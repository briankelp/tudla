import { Router } from "express";
import { z } from "zod";
import {
  aiSettings,
  campaignDrafts,
  campaigns,
  jobs,
  usage,
  and,
  eq,
  sql,
  type DB,
} from "@lead/database";
import {
  AISettingsInput,
  CampaignDraftInput,
  CampaignInput,
} from "@lead/contracts";
import type { Config } from "./config.js";
import { AppError, tokenHash } from "./security.js";
import { scoped, member } from "./repository.js";
import {
  admitJob,
  workspaceAI,
  resolveAI,
  getDraft,
  publicDraft,
  recentDrafts,
} from "./ai-store.js";

export function aiRoutes(db: DB, config: Config) {
  const router = Router({ mergeParams: true });
  router.get("/ai-settings", async (_req, res) =>
    res.json(
      await scoped(db, res.locals.who, (tx) =>
        workspaceAI(tx, res.locals.workspaceId, config),
      ),
    ),
  );
  router.put("/ai-settings", async (req, res) => {
    const data = AISettingsInput.parse(req.body);
    if (data.provider === "compatible" && !config.compatibleUrl)
      throw new AppError(
        409,
        "The host has not configured a compatible AI service.",
      );
    await scoped(db, res.locals.who, async (tx) => {
      await member(tx, res.locals.workspaceId, true);
      await tx
        .insert(aiSettings)
        .values({ workspaceId: res.locals.workspaceId, config: data })
        .onConflictDoUpdate({
          target: aiSettings.workspaceId,
          set: {
            config: data,
            revision: sql`${aiSettings.revision}+1`,
            updatedAt: new Date().toISOString(),
          },
        });
    });
    res.json(data);
  });
  router.get("/campaign-drafts", async (_req, res) =>
    res.json(
      await scoped(db, res.locals.who, (tx) =>
        recentDrafts(tx, res.locals.workspaceId),
      ),
    ),
  );
  router.get("/campaign-drafts/:id", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    res.json(
      publicDraft(
        await scoped(db, res.locals.who, (tx) =>
          getDraft(tx, res.locals.workspaceId, id),
        ),
      ),
    );
  });
  router.post("/campaign-drafts", async (req, res) => {
    const input = CampaignDraftInput.parse(req.body);
    const workspaceId = res.locals.workspaceId as string;
    const inputHash = tokenHash(
      JSON.stringify({
        brief: input.brief,
        answers: input.answers,
        current: input.current || null,
        parentId: input.parentId || null,
      }),
    );
    const draft = await scoped(db, res.locals.who, async (tx) => {
      // Serialize idempotent draft submissions, including after a client reconnects.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId},4))`,
      );
      const [previous] = await tx
        .select()
        .from(campaignDrafts)
        .where(
          and(
            eq(campaignDrafts.workspaceId, workspaceId),
            eq(campaignDrafts.id, input.requestId),
          ),
        );
      if (previous) {
        if (previous.inputHash !== inputHash)
          throw new AppError(
            409,
            "This request ID was already used for a different draft.",
          );
        return publicDraft(await getDraft(tx, workspaceId, previous.id));
      }
      if (input.parentId) await getDraft(tx, workspaceId, input.parentId);
      const ai = await resolveAI(tx, workspaceId, config);
      const [cached] = await tx
        .select()
        .from(campaignDrafts)
        .where(
          and(
            eq(campaignDrafts.workspaceId, workspaceId),
            eq(campaignDrafts.inputHash, inputHash),
            eq(campaignDrafts.aiConfig, ai),
            sql`${campaignDrafts.status} in ('ready','needs_clarification') and ${campaignDrafts.createdAt}>now()-interval '15 minutes'`,
          ),
        )
        .limit(1);
      if (!cached?.result) await admitJob(tx, workspaceId, config);
      const [row] = await tx
        .insert(campaignDrafts)
        .values({
          id: input.requestId,
          workspaceId,
          actorId: res.locals.who.id,
          brief: input.brief,
          answers: input.answers,
          current: input.current || null,
          parentId: input.parentId || null,
          inputHash,
          aiConfig: ai,
          ...(cached?.result
            ? {
                result: cached.result,
                status: cached.status,
                message: "Recent draft reused",
              }
            : {}),
        })
        .onConflictDoNothing()
        .returning();
      if (!row)
        throw new AppError(
          409,
          "This request ID is unavailable. Start a new draft.",
        );
      if (cached?.result) {
        await tx.insert(usage).values({
          workspaceId,
          provider: ai.provider,
          model: ai.model,
          stepKey: `${row.id}:draft:cache`,
          status: "cached",
          tokens: 0,
        });
        return publicDraft(row);
      }
      const [job] = await tx
        .insert(jobs)
        .values({
          workspaceId,
          actorId: res.locals.who.id,
          kind: "campaign_draft",
          payload: { draftId: row.id, ai, promptVersion: "campaign-draft-v1" },
          total: 1,
        })
        .returning();
      await tx
        .update(campaignDrafts)
        .set({ jobId: job!.id })
        .where(eq(campaignDrafts.id, row.id));
      return publicDraft({ ...row, jobId: job!.id });
    });
    res.status(202).json(draft);
  });
  router.post("/campaign-drafts/:id/accept", async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const fields = CampaignInput.parse(req.body);
    const workspaceId = res.locals.workspaceId as string;
    const result = await scoped(db, res.locals.who, async (tx) => {
      const [draft] = await tx
        .select()
        .from(campaignDrafts)
        .where(
          and(
            eq(campaignDrafts.workspaceId, workspaceId),
            eq(campaignDrafts.id, id),
          ),
        )
        .for("update");
      if (!draft) throw new AppError(404, "Draft not found.");
      if (draft.acceptedCampaignId) {
        const [existing] = await tx
          .select()
          .from(campaigns)
          .where(
            and(
              eq(campaigns.workspaceId, workspaceId),
              eq(campaigns.id, draft.acceptedCampaignId),
            ),
          );
        return existing;
      }
      const current = await getDraft(tx, workspaceId, id);
      if (!["ready", "needs_clarification"].includes(current.status))
        throw new AppError(
          409,
          "Wait for the draft to finish, or create a campaign manually.",
        );
      const [campaign] = await tx
        .insert(campaigns)
        .values({ ...fields, workspaceId })
        .returning();
      await tx
        .update(campaignDrafts)
        .set({
          acceptedCampaignId: campaign!.id,
          status: "accepted",
          message: "Campaign created",
        })
        .where(eq(campaignDrafts.id, id));
      return campaign;
    });
    res.status(201).json(result);
  });
  return router;
}

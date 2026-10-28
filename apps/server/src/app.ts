import express from "express";
import helmet from "helmet";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z, ZodError } from "zod";
import {
  and,
  eq,
  desc,
  inArray,
  sql,
  users,
  workspaces,
  memberships,
  campaigns,
  businesses,
  observations,
  entries,
  connections,
  jobs,
  usage,
  invites,
  views,
  type DB,
  type TX,
} from "@lead/database";
import {
  CampaignInput,
  BusinessInput,
  BusinessDetailsInput,
  businessKey,
  listingFacts,
  ConnectionInput,
  EntryPatch,
  ImportInput,
  JobInput,
  ProviderSchema,
  csvCell,
  type Prospect,
  providers as providerIds,
  llmProviders,
} from "@lead/contracts";
import { aiRoutes } from "./ai-routes.js";
import { workspaceAI, recentDrafts, resolveAI, admitJob } from "./ai-store.js";
import { liveReady, type Config } from "./config.js";
import { tokenVerifier, type VerifyToken, type Identity } from "./auth.js";
import { AppError, seal, maskKey, tokenHash } from "./security.js";
import {
  scoped,
  ensureUser,
  member,
  getCampaign,
  getProspects,
  importBusinesses,
  publicJob,
  connectionFor,
} from "./repository.js";

async function ensureNoBatchRun(tx: TX, workspaceId: string) {
  const result = await tx.execute(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${`${workspaceId}:batch`},2)) as locked`,
  );
  if (!result.rows[0]?.locked)
    throw new AppError(
      409,
      "A run is in progress. Try again when it finishes.",
    );
}

export function createApp(
  config: Config,
  db: DB | null,
  verify: VerifyToken = tokenVerifier(config),
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: [
            "'self'",
            ...(config.supabaseUrl ? [config.supabaseUrl] : []),
          ],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.get("/api/health", async (_req, res) => {
    if (db) {
      try {
        await db.execute(sql`select 1`);
      } catch {
        return res.status(503).json({ status: "unavailable" });
      }
    }
    return res.json({
      status: "ok",
      mode: liveReady(config) ? "live" : "demo",
    });
  });
  app.get("/api/config", (_req, res) =>
    res.json({
      authEnabled: liveReady(config),
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.publishableKey,
      providers: providerIds,
      compatibleAvailable: Boolean(config.compatibleUrl),
    }),
  );
  const api = express.Router();
  api.use(async (req, res, next) => {
    try {
      if (!db || config.demoOnly)
        throw new AppError(
          503,
          "Live workspaces are unavailable on this deployment.",
        );
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin &&
        req.headers.origin !== config.origin
      )
        throw new AppError(403, "This origin is not allowed.");
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      if (!token) throw new AppError(401, "Sign in to use your workspace.");
      res.locals.who = await verify(token);
      next();
    } catch (e) {
      next(e);
    }
  });
  const who = (res: express.Response) => res.locals.who as Identity;
  api.get("/bootstrap", async (_req, res) => {
    const result = await scoped(db!, who(res), async (tx) => {
      await ensureUser(tx, who(res));
      let rows = await tx
        .select({
          id: workspaces.id,
          name: workspaces.name,
          role: memberships.role,
        })
        .from(workspaces)
        .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
        .where(eq(memberships.userId, who(res).id));
      if (!rows.length) {
        await tx.execute(sql`select lead.create_workspace(${"My workspace"})`);
        rows = await tx
          .select({
            id: workspaces.id,
            name: workspaces.name,
            role: memberships.role,
          })
          .from(workspaces)
          .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
          .where(eq(memberships.userId, who(res).id));
      }
      return { user: who(res), workspaces: rows };
    });
    res.json(result);
  });
  api.post("/workspaces", async (req, res) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(req.body);
    res.status(201).json(
      await scoped(db!, who(res), async (tx) => {
        await ensureUser(tx, who(res));
        const r = await tx.execute(
          sql`select lead.create_workspace(${name}) as id`,
        );
        return { id: r.rows[0]?.id };
      }),
    );
  });
  api.post("/invitations/accept", async (req, res) => {
    const { token } = z
      .object({ token: z.string().min(32).max(128) })
      .parse(req.body);
    res.json(
      await scoped(db!, who(res), async (tx) => {
        await ensureUser(tx, who(res));
        const r = await tx.execute(
          sql`select lead.accept_invite(${tokenHash(token)}) as id`,
        );
        return { id: r.rows[0]?.id };
      }),
    );
  });
  api.use("/workspaces/:workspaceId", async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params.workspaceId);
      res.locals.workspaceId = id;
      res.locals.member = await scoped(db!, who(res), (tx) => member(tx, id));
      next();
    } catch (e) {
      next(e);
    }
  });
  const ws = (res: express.Response) => res.locals.workspaceId as string;
  api.use("/workspaces/:workspaceId", aiRoutes(db!, config));
  api.delete("/workspaces/:workspaceId", async (req, res) => {
    const { confirmation } = z
      .object({ confirmation: z.string().max(100) })
      .parse(req.body);
    if (res.locals.member.role !== "owner")
      throw new AppError(403, "Only the workspace owner can delete it.");
    await scoped(db!, who(res), (tx) =>
      tx.execute(
        sql`select lead.delete_workspace(${ws(res)}::uuid,${confirmation})`,
      ),
    );
    res.json({ removed: true });
  });
  api.delete("/workspaces/:workspaceId/members/:userId", async (req, res) => {
    const userId = z.string().uuid().parse(req.params.userId);
    await scoped(db!, who(res), async (tx) => {
      await member(tx, ws(res), true);
      await tx.execute(
        sql`select lead.remove_member(${ws(res)}::uuid,${userId}::uuid)`,
      );
    });
    res.status(204).end();
  });
  api.get("/workspaces/:workspaceId", async (_req, res) =>
    res.json(
      await scoped(db!, who(res), async (tx) => {
        const workspaceId = ws(res);
        const [workspace] = await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId));
        const people = await tx
          .select({
            userId: users.id,
            email: users.email,
            role: memberships.role,
          })
          .from(memberships)
          .innerJoin(users, eq(memberships.userId, users.id))
          .where(eq(memberships.workspaceId, workspaceId));
        const providers = await tx
          .select({
            provider: connections.provider,
            mask: connections.mask,
            enabled: connections.enabled,
            allowMembers: connections.allowMembers,
            updatedAt: connections.updatedAt,
          })
          .from(connections)
          .where(eq(connections.workspaceId, workspaceId));
        const totals = await tx.execute(
          sql`select provider,model,status,count(*) filter(where status<>'cached')::int as calls,count(*) filter(where status='cached')::int as "cacheHits",sum(tokens)::int as tokens,count(*) filter(where model is not null and tokens is null and status<>'cached')::int as unreported,coalesce(sum(credits),0)::int as credits from lead.usage where workspace_id=${workspaceId} and created_at>=now()-interval '30 days' group by provider,model,status`,
        );
        return {
          workspace: { ...workspace, role: res.locals.member.role },
          aiSettings: await workspaceAI(tx, workspaceId, config),
          drafts: await recentDrafts(tx, workspaceId),
          campaigns: await tx
            .select()
            .from(campaigns)
            .where(eq(campaigns.workspaceId, workspaceId))
            .orderBy(desc(campaigns.createdAt)),
          prospects: await getProspects(tx, workspaceId),
          members: people,
          connections: providers,
          jobs: (
            await tx
              .select()
              .from(jobs)
              .where(eq(jobs.workspaceId, workspaceId))
              .orderBy(desc(jobs.createdAt))
              .limit(30)
          ).map(publicJob),
          usage: totals.rows,
          views: await tx
            .select()
            .from(views)
            .where(eq(views.workspaceId, workspaceId)),
        };
      }),
    ),
  );
  api.post("/workspaces/:workspaceId/campaigns", async (req, res) => {
    const data = CampaignInput.parse(req.body);
    res.status(201).json(
      await scoped(
        db!,
        who(res),
        async (tx) =>
          (
            await tx
              .insert(campaigns)
              .values({ ...data, workspaceId: ws(res) })
              .returning()
          )[0],
      ),
    );
  });
  api.patch(
    "/workspaces/:workspaceId/campaigns/:campaignId",
    async (req, res) => {
      const id = z.string().uuid().parse(req.params.campaignId);
      const data = CampaignInput.parse(req.body);
      const result = await scoped(db!, who(res), async (tx) => {
        const [saved] = await tx
          .update(campaigns)
          .set(data)
          .where(and(eq(campaigns.workspaceId, ws(res)), eq(campaigns.id, id)))
          .returning();
        if (!saved) throw new AppError(404, "Campaign not found.");
        return saved;
      });
      res.json(result);
    },
  );
  api.delete(
    "/workspaces/:workspaceId/campaigns/:campaignId",
    async (req, res) => {
      const id = z.string().uuid().parse(req.params.campaignId);
      const removed = await scoped(db!, who(res), async (tx) => {
        const [campaign] = await tx
          .select({ id: campaigns.id })
          .from(campaigns)
          .where(and(eq(campaigns.workspaceId, ws(res)), eq(campaigns.id, id)))
          .for("update");
        if (!campaign) throw new AppError(404, "Campaign not found.");
        await ensureNoBatchRun(tx, ws(res));
        return (
          await tx
            .delete(campaigns)
            .where(
              and(eq(campaigns.workspaceId, ws(res)), eq(campaigns.id, id)),
            )
            .returning({ id: campaigns.id })
        ).length;
      });
      res.json({ removed: removed > 0 });
    },
  );
  api.post("/workspaces/:workspaceId/entries", async (req, res) => {
    const input = z
      .object({ campaignId: z.string().uuid(), business: BusinessInput })
      .parse(req.body);
    const result = await scoped(db!, who(res), async (tx) => {
      const result = await importBusinesses(
        tx,
        ws(res),
        input.campaignId,
        [input.business],
        "Manual entry",
      );
      if (!result.added)
        throw new AppError(409, "This business is already in the campaign.");
      return result;
    });
    res.status(201).json(result);
  });
  api.post("/workspaces/:workspaceId/import", async (req, res) => {
    const input = ImportInput.parse(req.body);
    res.json(
      await scoped(db!, who(res), (tx) =>
        importBusinesses(
          tx,
          ws(res),
          input.campaignId,
          input.businesses,
          "CSV import",
        ),
      ),
    );
  });
  api.put(
    "/workspaces/:workspaceId/businesses/:businessId",
    async (req, res) => {
      const id = z.string().uuid().parse(req.params.businessId);
      const details = BusinessDetailsInput.parse(req.body);
      const result = await scoped(db!, who(res), async (tx) => {
        const [row] = await tx
          .select()
          .from(businesses)
          .where(
            and(eq(businesses.workspaceId, ws(res)), eq(businesses.id, id)),
          );
        if (!row) throw new AppError(404, "Business not found.");
        const business = BusinessInput.parse({ ...row.data, ...details });
        await tx
          .update(businesses)
          .set({ data: business, externalKey: businessKey(business) })
          .where(
            and(eq(businesses.workspaceId, ws(res)), eq(businesses.id, id)),
          );
        await tx.insert(observations).values({
          workspaceId: ws(res),
          businessId: id,
          provider: "Manual correction",
          facts: listingFacts(
            { ...business, sourceUrl: "" },
            "Manual correction",
            new Date().toISOString(),
          ),
        });
        return business;
      });
      res.json(result);
    },
  );
  api.patch("/workspaces/:workspaceId/entries/:entryId", async (req, res) => {
    const id = z.string().uuid().parse(req.params.entryId);
    const data = EntryPatch.parse(req.body);
    res.json(
      await scoped(db!, who(res), async (tx) => {
        if (data.assignedTo) {
          const [m] = await tx
            .select()
            .from(memberships)
            .where(
              and(
                eq(memberships.workspaceId, ws(res)),
                eq(memberships.userId, data.assignedTo),
              ),
            );
          if (!m)
            throw new AppError(400, "Assignee must belong to this workspace.");
        }
        const [r] = await tx
          .update(entries)
          .set(data)
          .where(and(eq(entries.workspaceId, ws(res)), eq(entries.id, id)))
          .returning();
        if (!r) throw new AppError(404, "Prospect not found.");
        return r;
      }),
    );
  });
  api.delete("/workspaces/:workspaceId/entries/:entryId", async (req, res) => {
    const id = z.string().uuid().parse(req.params.entryId);
    const removed = await scoped(db!, who(res), async (tx) => {
      const [entry] = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(and(eq(entries.workspaceId, ws(res)), eq(entries.id, id)))
        .for("update");
      if (!entry) throw new AppError(404, "Prospect not found.");
      await ensureNoBatchRun(tx, ws(res));
      return (
        await tx
          .delete(entries)
          .where(and(eq(entries.workspaceId, ws(res)), eq(entries.id, id)))
          .returning({ id: entries.id })
      ).length;
    });
    res.json({ removed: removed > 0 });
  });
  api.delete("/workspaces/:workspaceId/entries", async (req, res) => {
    const { entryIds } = z
      .object({
        entryIds: z.array(z.string().uuid()).min(1).max(2000),
      })
      .strict()
      .parse(req.body);
    const ids = [...new Set(entryIds)];
    const removed = await scoped(db!, who(res), async (tx) => {
      const found = await tx
        .select({ id: entries.id })
        .from(entries)
        .where(and(eq(entries.workspaceId, ws(res)), inArray(entries.id, ids)))
        .for("update");
      if (found.length !== ids.length)
        throw new AppError(404, "One or more prospects were not found.");
      await ensureNoBatchRun(tx, ws(res));
      return (
        await tx
          .delete(entries)
          .where(
            and(eq(entries.workspaceId, ws(res)), inArray(entries.id, ids)),
          )
          .returning({ id: entries.id })
      ).length;
    });
    res.json({ removed });
  });
  api.put(
    "/workspaces/:workspaceId/connections/:provider",
    async (req, res) => {
      const provider = ProviderSchema.parse(req.params.provider);
      const data = ConnectionInput.parse(req.body);
      if (!config.encryptionKey)
        throw new AppError(503, "Provider connections are unavailable.");
      await scoped(db!, who(res), async (tx) => {
        await member(tx, ws(res), true);
        const values = {
          workspaceId: ws(res),
          provider,
          encryptedKey: seal(
            config.encryptionKey,
            data.key,
            `${ws(res)}:${provider}`,
            config.encryptionVersion,
          ),
          mask: maskKey(data.key),
          enabled: data.enabled,
          allowMembers: data.allowMembers,
          updatedAt: new Date().toISOString(),
        };
        await tx
          .insert(connections)
          .values(values)
          .onConflictDoUpdate({
            target: [connections.workspaceId, connections.provider],
            set: values,
          });
      });
      res.json({
        provider,
        mask: maskKey(data.key),
        enabled: data.enabled,
        allowMembers: data.allowMembers,
      });
    },
  );
  api.delete(
    "/workspaces/:workspaceId/connections/:provider",
    async (req, res) => {
      const provider = ProviderSchema.parse(req.params.provider);
      await scoped(db!, who(res), async (tx) => {
        await member(tx, ws(res), true);
        await tx
          .delete(connections)
          .where(
            and(
              eq(connections.workspaceId, ws(res)),
              eq(connections.provider, provider),
            ),
          );
      });
      res.status(204).end();
    },
  );
  api.post("/workspaces/:workspaceId/jobs", async (req, res) => {
    const input = JobInput.parse(req.body);
    const result = await scoped(db!, who(res), async (tx) => {
      await admitJob(tx, ws(res), config);
      let ai =
        input.kind === "analysis"
          ? await resolveAI(tx, ws(res), config)
          : undefined;
      const provider =
        input.kind === "discovery"
          ? "serpapi"
          : input.kind === "analysis"
            ? ai!.provider
            : input.kind === "enrichment"
              ? "firecrawl"
              : "provider" in input
                ? input.provider
                : "groq";
      const connection = await connectionFor(tx, ws(res), provider);
      if (
        input.kind === "connection_test" &&
        (llmProviders as readonly string[]).includes(provider)
      ) {
        const selected = await workspaceAI(tx, ws(res), config);
        ai = {
          provider: provider as typeof selected.provider,
          model:
            selected.provider === provider
              ? selected.model
              : provider === "google"
                ? "gemini-2.5-flash"
                : config.groqModel,
          responseMode:
            selected.provider === provider
              ? selected.responseMode
              : "structured",
          revision: selected.revision,
          connectionId: connection.id,
        };
        if (provider === "compatible" && !config.compatibleUrl)
          throw new AppError(
            409,
            "The host has not configured a compatible AI service.",
          );
      }
      if ("campaignId" in input) {
        await getCampaign(tx, ws(res), input.campaignId);
        if ("entryIds" in input) {
          const rows = await tx
            .select({ id: entries.id })
            .from(entries)
            .where(
              and(
                eq(entries.workspaceId, ws(res)),
                eq(entries.campaignId, input.campaignId),
                inArray(entries.id, input.entryIds),
              ),
            );
          if (rows.length !== new Set(input.entryIds).size)
            throw new AppError(400, "Some selected prospects are unavailable.");
        }
      }
      const [j] = await tx
        .insert(jobs)
        .values({
          workspaceId: ws(res),
          actorId: who(res).id,
          campaignId: "campaignId" in input ? input.campaignId : null,
          kind: input.kind,
          payload: { ...input, ...(ai ? { ai } : {}) },
          total:
            "entryIds" in input
              ? input.entryIds.length
              : input.kind === "connection_test"
                ? 1
                : input.limit,
        })
        .returning();
      return publicJob(j!);
    });
    res.status(202).json(result);
  });
  api.post("/workspaces/:workspaceId/jobs/:jobId/:action", async (req, res) => {
    const id = z.string().uuid().parse(req.params.jobId);
    const action = z.enum(["cancel", "resume"]).parse(req.params.action);
    res.json(
      await scoped(db!, who(res), async (tx) => {
        const [j] = await tx
          .select()
          .from(jobs)
          .where(and(eq(jobs.workspaceId, ws(res)), eq(jobs.id, id)));
        if (!j) throw new AppError(404, "Run not found.");
        if (action === "resume" && !["failed", "paused"].includes(j.status))
          throw new AppError(409, "This run cannot be resumed.");
        if (
          action === "cancel" &&
          !["queued", "running", "paused"].includes(j.status)
        )
          throw new AppError(409, "This run is no longer active.");
        const [r] = await tx
          .update(jobs)
          .set({
            status: action === "cancel" ? "cancelled" : "queued",
            message: action === "cancel" ? "Cancelled" : "Queued to resume",
            dispatchedAt: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(jobs.id, id))
          .returning();
        return publicJob(r!);
      }),
    );
  });
  api.post("/workspaces/:workspaceId/invitations", async (req, res) => {
    const { email } = z
      .object({ email: z.string().email().max(200) })
      .parse(req.body);
    const token = randomBytes(32).toString("hex");
    await scoped(db!, who(res), async (tx) => {
      await member(tx, ws(res), true);
      await tx.insert(invites).values({
        workspaceId: ws(res),
        email: email.toLowerCase(),
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
    });
    res.status(201).json({ url: `${config.origin}/?invite=${token}` });
  });
  api.post("/workspaces/:workspaceId/views", async (req, res) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        filters: z.record(z.string(), z.string().max(200)),
      })
      .parse(req.body);
    res.status(201).json(
      await scoped(
        db!,
        who(res),
        async (tx) =>
          (
            await tx
              .insert(views)
              .values({ ...input, workspaceId: ws(res) })
              .returning()
          )[0],
      ),
    );
  });
  api.post("/workspaces/:workspaceId/export", async (req, res) => {
    const input = z
      .object({ entryIds: z.array(z.string().uuid()).max(2000) })
      .parse(req.body);
    const list = await scoped(db!, who(res), (tx) => getProspects(tx, ws(res)));
    const wanted = new Set(input.entryIds);
    const selected = list.filter((p) => wanted.has(p.id));
    if (selected.length !== wanted.size)
      throw new AppError(404, "Some selected prospects are unavailable.");
    res.type("text/csv").attachment("prospects.csv").send(exportCsv(selected));
  });
  app.use("/api", api);
  app.use("/api", (_req, res) =>
    res.status(404).json({ message: "Not found." }),
  );
  const web = resolve(import.meta.dirname, "../../web/dist");
  if (existsSync(web)) {
    app.use(express.static(web));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(web, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof ZodError)
        return res.status(400).json({
          message: error.issues
            .map((i) => `${i.path.join(".") || "Input"}: ${i.message}`)
            .slice(0, 3)
            .join("; "),
        });
      if (error instanceof AppError)
        return res.status(error.status).json({ message: error.message });
      const code =
        (error as { cause?: { code?: string }; code?: string })?.cause?.code ||
        (error as { code?: string })?.code;
      if (code === "P0001")
        return res.status(400).json({
          message: _req.path.includes("invitation")
            ? "This invitation is invalid or expired."
            : "The workspace could not be created. Check the name and workspace limit.",
        });
      if (code === "23505")
        return res
          .status(409)
          .json({ message: "This record already exists in this workspace." });
      if (["23503", "23514", "42501"].includes(code || ""))
        return res.status(400).json({
          message: "This change is not allowed for the selected workspace.",
        });
      console.error(
        JSON.stringify({ event: "request_failed", code: code || "internal" }),
      );
      return res.status(500).json({
        message:
          "The request could not be completed. Saved records are unchanged.",
      });
    },
  );
  return app;
}
export function exportCsv(list: Prospect[]) {
  return [
    [
      "Business",
      "Category",
      "Address",
      "Phone",
      "Email",
      "Website",
      "Stage",
      "Notes",
      "Follow-up on",
      "Source",
      "Observed at",
      "AI summary",
    ],
    ...list.map((p) => [
      p.business.name,
      p.business.category,
      p.business.address,
      p.business.phone,
      p.business.email,
      p.business.website,
      p.stage,
      p.notes,
      p.followUpOn || "",
      p.facts[0]?.source,
      p.facts[0]?.observedAt,
      p.analysis?.summary || "",
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

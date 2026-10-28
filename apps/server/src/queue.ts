import { PgBoss } from "pg-boss";
import {
  database,
  withIdentity,
  sql,
  eq,
  and,
  jobs,
  usage,
  observations,
  analyses,
  entries,
  memberships,
  users,
  campaignDrafts,
  type DB,
} from "@lead/database";
import {
  AISettingsInput,
  llmProviders,
  type Business,
  type Campaign,
  type Provider,
} from "@lead/contracts";
import type { Config } from "./config.js";
import { AppError, unseal } from "./security.js";
import {
  scoped,
  member,
  connectionFor,
  reserveCall,
  getCampaign,
  getProspects,
  importBusinesses,
} from "./repository.js";
import {
  searchBusinesses,
  enrichWebsite,
  testConnection,
  type Fetcher,
} from "./providers.js";
import { AIError, generateStructured } from "./ai.js";
import { draftCampaign, researchBusiness } from "./ai-tasks.js";
import { getDraft, type AIExecution } from "./ai-store.js";
import { z } from "zod";
export async function runJob(
  db: DB,
  config: Config,
  identity: { id: string; email: string },
  jobId: string,
  fetcher?: Fetcher,
) {
  const who = identity;
  const get = () =>
    scoped(
      db,
      who,
      async (tx) => (await tx.select().from(jobs).where(eq(jobs.id, jobId)))[0],
    );
  let job = await get();
  if (!job || !["queued", "running"].includes(job.status)) return;
  const lock = await db.$client.connect();
  let locked = false;
  try {
    locked = Boolean(
      (
        await lock.query(
          "select pg_try_advisory_lock(hashtextextended($1,2)) as locked",
          [
            `${job.workspaceId}:${job.kind === "campaign_draft" ? "draft" : "batch"}`,
          ],
        )
      ).rows[0]?.locked,
    );
    if (!locked) throw new Error("workspace_busy");
    job = await get();
    if (!job || !["queued", "running"].includes(job.status)) return;
    const workspaceId = job.workspaceId;
    const patch = async (values: Partial<typeof jobs.$inferInsert>) =>
      scoped(db, who, async (tx) => {
        await tx
          .update(jobs)
          .set({ ...values, updatedAt: new Date().toISOString() })
          .where(and(eq(jobs.id, jobId), sql`${jobs.status} <> 'cancelled'`));
      });
    await patch({ status: "running", message: "Starting" });
    let checkpoint = { ...job.checkpoint };
    let completed = job.progress;
    let failed = Number(checkpoint.failed || 0);
    const savedAI = job.payload.ai as AIExecution | undefined;
    const ai = savedAI
      ? {
          ...AISettingsInput.parse(savedAI),
          connectionId: savedAI.connectionId,
          revision: savedAI.revision,
        }
      : {
          provider: "groq" as const,
          model: config.groqModel,
          responseMode: "structured" as const,
          connectionId: "",
          revision: 0,
        };
    const active = async () => {
      const current = await get();
      if (!current || current.status === "cancelled")
        throw new AppError(409, "Run cancelled.");
      await scoped(db, who, (tx) => member(tx, workspaceId));
    };
    async function call<T>(
      provider: Provider,
      step: string,
      operation: (key: string) => Promise<{
        value: T;
        tokens?: number | null;
        credits?: number;
        inputTokens?: number | null;
        outputTokens?: number | null;
        latencyMs?: number;
        responseId?: string;
      }>,
      model?: string,
    ): Promise<T> {
      await active();
      if (Object.hasOwn(checkpoint, `result:${step}`))
        return checkpoint[`result:${step}`] as T;
      const slot = `${workspaceId}:${provider}`;
      const reservedSlot = (
        await lock.query(
          "select pg_try_advisory_lock(hashtextextended($1,3)) as locked",
          [slot],
        )
      ).rows[0]?.locked;
      if (!reservedSlot) throw Error("workspace_busy");
      try {
        const connection = await scoped(db, who, async (tx) => {
          const c = await connectionFor(tx, workspaceId, provider);
          if (model && ai.connectionId && c.id !== ai.connectionId)
            throw new AppError(
              409,
              "The selected AI connection was removed. Start a new run.",
            );
          const reservation = await reserveCall(
            tx,
            workspaceId,
            jobId,
            provider,
            `${jobId}:${step}`,
            config.dailyLimit,
          );
          if (model)
            await tx
              .update(usage)
              .set({ model })
              .where(eq(usage.id, reservation.id));
          return { ...c, reservationId: reservation.id };
        });
        try {
          const key = unseal(
            config.encryptionKeys,
            connection.encryptedKey,
            `${workspaceId}:${provider}`,
          );
          const r = await operation(key);
          checkpoint[`result:${step}`] = r.value;
          await scoped(db, who, async (tx) => {
            await tx
              .update(usage)
              .set({
                status: "succeeded",
                tokens: r.tokens ?? null,
                credits: r.credits || 0,
                inputTokens: r.inputTokens ?? null,
                outputTokens: r.outputTokens ?? null,
                latencyMs: r.latencyMs ?? null,
                responseId: r.responseId ?? null,
              })
              .where(
                and(
                  eq(usage.workspaceId, workspaceId),
                  eq(usage.id, connection.reservationId),
                ),
              );
            await tx
              .update(jobs)
              .set({ checkpoint })
              .where(and(eq(jobs.id, jobId), sql`${jobs.status}<>'cancelled'`));
          });
          return r.value;
        } catch (error) {
          await scoped(db, who, async (tx) => {
            await tx
              .update(usage)
              .set({
                status:
                  error instanceof AIError
                    ? error.uncertain
                      ? "uncertain"
                      : error.code === "invalid_output"
                        ? "invalid_output"
                        : "failed"
                    : error instanceof AppError && error.status !== 504
                      ? "failed"
                      : "uncertain",
                ...(error instanceof AIError
                  ? {
                      tokens: error.tokens,
                      inputTokens: error.inputTokens,
                      outputTokens: error.outputTokens,
                      latencyMs: error.latencyMs,
                      responseId: error.responseId ?? null,
                      errorCode: error.code,
                    }
                  : {}),
              })
              .where(
                and(
                  eq(usage.workspaceId, workspaceId),
                  eq(usage.id, connection.reservationId),
                ),
              );
          });
          throw error;
        }
      } finally {
        await lock.query("select pg_advisory_unlock(hashtextextended($1,3))", [
          slot,
        ]);
      }
    }
    async function done(step: string) {
      checkpoint[step] = true;
      delete checkpoint[`result:${step}`];
      checkpoint.failed = failed;
      completed++;
      await patch({
        progress: completed,
        checkpoint,
        message: `Processed ${completed} of ${job!.total}`,
      });
    }
    if (job.kind === "connection_test") {
      const provider = job.payload.provider as Provider;
      await call(
        provider,
        "test",
        async (key) => {
          if ((llmProviders as readonly string[]).includes(provider)) {
            const r = await generateStructured(
              {
                ...ai,
                provider: provider as typeof ai.provider,
                key,
                baseUrl: config.compatibleUrl,
              },
              {
                system: 'Return the object {"ok":true}.',
                input: { check: true },
                schema: z.object({ ok: z.literal(true) }),
                jsonSchema: {
                  type: "object",
                  additionalProperties: false,
                  properties: { ok: { type: "boolean" } },
                  required: ["ok"],
                },
              },
              fetcher,
            );
            return { ...r, value: true };
          }
          await testConnection(provider, key, fetcher);
          return { value: true, credits: provider === "firecrawl" ? 1 : 0 };
        },
        (llmProviders as readonly string[]).includes(provider)
          ? ai.model
          : undefined,
      );
      await patch({
        status: "completed",
        progress: 1,
        total: 1,
        message: "Connection works",
      });
      return;
    }
    if (job.kind === "campaign_draft") {
      const draft = await scoped(db, who, (tx) =>
        getDraft(tx, workspaceId, String(job!.payload.draftId)),
      );
      const result = await call(
        ai.provider,
        "draft",
        (key) =>
          draftCampaign(
            { ...ai, key, baseUrl: config.compatibleUrl },
            {
              brief: draft.brief,
              answers: draft.answers,
              ...(draft.current ? { current: draft.current } : {}),
            },
            fetcher,
          ),
        ai.model,
      );
      await scoped(db, who, async (tx) => {
        const [current] = await tx
          .select()
          .from(jobs)
          .where(eq(jobs.id, jobId));
        if (current?.status === "cancelled") return;
        await tx
          .update(campaignDrafts)
          .set({
            result,
            status: result.status,
            message:
              result.status === "ready"
                ? "Ready to review"
                : "More details needed",
          })
          .where(
            and(
              eq(campaignDrafts.workspaceId, workspaceId),
              eq(campaignDrafts.id, draft.id),
            ),
          );
      });
      await patch({
        status: "completed",
        progress: 1,
        total: 1,
        message: "Draft ready to review",
        checkpoint: { draft: true },
      });
      return;
    }
    const campaign = await scoped(db, who, (tx) =>
      getCampaign(tx, workspaceId, job!.campaignId!),
    );
    if (job.kind === "discovery") {
      if (!checkpoint.discovery) {
        await patch({ message: "Searching businesses" });
        const query = String(job.payload.query)
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase();
        const limit = Number(job.payload.limit);
        const cached = await scoped(db, who, async (tx) => {
          // A cache hit still requires permission to use this workspace's source.
          await connectionFor(tx, workspaceId, "serpapi");
          const recent = await tx
            .select()
            .from(jobs)
            .where(
              and(
                eq(jobs.workspaceId, workspaceId),
                eq(jobs.kind, "discovery"),
                eq(jobs.status, "completed"),
                sql`${jobs.updatedAt} > now() - interval '1 hour'`,
              ),
            )
            .orderBy(sql`${jobs.updatedAt} desc`)
            .limit(25);
          return recent.find(
            (r) =>
              String(r.payload.query)
                .trim()
                .replace(/\s+/g, " ")
                .toLowerCase() === query &&
              Number(r.payload.limit) >= limit &&
              Array.isArray(r.checkpoint.results) &&
              Date.parse(String(r.checkpoint.observedAt)) >
                Date.now() - 3600000,
          );
        });
        const list = cached
          ? (cached.checkpoint.results as Business[]).slice(0, limit)
          : await call("serpapi", "discovery", async (key) => ({
              value: await searchBusinesses(
                key,
                String(job!.payload.query),
                limit,
                fetcher,
              ),
              credits: 1,
            }));
        const observedAt = cached
          ? String(cached.checkpoint.observedAt)
          : new Date().toISOString();
        await scoped(db, who, (tx) =>
          importBusinesses(
            tx,
            workspaceId,
            campaign.id,
            list,
            "SerpApi Google Maps",
            observedAt,
          ),
        );
        if (cached)
          await scoped(db, who, (tx) =>
            tx.insert(usage).values({
              workspaceId,
              jobId,
              provider: "serpapi",
              status: "cached",
              stepKey: `${jobId}:discovery:cache`,
            }),
          );
        checkpoint.discovery = true;
        checkpoint.results = list;
        checkpoint.observedAt = observedAt;
        checkpoint.cacheHit = Boolean(cached);
        await patch({
          checkpoint,
          status: "completed",
          progress: list.length,
          total: list.length,
          message: `${list.length} businesses returned${cached ? " from recent workspace search" : ""}`,
        });
      } else await patch({ status: "completed", message: "Search complete" });
      return;
    }
    const prospects = await scoped(db, who, (tx) =>
      getProspects(tx, workspaceId, campaign.id),
    );
    const selected = new Set(job.payload.entryIds as string[]);
    const list = prospects.filter((p) => selected.has(p.id));
    for (const prospect of list) {
      const step = `${job.kind}:${prospect.id}`;
      if (checkpoint[step]) continue;
      await active();
      try {
        if (job.kind === "analysis") {
          const result = await call(
            ai.provider,
            step,
            (key) =>
              researchBusiness(
                { ...ai, key, baseUrl: config.compatibleUrl },
                campaign as Campaign,
                prospect.facts,
                fetcher,
              ),
            ai.model,
          );
          await scoped(db, who, async (tx) => {
            await tx.insert(analyses).values({
              workspaceId,
              entryId: prospect.id,
              status: "completed",
              data: result,
              inputFacts: prospect.facts,
              model: ai.model,
              provider: ai.provider,
              campaignSnapshot: campaign,
              promptVersion: "research-v1",
            });
          });
        } else {
          if (!prospect.business.website)
            throw new AppError(400, "Website not listed in source.");
          const page = await call("firecrawl", step, async (key) => ({
            value: await enrichWebsite(key, prospect.business.website, fetcher),
            credits: 1,
          }));
          await scoped(db, who, async (tx) => {
            await tx.insert(observations).values({
              workspaceId,
              businessId: prospect.businessId,
              provider: "Firecrawl",
              facts: [
                {
                  id: `website:${prospect.businessId}`,
                  label: "Website excerpt",
                  value: page.markdown,
                  source: "Firecrawl",
                  observedAt: new Date().toISOString(),
                  url: page.url,
                },
              ],
            });
          });
        }
      } catch (error) {
        if (error instanceof AIError && error.code !== "invalid_output")
          throw error;
        if (
          error instanceof AppError &&
          [401, 403, 429, 504].includes(error.status)
        )
          throw error;
        failed++;
        if (job.kind === "analysis")
          await scoped(db, who, async (tx) => {
            await tx.insert(analyses).values({
              workspaceId,
              entryId: prospect.id,
              status: "failed",
              data: null,
              inputFacts: prospect.facts,
              error:
                error instanceof AppError
                  ? error.message
                  : "Analysis failed. Source facts are saved.",
              model: ai.model,
              provider: ai.provider,
              campaignSnapshot: campaign,
              promptVersion: "research-v1",
            });
          });
      }
      await done(step);
    }
    await patch({
      status: failed ? "partial" : "completed",
      message: failed
        ? `${failed} records need attention`
        : `${completed} records processed`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "workspace_busy")
      throw error;
    const current = await get();
    if (current && current.status !== "cancelled")
      await scoped(db, who, async (tx) => {
        await tx
          .update(jobs)
          .set({
            status:
              error instanceof AppError && error.status === 429
                ? "paused"
                : "failed",
            message:
              error instanceof AppError
                ? error.message
                : "Processing stopped. Completed results are saved.",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(jobs.id, jobId));
      });
  } finally {
    if (locked)
      await lock.query("select pg_advisory_unlock(hashtextextended($1,2))", [
        `${job?.workspaceId}:${job?.kind === "campaign_draft" ? "draft" : "batch"}`,
      ]);
    lock.release();
  }
}
export async function startQueue(
  db: DB,
  config: Config,
  worker: boolean,
  fetcher?: Fetcher,
) {
  const boss = new PgBoss({
    connectionString: config.queueUrl,
    max: 2,
    schema: "pgboss",
  });
  boss.on("error", () =>
    console.error(JSON.stringify({ event: "queue_error" })),
  );
  await boss.start();
  await boss.createQueue("lead-work", {
    policy: "singleton",
    retryLimit: 12,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 1800,
    retentionSeconds: 86400,
  });
  await boss.createQueue("lead-maintenance", {
    retryLimit: 3,
    retryDelay: 60,
    retentionSeconds: 86400,
  });
  await boss.createQueue("lead-draft", {
    policy: "singleton",
    retryLimit: 12,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 180,
    retentionSeconds: 86400,
  });
  await boss.schedule("lead-maintenance", "0 3 * * *", {});
  const system = database(config.queueUrl, 1);
  if (worker)
    await boss.work("lead-maintenance", async () => {
      await system.db.execute(sql`select lead.prune_history(90)`);
    });
  let pumping = false;
  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      const r = await system.db.execute(sql`select * from lead.pending_jobs()`);
      for (const row of r.rows) {
        await boss.send(
          row.kind === "campaign_draft" ? "lead-draft" : "lead-work",
          { jobId: row.id },
          { singletonKey: String(row.workspace_id) },
        );
        await system.db.execute(
          sql`select lead.mark_dispatched(${row.id}::uuid)`,
        );
      }
    } catch {
      console.error(JSON.stringify({ event: "job_dispatch_error" }));
    } finally {
      pumping = false;
    }
  };
  const timer = setInterval(() => void pump(), 5000);
  timer.unref();
  await pump();
  // Each running job holds one connection for its advisory lock. Leave one
  // connection free for its transactional reads/writes across both queues.
  let slots = config.poolSize - 1;
  const waiting: (() => void)[] = [];
  const withSlot = async (work: () => Promise<void>) => {
    if (slots > 0) slots--;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else slots++;
    }
  };
  if (worker)
    for (const queueName of ["lead-work", "lead-draft"])
      await boss.work<{ jobId: string }>(
        queueName,
        { localConcurrency: 2, pollingIntervalSeconds: 1 },
        async (batch) => {
          for (const task of batch) {
            const r = await system.db.execute(
              sql`select * from lead.job_identity(${task.data.jobId}::uuid)`,
            );
            const row = r.rows[0];
            if (row)
              await withSlot(() =>
                runJob(
                  db,
                  config,
                  { id: String(row.user_id), email: String(row.email) },
                  task.data.jobId,
                  fetcher,
                ),
              );
          }
        },
      );
  return {
    pump,
    stop: async () => {
      clearInterval(timer);
      await boss.stop({ graceful: true, timeout: 65000 });
      await system.pool.end();
    },
  };
}

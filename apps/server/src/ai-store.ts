import {
  aiSettings,
  campaignDrafts,
  jobs,
  eq,
  and,
  desc,
  sql,
  type TX,
} from "@lead/database";
import {
  AISettingsInput,
  type AISettings,
  type CampaignDraft,
} from "@lead/contracts";
import type { Config } from "./config.js";
import { AppError } from "./security.js";
import { connectionFor } from "./repository.js";

export type AIExecution = AISettings & {
  connectionId: string;
  revision: number;
};
export async function workspaceAI(tx: TX, workspaceId: string, config: Config) {
  const [row] = await tx
    .select()
    .from(aiSettings)
    .where(eq(aiSettings.workspaceId, workspaceId));
  return {
    ...AISettingsInput.parse(
      row?.config || { provider: "groq", model: config.groqModel },
    ),
    revision: row?.revision || 0,
  };
}
export async function resolveAI(
  tx: TX,
  workspaceId: string,
  config: Config,
): Promise<AIExecution> {
  const selected = await workspaceAI(tx, workspaceId, config);
  if (selected.provider === "compatible" && !config.compatibleUrl)
    throw new AppError(
      409,
      "The host has not configured a compatible AI service.",
    );
  const connection = await connectionFor(tx, workspaceId, selected.provider);
  return { ...selected, connectionId: connection.id };
}
export async function admitJob(tx: TX, workspaceId: string, config: Config) {
  const capacity = await tx.execute(
    sql`select lead.capacity_available(50) as available`,
  );
  if (!capacity.rows[0]?.available)
    throw new AppError(
      429,
      "The service is busy. Try again after an active run finishes.",
    );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId},1))`,
  );
  const count = await tx.execute(
    sql`select count(*)::int as count from lead.jobs where workspace_id=${workspaceId} and status in ('queued','running')`,
  );
  if (Number(count.rows[0]?.count) >= config.maxActiveJobs)
    throw new AppError(429, "Wait for an active run to finish.");
}
export function publicDraft(
  row: typeof campaignDrafts.$inferSelect,
): CampaignDraft {
  return {
    id: row.id,
    brief: row.brief,
    answers: row.answers,
    current: row.current,
    parentId: row.parentId,
    result: row.result,
    jobId: row.jobId,
    acceptedCampaignId: row.acceptedCampaignId,
    status: row.status,
    message: row.message,
    createdAt: row.createdAt,
  };
}
export async function getDraft(tx: TX, workspaceId: string, id: string) {
  const [row] = await tx
    .select()
    .from(campaignDrafts)
    .where(
      and(
        eq(campaignDrafts.workspaceId, workspaceId),
        eq(campaignDrafts.id, id),
      ),
    );
  if (!row) throw new AppError(404, "Draft not found.");
  // Job status is authoritative for cancellation, removal, and quota failures.
  if (row.jobId && !row.acceptedCampaignId) {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, row.jobId)));
    if (job && job.status !== "completed")
      return { ...row, status: job.status, message: job.message };
  }
  return row;
}
export async function recentDrafts(tx: TX, workspaceId: string) {
  const rows = await tx
    .select()
    .from(campaignDrafts)
    .where(
      and(
        eq(campaignDrafts.workspaceId, workspaceId),
        sql`${campaignDrafts.acceptedCampaignId} is null`,
      ),
    )
    .orderBy(desc(campaignDrafts.createdAt))
    .limit(5);
  return Promise.all(
    rows.map(async (row) =>
      publicDraft(await getDraft(tx, workspaceId, row.id)),
    ),
  );
}

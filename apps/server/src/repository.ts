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
  analyses,
  connections,
  jobs,
  usage,
  withIdentity,
  type DB,
  type TX,
} from "@lead/database";
import {
  businessKey,
  BusinessInput,
  campaignContext,
  listingFacts,
  type Business,
  type Prospect,
  type Job,
  type Provider,
  type Fact,
} from "@lead/contracts";
import type { Identity } from "./auth.js";
import { AppError } from "./security.js";
export const scoped = <T>(db: DB, who: Identity, fn: (tx: TX) => Promise<T>) =>
  withIdentity(db, who.id, who.email, fn);
export async function member(tx: TX, workspaceId: string, admin = false) {
  const [m] = await tx
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.workspaceId, workspaceId),
        sql`${memberships.userId}=lead.user_id()`,
      ),
    );
  if (!m) throw new AppError(404, "Workspace not found.");
  if (admin && !["owner", "admin"].includes(m.role))
    throw new AppError(403, "An administrator must make this change.");
  return m;
}
export async function ensureUser(tx: TX, who: Identity) {
  await tx
    .insert(users)
    .values(who)
    .onConflictDoUpdate({ target: users.id, set: { email: who.email } });
}
export async function getCampaign(
  tx: TX,
  workspaceId: string,
  campaignId: string,
) {
  const [c] = await tx
    .select()
    .from(campaigns)
    .where(
      and(eq(campaigns.workspaceId, workspaceId), eq(campaigns.id, campaignId)),
    );
  if (!c) throw new AppError(404, "Campaign not found.");
  return c;
}
export async function importBusinesses(
  tx: TX,
  workspaceId: string,
  campaignId: string,
  list: Business[],
  source: string,
  observedAt = new Date().toISOString(),
) {
  await getCampaign(tx, workspaceId, campaignId);
  let added = 0;
  for (const business of list) {
    const externalKey = businessKey(business);
    const [b] = await tx
      .insert(businesses)
      .values({ workspaceId, externalKey, data: business })
      .onConflictDoUpdate({
        target: [businesses.workspaceId, businesses.externalKey],
        // A sparse listing must not erase contact details already collected.
        set: {
          data: sql`${businesses.data} || ${JSON.stringify(
            Object.fromEntries(
              Object.entries(business).filter(
                ([, value]) => value !== "" && value !== null,
              ),
            ),
          )}::jsonb`,
        },
      })
      .returning();
    if (!b) continue;
    const [entry] = await tx
      .insert(entries)
      .values({ workspaceId, campaignId, businessId: b.id })
      .onConflictDoNothing()
      .returning();
    if (entry) added++;
    await tx.insert(observations).values({
      workspaceId,
      businessId: b.id,
      provider: source,
      facts: listingFacts(business, source, observedAt),
    });
  }
  return { added, total: list.length };
}
export async function getProspects(
  tx: TX,
  workspaceId: string,
  campaignId?: string,
): Promise<Prospect[]> {
  const rows = await tx
    .select({ entry: entries, business: businesses.data, campaign: campaigns })
    .from(entries)
    .innerJoin(businesses, eq(entries.businessId, businesses.id))
    .innerJoin(campaigns, eq(entries.campaignId, campaigns.id))
    .where(
      and(
        eq(entries.workspaceId, workspaceId),
        campaignId ? eq(entries.campaignId, campaignId) : undefined,
      ),
    )
    .orderBy(desc(entries.createdAt))
    .limit(2000);
  if (!rows.length) return [];
  const obs = await tx
    .select()
    .from(observations)
    .where(
      and(
        eq(observations.workspaceId, workspaceId),
        inArray(
          observations.businessId,
          rows.map((r) => r.entry.businessId),
        ),
      ),
    )
    .orderBy(desc(observations.createdAt));
  const ai = await tx
    .select()
    .from(analyses)
    .where(
      and(
        eq(analyses.workspaceId, workspaceId),
        inArray(
          analyses.entryId,
          rows.map((r) => r.entry.id),
        ),
      ),
    )
    .orderBy(desc(analyses.createdAt));
  const listingSignature = (facts: Fact[]) =>
    JSON.stringify(
      facts
        .filter((f) => f.id.startsWith("listing:"))
        .map((f) => [f.id, f.value])
        .sort(),
    );
  return rows.map(({ entry, business: raw, campaign }) => {
    const business = BusinessInput.parse(raw);
    const currentListing = listingFacts(business, "", "");
    const facts = new Map();
    obs
      .filter((o) => o.businessId === entry.businessId)
      .forEach((o) =>
        o.facts.forEach((f) => {
          if (!facts.has(f.id)) facts.set(f.id, f);
        }),
      );
    const a = ai.find((a) => a.entryId === entry.id);
    const outdated = Boolean(
      a &&
      ((a.campaignSnapshot &&
        campaignContext(a.campaignSnapshot) !== campaignContext(campaign)) ||
        (a.status === "completed" &&
          listingSignature(a.inputFacts) !== listingSignature(currentListing))),
    );
    return {
      ...entry,
      stage: entry.stage as Prospect["stage"],
      business,
      facts: [...facts.values()].filter(
        (fact: Fact) =>
          !fact.id.startsWith("listing:") ||
          currentListing.some(
            (current) => current.id === fact.id && current.value === fact.value,
          ),
      ),
      analysis: outdated ? null : (a?.data ?? null),
      analysisFacts: a?.inputFacts ?? [],
      analysisStatus: outdated ? "outdated" : (a?.status ?? "not_started"),
      analysisError: a?.error ?? null,
    };
  });
}
export const publicJob = (j: typeof jobs.$inferSelect): Job => ({
  id: j.id,
  kind: j.kind as Job["kind"],
  status: j.status,
  campaignId: j.campaignId,
  progress: j.progress,
  total: j.total,
  message: j.message,
  createdAt: j.createdAt,
  updatedAt: j.updatedAt,
});
export async function connectionFor(
  tx: TX,
  workspaceId: string,
  provider: Provider,
) {
  const m = await member(tx, workspaceId);
  const [c] = await tx
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.workspaceId, workspaceId),
        eq(connections.provider, provider),
      ),
    );
  if (!c?.enabled)
    throw new AppError(409, `Connect ${provider} in Connections first.`);
  if (m.role === "member" && !c.allowMembers)
    throw new AppError(403, "This connection is not enabled for team members.");
  return c;
}
export async function reserveCall(
  tx: TX,
  workspaceId: string,
  jobId: string,
  provider: Provider,
  stepKey: string,
  limit: number,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId},1))`,
  );
  const [previous] = await tx
    .select()
    .from(usage)
    .where(
      and(
        eq(usage.workspaceId, workspaceId),
        sql`${usage.stepKey} like ${stepKey + ":%"}`,
      ),
    )
    .orderBy(desc(usage.createdAt));
  if (previous && previous.status !== "failed")
    throw new AppError(
      409,
      "This provider step already ran or has an uncertain outcome. Create a new run only after checking provider usage.",
    );
  const count = await tx.execute(
    sql`select count(*)::int as count from lead.usage where workspace_id=${workspaceId} and status<>'cached' and created_at>=date_trunc('day',now())`,
  );
  if (Number(count.rows[0]?.count) >= limit)
    throw new AppError(
      429,
      "Workspace daily request limit reached. Try again tomorrow.",
    );
  const [row] = await tx
    .insert(usage)
    .values({
      workspaceId,
      jobId,
      provider,
      stepKey: `${stepKey}:${crypto.randomUUID()}`,
      status: "reserved",
    })
    .returning();
  return row!;
}

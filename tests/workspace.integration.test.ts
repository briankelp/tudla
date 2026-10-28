import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID, randomBytes } from "node:crypto";
import pg from "pg";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import supertest from "supertest";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
  database,
  withIdentity,
  users,
  memberships,
  campaigns,
  connections,
  aiSettings,
  campaignDrafts,
  analyses,
  jobs,
  usage,
  entries,
  businesses,
  observations,
  sql,
  eq,
  type DB,
  and,
} from "@lead/database";
import { BusinessInput } from "@lead/contracts";
import { createApp } from "../apps/server/src/app.js";
import { readConfig, type Config } from "../apps/server/src/config.js";
import { runJob, startQueue } from "../apps/server/src/queue.js";
import { scoped, reserveCall } from "../apps/server/src/repository.js";
let admin: pg.Pool;
let adminDb: ReturnType<typeof database>;
let storage: ReturnType<typeof database>;
let authServer: Server;
let apiServer: Server;
let api: ReturnType<typeof supertest>;
let config: Config;
let tokenA: string;
let tokenB: string;
let tokenMember: string;
let tokenC: string;
let tokenD: string;
let badToken: string;
let wsA: string;
let wsB: string;
let concurrentWorkspaceId: string;
let campaignId: string;
let entryId: string;
const a = { id: randomUUID(), email: "owner-a@example.com" },
  b = { id: randomUUID(), email: "owner-b@example.com" },
  m = { id: randomUUID(), email: "member@example.com" },
  c = { id: randomUUID(), email: "owner-c@example.com" },
  d = { id: randomUUID(), email: "owner-d@example.com" };
const dbName = `lead_test_${randomUUID().replaceAll("-", "")}`;
const privateKey = "test-provider-key-that-must-not-leak";
beforeAll(async () => {
  const adminUrl =
    process.env.DATABASE_ADMIN_URL ||
    "postgresql://lead:lead_local_only@127.0.0.1:54329/lead";
  admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`create database "${dbName}"`);
  const url = (s: string) => {
    const u = new URL(s);
    u.pathname = `/${dbName}`;
    return u.href;
  };
  adminDb = database(url(adminUrl), 1);
  await migrate(adminDb.db, {
    migrationsFolder: new URL("../packages/database/drizzle", import.meta.url)
      .pathname,
  });
  await admin.query(
    `grant connect,create on database "${dbName}" to lead_queue_access`,
  );
  await admin.query(`grant connect on database "${dbName}" to lead_app`);
  storage = database(
    url(
      process.env.DATABASE_URL ||
        "postgresql://lead_runtime:runtime_local_only@127.0.0.1:54329/lead",
    ),
    5,
  );
  const keys = await generateKeyPair("ES256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test-key",
    alg: "ES256",
    use: "sig",
  };
  authServer = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) =>
    authServer.listen(0, "127.0.0.1", resolve),
  );
  const address = authServer.address() as { port: number };
  const issuer = `http://127.0.0.1:${address.port}`;
  const sign = (who: typeof a, overrides: Record<string, unknown> = {}) =>
    new SignJWT({
      email: who.email,
      role: "authenticated",
      app_metadata: { providers: ["google"] },
      ...overrides,
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setSubject(who.id)
      .setIssuer(`${issuer}/auth/v1`)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(keys.privateKey);
  tokenA = await sign(a);
  tokenB = await sign(b);
  tokenMember = await sign(m);
  tokenC = await sign(c);
  tokenD = await sign(d);
  badToken = await sign(a, { role: "service_role" });
  config = readConfig({
    DEMO_ONLY: "false",
    NODE_ENV: "test",
    SUPABASE_URL: issuer,
    SUPABASE_PUBLISHABLE_KEY: "public-key",
    DATABASE_URL: url(
      process.env.DATABASE_URL ||
        "postgresql://lead_runtime:runtime_local_only@127.0.0.1:54329/lead",
    ),
    QUEUE_DATABASE_URL: url(
      process.env.QUEUE_DATABASE_URL ||
        "postgresql://lead_queue:queue_local_only@127.0.0.1:54329/lead",
    ),
    ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    WORKSPACE_DAILY_CALL_LIMIT: "4",
  });
  apiServer = createServer(createApp(config, storage.db));
  await new Promise<void>((resolve) =>
    apiServer.listen(0, "127.0.0.1", resolve),
  );
  api = supertest(apiServer);
  const first = await api
    .get("/api/bootstrap")
    .set("authorization", `Bearer ${tokenA}`);
  expect(first.status, JSON.stringify(first.body)).toBe(200);
  wsA = first.body.workspaces[0].id;
  const second = await api
    .get("/api/bootstrap")
    .set("authorization", `Bearer ${tokenB}`);
  wsB = second.body.workspaces[0].id;
}, 30000);
afterAll(async () => {
  await new Promise<void>((resolve) =>
    apiServer ? apiServer.close(() => resolve()) : resolve(),
  );
  await storage?.pool.end();
  await adminDb?.pool.end();
  await new Promise<void>((resolve) =>
    authServer ? authServer.close(() => resolve()) : resolve(),
  );
  if (admin) {
    // pg-pool resolves end() before every socket has finished disconnecting.
    await vi.waitFor(
      async () => {
        const result = await admin.query(
          "select count(*)::int as count from pg_stat_activity where datname=$1",
          [dbName],
        );
        expect(result.rows[0].count).toBe(0);
      },
      { timeout: 5000, interval: 50 },
    );
    await admin.query(`drop database if exists "${dbName}"`);
    await admin.end();
  }
});
const req = (token: string) => ({ authorization: `Bearer ${token}` });
const base = () => `/api/workspaces/${wsA}`;
async function createAIWorkspace(
  name: string,
  provider: "groq" | "google" = "groq",
  model = provider === "google" ? "gemini-test" : "groq-test",
) {
  const created = await api
    .post("/api/workspaces")
    .set(req(tokenA))
    .send({ name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const path = `/api/workspaces/${created.body.id}`;
  const key = `${provider}-${randomUUID()}-private-test-key`;
  const connected = await api
    .put(`${path}/connections/${provider}`)
    .set(req(tokenA))
    .send({ key });
  expect(connected.status, JSON.stringify(connected.body)).toBe(200);
  const settings = await api
    .put(`${path}/ai-settings`)
    .set(req(tokenA))
    .send({ provider, model, responseMode: "structured" });
  expect(settings.status, JSON.stringify(settings.body)).toBe(200);
  return { id: created.body.id as string, path, key, model };
}
function openAIResponse(value: unknown, id = "openai-fixture", usage = true) {
  return new Response(
    JSON.stringify({
      id,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: JSON.stringify(value) },
          finish_reason: "stop",
        },
      ],
      ...(usage
        ? {
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }
        : {}),
    }),
    { headers: { "content-type": "application/json" } },
  );
}
function readyDraft(name = "Cebu Clinics") {
  return {
    status: "ready",
    fields: {
      name,
      offer: "Scheduling software",
      categories: ["clinic"],
      locations: ["Cebu"],
      requiredEvidence: ["Budget confirmed"],
    },
    questions: [],
    assumptions: ["The target area is Cebu."],
  };
}
describe("authenticated workspace workflow", () => {
  const deletionFixtures: { path: string; token: string; name: string }[] = [];
  afterEach(async () => {
    for (const fixture of deletionFixtures.splice(0).reverse()) {
      const removed = await api
        .delete(fixture.path)
        .set(req(fixture.token))
        .send({ confirmation: fixture.name });
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    }
  });

  const campaignFields = (name: string) => ({
    name,
    offer: "Test offer",
    categories: ["clinic"],
    locations: ["Cebu"],
    requiredEvidence: [],
  });
  async function createDeletionWorkspace(token: string, name: string) {
    const response = await api
      .post("/api/workspaces")
      .set(req(token))
      .send({ name });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    deletionFixtures.push({
      path: `/api/workspaces/${response.body.id}`,
      token,
      name,
    });
    return {
      id: response.body.id as string,
      path: `/api/workspaces/${response.body.id}`,
    };
  }
  async function addCampaign(path: string, token: string, name: string) {
    const response = await api
      .post(`${path}/campaigns`)
      .set(req(token))
      .send(campaignFields(name));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body.id as string;
  }
  async function addProspect(
    path: string,
    token: string,
    campaign: string,
    name: string,
  ) {
    const response = await api
      .post(`${path}/entries`)
      .set(req(token))
      .send({
        campaignId: campaign,
        business: { name, address: "Cebu" },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const current = await api.get(path).set(req(token));
    return current.body.prospects.find(
      (prospect: any) =>
        prospect.campaignId === campaign && prospect.business.name === name,
    );
  }

  it("deletes an entry and its analysis while retaining the shared business", async () => {
    const workspace = await createDeletionWorkspace(
      tokenA,
      "Delete single workspace",
    );
    const primaryCampaign = await addCampaign(
      workspace.path,
      tokenA,
      "Delete single primary",
    );
    const sharedCampaign = await addCampaign(
      workspace.path,
      tokenA,
      "Delete single shared",
    );
    const primary = await addProspect(
      workspace.path,
      tokenA,
      primaryCampaign,
      "Shared deletion business",
    );
    const shared = await addProspect(
      workspace.path,
      tokenA,
      sharedCampaign,
      "Shared deletion business",
    );
    await scoped(storage.db, a, (tx) =>
      tx.insert(analyses).values({
        workspaceId: workspace.id,
        entryId: primary.id,
        status: "completed",
        model: "fixture",
        promptVersion: "test",
        campaignSnapshot: campaignFields("Delete single primary"),
        inputFacts: [],
        data: null,
      }),
    );
    const deleted = await api
      .delete(`${workspace.path}/entries/${primary.id}`)
      .set(req(tokenA));
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ removed: true });
    const state = await api.get(workspace.path).set(req(tokenA));
    expect(state.body.prospects.some((p: any) => p.id === primary.id)).toBe(
      false,
    );
    expect(state.body.prospects.some((p: any) => p.id === shared.id)).toBe(
      true,
    );
    const retained = await scoped(storage.db, a, async (tx) => ({
      analysis: await tx
        .select()
        .from(analyses)
        .where(eq(analyses.entryId, primary.id)),
      business: await tx
        .select()
        .from(businesses)
        .where(eq(businesses.id, primary.businessId)),
      observation: await tx
        .select()
        .from(observations)
        .where(eq(observations.businessId, primary.businessId)),
    }));
    expect(retained.analysis).toHaveLength(0);
    expect(retained.business).toHaveLength(1);
    expect(retained.observation.length).toBeGreaterThan(0);
  });

  it("bulk deletion validates scope and missing IDs atomically, and enforces workspace authorization", async () => {
    const workspace = await createDeletionWorkspace(
      tokenA,
      "Delete bulk workspace",
    );
    const campaign = await addCampaign(workspace.path, tokenA, "Delete bulk");
    const one = await addProspect(
      workspace.path,
      tokenA,
      campaign,
      "Bulk deletion one",
    );
    const two = await addProspect(
      workspace.path,
      tokenA,
      campaign,
      "Bulk deletion two",
    );
    const memberInvite = await api
      .post(`${workspace.path}/invitations`)
      .set(req(tokenA))
      .send({ email: m.email });
    expect(memberInvite.status).toBe(201);
    const inviteToken = new URL(memberInvite.body.url).searchParams.get(
      "invite",
    );
    expect(
      (
        await api
          .post("/api/invitations/accept")
          .set(req(tokenMember))
          .send({ token: inviteToken })
      ).status,
    ).toBe(200);
    const foreignWorkspace = await createDeletionWorkspace(
      tokenB,
      "Delete foreign workspace",
    );
    const foreignCampaign = await addCampaign(
      foreignWorkspace.path,
      tokenB,
      "Delete foreign campaign",
    );
    const foreignEntry = await addProspect(
      foreignWorkspace.path,
      tokenB,
      foreignCampaign,
      "Foreign deletion prospect",
    );
    const foreign = await api
      .delete(`${workspace.path}/entries/${foreignEntry.id}`)
      .set(req(tokenB));
    expect(foreign.status).toBe(404);
    const bad = await api
      .delete(`${workspace.path}/entries`)
      .set(req(tokenA))
      .send({ entryIds: [one.id, foreignEntry.id] });
    expect(bad.status).toBe(404);
    const stillThere = await api.get(workspace.path).set(req(tokenA));
    expect(stillThere.body.prospects.some((p: any) => p.id === one.id)).toBe(
      true,
    );
    expect(
      (
        await api
          .delete(`${workspace.path}/entries`)
          .set(req(tokenA))
          .send({ entryIds: [] })
      ).status,
    ).toBe(400);
    expect(
      (
        await api
          .delete(`${workspace.path}/entries`)
          .set(req(tokenMember))
          .send({ entryIds: [one.id] })
      ).status,
    ).toBe(200);
    const remaining = await api
      .delete(`${workspace.path}/entries`)
      .set(req(tokenA))
      .send({ entryIds: [two.id, two.id] });
    expect(remaining.status).toBe(200);
    expect(remaining.body).toEqual({ removed: 1 });
  });

  it("campaign deletion cascades its entries, analyses, and jobs only", async () => {
    const workspace = await createDeletionWorkspace(
      tokenA,
      "Delete campaign workspace",
    );
    const foreignWorkspace = await createDeletionWorkspace(
      tokenB,
      "Delete campaign foreign workspace",
    );
    const foreignCampaign = await addCampaign(
      foreignWorkspace.path,
      tokenB,
      "Delete campaign foreign",
    );
    const target = await addCampaign(
      workspace.path,
      tokenA,
      "Delete campaign target",
    );
    const other = await addCampaign(
      workspace.path,
      tokenA,
      "Delete campaign other",
    );
    const targetEntry = await addProspect(
      workspace.path,
      tokenA,
      target,
      "Campaign cascade target",
    );
    const otherEntry = await addProspect(
      workspace.path,
      tokenA,
      other,
      "Campaign cascade other",
    );
    const jobId = randomUUID();
    const draftId = randomUUID();
    await scoped(storage.db, a, async (tx) => {
      await tx.insert(analyses).values({
        workspaceId: workspace.id,
        entryId: targetEntry.id,
        status: "completed",
        model: "fixture",
        promptVersion: "test",
        campaignSnapshot: campaignFields("Delete campaign target"),
        inputFacts: [],
        data: null,
      });
      await tx.insert(jobs).values({
        id: jobId,
        workspaceId: workspace.id,
        actorId: a.id,
        campaignId: target,
        kind: "analysis",
        payload: {},
      });
      await tx.insert(campaignDrafts).values({
        id: draftId,
        workspaceId: workspace.id,
        actorId: a.id,
        brief: "accepted draft fixture",
        inputHash: randomUUID(),
        aiConfig: {
          provider: "groq",
          model: "fixture",
          responseMode: "structured",
          connectionId: randomUUID(),
          revision: 1,
        },
        acceptedCampaignId: target,
        status: "accepted",
      });
    });
    const result = await api
      .delete(`${workspace.path}/campaigns/${target}`)
      .set(req(tokenA));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ removed: true });
    const state = await api.get(workspace.path).set(req(tokenA));
    expect(state.body.campaigns.some((c: any) => c.id === target)).toBe(false);
    expect(state.body.prospects.some((p: any) => p.id === targetEntry.id)).toBe(
      false,
    );
    expect(state.body.prospects.some((p: any) => p.id === otherEntry.id)).toBe(
      true,
    );
    const remnants = await scoped(storage.db, a, async (tx) => ({
      analysis: await tx
        .select()
        .from(analyses)
        .where(eq(analyses.entryId, targetEntry.id)),
      job: await tx.select().from(jobs).where(eq(jobs.id, jobId)),
      draft: await tx
        .select()
        .from(campaignDrafts)
        .where(eq(campaignDrafts.id, draftId)),
      business: await tx
        .select()
        .from(businesses)
        .where(eq(businesses.id, targetEntry.businessId)),
    }));
    expect(remnants.analysis).toHaveLength(0);
    expect(remnants.job).toHaveLength(0);
    expect(remnants.business).toHaveLength(1);
    expect(remnants.draft[0]?.acceptedCampaignId).toBeNull();
    const missing = await api
      .delete(`${workspace.path}/campaigns/${randomUUID()}`)
      .set(req(tokenA));
    expect(missing.status).toBe(404);
    const foreignDelete = await api
      .delete(`${workspace.path}/campaigns/${foreignCampaign}`)
      .set(req(tokenA));
    expect(foreignDelete.status).toBe(404);
  });

  it("rejects deletion while a workspace batch job holds its lock", async () => {
    const workspace = await createDeletionWorkspace(
      tokenA,
      "Delete locked workspace",
    );
    const campaign = await addCampaign(workspace.path, tokenA, "Delete locked");
    const prospect = await addProspect(
      workspace.path,
      tokenA,
      campaign,
      "Locked deletion prospect",
    );
    // Advisory locks must be held in the same database as the API and worker.
    const connection = await storage.pool.connect();
    try {
      await connection.query(
        "select pg_advisory_lock(hashtextextended($1,2))",
        [`${workspace.id}:batch`],
      );
      const response = await api
        .delete(`${workspace.path}/entries/${prospect.id}`)
        .set(req(tokenA));
      expect(response.status).toBe(409);
      expect(response.body.message).toMatch(/run is in progress/i);
    } finally {
      await connection.query(
        "select pg_advisory_unlock(hashtextextended($1,2))",
        [`${workspace.id}:batch`],
      );
      connection.release();
    }
  });

  it("rejects unsigned and wrong-role tokens", async () => {
    expect((await api.get("/api/bootstrap")).status).toBe(401);
    expect((await api.get("/api/bootstrap").set(req("garbage"))).status).toBe(
      401,
    );
    expect((await api.get("/api/bootstrap").set(req(badToken))).status).toBe(
      401,
    );
  });
  it("isolates workspaces through API and SQL RLS", async () => {
    expect((await api.get(base()).set(req(tokenB))).status).toBe(404);
    const rows = await scoped(storage.db, b, (tx) =>
      tx.select().from(memberships).where(eq(memberships.workspaceId, wsA)),
    );
    expect(rows).toHaveLength(0);
    await expect(
      scoped(storage.db, b, (tx) =>
        tx.insert(campaigns).values({
          workspaceId: wsA,
          name: "intrusion",
          offer: "x",
          categories: [],
          locations: [],
          requiredEvidence: [],
        }),
      ),
    ).rejects.toThrow();
  });
  it("creates a campaign and imports distinct branches once", async () => {
    const c = await api
      .post(`${base()}/campaigns`)
      .set(req(tokenA))
      .send({
        name: "Clinics",
        offer: "Scheduling software",
        categories: ["clinic"],
        locations: ["Cebu"],
        requiredEvidence: ["Budget confirmed"],
      });
    expect(c.status).toBe(201);
    campaignId = c.body.id;
    const business = BusinessInput.parse({
      name: "Branch",
      category: "Clinic",
      address: "North Cebu",
      website: "https://example.com",
      phone: "+123",
    });
    const imported = await api
      .post(`${base()}/import`)
      .set(req(tokenA))
      .send({
        campaignId,
        businesses: [
          business,
          business,
          { ...business, address: "South Cebu" },
        ],
      });
    expect(imported.body.added).toBe(2);
    const state = await api.get(base()).set(req(tokenA));
    expect(state.body.prospects).toHaveLength(2);
    entryId = state.body.prospects[0].id;
    expect(state.body.prospects[0].business.phone).toBe("+123");
  });
  it("preserves contact details when a duplicate CSV row is sparse", async () => {
    const rich = {
      name: "Import preservation",
      address: "Cebu",
      phone: "12345",
      website: "https://example.com",
      rating: 4.5,
      reviews: 0,
    };
    const upload = (business: object) =>
      api
        .post(`${base()}/import`)
        .set(req(tokenA))
        .send({ campaignId, businesses: [business] });
    expect((await upload(rich)).status).toBe(200);
    const repeated = await upload({
      name: rich.name,
      address: rich.address,
      category: "Clinic",
    });
    expect(repeated.body.added).toBe(0);
    const state = await api.get(base()).set(req(tokenA));
    const saved = state.body.prospects.find(
      (p: any) => p.business.name === rich.name,
    );
    expect(saved.business).toMatchObject({ ...rich, category: "Clinic" });
  });

  it("adds a manual prospect, records its source, and rejects duplicates or foreign campaigns", async () => {
    const add = (business: object, id = campaignId) =>
      api
        .post(`${base()}/entries`)
        .set(req(tokenA))
        .send({ campaignId: id, business });
    const business = { name: "Manual business", address: "Mandaue" };
    expect((await add(business)).status).toBe(201);
    expect((await add({ ...business, phone: "do not overwrite" })).status).toBe(
      409,
    );
    expect((await add({ name: "" })).status).toBe(400);
    const foreign = await api
      .post(`/api/workspaces/${wsB}/entries`)
      .set(req(tokenB))
      .send({ campaignId, business });
    expect(foreign.status).toBe(404);
    const state = await api.get(base()).set(req(tokenA));
    const saved = state.body.prospects.find(
      (p: any) => p.business.name === business.name,
    );
    expect(saved.business.phone).toBe("");
    expect(saved.stage).toBe("New");
    expect(saved.facts[0].source).toBe("Manual entry");
  });

  it("edits campaign fields without presenting research for old criteria as current", async () => {
    const fields = {
      name: "Editable campaign",
      offer: "Scheduling",
      categories: ["Clinic"],
      locations: ["Cebu"],
      requiredEvidence: [],
    };
    const created = await api
      .post(`${base()}/campaigns`)
      .set(req(tokenA))
      .send(fields);
    const id = created.body.id;
    await api
      .post(`${base()}/entries`)
      .set(req(tokenA))
      .send({
        campaignId: id,
        business: {
          name: "Campaign edit fixture",
          category: "Clinic",
          address: "Cebu",
        },
      });
    const before = await api.get(base()).set(req(tokenA));
    const prospect = before.body.prospects.find(
      (p: any) => p.campaignId === id,
    );
    await scoped(storage.db, a, (tx) =>
      tx.insert(analyses).values({
        workspaceId: wsA,
        entryId: prospect.id,
        status: "completed",
        model: "fixture",
        promptVersion: "test",
        campaignSnapshot: fields,
        inputFacts: prospect.facts,
        data: {
          summary: "Original research",
          assessments: [],
          unknowns: [],
          nextQuestion: "",
        },
      }),
    );
    expect(
      (
        await api
          .patch(`/api/workspaces/${wsB}/campaigns/${id}`)
          .set(req(tokenB))
          .send(fields)
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .patch(`${base()}/campaigns/${id}`)
          .set(req(tokenA))
          .send({ ...fields, name: "" })
      ).status,
    ).toBe(400);
    const changed = {
      ...fields,
      name: "Updated campaign",
      locations: ["Davao"],
    };
    const saved = await api
      .patch(`${base()}/campaigns/${id}`)
      .set(req(tokenA))
      .send(changed);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject(changed);
    const state = await api.get(base()).set(req(tokenA));
    const updated = state.body.prospects.find((p: any) => p.id === prospect.id);
    expect(updated.analysis).toBeNull();
    expect(updated.analysisStatus).toBe("outdated");
    const history = await scoped(storage.db, a, (tx) =>
      tx.select().from(analyses).where(eq(analyses.entryId, prospect.id)),
    );
    expect(history[0]?.data?.summary).toBe("Original research");
  });

  it("edits shared business details, clears obsolete facts, and preserves workspace boundaries", async () => {
    const business = {
      name: "Editable business",
      category: "Clinic",
      address: "Cebu",
      phone: "12345",
      website: "https://example.com",
    };
    await api
      .post(`${base()}/entries`)
      .set(req(tokenA))
      .send({ campaignId, business });
    const before = await api.get(base()).set(req(tokenA));
    const prospect = before.body.prospects.find(
      (p: any) => p.business.name === business.name,
    );
    await scoped(storage.db, a, (tx) =>
      tx.insert(analyses).values({
        workspaceId: wsA,
        entryId: prospect.id,
        status: "completed",
        model: "fixture",
        promptVersion: "test",
        campaignSnapshot: before.body.campaigns.find(
          (c: any) => c.id === campaignId,
        ),
        inputFacts: prospect.facts,
        data: {
          summary: "Old listing details",
          assessments: [],
          unknowns: [],
          nextQuestion: "",
        },
      }),
    );
    const changed = {
      ...business,
      phone: "67890",
      website: "",
      email: "owner@example.com",
    };
    expect(
      (
        await api
          .put(`/api/workspaces/${wsB}/businesses/${prospect.businessId}`)
          .set(req(tokenB))
          .send(changed)
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .put(`${base()}/businesses/${prospect.businessId}`)
          .set(req(tokenA))
          .send({ ...changed, email: "bad address" })
      ).status,
    ).toBe(400);
    const saved = await api
      .put(`${base()}/businesses/${prospect.businessId}`)
      .set(req(tokenA))
      .send(changed);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject(changed);
    const state = await api.get(base()).set(req(tokenA));
    const updated = state.body.prospects.find((p: any) => p.id === prospect.id);
    expect(updated.business).toMatchObject(changed);
    expect(updated.facts.some((f: any) => f.id === "listing:website")).toBe(
      false,
    );
    expect(
      updated.facts.find((f: any) => f.id === "listing:email").source,
    ).toBe("Manual correction");
    expect(updated.analysisStatus).toBe("outdated");
    const exported = await api
      .post(`${base()}/export`)
      .set(req(tokenA))
      .send({ entryIds: [prospect.id] });
    expect(exported.text).toContain('"Email"');
    expect(exported.text).toContain('"owner@example.com"');
    const duplicate = await api
      .put(`${base()}/businesses/${prospect.businessId}`)
      .set(req(tokenA))
      .send({ ...changed, name: "Branch", address: "North Cebu" });
    expect(duplicate.status).toBe(409);
  });

  it("saves full-length notes and date-only follow-ups without crossing workspaces", async () => {
    const values = {
      notes: "A".repeat(3000),
      feedback: "Review the source",
      followUpOn: "2028-02-29",
    };
    const saved = await api
      .patch(`${base()}/entries/${entryId}`)
      .set(req(tokenA))
      .send(values);
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject(values);
    expect(
      (
        await api
          .patch(`${base()}/entries/${entryId}`)
          .set(req(tokenA))
          .send({ followUpOn: "2026-02-30" })
      ).status,
    ).toBe(400);
    expect(
      (
        await api
          .patch(`${base()}/entries/${entryId}`)
          .set(req(tokenA))
          .send({ notes: "A".repeat(5001) })
      ).status,
    ).toBe(400);
    expect(
      (
        await api
          .patch(`/api/workspaces/${wsB}/entries/${entryId}`)
          .set(req(tokenB))
          .send(values)
      ).status,
    ).toBe(404);
    const state = await api.get(base()).set(req(tokenA));
    expect(
      state.body.prospects.find((p: any) => p.id === entryId),
    ).toMatchObject(values);
    const exported = await api
      .post(`${base()}/export`)
      .set(req(tokenA))
      .send({ entryIds: [entryId] });
    expect(exported.text).toContain('"Follow-up on"');
    expect(exported.text).toContain('"2028-02-29"');
    expect(
      (
        await api
          .patch(`${base()}/entries/${entryId}`)
          .set(req(tokenA))
          .send({ followUpOn: null })
      ).body.followUpOn,
    ).toBeNull();
  });

  it("persists a reviewed email draft without sending mail or changing stage", async () => {
    const draft = {
      to: "recipient@example.com",
      subject: "Introduction",
      body: "A proposal for a short product discussion.",
      context: "Discuss scheduling",
    };
    const before = await api.get(base()).set(req(tokenA));
    const stage = before.body.prospects.find(
      (p: any) => p.id === entryId,
    ).stage;
    const saved = await api
      .patch(`${base()}/entries/${entryId}`)
      .set(req(tokenA))
      .send({ emailDraft: draft });
    expect(saved.status).toBe(200);
    expect(saved.body.emailDraft).toEqual(draft);
    const invalid = await api
      .patch(`${base()}/entries/${entryId}`)
      .set(req(tokenA))
      .send({
        emailDraft: { ...draft, to: "a@example.com\r\nBcc: other@example.com" },
      });
    expect(invalid.status).toBe(400);
    expect(
      (
        await api
          .patch(`/api/workspaces/${wsB}/entries/${entryId}`)
          .set(req(tokenB))
          .send({ emailDraft: draft })
      ).status,
    ).toBe(404);
    const state = await api.get(base()).set(req(tokenA));
    const persisted = state.body.prospects.find((p: any) => p.id === entryId);
    expect(persisted.emailDraft).toEqual(draft);
    expect(persisted.stage).toBe(stage);
    expect(state.body.jobs).toEqual(before.body.jobs);
    expect(state.body.usage).toEqual(before.body.usage);
  });

  it("does not allow cross-workspace exports or assignments", async () => {
    expect(
      (
        await api
          .post(`/api/workspaces/${wsB}/export`)
          .set(req(tokenB))
          .send({ entryIds: [entryId] })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .patch(`${base()}/entries/${entryId}`)
          .set(req(tokenA))
          .send({ assignedTo: b.id })
      ).status,
    ).toBe(400);
  });
  it("keeps provider keys encrypted and out of API responses", async () => {
    const r = await api
      .put(`${base()}/connections/groq`)
      .set(req(tokenA))
      .send({ key: privateKey, allowMembers: false });
    expect(r.status).toBe(200);
    const state = await api.get(base()).set(req(tokenA));
    expect(JSON.stringify(state.body)).not.toContain(privateKey);
    expect(JSON.stringify(state.body)).not.toContain("encryptedKey");
    const saved = await scoped(storage.db, a, (tx) =>
      tx.select().from(connections),
    );
    expect(JSON.stringify(saved)).not.toContain(privateKey);
  });
  it("accepts a one-use invitation and restricts member credential use", async () => {
    await api.get("/api/bootstrap").set(req(tokenMember));
    const invite = await api
      .post(`${base()}/invitations`)
      .set(req(tokenA))
      .send({ email: m.email });
    const token = new URL(invite.body.url).searchParams.get("invite");
    expect(
      (
        await api
          .post("/api/invitations/accept")
          .set(req(tokenMember))
          .send({ token })
      ).status,
    ).toBe(200);
    expect(
      (
        await api
          .post("/api/invitations/accept")
          .set(req(tokenMember))
          .send({ token })
      ).status,
    ).toBe(400);
    expect(
      (
        await api.put(`${base()}/ai-settings`).set(req(tokenMember)).send({
          provider: "groq",
          model: "member-model",
          responseMode: "structured",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .put(`${base()}/connections/groq`)
          .set(req(tokenMember))
          .send({ key: "other-private-key" })
      ).status,
    ).toBe(403);
    expect(
      (
        await api
          .post(`${base()}/jobs`)
          .set(req(tokenMember))
          .send({ kind: "analysis", campaignId, entryIds: [entryId] })
      ).status,
    ).toBe(403);
  });
  it("runs grounded analysis with real persistence and a stubbed provider", async () => {
    const r = await api
      .post(`${base()}/jobs`)
      .set(req(tokenA))
      .send({ kind: "analysis", campaignId, entryIds: [entryId] });
    expect(r.status).toBe(202);
    const response = {
      summary: "Branch is listed as a clinic in Cebu.",
      assessments: [
        {
          criterion: "Category",
          result: "match",
          evidenceIds: ["listing:category"],
        },
        {
          criterion: "Location",
          result: "match",
          evidenceIds: ["listing:address"],
        },
        { criterion: "Budget confirmed", result: "unknown", evidenceIds: [] },
      ],
      unknowns: ["Budget"],
      nextQuestion: "What is the budget?",
    };
    let calls = 0;
    await runJob(storage.db, config, a, r.body.id, async (_url, options) => {
      calls++;
      expect(options?.headers).toMatchObject({
        authorization: `Bearer ${privateKey}`,
      });
      return new Response(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: { content: JSON.stringify(response) },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 60,
            completion_tokens: 40,
            total_tokens: 100,
          },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const state = await api.get(base()).set(req(tokenA));
    const p = state.body.prospects.find((p: any) => p.id === entryId);
    expect(p.analysis.summary).toBe(response.summary);
    expect(p.business.phone).toBe("+123");
    expect(state.body.jobs.find((j: any) => j.id === r.body.id).status).toBe(
      "completed",
    );
    await runJob(storage.db, config, a, r.body.id, async () => {
      calls++;
      return new Response("{}");
    });
    expect(calls).toBe(1);
    expect(state.body.usage[0].tokens).toBe(100);
  });
  it("preserves records through failed provider analysis", async () => {
    const r = await api
      .post(`${base()}/jobs`)
      .set(req(tokenA))
      .send({ kind: "analysis", campaignId, entryIds: [entryId] });
    await runJob(
      storage.db,
      config,
      a,
      r.body.id,
      async () => new Response("{}", { status: 429 }),
    );
    const state = await api.get(base()).set(req(tokenA));
    expect(state.body.jobs.find((j: any) => j.id === r.body.id).status).toBe(
      "paused",
    );
    expect(
      state.body.prospects.find((p: any) => p.id === entryId).business.phone,
    ).toBe("+123");
  });
  it("neutralizes spreadsheet injection in actual exported rows", async () => {
    await api
      .patch(`${base()}/entries/${entryId}`)
      .set(req(tokenA))
      .send({ notes: '=HYPERLINK("https://example.com")' });
    const csv = await api
      .post(`${base()}/export`)
      .set(req(tokenA))
      .send({ entryIds: [entryId] });
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("\"'=HYPERLINK");
  });
  it("starts the durable queue using the restricted queue role", async () => {
    const queue = await startQueue(storage.db, config, false);
    await queue.stop();
  });
  it("allows only an owner to delete a confirmed workspace", async () => {
    const created = await api
      .post("/api/workspaces")
      .set(req(tokenA))
      .send({ name: "Disposable workspace" });
    const path = `/api/workspaces/${created.body.id}`;
    const campaign = await api.post(`${path}/campaigns`).set(req(tokenA)).send({
      name: "Disposable list",
      offer: "Software",
      categories: [],
      locations: [],
      requiredEvidence: [],
    });
    await api
      .post(`${path}/import`)
      .set(req(tokenA))
      .send({
        campaignId: campaign.body.id,
        businesses: [{ name: "Disposable business" }],
      });
    await api
      .put(`${path}/connections/groq`)
      .set(req(tokenA))
      .send({ key: "disposable-connection-key" });
    expect(
      (
        await api
          .delete(path)
          .set(req(tokenB))
          .send({ confirmation: "Disposable workspace" })
      ).status,
    ).toBe(404);
    expect(
      (
        await api
          .delete(path)
          .set(req(tokenA))
          .send({ confirmation: "Wrong name" })
      ).status,
    ).toBe(400);
    expect(
      (
        await api
          .delete(path)
          .set(req(tokenA))
          .send({ confirmation: "Disposable workspace" })
      ).status,
    ).toBe(200);
    expect((await api.get(path).set(req(tokenA))).status).toBe(404);
    const remaining = await adminDb.db.execute(sql`select
      (select count(*) from lead.businesses where workspace_id=${created.body.id}) +
      (select count(*) from lead.connections where workspace_id=${created.body.id}) +
      (select count(*) from lead.observations where workspace_id=${created.body.id}) as count`);
    expect(Number(remaining.rows[0].count)).toBe(0);
  });
  it("resumes a rate-limited run without losing completed records", async () => {
    const state = await api.get(base()).set(req(tokenA));
    const paused = state.body.jobs.find((j: any) => j.status === "paused");
    expect(paused).toBeTruthy();
    expect(
      (
        await api
          .post(`${base()}/jobs/${paused.id}/resume`)
          .set(req(tokenA))
          .send({})
      ).status,
    ).toBe(200);
    await runJob(
      storage.db,
      config,
      a,
      paused.id,
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                index: 0,
                message: {
                  content: JSON.stringify({
                    summary: "Branch is listed as a clinic.",
                    assessments: [
                      {
                        criterion: "Category",
                        result: "match",
                        evidenceIds: ["listing:category"],
                      },
                      {
                        criterion: "Location",
                        result: "match",
                        evidenceIds: ["listing:address"],
                      },
                      {
                        criterion: "Budget confirmed",
                        result: "unknown",
                        evidenceIds: [],
                      },
                    ],
                    unknowns: ["Budget"],
                    nextQuestion: "What is the budget?",
                  }),
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 25,
              completion_tokens: 17,
              total_tokens: 42,
            },
          }),
        ),
    );
    const updated = await api.get(base()).set(req(tokenA));
    expect(updated.body.jobs.find((j: any) => j.id === paused.id).status).toBe(
      "completed",
    );
    expect(
      updated.body.prospects.find((p: any) => p.id === entryId).analysisFacts
        .length,
    ).toBeGreaterThan(0);
  });
  it("reserves a daily usage ceiling atomically under concurrent calls", async () => {
    const state = await api.get(base()).set(req(tokenA));
    const jobId = state.body.jobs[0].id;
    const results = await Promise.allSettled(
      [1, 2, 3].map((n) =>
        scoped(storage.db, a, (tx) =>
          reserveCall(tx, wsA, jobId, "groq", `budget-test-${n}`, 4),
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("caches searches within one workspace and preserves the source timestamp", async () => {
    const workspace = await api
      .post("/api/workspaces")
      .set(req(tokenA))
      .send({ name: "Cache check" });
    const prefix = `/api/workspaces/${workspace.body.id}`;
    const campaign = await api
      .post(`${prefix}/campaigns`)
      .set(req(tokenA))
      .send({
        name: "Source check",
        offer: "Software",
        categories: [],
        locations: [],
        requiredEvidence: [],
      });
    await api
      .put(`${prefix}/connections/serpapi`)
      .set(req(tokenA))
      .send({ key: "workspace-source-test-key" });
    let calls = 0;
    const source = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          local_results: [
            { title: "Source clinic", address: "Cebu", place_id: "source-1" },
          ],
        }),
      );
    };
    const create = async (query: string) =>
      api.post(`${prefix}/jobs`).set(req(tokenA)).send({
        kind: "discovery",
        campaignId: campaign.body.id,
        query,
        limit: 20,
      });
    const first = await create("Clinics in Cebu");
    expect(first.status).toBe(202);
    await runJob(storage.db, config, a, first.body.id, source);
    const before = await api.get(prefix).set(req(tokenA));
    const observedAt = before.body.prospects[0].facts[0].observedAt;
    const second = await create("  clinics  in Cebu  ");
    await runJob(storage.db, config, a, second.body.id, source);
    const state = await api.get(prefix).set(req(tokenA));
    expect(calls).toBe(1);
    expect(state.body.prospects).toHaveLength(1);
    expect(state.body.prospects[0].facts[0].observedAt).toBe(observedAt);
    expect(
      state.body.usage.find((u: any) => u.status === "cached"),
    ).toMatchObject({ calls: 0, cacheHits: 1, credits: 0 });
    await api.delete(`${prefix}/connections/serpapi`).set(req(tokenA));
    const blocked = await create("Clinics in Cebu");
    expect(blocked.status).toBe(409);

    const other = `/api/workspaces/${wsB}`;
    const c = await api.post(`${other}/campaigns`).set(req(tokenB)).send({
      name: "Separate source",
      offer: "Software",
      categories: [],
      locations: [],
      requiredEvidence: [],
    });
    await api
      .put(`${other}/connections/serpapi`)
      .set(req(tokenB))
      .send({ key: "other-workspace-source-key" });
    const separate = await api.post(`${other}/jobs`).set(req(tokenB)).send({
      kind: "discovery",
      campaignId: c.body.id,
      query: "Clinics in Cebu",
      limit: 20,
    });
    expect(separate.status).toBe(202);
    await runJob(storage.db, config, b, separate.body.id, source);
    expect(calls).toBe(2);
  });
  it("processes a queued job after restarting its consumer", async () => {
    await api
      .put(`/api/workspaces/${wsB}/connections/groq`)
      .set(req(tokenB))
      .send({ key: "second-workspace-test-key" });
    const run = await api
      .post(`/api/workspaces/${wsB}/jobs`)
      .set(req(tokenB))
      .send({ kind: "connection_test", provider: "groq" });
    expect(run.status).toBe(202);
    const first = await startQueue(storage.db, config, false);
    await first.stop();
    let observedKey = "";
    const worker = await startQueue(
      storage.db,
      config,
      true,
      async (_url, options) => {
        observedKey = String(
          (options?.headers as Record<string, string>)?.authorization,
        );
        return openAIResponse({ ok: true }, "connection-check");
      },
    );
    try {
      await vi.waitFor(
        async () => {
          const state = await api
            .get(`/api/workspaces/${wsB}`)
            .set(req(tokenB));
          expect(
            state.body.jobs.find((j: any) => j.id === run.body.id).status,
          ).toBe("completed");
        },
        { timeout: 10000, interval: 200 },
      );
      expect(observedKey).toBe("Bearer second-workspace-test-key");
    } finally {
      await worker.stop();
    }
  });
  it("freezes provider settings into queued drafts and makes request IDs idempotent", async () => {
    const workspace = await createAIWorkspace(
      "AI snapshot",
      "groq",
      "llama-test-v1",
    );
    const requestId = randomUUID();
    const submit = (brief: string) =>
      api
        .post(`${workspace.path}/campaign-drafts`)
        .set(req(tokenA))
        .send({ requestId, brief });
    const queued = await submit(
      "Find Cebu clinics that may need appointment scheduling software.",
    );
    expect(queued.status, JSON.stringify(queued.body)).toBe(202);
    expect(queued.body).toMatchObject({
      id: requestId,
      status: "queued",
      jobId: expect.any(String),
    });
    expect(
      (await api.get(workspace.path).set(req(tokenA))).body.campaigns,
    ).toHaveLength(0);

    const repeated = await submit(
      "Find Cebu clinics that may need appointment scheduling software.",
    );
    expect(repeated.status).toBe(202);
    expect(repeated.body.jobId).toBe(queued.body.jobId);
    expect(
      (await submit("Different brief with the same request identifier."))
        .status,
    ).toBe(409);

    const googleKey = `google-${randomUUID()}-private-test-key`;
    await api
      .put(`${workspace.path}/connections/google`)
      .set(req(tokenA))
      .send({ key: googleKey });
    await api.put(`${workspace.path}/ai-settings`).set(req(tokenA)).send({
      provider: "google",
      model: "gemini-after-queue",
      responseMode: "structured",
    });
    let observedUrl = "";
    let observedKey = "";
    let observedBody: any;
    await runJob(
      storage.db,
      config,
      a,
      queued.body.jobId,
      async (url, options) => {
        observedUrl = String(url);
        observedKey = new Headers(options?.headers).get("authorization") || "";
        observedBody = JSON.parse(String(options?.body));
        return openAIResponse(readyDraft(), "frozen-groq-response");
      },
    );
    expect(observedUrl).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(observedKey).toBe(`Bearer ${workspace.key}`);
    expect(observedBody.model).toBe("llama-test-v1");
    expect(observedKey).not.toContain(googleKey);
    const loaded = await api
      .get(`${workspace.path}/campaign-drafts/${requestId}`)
      .set(req(tokenA));
    expect(loaded.body).toMatchObject({
      status: "ready",
      brief: "Find Cebu clinics that may need appointment scheduling software.",
      result: readyDraft(),
    });
    const workspaceState = await api.get(workspace.path).set(req(tokenA));
    expect(workspaceState.body.drafts[0].id).toBe(requestId);
    expect(workspaceState.body.aiSettings).toMatchObject({
      provider: "google",
      model: "gemini-after-queue",
    });
  });
  it("uses Google's native response, caches recent drafts, and accepts edited fields idempotently", async () => {
    const workspace = await createAIWorkspace(
      "Google drafts",
      "google",
      "gemini-fixture",
    );
    const requestId = randomUUID();
    const brief =
      "Help me plan outreach to small clinics, but I have not chosen the region or offer yet.";
    const queued = await api
      .post(`${workspace.path}/campaign-drafts`)
      .set(req(tokenA))
      .send({ requestId, brief });
    expect(queued.status).toBe(202);
    const clarification = {
      status: "needs_clarification",
      fields: {
        name: "",
        offer: "",
        categories: ["clinic"],
        locations: [],
        requiredEvidence: [],
      },
      questions: [
        "Which region should the campaign target?",
        "What offer should it promote?",
      ],
      assumptions: ["The target is small clinics."],
    };
    let calls = 0;
    await runJob(
      storage.db,
      config,
      a,
      queued.body.jobId,
      async (url, options) => {
        calls++;
        expect(String(url)).toContain(
          "generativelanguage.googleapis.com/v1beta/models/gemini-fixture:generateContent",
        );
        expect(new Headers(options?.headers).get("x-goog-api-key")).toBe(
          workspace.key,
        );
        const body = JSON.parse(String(options?.body));
        expect(body.generationConfig.responseMimeType).toBe("application/json");
        expect(body.generationConfig.responseJsonSchema).toBeTruthy();
        return new Response(
          JSON.stringify({
            responseId: "google-draft-response",
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: JSON.stringify(clarification) }],
                },
                finishReason: "STOP",
              },
            ],
            usageMetadata: {
              promptTokenCount: 20,
              candidatesTokenCount: 12,
              totalTokenCount: 32,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    );
    expect(calls).toBe(1);
    const persisted = await api
      .get(`${workspace.path}/campaign-drafts/${requestId}`)
      .set(req(tokenA));
    expect(persisted.body).toMatchObject({
      brief,
      status: "needs_clarification",
      result: clarification,
    });
    const cachedId = randomUUID();
    const cached = await api
      .post(`${workspace.path}/campaign-drafts`)
      .set(req(tokenA))
      .send({ requestId: cachedId, brief });
    expect(cached.status).toBe(202);
    expect(cached.body).toMatchObject({
      id: cachedId,
      status: "needs_clarification",
      jobId: null,
      result: clarification,
    });
    expect(calls).toBe(1);

    const edited = {
      name: "Edited Cebu clinic plan",
      offer: "Appointment reminders",
      categories: ["clinic"],
      locations: ["Cebu"],
      requiredEvidence: ["Decision maker identified"],
    };
    const accepted = await api
      .post(`${workspace.path}/campaign-drafts/${requestId}/accept`)
      .set(req(tokenA))
      .send(edited);
    expect(accepted.status).toBe(201);
    const acceptedAgain = await api
      .post(`${workspace.path}/campaign-drafts/${requestId}/accept`)
      .set(req(tokenA))
      .send({ ...edited, name: "Ignored second edit" });
    expect(acceptedAgain.status).toBe(201);
    expect(acceptedAgain.body.id).toBe(accepted.body.id);
    expect(acceptedAgain.body.name).toBe("Edited Cebu clinic plan");
    expect(
      (await api.get(workspace.path).set(req(tokenA))).body.campaigns,
    ).toHaveLength(1);
  });
  it("isolates AI settings and drafts in API and row-level SQL access", async () => {
    const workspace = await createAIWorkspace("AI RLS");
    expect(
      (await api.get(`${workspace.path}/ai-settings`).set(req(tokenB))).status,
    ).toBe(404);
    expect(
      (await api.get(`${workspace.path}/campaign-drafts`).set(req(tokenB)))
        .status,
    ).toBe(404);
    expect(
      await scoped(storage.db, b, (tx) =>
        tx
          .select()
          .from(aiSettings)
          .where(eq(aiSettings.workspaceId, workspace.id)),
      ),
    ).toHaveLength(0);
    expect(
      await scoped(storage.db, b, (tx) =>
        tx
          .select()
          .from(campaignDrafts)
          .where(eq(campaignDrafts.workspaceId, workspace.id)),
      ),
    ).toHaveLength(0);
    await expect(
      scoped(storage.db, b, (tx) =>
        tx.insert(aiSettings).values({
          workspaceId: workspace.id,
          config: {
            provider: "groq",
            model: "intruder-model",
            responseMode: "structured",
          },
        }),
      ),
    ).rejects.toThrow();
  });
  it("preserves malformed and timed-out drafts without leaking model output or repeating calls", async () => {
    const workspace = await createAIWorkspace("AI safe failures");
    const badId = randomUUID();
    const badBrief =
      "Find regional businesses interested in a simple appointment reminder service.";
    const bad = await api
      .post(`${workspace.path}/campaign-drafts`)
      .set(req(tokenA))
      .send({ requestId: badId, brief: badBrief });
    let badCalls = 0;
    await runJob(storage.db, config, a, bad.body.jobId, async () => {
      badCalls++;
      return openAIResponse("MODEL_PRIVATE_RAW_TEXT", "bad-output", false);
    });
    const badLoaded = await api
      .get(`${workspace.path}/campaign-drafts/${badId}`)
      .set(req(tokenA));
    expect(badLoaded.body).toMatchObject({ brief: badBrief, status: "failed" });
    expect(JSON.stringify(badLoaded.body)).not.toContain(
      "MODEL_PRIVATE_RAW_TEXT",
    );
    const badUsage = await scoped(storage.db, a, (tx) =>
      tx.select().from(usage).where(eq(usage.jobId, bad.body.jobId)),
    );
    expect(badUsage[0]).toMatchObject({
      status: "invalid_output",
      errorCode: "invalid_output",
    });

    const timeoutId = randomUUID();
    const timeout = await api
      .post(`${workspace.path}/campaign-drafts`)
      .set(req(tokenA))
      .send({
        requestId: timeoutId,
        brief:
          "Identify local repair shops that may want an online booking tool.",
      });
    let timeoutCalls = 0;
    const timeoutFetcher = async () => {
      timeoutCalls++;
      throw new DOMException("provider timed out", "TimeoutError");
    };
    await runJob(storage.db, config, a, timeout.body.jobId, timeoutFetcher);
    await runJob(storage.db, config, a, timeout.body.jobId, timeoutFetcher);
    expect(timeoutCalls).toBe(1);
    const uncertain = await scoped(storage.db, a, (tx) =>
      tx.select().from(usage).where(eq(usage.jobId, timeout.body.jobId)),
    );
    expect(uncertain[0]).toMatchObject({
      status: "uncertain",
      errorCode: "timeout",
    });
  });
  it("fails queued drafts cleanly when the saved provider connection is removed", async () => {
    const workspace = await createAIWorkspace("AI removed connection");
    const queued = await api
      .post(`${workspace.path}/campaign-drafts`)
      .set(req(tokenA))
      .send({
        requestId: randomUUID(),
        brief: "Find independent dentists that could use patient reminders.",
      });
    expect(queued.status).toBe(202);
    await api.delete(`${workspace.path}/connections/groq`).set(req(tokenA));
    let calls = 0;
    await runJob(storage.db, config, a, queued.body.jobId, async () => {
      calls++;
      return openAIResponse(readyDraft());
    });
    expect(calls).toBe(0);
    expect(
      (
        await api
          .get(`${workspace.path}/campaign-drafts/${queued.body.id}`)
          .set(req(tokenA))
      ).body.status,
    ).toBe("failed");

    const disabledWorkspace = await createAIWorkspace("AI disabled connection");
    const disabledDraft = await api
      .post(`${disabledWorkspace.path}/campaign-drafts`)
      .set(req(tokenA))
      .send({
        requestId: randomUUID(),
        brief: "Find independent dentists that could use patient reminders.",
      });
    await api
      .put(`${disabledWorkspace.path}/connections/groq`)
      .set(req(tokenA))
      .send({ key: disabledWorkspace.key, enabled: false });
    let disabledCalls = 0;
    await runJob(storage.db, config, a, disabledDraft.body.jobId, async () => {
      disabledCalls++;
      return openAIResponse(readyDraft());
    });
    expect(disabledCalls).toBe(0);
    expect(
      (
        await api
          .get(
            `${disabledWorkspace.path}/campaign-drafts/${disabledDraft.body.id}`,
          )
          .set(req(tokenA))
      ).body.status,
    ).toBe("failed");
  });
  it("revokes removed members and cancels their pending provider work", async () => {
    await api
      .put(`${base()}/connections/groq`)
      .set(req(tokenA))
      .send({ key: privateKey, allowMembers: true });
    await api
      .patch(`${base()}/entries/${entryId}`)
      .set(req(tokenA))
      .send({ assignedTo: m.id });
    const run = await api
      .post(`${base()}/jobs`)
      .set(req(tokenMember))
      .send({ kind: "analysis", campaignId, entryIds: [entryId] });
    expect(run.status).toBe(202);
    expect(
      (await api.delete(`${base()}/members/${m.id}`).set(req(tokenA))).status,
    ).toBe(204);
    expect((await api.get(base()).set(req(tokenMember))).status).toBe(404);
    const state = await api.get(base()).set(req(tokenA));
    expect(state.body.jobs.find((j: any) => j.id === run.body.id).status).toBe(
      "cancelled",
    );
    expect(
      state.body.prospects.find((p: any) => p.id === entryId).assignedTo,
    ).toBeNull();
    let calls = 0;
    await runJob(storage.db, config, m, run.body.id, async () => {
      calls++;
      return new Response("{}");
    });
    expect(calls).toBe(0);
  });
  it("deduplicates a bounded burst of identical draft submissions", async () => {
    const workspace = await createAIWorkspace("Concurrent draft dedupe");
    concurrentWorkspaceId = workspace.id;
    const path = workspace.path;
    const requestId = randomUUID();
    const brief =
      "Find independent clinics that could use appointment scheduling software.";
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        api
          .post(`${path}/campaign-drafts`)
          .set(req(tokenA))
          .send({ requestId, brief }),
      ),
    );
    expect(responses.every((response) => response.status === 202)).toBe(true);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    const jobIds = new Set(responses.map((response) => response.body.jobId));
    expect(jobIds.size).toBe(1);
    const draftRows = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(campaignDrafts)
        .where(eq(campaignDrafts.workspaceId, workspace.id)),
    );
    const jobRows = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.workspaceId, workspace.id),
            eq(jobs.kind, "campaign_draft"),
          ),
        ),
    );
    expect(draftRows).toHaveLength(1);
    expect(jobRows).toHaveLength(1);

    let providerCalls = 0;
    await runJob(storage.db, config, a, [...jobIds][0]!, async () => {
      providerCalls++;
      return openAIResponse(readyDraft());
    });
    expect(providerCalls).toBe(1);
  });
  it("admits three simultaneous drafts per workspace while another workspace can submit", async () => {
    const path = `/api/workspaces/${concurrentWorkspaceId}`;
    const submissions = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        api
          .post(`${path}/campaign-drafts`)
          .set(req(tokenA))
          .send({
            requestId: randomUUID(),
            brief: `Find local clinics that may need appointment scheduling software, request ${index}.`,
          }),
      ),
    );
    expect(
      submissions.filter((response) => response.status === 202),
    ).toHaveLength(3);
    expect(
      submissions.filter((response) => response.status === 429),
    ).toHaveLength(9);
    const admitted = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.workspaceId, concurrentWorkspaceId),
            eq(jobs.kind, "campaign_draft"),
            sql`${jobs.status} in ('queued','running')`,
          ),
        ),
    );
    expect(admitted).toHaveLength(3);

    const other = `/api/workspaces/${wsB}`;
    await api
      .put(`${other}/connections/groq`)
      .set(req(tokenB))
      .send({ key: `capacity-${randomUUID()}-private-key` });
    const separate = await api
      .post(`${other}/campaign-drafts`)
      .set(req(tokenB))
      .send({
        requestId: randomUUID(),
        brief: "Find local repair shops interested in appointment reminders.",
      });
    expect(separate.status).toBe(202);
    await Promise.all(
      submissions
        .filter((response) => response.status === 202)
        .map((response) =>
          api
            .post(`${path}/jobs/${response.body.jobId}/cancel`)
            .set(req(tokenA))
            .send({}),
        ),
    );
    await api
      .post(`${other}/jobs/${separate.body.jobId}/cancel`)
      .set(req(tokenB))
      .send({});
  });
  it("enforces member AI permissions and rejects acceptance of a cancelled draft", async () => {
    const path = `/api/workspaces/${wsB}`;
    await api
      .put(`${path}/connections/groq`)
      .set(req(tokenB))
      .send({ key: `member-${randomUUID()}-private-key`, allowMembers: false });
    const invite = await api
      .post(`${path}/invitations`)
      .set(req(tokenB))
      .send({ email: m.email });
    const inviteToken = new URL(invite.body.url).searchParams.get("invite");
    expect(invite.status).toBe(201);
    expect(
      (
        await api
          .post("/api/invitations/accept")
          .set(req(tokenMember))
          .send({ token: inviteToken })
      ).status,
    ).toBe(200);
    expect(
      (
        await api.put(`${path}/ai-settings`).set(req(tokenMember)).send({
          provider: "groq",
          model: "member-model",
          responseMode: "structured",
        })
      ).status,
    ).toBe(403);
    const memberDenied = await api
      .post(`${path}/campaign-drafts`)
      .set(req(tokenMember))
      .send({
        requestId: randomUUID(),
        brief: "Find local clinics interested in better appointment reminders.",
      });
    expect(memberDenied.status).toBe(403);

    await api
      .put(`${path}/connections/groq`)
      .set(req(tokenB))
      .send({ key: "second-workspace-test-key", allowMembers: true });
    const memberAllowed = await api
      .post(`${path}/campaign-drafts`)
      .set(req(tokenMember))
      .send({
        requestId: randomUUID(),
        brief: "Find local clinics interested in better appointment reminders.",
      });
    expect(memberAllowed.status).toBe(202);
    await api
      .post(`${path}/jobs/${memberAllowed.body.jobId}/cancel`)
      .set(req(tokenB))
      .send({});

    const queued = await api
      .post(`${path}/campaign-drafts`)
      .set(req(tokenB))
      .send({
        requestId: randomUUID(),
        brief: "Find dentists that could use online appointment scheduling.",
      });
    expect(queued.status).toBe(202);
    const cancelled = await api
      .post(`${path}/jobs/${queued.body.jobId}/cancel`)
      .set(req(tokenB))
      .send({});
    expect(cancelled.status).toBe(200);
    const accepted = await api
      .post(`${path}/campaign-drafts/${queued.body.id}/accept`)
      .set(req(tokenB))
      .send(readyDraft().fields);
    expect(accepted.status).toBe(409);
  });
  it("does not run a queued draft with a replaced provider connection", async () => {
    const path = base();
    await api
      .put(`${path}/connections/groq`)
      .set(req(tokenA))
      .send({ key: `old-${randomUUID()}-private-key` });
    const queued = await api
      .post(`${path}/campaign-drafts`)
      .set(req(tokenA))
      .send({
        requestId: randomUUID(),
        brief:
          "Find independent clinics that could use appointment scheduling software.",
      });
    expect(queued.status).toBe(202);
    const before = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.workspaceId, wsA),
            eq(connections.provider, "groq"),
          ),
        ),
    );
    await api.delete(`${path}/connections/groq`).set(req(tokenA));
    const replacementKey = `replacement-${randomUUID()}-private-key`;
    await api
      .put(`${path}/connections/groq`)
      .set(req(tokenA))
      .send({ key: replacementKey });
    const after = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(connections)
        .where(
          and(
            eq(connections.workspaceId, wsA),
            eq(connections.provider, "groq"),
          ),
        ),
    );
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(before[0]!.id);

    let providerCalls = 0;
    await runJob(
      storage.db,
      config,
      a,
      queued.body.jobId,
      async (_url, options) => {
        providerCalls++;
        expect(new Headers(options?.headers).get("authorization")).not.toBe(
          `Bearer ${replacementKey}`,
        );
        return openAIResponse(readyDraft());
      },
    );
    expect(providerCalls).toBe(0);
    expect(
      (
        await api
          .get(`${path}/campaign-drafts/${queued.body.id}`)
          .set(req(tokenA))
      ).body.status,
    ).toBe("failed");
  });
  it("drains mixed draft and batch queues across four workspaces with a two-connection pool", async () => {
    const cState = await api.get("/api/bootstrap").set(req(tokenC));
    const dState = await api.get("/api/bootstrap").set(req(tokenD));
    expect(cState.status).toBe(200);
    expect(dState.status).toBe(200);
    const cWorkspace = cState.body.workspaces[0].id as string;
    const dWorkspace = dState.body.workspaces[0].id as string;
    const cPath = `/api/workspaces/${cWorkspace}`;
    const dPath = `/api/workspaces/${dWorkspace}`;
    const cKey = `c-${randomUUID()}-private-provider-key`;
    const dKey = `d-${randomUUID()}-private-provider-key`;
    for (const [path, token, key] of [
      [base(), tokenA, `a-${randomUUID()}-private-provider-key`],
      [
        `/api/workspaces/${wsB}`,
        tokenB,
        `b-${randomUUID()}-private-provider-key`,
      ],
      [cPath, tokenC, cKey],
      [dPath, tokenD, dKey],
    ] as const) {
      expect(
        (
          await api
            .put(`${path}/connections/groq`)
            .set(req(token))
            .send({ key })
        ).status,
      ).toBe(200);
      expect(
        (
          await api.put(`${path}/ai-settings`).set(req(token)).send({
            provider: "groq",
            model: "small-pool-test",
            responseMode: "structured",
          })
        ).status,
      ).toBe(200);
    }
    const workspaces = [
      { id: wsA, path: base(), token: tokenA, identity: a },
      { id: wsB, path: `/api/workspaces/${wsB}`, token: tokenB, identity: b },
      { id: cWorkspace, path: cPath, token: tokenC, identity: c },
      { id: dWorkspace, path: dPath, token: tokenD, identity: d },
    ];
    const queued = await Promise.all(
      workspaces.map(async (workspace) => {
        const [draft, batch] = await Promise.all([
          api
            .post(`${workspace.path}/campaign-drafts`)
            .set(req(workspace.token))
            .send({
              requestId: randomUUID(),
              brief: `Find independent clinics that could use scheduling software in workspace ${workspace.id}.`,
            }),
          api
            .post(`${workspace.path}/jobs`)
            .set(req(workspace.token))
            .send({ kind: "connection_test", provider: "groq" }),
        ]);
        expect(draft.status).toBe(202);
        expect(batch.status).toBe(202);
        return [draft.body.jobId, batch.body.id] as const;
      }),
    );
    const smallPool = database(config.databaseUrl, 2);
    const workerConfig = { ...config, poolSize: 2, dailyLimit: 100 };
    let worker: Awaited<ReturnType<typeof startQueue>> | undefined;
    try {
      worker = await startQueue(
        smallPool.db,
        workerConfig,
        true,
        async (_url, options) => {
          const body = String(options?.body || "");
          return openAIResponse(
            body.includes('"ok"') ? { ok: true } : readyDraft(),
            "small-pool-worker",
          );
        },
      );
      await vi.waitFor(
        async () => {
          for (const [index, workspace] of workspaces.entries()) {
            const workspaceJobIds = queued[index]!;
            const rows = await scoped(storage.db, workspace.identity, (tx) =>
              Promise.all(
                workspaceJobIds.map((id) =>
                  tx.select().from(jobs).where(eq(jobs.id, id)),
                ),
              ),
            );
            expect(
              rows.flat().filter((row) => row.status === "completed"),
              JSON.stringify(
                rows.flat().map(({ kind, status, message }) => ({
                  kind,
                  status,
                  message,
                })),
              ),
            ).toHaveLength(2);
          }
        },
        { timeout: 10000, interval: 100 },
      );
    } finally {
      if (worker) await worker.stop();
      await smallPool.pool.end();
    }
  });
  it("prunes aged parent drafts without losing child or accepted campaign records", async () => {
    const path = base();
    await api
      .put(`${path}/connections/groq`)
      .set(req(tokenA))
      .send({ key: `retention-${randomUUID()}-private-key` });
    const parent = await api
      .post(`${path}/campaign-drafts`)
      .set(req(tokenA))
      .send({
        requestId: randomUUID(),
        brief:
          "Find independent clinics that could use appointment scheduling software.",
      });
    expect(parent.status).toBe(202);
    await runJob(
      storage.db,
      { ...config, dailyLimit: 100 },
      a,
      parent.body.jobId,
      async () => openAIResponse(readyDraft("Retention parent")),
    );
    const accepted = await api
      .post(`${path}/campaign-drafts/${parent.body.id}/accept`)
      .set(req(tokenA))
      .send(readyDraft("Retention parent").fields);
    expect(accepted.status).toBe(201);
    const child = await api
      .post(`${path}/campaign-drafts`)
      .set(req(tokenA))
      .send({
        requestId: randomUUID(),
        parentId: parent.body.id,
        brief: "Refine the outreach plan for independent clinics in Cebu.",
        current: readyDraft("Retention parent").fields,
      });
    expect(child.status).toBe(202);

    await adminDb.db.execute(
      sql`update lead.campaign_drafts set created_at=now()-interval '31 days' where id=${parent.body.id}`,
    );
    await adminDb.db.execute(sql`select lead.prune_history(90)`);

    const parentRows = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(campaignDrafts)
        .where(eq(campaignDrafts.id, parent.body.id)),
    );
    const childRows = await scoped(storage.db, a, (tx) =>
      tx
        .select()
        .from(campaignDrafts)
        .where(eq(campaignDrafts.id, child.body.id)),
    );
    const campaignRows = await scoped(storage.db, a, (tx) =>
      tx.select().from(campaigns).where(eq(campaigns.id, accepted.body.id)),
    );
    expect(parentRows).toHaveLength(0);
    expect(childRows[0]?.parentId).toBeNull();
    expect(campaignRows).toHaveLength(1);
  });
});

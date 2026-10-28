import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import {
  BusinessInput,
  businessKey,
  csvCell,
  safeWebsite,
  listingFacts,
  CampaignDraftResultSchema,
  AISettingsInput,
} from "@lead/contracts";
import { seal, unseal } from "../apps/server/src/security.js";
import {
  normalizeMaps,
  validateAnalysis,
  publicAddress,
} from "../apps/server/src/providers.js";
import { readConfig } from "../apps/server/src/config.js";
import { sampleState, sampleAnalysis } from "../apps/web/src/data.js";
describe("sample workflow", () => {
  it("follows a general sales campaign instead of assuming clinic services", () => {
    const state = sampleState();
    const campaign = {
      ...state.campaigns[0]!,
      offer: "Warehouse management software",
      categories: ["Warehouse"],
      locations: ["Davao"],
      requiredEvidence: ["Monthly shipment volume confirmed"],
    };
    const prospect = {
      ...state.prospects[0]!,
      business: BusinessInput.parse({
        name: "Example warehouse",
        category: "Warehouse",
        address: "Davao",
      }),
    };
    const analysis = sampleAnalysis(prospect, campaign);
    expect(analysis.unknowns).toContain("Monthly shipment volume confirmed");
    expect(analysis.nextQuestion).toContain(campaign.offer);
    expect(JSON.stringify(analysis).toLowerCase()).not.toMatch(
      /appointment|clinic/,
    );
  });
});
describe("source records", () => {
  it("keeps branches sharing a website and phone separate", () => {
    const a = BusinessInput.parse({
      name: "Clinic",
      address: "Cebu North",
      website: "https://example.com",
      phone: "123",
    });
    const b = { ...a, address: "Cebu South" };
    expect(businessKey(a)).not.toBe(businessKey(b));
  });
  it("deduplicates provider IDs before analysis and preserves zero values", () => {
    const rows = normalizeMaps(
      {
        local_results: [
          { title: "A", place_id: "one", reviews: 0, rating: 0 },
          { title: "A", place_id: "one" },
          { title: "B", place_id: "two" },
        ],
      },
      20,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]?.reviews).toBe(0);
    expect(rows[0]?.rating).toBe(0);
  });
  it("does not interpret absent website data as a website finding", () => {
    const facts = listingFacts(
      BusinessInput.parse({ name: "A" }),
      "Search",
      "now",
    );
    expect(facts.some((f) => f.label === "Website")).toBe(false);
  });
  it.each([
    "javascript:alert(1)",
    "https://user:password@example.com",
    "data:text/html,hello",
  ])("rejects an unsafe link %s", (value) =>
    expect(safeWebsite(value)).toBe(""),
  );
  it.each(["=SUM(A1)", "+cmd", "-1+2", "@cmd", " \t=cmd", "\r=cmd"])(
    "neutralizes spreadsheet formulas %s",
    (value) => expect(csvCell(value).startsWith("\"'")).toBe(true),
  );
  it("escapes quotes and embedded newlines", () =>
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"'));
});
describe("credential boundaries", () => {
  const master = randomBytes(32).toString("base64");
  it("supports staged key rotation without exposing plaintext", () => {
    const next = randomBytes(32).toString("base64");
    const ring = { "1": master, "2": next };
    const old = seal(master, "private", "ws:groq");
    const rotated = seal(next, unseal(ring, old, "ws:groq"), "ws:groq", 2);
    expect(rotated.version).toBe(2);
    expect(unseal(ring, old, "ws:groq")).toBe("private");
    expect(unseal(ring, rotated, "ws:groq")).toBe("private");
    expect(() => unseal({ "1": master }, rotated, "ws:groq")).toThrow();
  });
  it("binds ciphertext to workspace and provider", () => {
    const e = seal(master, "a-private-key", "workspace-a:groq");
    expect(JSON.stringify(e)).not.toContain("a-private-key");
    expect(unseal(master, e, "workspace-a:groq")).toBe("a-private-key");
    expect(() => unseal(master, e, "workspace-b:groq")).toThrow();
    expect(() => unseal(master, e, "workspace-a:serpapi")).toThrow();
  });
  it("rejects modified ciphertext", () => {
    const e = seal(master, "a-private-key", "workspace-a:groq");
    e.tag = Buffer.alloc(16).toString("base64");
    expect(() => unseal(master, e, "workspace-a:groq")).toThrow();
  });
});
describe("analysis contract", () => {
  const c = {
    categories: ["clinic"],
    locations: [],
    requiredEvidence: ["Budget confirmed"],
  };
  const facts = listingFacts(
    BusinessInput.parse({ name: "A", category: "Clinic" }),
    "Search",
    "now",
  );
  const valid = {
    summary: "A is listed as a clinic.",
    assessments: [
      {
        criterion: "Category",
        result: "match",
        evidenceIds: ["listing:category"],
      },
      { criterion: "Budget confirmed", result: "unknown", evidenceIds: [] },
    ],
    unknowns: ["Budget"],
    nextQuestion: "What is the budget?",
  };
  it("accepts evidence-linked matches and explicit unknowns", () =>
    expect(validateAnalysis(valid, facts, c)).toEqual(valid));
  it("rejects invented evidence", () =>
    expect(() =>
      validateAnalysis(
        {
          ...valid,
          assessments: [
            { ...valid.assessments[0], evidenceIds: ["invented"] },
            valid.assessments[1],
          ],
        },
        facts,
        c,
      ),
    ).toThrow());
  it("rejects unsupported conclusions without evidence", () =>
    expect(() =>
      validateAnalysis(
        {
          ...valid,
          assessments: valid.assessments.map((a) => ({
            ...a,
            result: "match",
            evidenceIds: [],
          })),
        },
        facts,
        c,
      ),
    ).toThrow());
  it("rejects extra contact fields", () =>
    expect(() =>
      validateAnalysis({ ...valid, contactPhone: "invented" }, facts, c),
    ).toThrow());
  it("requires every campaign criterion", () =>
    expect(() =>
      validateAnalysis({ ...valid, assessments: [] }, facts, c),
    ).toThrow());
});
describe("configuration and network targets", () => {
  it("defaults to a sample with no hosted configuration, even with stale credentials", () => {
    const config = readConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://unused.example/app",
      QUEUE_DATABASE_URL: "postgresql://unused.example/queue",
      SUPABASE_URL: "https://unused.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "old-key",
      ENCRYPTION_KEYS: "obsolete configuration",
      EMBEDDED_WORKER: "true",
      LLM_COMPATIBLE_BASE_URL: "https://unused.example/v1",
    });
    expect(config.demoOnly).toBe(true);
    expect(config.embeddedWorker).toBe(false);
    for (const key of [
      "databaseUrl",
      "queueUrl",
      "supabaseUrl",
      "publishableKey",
      "encryptionKey",
      "compatibleUrl",
    ] as const)
      expect(config[key]).toBe("");
    expect(config.encryptionKeys).toEqual({});
  });
  it.each(["https://tudla.onrender.com", "https://tudla.onrender.com/"])(
    "matches browser Origin headers when APP_ORIGIN is %s",
    (origin) => {
      expect(readConfig({ APP_ORIGIN: origin }).origin).toBe(
        "https://tudla.onrender.com",
      );
    },
  );
  it("requires a spare database connection for background job writes", () => {
    expect(() => readConfig({ DATABASE_POOL_SIZE: "1" })).toThrow("at least 2");
    expect(readConfig({ DATABASE_POOL_SIZE: "2" }).poolSize).toBe(2);
  });
  it("accepts a host-owned compatible URL and rejects embedded secrets", () => {
    expect(
      readConfig({
        DEMO_ONLY: "false",
        LLM_COMPATIBLE_BASE_URL: "https://ai.example/v1/",
      }).compatibleUrl,
    ).toBe("https://ai.example/v1");
    expect(() =>
      readConfig({
        DEMO_ONLY: "false",
        LLM_COMPATIBLE_BASE_URL: "https://user:key@ai.example/v1",
      }),
    ).toThrow();
    expect(() =>
      readConfig({
        DEMO_ONLY: "false",
        LLM_COMPATIBLE_BASE_URL: "http://localhost:11434/v1",
      }),
    ).toThrow("HTTPS");
    expect(
      readConfig({
        DEMO_ONLY: "false",
        LLM_COMPATIBLE_BASE_URL: "http://localhost:11434/v1",
        LLM_ALLOW_LOCAL: "true",
      }).compatibleUrl,
    ).toContain("localhost");
  });
  it("fails closed for incomplete live production", () =>
    expect(() =>
      readConfig({ NODE_ENV: "production", DEMO_ONLY: "false" }),
    ).toThrow());
  it("permits an explicitly sample-only production deployment", () =>
    expect(
      readConfig({ NODE_ENV: "production", DEMO_ONLY: "true" }).demoOnly,
    ).toBe(true));
  it("rejects a keyring missing its active encryption version", () => {
    expect(() =>
      readConfig({
        DEMO_ONLY: "false",
        ENCRYPTION_KEYS: JSON.stringify({
          "1": Buffer.alloc(32, 7).toString("base64"),
        }),
        ENCRYPTION_KEY_VERSION: "2",
      }),
    ).toThrow("missing");
  });
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "100.64.1.2",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fd00::1",
    "224.0.0.1",
  ])("blocks private/reserved %s", (ip) =>
    expect(publicAddress(ip)).toBe(false),
  );
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])(
    "accepts public %s",
    (ip) => expect(publicAddress(ip)).toBe(true),
  );
});
describe("AI draft boundaries", () => {
  const fields = {
    name: "",
    offer: "",
    categories: [],
    locations: [],
    requiredEvidence: [],
  };
  it("allows incomplete suggestions only when it asks for clarification", () => {
    expect(
      CampaignDraftResultSchema.safeParse({
        status: "needs_clarification",
        fields,
        questions: ["What is your offer?"],
        assumptions: [],
      }).success,
    ).toBe(true);
    expect(
      CampaignDraftResultSchema.safeParse({
        status: "ready",
        fields,
        questions: [],
        assumptions: [],
      }).success,
    ).toBe(false);
    expect(
      CampaignDraftResultSchema.safeParse({
        status: "needs_clarification",
        fields,
        questions: [],
        assumptions: [],
      }).success,
    ).toBe(false);
  });
  it("rejects unexpected draft actions and model URLs", () => {
    expect(
      CampaignDraftResultSchema.safeParse({
        status: "ready",
        fields: { ...fields, name: "Clinics", offer: "Software" },
        questions: [],
        assumptions: [],
        execute: "search",
      }).success,
    ).toBe(false);
    expect(
      AISettingsInput.safeParse({
        provider: "groq",
        model: "https://untrusted.example/model",
      }).success,
    ).toBe(false);
    expect(
      AISettingsInput.safeParse({
        provider: "compatible",
        model: "llama3.1:8b",
        responseMode: "text",
      }).success,
    ).toBe(true);
  });
});

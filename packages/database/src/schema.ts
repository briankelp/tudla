import {
  pgSchema,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  integer,
  date,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import type {
  Business,
  Fact,
  Analysis,
  AISettings,
  CampaignFields,
  CampaignDraftResult,
  EmailDraft,
} from "@lead/contracts";
export const lead = pgSchema("lead");
const id = () => uuid("id").primaryKey().defaultRandom();
const created = () =>
  timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow();
export const users = lead.table("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
});
export const workspaces = lead.table("workspaces", {
  id: id(),
  name: text("name").notNull(),
  createdAt: created(),
});
export const memberships = lead.table(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);
export const campaigns = lead.table("campaigns", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  offer: text("offer").notNull(),
  categories: jsonb("categories").$type<string[]>().notNull(),
  locations: jsonb("locations").$type<string[]>().notNull(),
  requiredEvidence: jsonb("required_evidence").$type<string[]>().notNull(),
  createdAt: created(),
});
export const businesses = lead.table(
  "businesses",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    externalKey: text("external_key").notNull(),
    data: jsonb("data").$type<Business>().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("business_key").on(t.workspaceId, t.externalKey)],
);
export const observations = lead.table("observations", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  facts: jsonb("facts").$type<Fact[]>().notNull(),
  createdAt: created(),
});
export const entries = lead.table(
  "entries",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    stage: text("stage").notNull().default("New"),
    notes: text("notes").notNull().default(""),
    followUpOn: date("follow_up_on", { mode: "string" }),
    emailDraft: jsonb("email_draft").$type<EmailDraft | null>(),
    assignedTo: uuid("assigned_to"),
    feedback: text("feedback").notNull().default(""),
    createdAt: created(),
  },
  (t) => [uniqueIndex("campaign_business").on(t.campaignId, t.businessId)],
);
export const analyses = lead.table("analyses", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => entries.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<Analysis | null>(),
  inputFacts: jsonb("input_facts").$type<Fact[]>().notNull().default([]),
  status: text("status").notNull(),
  error: text("error"),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  provider: text("provider").notNull().default("groq"),
  campaignSnapshot: jsonb("campaign_snapshot").$type<CampaignFields | null>(),
  createdAt: created(),
});
export const connections = lead.table(
  "connections",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    encryptedKey: jsonb("encrypted_key")
      .$type<{ version: number; iv: string; tag: string; ciphertext: string }>()
      .notNull(),
    mask: text("mask").notNull(),
    enabled: boolean("enabled").notNull(),
    allowMembers: boolean("allow_members").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("workspace_provider").on(t.workspaceId, t.provider)],
);
export const jobs = lead.table("jobs", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  campaignId: uuid("campaign_id").references(() => campaigns.id, {
    onDelete: "cascade",
  }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("queued"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  progress: integer("progress").notNull().default(0),
  total: integer("total").notNull().default(0),
  message: text("message").notNull().default("Queued"),
  checkpoint: jsonb("checkpoint")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  dispatchedAt: timestamp("dispatched_at", {
    withTimezone: true,
    mode: "string",
  }),
  createdAt: created(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
});
export const usage = lead.table(
  "usage",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    stepKey: text("step_key").notNull(),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    tokens: integer("tokens"),
    credits: integer("credits").notNull().default(0),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    responseId: text("response_id"),
    errorCode: text("error_code"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("usage_step").on(t.workspaceId, t.stepKey)],
);
export const aiSettings = lead.table("ai_settings", {
  workspaceId: uuid("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  config: jsonb("config").$type<AISettings>().notNull(),
  revision: integer("revision").notNull().default(1),
  updatedAt: created(),
});
export const campaignDrafts = lead.table(
  "campaign_drafts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    brief: text("brief").notNull(),
    answers: text("answers").notNull().default(""),
    current: jsonb("current_fields").$type<CampaignFields | null>(),
    parentId: uuid("parent_id"),
    inputHash: text("input_hash").notNull(),
    aiConfig: jsonb("ai_config")
      .$type<AISettings & { connectionId: string; revision: number }>()
      .notNull(),
    result: jsonb("result").$type<CampaignDraftResult | null>(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    acceptedCampaignId: uuid("accepted_campaign_id").references(
      () => campaigns.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("queued"),
    message: text("message").notNull().default("Queued"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("draft_tenant").on(t.id, t.workspaceId)],
);
export const invites = lead.table("invites", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", {
    withTimezone: true,
    mode: "string",
  }).notNull(),
  createdAt: created(),
});
export const views = lead.table("views", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, string>>().notNull(),
  createdAt: created(),
});

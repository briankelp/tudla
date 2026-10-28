import { z } from "zod";
export const providers = [
  "serpapi",
  "groq",
  "google",
  "compatible",
  "firecrawl",
] as const;
export const ProviderSchema = z.enum(providers);
export type Provider = z.infer<typeof ProviderSchema>;
export const llmProviders = ["groq", "google", "compatible"] as const;
export const LLMProviderSchema = z.enum(llmProviders);
export type LLMProvider = z.infer<typeof LLMProviderSchema>;
export const AISettingsInput = z.object({
  provider: LLMProviderSchema,
  model: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^(?!.*:\/\/)(?!\/\/)[\w./:\-]+$/, "Use a model ID, not a URL."),
  responseMode: z.enum(["structured", "text"]).default("structured"),
});
export type AISettings = z.infer<typeof AISettingsInput>;
export const stages = ["New", "Shortlisted", "Contacted", "Not a fit"] as const;
export const StageSchema = z.enum(stages);
const text = z.string().trim().max(2000);
export const CampaignInput = z.object({
  name: text.min(1).max(100),
  offer: text.min(1).max(500),
  categories: z.array(z.string().trim().min(1).max(80)).max(12),
  locations: z.array(z.string().trim().min(1).max(100)).max(12),
  requiredEvidence: z
    .array(z.string().trim().min(1).max(160))
    .max(10)
    .refine(
      (values) =>
        new Set(values.map((v) => v.toLowerCase())).size === values.length &&
        !values.some((v) => ["category", "location"].includes(v.toLowerCase())),
      "Use unique evidence criteria other than Category or Location.",
    ),
});
export type Campaign = z.infer<typeof CampaignInput> & {
  id: string;
  createdAt: string;
};
export type CampaignFields = z.infer<typeof CampaignInput>;
export const campaignContext = (campaign: CampaignFields) =>
  JSON.stringify([
    campaign.offer,
    campaign.categories,
    campaign.locations,
    campaign.requiredEvidence,
  ]);
export const DraftFieldsSchema = CampaignInput.extend({
  name: text.max(100),
  offer: text.max(500),
});
export const CampaignDraftResultSchema = z
  .object({
    status: z.enum(["needs_clarification", "ready"]),
    fields: DraftFieldsSchema,
    questions: z.array(z.string().trim().min(1).max(250)).max(3),
    assumptions: z.array(z.string().trim().min(1).max(250)).max(5),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === "ready" &&
      !CampaignInput.safeParse(value.fields).success
    )
      ctx.addIssue({
        code: "custom",
        message: "A ready draft needs valid campaign fields.",
      });
    if (value.status === "needs_clarification" && !value.questions.length)
      ctx.addIssue({
        code: "custom",
        message: "Ask a question when information is missing.",
      });
  });
export type CampaignDraftResult = z.infer<typeof CampaignDraftResultSchema>;
export const CampaignDraftInput = z.object({
  requestId: z.string().uuid(),
  brief: z.string().trim().min(12).max(4000),
  answers: z.string().trim().max(2000).default(""),
  current: DraftFieldsSchema.optional(),
  parentId: z.string().uuid().optional(),
});
export type DraftRequest = z.infer<typeof CampaignDraftInput>;
export type CampaignDraft = {
  id: string;
  brief: string;
  answers: string;
  current: CampaignFields | null;
  parentId: string | null;
  result: CampaignDraftResult | null;
  jobId: string | null;
  acceptedCampaignId: string | null;
  status: string;
  message: string;
  createdAt: string;
};
export const BusinessInput = z.object({
  name: text.min(1).max(200),
  category: text.max(200).default(""),
  address: text.max(500).default(""),
  phone: text.max(100).default(""),
  email: z.string().trim().max(254).email().or(z.literal("")).default(""),
  website: text.max(2000).default(""),
  rating: z.number().min(0).max(5).nullable().default(null),
  reviews: z.number().int().min(0).nullable().default(null),
  placeId: text.max(500).default(""),
  sourceUrl: text.max(2000).default(""),
});
export type Business = z.infer<typeof BusinessInput>;
export const BusinessDetailsInput = BusinessInput.pick({
  name: true,
  category: true,
  address: true,
  phone: true,
  email: true,
  website: true,
});
export const EmailDraftInput = z.object({
  to: BusinessInput.shape.email,
  subject: z
    .string()
    .max(200)
    .regex(/^[^\r\n]*$/, "Subject must be a single line."),
  body: z.string().max(5000),
  context: z.string().max(2000).default(""),
});
export type EmailDraft = z.infer<typeof EmailDraftInput>;
export const AssessmentSchema = z
  .object({
    criterion: z.string().max(200),
    result: z.enum(["match", "mismatch", "unknown"]),
    evidenceIds: z.array(z.string().max(100)).max(8),
  })
  .strict();
export const AnalysisSchema = z
  .object({
    summary: z.string().min(1).max(800),
    assessments: z.array(AssessmentSchema).max(30),
    unknowns: z.array(z.string().max(200)).max(12),
    nextQuestion: z.string().max(250),
  })
  .strict();
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Fact = {
  id: string;
  label: string;
  value: string;
  source: string;
  observedAt: string;
  url: string;
};
export type Prospect = {
  id: string;
  businessId: string;
  campaignId: string;
  business: Business;
  stage: z.infer<typeof StageSchema>;
  notes: string;
  assignedTo: string | null;
  facts: Fact[];
  analysis: Analysis | null;
  analysisFacts?: Fact[];
  analysisStatus: string;
  analysisError: string | null;
  feedback: string;
  followUpOn?: string | null;
  emailDraft?: EmailDraft | null;
  createdAt: string;
};
export type Workspace = {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
};
export type Connection = {
  provider: Provider;
  mask: string;
  enabled: boolean;
  allowMembers: boolean;
  updatedAt: string;
};
export type Job = {
  id: string;
  kind:
    | "discovery"
    | "analysis"
    | "enrichment"
    | "connection_test"
    | "campaign_draft";
  status: string;
  campaignId: string | null;
  progress: number;
  total: number;
  message: string;
  createdAt: string;
  updatedAt: string;
};
export const JobInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("discovery"),
    campaignId: z.string().uuid(),
    query: text.min(2).max(200),
    limit: z.number().int().min(1).max(20).default(20),
  }),
  z.object({
    kind: z.enum(["analysis", "enrichment"]),
    campaignId: z.string().uuid(),
    entryIds: z.array(z.string().uuid()).min(1).max(20),
  }),
  z.object({ kind: z.literal("connection_test"), provider: ProviderSchema }),
]);
export const EntryPatch = z.object({
  stage: StageSchema.optional(),
  notes: z.string().max(5000).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  feedback: z.string().trim().max(1000).optional(),
  followUpOn: z.string().date().nullable().optional(),
  emailDraft: EmailDraftInput.nullable().optional(),
});
export const ConnectionInput = z.object({
  key: z.string().trim().min(8).max(1000),
  enabled: z.boolean().default(true),
  allowMembers: z.boolean().default(false),
});
export const ImportInput = z.object({
  campaignId: z.string().uuid(),
  businesses: z.array(BusinessInput).min(1).max(200),
});
export type Member = { userId: string; email: string; role: string };
export type Usage = {
  provider: Provider;
  model?: string | null;
  status: string;
  calls: number;
  tokens: number | null;
  unreported?: number;
  credits: number;
  cacheHits: number;
};
export const unavailable = (value: unknown) =>
  ["", "n/a", "not available", "none", "null", "undefined"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
export function safeWebsite(value: string): string {
  if (unavailable(value)) return "";
  try {
    const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : "";
  } catch {
    return "";
  }
}
export function businessKey(b: Business): string {
  if (b.placeId) return `place:${b.placeId}`;
  const clean = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `business:${clean(b.name)}|${clean(b.address)}`;
}
export function listingFacts(
  b: Business,
  source: string,
  observedAt: string,
): Fact[] {
  return [
    ["name", "Business", b.name],
    ["category", "Category", b.category],
    ["address", "Address", b.address],
    ["phone", "Phone", b.phone],
    ["email", "Email", b.email],
    ["website", "Website", safeWebsite(b.website)],
    ["rating", "Rating", b.rating === null ? "" : String(b.rating)],
  ]
    .filter(([, , value]) => !unavailable(value))
    .map(([id, label, value]) => ({
      id: `listing:${id}`,
      label: label!,
      value: value!,
      source,
      observedAt,
      url: b.sourceUrl,
    }));
}
export function fitChecks(
  b: Business,
  c: Pick<Campaign, "categories" | "locations" | "requiredEvidence">,
) {
  const checks: {
    criterion: string;
    result: "match" | "mismatch" | "unknown";
  }[] = [];
  const match = (value: string, targets: string[]) =>
    !value
      ? "unknown"
      : targets.some((t) => value.toLowerCase().includes(t.toLowerCase()))
        ? "match"
        : "mismatch";
  if (c.categories.length)
    checks.push({
      criterion: "Category",
      result: match(b.category, c.categories),
    });
  if (c.locations.length)
    checks.push({
      criterion: "Location",
      result: match(b.address, c.locations),
    });
  c.requiredEvidence.forEach((criterion) =>
    checks.push({ criterion, result: "unknown" }),
  );
  return checks;
}
export function csvCell(value: unknown): string {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

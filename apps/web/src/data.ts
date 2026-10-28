import {
  BusinessInput,
  businessKey,
  listingFacts,
  csvCell,
  fitChecks,
  type Workspace,
  type Campaign,
  type Prospect,
  type Connection,
  type Member,
  type Job,
  type Usage,
  type Business,
  type Provider,
  type Analysis,
  AISettingsInput,
  CampaignDraftResultSchema,
  type AISettings,
  type CampaignDraft,
  type DraftRequest,
} from "@lead/contracts";
export type State = {
  workspace: Workspace;
  campaigns: Campaign[];
  prospects: Prospect[];
  connections: Connection[];
  members: Member[];
  jobs: Job[];
  usage: Usage[];
  aiSettings: AISettings;
  drafts: CampaignDraft[];
  views: { id: string; name: string; filters: Record<string, string> }[];
};
export type PublicConfig = {
  authEnabled: boolean;
  supabaseUrl: string;
  publishableKey: string;
  compatibleAvailable?: boolean;
};
export const DEMO_KEY = "lead-tool-demo-v2";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-10-17T00:00:00.000Z";
export function sampleState(): State {
  const campaign: Campaign = {
    id: id(1),
    name: "Clinics · Cebu",
    offer: "Appointment scheduling software",
    categories: ["Dental clinic", "Medical clinic", "Diagnostic"],
    locations: ["Cebu"],
    requiredEvidence: ["Appointment workflow confirmed"],
    createdAt: now,
  };
  const raw = [
    ["Marina Dental Studio", "Dental clinic", "Cebu City, Cebu", "New", true],
    [
      "Harbor Family Clinic",
      "Medical clinic",
      "Mandaue, Cebu",
      "Shortlisted",
      true,
    ],
    [
      "Cedar Diagnostic Center",
      "Diagnostic center",
      "Cebu City, Cebu",
      "New",
      false,
    ],
    [
      "Sierra Dental Practice",
      "Dental clinic",
      "Lapu-Lapu, Cebu",
      "Contacted",
      true,
    ],
    [
      "Cebu Pet Care",
      "Veterinary clinic",
      "Cebu City, Cebu",
      "Not a fit",
      false,
    ],
    ["Eastbay Health Center", "Medical clinic", "Talisay, Cebu", "New", true],
  ] as const;
  const prospects = raw.map(
    ([name, category, address, stage, website], i): Prospect => {
      const business = BusinessInput.parse({
        name,
        category,
        address,
        phone: i === 2 ? "" : `+63 32 000 ${1000 + i}`,
        website: website ? "https://example.com" : "",
        rating: [4.6, 4.8, 4.2, null, 4.7, 4.3][i],
        reviews: [46, 83, 12, 0, 27, 65][i],
        placeId: `fictional-${i}`,
      });
      return {
        id: id(20 + i),
        businessId: id(40 + i),
        campaignId: campaign.id,
        business,
        stage,
        notes:
          i === 1
            ? "Confirm the current scheduling process before a product discussion."
            : "",
        assignedTo: i === 1 ? id(99) : null,
        facts: listingFacts(business, "Sample listing", now),
        analysis: null,
        analysisStatus: "not_started",
        analysisError: null,
        feedback: "",
        createdAt: now,
      };
    },
  );
  return {
    workspace: { id: id(2), name: "Sample workspace", role: "owner" },
    campaigns: [campaign],
    prospects,
    connections: [],
    members: [{ userId: id(99), email: "rep@example.com", role: "owner" }],
    jobs: [],
    usage: [],
    aiSettings: {
      provider: "groq",
      model: "openai/gpt-oss-20b",
      responseMode: "structured",
    },
    drafts: [],
    views: [],
  };
}
export function readDemo(): State {
  try {
    const value = JSON.parse(localStorage.getItem(DEMO_KEY) || "null");
    if (
      value?.version === 2 &&
      Array.isArray(value.state?.prospects) &&
      Array.isArray(value.state?.campaigns) &&
      value.state.prospects.every(
        (p: Prospect) => BusinessInput.safeParse(p.business).success,
      )
    )
      return {
        ...value.state,
        prospects: value.state.prospects.map((p: Prospect) => ({
          ...p,
          business: BusinessInput.parse(p.business),
        })),
        aiSettings: AISettingsInput.safeParse(value.state.aiSettings).success
          ? value.state.aiSettings
          : sampleState().aiSettings,
        drafts: Array.isArray(value.state.drafts)
          ? value.state.drafts.filter(
              (d: CampaignDraft) =>
                d &&
                typeof d.id === "string" &&
                typeof d.brief === "string" &&
                (!d.result ||
                  CampaignDraftResultSchema.safeParse(d.result).success),
            )
          : [],
      };
  } catch {
    /* A damaged sample does not prevent a fresh demo. */
  }
  return sampleState();
}
export function sampleCampaignDraft(input: DraftRequest): CampaignDraft {
  const fields = input.current || {
    name: "",
    offer: "",
    categories: [],
    locations: [],
    requiredEvidence: [],
  };
  return {
    id: input.requestId,
    brief: input.brief,
    answers: input.answers,
    current: input.current || null,
    parentId: input.parentId || null,
    jobId: null,
    acceptedCampaignId: null,
    status: "needs_clarification",
    message: "Sample draft ready to edit",
    createdAt: new Date().toISOString(),
    result: {
      status: "needs_clarification",
      fields: {
        ...fields,
        name: fields.name || "New campaign",
        offer: fields.offer || input.brief.slice(0, 500),
      },
      questions: [
        "Which business categories, locations, and evidence should the campaign include?",
      ],
      assumptions: [
        "Sample mode copies your brief into editable fields. It does not call an AI provider.",
      ],
    },
  };
}
export function storeDemo(state: State) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify({ version: 2, state }));
  } catch {
    throw Error(
      "Browser storage is full or unavailable. Export your records before leaving.",
    );
  }
}
export async function request<T>(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw Error(err.message || "The request could not be completed.");
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
export function downloadCsv(prospects: Prospect[]) {
  const csv = [
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
    ...prospects.map((p) => [
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
  const url = URL.createObjectURL(
    new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "prospects.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function importDemo(
  state: State,
  campaignId: string,
  businesses: Business[],
  source = "CSV import",
): State {
  const existing = new Set(
    state.prospects
      .filter((p) => p.campaignId === campaignId)
      .map((p) => businessKey(p.business)),
  );
  const additions = businesses
    .filter((b) => {
      const key = businessKey(b);
      if (existing.has(key)) return false;
      existing.add(key);
      return true;
    })
    .map((b) => ({
      id: crypto.randomUUID(),
      businessId:
        state.prospects.find((p) => businessKey(p.business) === businessKey(b))
          ?.businessId || crypto.randomUUID(),
      campaignId,
      business: b,
      stage: "New" as const,
      notes: "",
      assignedTo: null,
      facts: listingFacts(b, source, new Date().toISOString()),
      analysis: null,
      analysisStatus: "not_started",
      analysisError: null,
      feedback: "",
      createdAt: new Date().toISOString(),
    }));
  return { ...state, prospects: [...additions, ...state.prospects] };
}
export function sampleAnalysis(p: Prospect, campaign: Campaign): Analysis {
  const checks = fitChecks(p.business, campaign);
  return {
    summary: `${p.business.name} is listed${p.business.category ? ` as a ${p.business.category.toLowerCase()}` : ""}${p.business.address ? ` in ${p.business.address}` : ""}.`,
    assessments: checks.map((c) => ({
      ...c,
      evidenceIds:
        c.criterion === "Category"
          ? ["listing:category"]
          : c.criterion === "Location"
            ? ["listing:address"]
            : [],
    })),
    unknowns: [
      ...new Set([
        ...checks.filter((c) => c.result === "unknown").map((c) => c.criterion),
        "Budget and buying intent",
      ]),
    ],
    nextQuestion: `Is ${campaign.offer} relevant to your current priorities?`,
  };
}
export function parseBusinesses(raw: unknown[]): Business[] {
  return raw.map((row: any) =>
    BusinessInput.parse({
      name: row.companyName || row.name || row.business || row["company name"],
      category: row.category || "",
      address: row.address || "",
      phone: row.contactPhone || row.phone || "",
      email: row.email || row.contactEmail || "",
      website: row.website || "",
      rating:
        row.rating === ""
          ? null
          : Number.isFinite(Number(row.rating)) && row.rating != null
            ? Number(row.rating)
            : null,
      reviews:
        row.reviews === ""
          ? null
          : Number.isFinite(Number(row.reviews)) && row.reviews != null
            ? Number(row.reviews)
            : null,
      placeId: row.placeId || row.raw?.placeId || "",
      sourceUrl: row.sourceUrl || "",
    }),
  );
}

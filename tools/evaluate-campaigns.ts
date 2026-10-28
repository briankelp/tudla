import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";
import {
  CampaignDraftInput,
  CampaignDraftResultSchema,
  type CampaignDraftResult,
} from "@lead/contracts";

const ExpectedSchema = z
  .object({
    status: z.enum(["ready", "needs_clarification"]).optional(),
    requiredLocations: z.array(z.string().trim().min(1)).optional(),
    requiredCategories: z.array(z.string().trim().min(1)).optional(),
    offerIncludes: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const FixtureSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/),
    split: z.enum(["development", "heldout"]),
    brief: z.string().trim().min(12).max(4000),
    answers: z.string().trim().max(2000).optional(),
    current: z
      .object({
        name: z.string(),
        offer: z.string(),
        categories: z.array(z.string()),
        locations: z.array(z.string()),
        requiredEvidence: z.array(z.string()),
      })
      .strict()
      .optional(),
    expected: ExpectedSchema,
  })
  .strict();

export type CampaignCase = z.infer<typeof FixtureSchema>;
export type CampaignPrediction = {
  id: string;
  result: unknown;
  latencyMs?: number;
  tokens?: number;
  provider?: string;
  model?: string;
};

const PredictionLineSchema = z
  .object({
    id: z.string().min(1),
    result: z.unknown(),
    latencyMs: z.number().finite().nonnegative().optional(),
    tokens: z.number().finite().nonnegative().optional(),
    provider: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
  })
  .strict();

export type RateMetric = {
  matched: number;
  denominator: number;
  rate: number | null;
};
export type CampaignEvaluation = {
  caseCount: number;
  predictionsReceived: number;
  missingIds: string[];
  coverage: RateMetric;
  schemaValid: RateMetric;
  schemaValidAmongReceived: RateMetric;
  statusAgreement: RateMetric;
  anchorRetention: RateMetric;
  latencyMs: { reported: number; total: number; mean: number | null };
  tokens: { reported: number; total: number };
  providerModels: Array<{
    provider: string | null;
    model: string | null;
    predictions: number;
  }>;
  cases: Array<{
    id: string;
    split: CampaignCase["split"];
    predictionReceived: boolean;
    schemaValid: boolean;
    statusMatches: boolean | null;
    anchors: RateMetric;
  }>;
};

function metric(matched: number, denominator: number): RateMetric {
  return {
    matched,
    denominator,
    rate: denominator ? matched / denominator : null,
  };
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function hasAnchor(values: string[], anchor: string) {
  const target = normalize(anchor);
  return values.some((value) => normalize(value).includes(target));
}

/** Parse and validate newline-delimited fixtures, including shared campaign input rules. */
export function parseCampaignCases(text: string): CampaignCase[] {
  const parsed: CampaignCase[] = [];
  const ids = new Set<string>();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`Invalid fixture JSON on line ${index + 1}.`);
    }
    const item = FixtureSchema.parse(raw);
    if (ids.has(item.id)) throw new Error(`Duplicate fixture ID: ${item.id}`);
    ids.add(item.id);
    CampaignDraftInput.parse({
      requestId: "00000000-0000-4000-8000-000000000001",
      brief: item.brief,
      answers: item.answers,
      current: item.current,
    });
    parsed.push(item);
  }
  if (!parsed.length) throw new Error("Fixture file contains no cases.");
  const development = parsed.filter(
    (item) => item.split === "development",
  ).length;
  const heldout = parsed.filter((item) => item.split === "heldout").length;
  if (development !== 20 || heldout !== 10)
    throw new Error(
      `Expected 20 development and 10 heldout cases; found ${development} and ${heldout}.`,
    );
  return parsed;
}

/** Parse JSONL predictions. `result` stays unknown so invalid model output is measured, not discarded. */
export function parseCampaignPredictions(text: string): CampaignPrediction[] {
  const parsed: CampaignPrediction[] = [];
  const ids = new Set<string>();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`Invalid prediction JSON on line ${index + 1}.`);
    }
    if (
      raw !== null &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !Object.hasOwn(raw, "result")
    )
      throw new Error(`Missing prediction result on line ${index + 1}.`);
    const item = PredictionLineSchema.parse(raw);
    if (ids.has(item.id))
      throw new Error(`Duplicate prediction ID: ${item.id}`);
    ids.add(item.id);
    parsed.push(item as CampaignPrediction);
  }
  return parsed;
}

/** Evaluate all fixtures; missing and invalid predictions remain in each metric's denominator. */
export function evaluateCampaigns(
  cases: CampaignCase[],
  predictions: CampaignPrediction[],
): CampaignEvaluation {
  const byId = new Map<string, CampaignPrediction>();
  const known = new Set(cases.map((item) => item.id));
  for (const prediction of predictions) {
    if (!known.has(prediction.id))
      throw new Error(`Unknown prediction ID: ${prediction.id}`);
    if (byId.has(prediction.id))
      throw new Error(`Duplicate prediction ID: ${prediction.id}`);
    byId.set(prediction.id, prediction);
  }

  let validCount = 0;
  let statusMatches = 0;
  let statusDenominator = 0;
  let anchorMatches = 0;
  let anchorDenominator = 0;
  const perCase = cases.map((item) => {
    const prediction = byId.get(item.id);
    const parsed = prediction
      ? CampaignDraftResultSchema.safeParse(prediction.result)
      : null;
    const valid = Boolean(parsed?.success);
    if (valid) validCount++;
    const result = parsed?.success ? parsed.data : undefined;
    let statusMatch: boolean | null = null;
    if (item.expected.status) {
      statusDenominator++;
      statusMatch = result?.status === item.expected.status;
      if (statusMatch) statusMatches++;
    }
    const anchors = [
      ...(item.expected.requiredLocations || []).map((anchor) =>
        hasAnchor(result?.fields.locations || [], anchor),
      ),
      ...(item.expected.requiredCategories || []).map((anchor) =>
        hasAnchor(result?.fields.categories || [], anchor),
      ),
      ...(item.expected.offerIncludes || []).map((anchor) =>
        normalize(result?.fields.offer || "").includes(normalize(anchor)),
      ),
    ];
    anchorDenominator += anchors.length;
    anchorMatches += anchors.filter(Boolean).length;
    return {
      id: item.id,
      split: item.split,
      predictionReceived: Boolean(prediction),
      schemaValid: valid,
      statusMatches: statusMatch,
      anchors: metric(anchors.filter(Boolean).length, anchors.length),
    };
  });

  const latencyValues = predictions.flatMap((p) =>
    p.latencyMs === undefined ? [] : [p.latencyMs],
  );
  const tokenValues = predictions.flatMap((p) =>
    p.tokens === undefined ? [] : [p.tokens],
  );
  const sourceCounts = new Map<
    string,
    { provider: string | null; model: string | null; predictions: number }
  >();
  for (const prediction of predictions) {
    const provider = prediction.provider || null;
    const model = prediction.model || null;
    const key = JSON.stringify([provider, model]);
    const source = sourceCounts.get(key) || { provider, model, predictions: 0 };
    source.predictions++;
    sourceCounts.set(key, source);
  }
  const denominator = cases.length;
  return {
    caseCount: denominator,
    predictionsReceived: byId.size,
    missingIds: cases
      .filter((item) => !byId.has(item.id))
      .map((item) => item.id),
    coverage: metric(byId.size, denominator),
    schemaValid: metric(validCount, denominator),
    schemaValidAmongReceived: metric(validCount, byId.size),
    statusAgreement: metric(statusMatches, statusDenominator),
    anchorRetention: metric(anchorMatches, anchorDenominator),
    latencyMs: {
      reported: latencyValues.length,
      total: latencyValues.reduce((sum, value) => sum + value, 0),
      mean: latencyValues.length
        ? latencyValues.reduce((sum, value) => sum + value, 0) /
          latencyValues.length
        : null,
    },
    tokens: {
      reported: tokenValues.length,
      total: tokenValues.reduce((sum, value) => sum + value, 0),
    },
    providerModels: [...sourceCounts.values()],
    cases: perCase,
  };
}

export async function loadCampaignCases(
  path = resolve("eval/campaigns.jsonl"),
) {
  return parseCampaignCases(await readFile(path, "utf8"));
}

async function main(args: string[]) {
  const cases = await loadCampaignCases();
  const predictionArg = args.indexOf("--predictions");
  if (predictionArg < 0) {
    console.log(
      JSON.stringify(
        {
          fixtureReadiness: {
            status: "ready",
            caseCount: cases.length,
            splits: { development: 20, heldout: 10 },
          },
          modelMetrics: null,
          note: "No provider calls were made. Supply --predictions with JSONL output to score a model run.",
        },
        null,
        2,
      ),
    );
    return;
  }
  const path = args[predictionArg + 1];
  if (!path || path.startsWith("--"))
    throw new Error("--predictions requires a JSONL file path.");
  const predictions = parseCampaignPredictions(await readFile(path, "utf8"));
  console.log(JSON.stringify(evaluateCampaigns(cases, predictions), null, 2));
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Evaluation failed.",
    );
    process.exitCode = 1;
  });
}

export type { CampaignDraftResult };

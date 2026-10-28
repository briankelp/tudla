import { readFile, writeFile } from "node:fs/promises";
import { BusinessInput, listingFacts } from "@lead/contracts";
import { validateAnalysis } from "../apps/server/src/providers.js";
type Case = {
  id: string;
  split: string;
  business: unknown;
  campaign: {
    categories: string[];
    locations: string[];
    requiredEvidence: string[];
  };
  expected: Record<string, string>;
};
const cases: Case[] = JSON.parse(
  await readFile(new URL("../eval/cases.json", import.meta.url), "utf8"),
);
const args = process.argv.slice(2);
const input = args.indexOf("--predictions");
const output = args.indexOf("--output");
if (input < 0) {
  console.log(
    JSON.stringify(
      {
        status: "ready",
        examples: cases.length,
        development: cases.filter((c) => c.split === "development").length,
        heldout: cases.filter((c) => c.split === "heldout").length,
        modelMetrics: null,
        note: "No model predictions supplied. This is evaluation setup, not measured AI accuracy.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
const predictions = (await readFile(args[input + 1]!, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const seen = new Set();
const splits: Record<
  string,
  {
    examples: number;
    valid: number;
    correct: number;
    criteria: number;
    referenceValid: number;
    latencyMs: number;
    tokens: number;
  }
> = {};
for (const p of predictions) {
  const example = cases.find((c) => c.id === p.id);
  if (!example || seen.has(p.id))
    throw Error("Unknown or duplicate example ID.");
  seen.add(p.id);
  const result = (splits[example.split] ??= {
    examples: 0,
    valid: 0,
    correct: 0,
    criteria: 0,
    referenceValid: 0,
    latencyMs: 0,
    tokens: 0,
  });
  result.examples++;
  result.criteria += Object.keys(example.expected).length;
  result.latencyMs += Number(p.latencyMs) || 0;
  result.tokens += Number(p.tokens) || 0;
  try {
    const facts = listingFacts(
      BusinessInput.parse(example.business),
      "Evaluation fixture",
      "2026-10-17T00:00:00Z",
    );
    const analysis = validateAnalysis(p.analysis, facts, example.campaign);
    result.valid++;
    result.referenceValid++;
    for (const a of analysis.assessments)
      if (example.expected[a.criterion] === a.result) result.correct++;
  } catch {
    /* Invalid responses count against all criteria in that example. */
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  examples: predictions.length,
  splits: Object.fromEntries(
    Object.entries(splits).map(([name, v]) => [
      name,
      {
        ...v,
        schemaAndReferenceValidity: v.valid / v.examples,
        criterionAgreement: v.correct / v.criteria,
        meanLatencyMs: v.latencyMs / v.examples,
      },
    ]),
  ),
  limitations:
    "Synthetic fixtures. Valid references do not prove a claim is supported. Independently review summary claims and test with representative source data before reporting model quality.",
};
console.log(JSON.stringify(report, null, 2));
if (output >= 0)
  await writeFile(args[output + 1]!, JSON.stringify(report, null, 2) + "\n");

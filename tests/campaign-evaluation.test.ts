import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  evaluateCampaigns,
  parseCampaignCases,
  parseCampaignPredictions,
  type CampaignCase,
} from "../tools/evaluate-campaigns.js";

function validResult(item: CampaignCase) {
  const locations = item.expected.requiredLocations || [];
  const categories = item.expected.requiredCategories || [];
  const offer = item.expected.offerIncludes?.join(" ") || "A supplied service";
  const status = item.expected.status || "ready";
  return {
    status,
    fields: {
      name: "Reviewable campaign",
      offer,
      categories,
      locations,
      requiredEvidence: [],
    },
    questions:
      status === "needs_clarification"
        ? ["What should the campaign focus on?"]
        : [],
    assumptions: [],
  };
}

describe("campaign evaluation harness", () => {
  it("validates the frozen fixture set and its development/heldout split", async () => {
    const content = await readFile("eval/campaigns.jsonl", "utf8");
    const cases = parseCampaignCases(content);
    expect(cases).toHaveLength(30);
    expect(cases.filter((item) => item.split === "development")).toHaveLength(
      20,
    );
    expect(cases.filter((item) => item.split === "heldout")).toHaveLength(10);
    expect(cases.some((item) => item.current && item.answers)).toBe(true);
  });

  it("keeps missing and malformed outputs in full-set denominators", async () => {
    const cases = await (async () =>
      parseCampaignCases(await readFile("eval/campaigns.jsonl", "utf8")))();
    const predictions = [
      {
        id: cases[0]!.id,
        result: validResult(cases[0]!),
        latencyMs: 120,
        tokens: 35,
        provider: "groq",
        model: "test-model",
      },
      { id: cases[1]!.id, result: { status: "ready", fields: {} } },
    ];
    const report = evaluateCampaigns(cases, predictions);
    expect(report).toMatchObject({
      caseCount: 30,
      predictionsReceived: 2,
      missingIds: expect.arrayContaining([cases[2]!.id]),
      coverage: { matched: 2, denominator: 30 },
      schemaValid: { matched: 1, denominator: 30 },
      schemaValidAmongReceived: { matched: 1, denominator: 2 },
      latencyMs: { reported: 1, total: 120, mean: 120 },
      tokens: { reported: 1, total: 35 },
      providerModels: [
        { provider: "groq", model: "test-model", predictions: 1 },
        { provider: null, model: null, predictions: 1 },
      ],
    });
    expect(report.cases.find((item) => item.id === cases[2]!.id)).toMatchObject(
      {
        predictionReceived: false,
        schemaValid: false,
      },
    );
    expect(report.cases.find((item) => item.id === cases[1]!.id)).toMatchObject(
      {
        predictionReceived: true,
        schemaValid: false,
        statusMatches: false,
      },
    );
    expect(report.anchorRetention.denominator).toBeGreaterThan(0);
    expect(report.statusAgreement.denominator).toBeGreaterThan(0);
  });

  it("rejects duplicate fixtures, duplicate prediction IDs, and unknown prediction IDs", async () => {
    const content = await readFile("eval/campaigns.jsonl", "utf8");
    const first = JSON.parse(content.split("\n")[0]!);
    expect(() =>
      parseCampaignCases(`${JSON.stringify(first)}\n${JSON.stringify(first)}`),
    ).toThrow(/Duplicate fixture ID/);
    expect(() =>
      parseCampaignPredictions(
        '{"id":"dev-bakery-loyalty","result":{}}\n{"id":"dev-bakery-loyalty","result":{}}',
      ),
    ).toThrow(/Duplicate prediction ID/);
    expect(() =>
      parseCampaignPredictions('{"id":"dev-bakery-loyalty"}'),
    ).toThrow(/Missing prediction result/);
    const cases = parseCampaignCases(content);
    expect(() =>
      evaluateCampaigns(cases, [{ id: "unknown-case", result: {} }]),
    ).toThrow(/Unknown prediction ID/);
  });
});

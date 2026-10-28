# Campaign draft evaluation

`campaigns.jsonl` is a small, synthetic behavior check for campaign drafting. It contains 20 development briefs and 10 heldout briefs across sales industries. The set includes vague requests, conflicting constraints, refinements to existing fields, and multiple locations. It has no real customer data or factual claims about markets.

Run `npm run eval:campaigns` to validate the fixture set and print its size. This default path makes no provider calls and reports `modelMetrics: null`. To score saved output, pass a JSONL file with one record per prediction:

```sh
npm run eval:campaigns -- --predictions /path/to/predictions.jsonl
```

Each prediction has an `id`, a `result` conforming to `CampaignDraftResult`, and optional `latencyMs`, `tokens`, `provider`, and `model` fields. The prediction file is the output of a separately run model evaluation; this tool does not request a model or infer missing generations. Duplicate and unknown IDs are errors. Invalid result schemas are counted as invalid predictions.

## Measures

- **Coverage** is predictions received divided by all fixture cases.
- **Schema validity** is valid results divided by all fixture cases. Missing predictions therefore count as failures. `schemaValidAmongReceived` is also shown to distinguish output quality from coverage.
- **Status agreement** is exact agreement with cases that specify an expected status. Missing or invalid results count as disagreements.
- **Anchor retention** checks only explicit `requiredLocations`, `requiredCategories`, and `offerIncludes` strings. A location or category must appear in a corresponding result field; an offer anchor must appear in the offer. Matching is case-insensitive substring matching. Missing or invalid results count as missed anchors.
- **Latency and tokens** total and average only supplied numeric values; each reports how many predictions supplied a value.
- The report lists missing fixture IDs and groups predictions by their optional provider/model labels.

These checks cannot determine whether the generated offer is entailed by the brief, whether a clarification question is useful, or whether an assumption is safe. Those require human review using the rubric below. Do not interpret these fixture metrics as production accuracy or factuality scores.

## Manual review rubric

For each sampled output, verify that it preserves explicit audience, location, and offer constraints; does not silently resolve contradictions; asks a focused question when essential information is missing; and labels assumptions without presenting them as facts. Treat generated campaign fields as editable suggestions, not verified claims. Record any invented market evidence, customer counts, outcomes, pricing, or business details as a failure even when the JSON schema is valid.

## Heldout process

Keep the 10 heldout briefs unchanged while tuning prompts, schemas, or models. Use the 20 development cases to identify and fix behavior. When comparing a new version, save one prediction per fixture ID with the exact provider/model and optional latency/token metadata, then evaluate both splits separately by filtering the report's per-case `split` values or by using a local analysis script. Review heldout outputs only after the change is frozen. If heldout cases are used to make another change, they become development data; write a fresh, versioned heldout set before making a new heldout claim. Keep prediction files alongside the code revision and settings so runs can be reproduced.

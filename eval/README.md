# Evaluation

`npm run eval` checks the fixture inventory without calling providers. It does not report AI accuracy without model predictions.

The initial eight synthetic fixtures cover category/location matches, missing data, unsupported budget/intent, missing websites, and hostile source text. Four are development examples; four are held out. Freeze a larger representative evaluation set before tuning a prompt against real business data. Do not claim these eight fixtures establish production quality.

To evaluate externally collected responses, write JSONL records with `id` matching a case, `analysis` matching the research schema, and optional `latencyMs` and `tokens`, then run:

```sh
npm run eval -- --predictions /path/to/predictions.jsonl --output /path/to/report.json
```

The report separates development and held-out results. Invalid responses count against the expected criteria. It measures response/schema/reference validity and agreement with explicit labels. It cannot automatically measure whether a summary's prose is entailed by a source; that requires independent human review. No conversion, time-saving, throughput, or cost-per-lead claim has been measured yet.

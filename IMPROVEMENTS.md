# Tudla remaining work

This roadmap distinguishes deployment validation and product improvements from features already implemented.

## Current baseline

The application already has PostgreSQL persistence, Google/Supabase authentication, workspace isolation, encrypted provider connections, campaign drafting, discovery/import/manual entry, notes/follow-ups, outreach drafts, CSV export, resumable jobs, usage limits, deletion, Docker packaging, CI, and evaluation fixtures. Do not list these as missing MVP features. See [README](README.md) and [architecture](CODEBASE_EXPLAINED.md).

The public demo uses sample data and makes no provider calls. An operator must validate authentication and provider behavior in their own self-hosted installation.

## Validate before relying on a live service

| Work                                  | Completion evidence                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hosted identity/workspace walkthrough | Two real Google accounts, independent workspaces, an intentional invitation, and attempted cross-workspace access |
| Bounded provider smoke test           | Actual selected provider/model, representative reviewed output, request settings, date, and usage                 |
| Hosting/worker health                 | Verified deployed revision, API health, queue completion and recovery on the chosen connection mode               |
| Backups and restore                   | Restore into a separate environment with the required encryption key versions, then sign in and inspect records   |
| Operational alerting                  | A tested alert for a failed/stalled run or unavailable service                                                    |
| Source retention policy               | Defined retention and deletion rules for actual business data and the operator's managed-auth account process     |

These checks require deployment/account access and, for provider calls, may consume credits. They are not implied by passing local integration tests.

## Product improvements

- Server-side pagination and filtering beyond the current 2,000-entry workspace response; measure the queries and preserve selection/export semantics.
- An activity history for changes to stages, contact fields, and assignments, with a deliberate record/retention model.
- Explicit follow-up completion/history. Dates currently support due filtering; they do not schedule reminders.
- Duplicate review and conflict resolution for uncertain imports; retain branch identity and source provenance.
- A signed-in Team walkthrough and broader keyboard, screen-reader, and browser coverage.

## Evaluation and performance

- Collect representative permitted source data and saved model predictions; keep development and heldout examples distinct.
- Independently review summary entailment, useful questions, and assumptions in addition to schema/reference validity.
- Measure task completion time before claiming productivity gains, and record sample size and comparison method.
- Test the hosted queue, database pools, provider limits, memory, latency, and load before stating a supported-user or throughput number.
- Add account-specific cost estimates only when authoritative prices and actual usage are available. The application already records calls, supplied tokens, known credits, and cache hits.

## Optional extensions

CRM handoff, additional discovery providers, a self-hosted retrieval service, member-specific keys, automated outreach, and subscription billing are separate product decisions. A self-hosted browser or arbitrary endpoint would need its own network controls and operating budget. No implementation is promised by this roadmap.

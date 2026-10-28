# Deployment

## Static demo

The default deployment is the browser-local sample. It needs no credentials, database, or provider account. Use [Vercel's static configuration](STATIC-DEMO.md), or `docker compose up -d --build` for a loopback-only local instance. The Docker image runs as a non-root user and contains no backend dependencies.

## Authenticated self-hosting

Use your own Supabase project, PostgreSQL database, hosting account, and provider credentials. Treat this as an application to configure and validate, not a managed service with a security or availability guarantee. Keep it private until authentication, workspace isolation, backups, and provider behavior have been checked in your deployment.

### Local live stack

1. Copy `.env.example` to `.env` without overwriting an existing environment file.
2. Set unique `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, and `QUEUE_DB_PASSWORD` values. They configure the isolated Docker database roles. Example passwords are for local development only.
3. Set `DEMO_ONLY=false`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY`. Use asymmetric ES256/RS256 signing keys and enable Google sign-in in Supabase.
4. Generate an encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put it in `ENCRYPTION_KEY`. Keep it private and backed up separately from the database.
5. Run `docker compose -f compose.live.yaml up -d --build`. Open `http://localhost:3100`.

`compose.live.yaml` builds the live frontend explicitly, runs migrations, and starts PostgreSQL, the API, and a separate worker. Its database and web ports bind to loopback. Keep `APP_ORIGIN` and your Supabase redirect allowlist consistent with the address actually used by the browser. Do not expose the local Compose configuration directly to the internet.

### Hosted API and worker

Build Docker with `--target live --build-arg VITE_LIVE_WORKSPACES=true`. Serve the app through HTTPS, with `APP_ORIGIN` set to that exact public origin. Use a separate worker with command `node apps/server/dist/worker.js`; set `EMBEDDED_WORKER=false` unless intentionally operating a single-service pilot.

Use separate migration, application, and queue connections. Supply `DATABASE_ADMIN_URL` only to a one-off migration task, alongside `DATABASE_URL` and `QUEUE_DATABASE_URL`:

```sh
node tools/setup-db.mjs
node packages/database/dist/migrate.js
```

Remove the administrator connection from API and worker services. Their runtime roles must not be superusers, bypass RLS, or own application tables. Do not run migrations concurrently on every replica. Use verified TLS for remote PostgreSQL; Supabase's public CA and provenance are in [packages/database/certs](../packages/database/certs/README.md).

| Variable                                    | Purpose                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `DEMO_ONLY`                                 | `false` to enable authenticated workspaces                                        |
| `APP_ORIGIN`                                | Exact browser origin, HTTPS for public hosting                                    |
| `DATABASE_URL`                              | Restricted application connection                                                 |
| `QUEUE_DATABASE_URL`                        | Separate restricted queue connection                                              |
| `SUPABASE_URL`                              | Your Supabase authentication project                                              |
| `SUPABASE_PUBLISHABLE_KEY`                  | Public authentication configuration                                               |
| `ENCRYPTION_KEY`                            | 32 random bytes, base64 encoded, kept server-side                                 |
| `ENCRYPTION_KEYS`, `ENCRYPTION_KEY_VERSION` | Optional versioned keyring for staged rotation                                    |
| `EMBEDDED_WORKER`                           | Prefer `false` with a separate worker                                             |
| `WORKSPACE_DAILY_CALL_LIMIT`                | Per-workspace attempted-provider-call ceiling; default 100                        |
| `MAX_ACTIVE_JOBS`                           | Job-admission ceiling; default 3                                                  |
| `DATABASE_POOL_SIZE`                        | Per-process pool size; default 4                                                  |
| `LLM_COMPATIBLE_BASE_URL`                   | Optional operator-controlled HTTPS endpoint; never supplied by a workspace member |

Provider keys are supplied by workspace owners/admins in Connections and encrypted server-side. There is no operator-key fallback. Connection tests and jobs can consume requests, credits, or tokens; provider billing is authoritative. Start with small limits, test one reviewed record, and monitor usage before increasing them.

### Request limits and reverse proxies

The self-hosted Express server allows 600 requests per minute per IPv4 address or IPv6 /56 subnet, including API, configuration, and static routes. Set `REQUESTS_PER_MINUTE` to a positive integer to change that allowance. Excess requests receive HTTP 429 with rate-limit and `Retry-After` headers before body parsing or database work.

Proxy headers are untrusted by default. Behind a reverse proxy, set `TRUSTED_PROXY_CIDRS` to a comma-separated list of only that proxy's exact IP addresses or CIDRs. The proxy must overwrite incoming forwarded headers, and network rules must prevent bypassing it. Follow [Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/); do not trust arbitrary client-supplied headers or every internet address.

Counters use process memory and reset on restart. Multiple API processes have separate counters. Use an edge gateway or a shared rate-limit store for a deployment-wide quota, and configure hosting-level abuse controls separately. Provider-call limits remain independent of HTTP request limits.

### Identity, privacy, and operations

Configure a Google web OAuth client and Supabase callback using [Supabase's setup guide](https://supabase.com/docs/guides/auth/social-login/auth-google). Request identity, email, and profile only. Google secrets stay in Supabase. Test two independent accounts and intentional invitations, including attempted cross-workspace access, before inviting users.

Write a privacy notice for your installation. Account identities, business contacts, notes, drafts, and queued inputs may be stored in your database. Enabled source and AI providers receive data needed for requested jobs. Provider-generated text requires human review. Source-specific terms govern collection, storage, and redistribution.

Define retention and deletion procedures, including managed-auth account deletion. Workspace deletion and membership removal are implemented; operator account processes and storage retention still need configuring. `npm run maintenance` previews history cleanup, and `npm run maintenance -- --apply` applies it. Review a dry run before deleting records.

Enable backups and restore them into a separate environment before relying on them. Keep encryption-key versions needed by retained backups. For rotation, deploy a keyring containing both old and new keys, switch the active version, then use `npm run keys:rotate` to preview and `npm run keys:rotate -- --apply` to re-encrypt rows. Do not retire a key still required by a backup.

Monitor the API, worker, queue, database connection budget, and provider quotas. Health responses do not verify OAuth or completed provider jobs. Durable worker connections need a direct or compatible session-pool connection; do not assume a transaction pool supports persistent sessions.

## Local integration tests

Use a dedicated, disposable local PostgreSQL instance. The integration suite creates and drops a uniquely named test database and needs privileged setup roles. Never use a hosted/live application connection.

For example, start an isolated test service on an unused loopback port:

```sh
docker run --rm -d --name tudla-test-postgres \
  -p 127.0.0.1:55439:5432 \
  --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_USER=lead -e POSTGRES_PASSWORD=lead_local_only \
  -e POSTGRES_DB=lead postgres:17-alpine
```

After PostgreSQL is ready, build the packages and run setup/tests with explicit local URLs. Calling the scripts directly avoids loading an unrelated `.env` file:

```sh
npm run build:packages
export DATABASE_ADMIN_URL=postgresql://lead:lead_local_only@127.0.0.1:55439/lead
export DATABASE_URL=postgresql://lead_runtime:runtime_local_only@127.0.0.1:55439/lead
export QUEUE_DATABASE_URL=postgresql://lead_queue:queue_local_only@127.0.0.1:55439/lead
node tools/setup-db.mjs
node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts
docker stop tudla-test-postgres
```

Use your own local test password if needed, and remove the exported variables from your shell afterward. The test container's database is in memory and disappears when stopped. No volume or hosted application data is deleted.

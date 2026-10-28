# Tudla

A prospecting workspace for organizing businesses, reviewing campaign fit, and tracking outreach.

[Try the demo](https://tudla-demo.vercel.app/) · [Privacy](https://tudla-demo.vercel.app/privacy.html) · [Report a bug](https://github.com/briankelp/tudla/issues) · [Contact](mailto:brianfallaria@gmail.com?subject=Tudla)

## What you can use

The public demo runs entirely in the browser with sample records. You can create campaigns, add or import businesses, compare prospects, update stages, save notes and follow-up dates, draft emails, and export CSVs. Changes stay in that browser. No account, API key, backend, or paid provider is needed. Use sample data; browser storage is not an encrypted secret store.

The repository also includes an optional self-hosted API and worker: Google sign-in through Supabase, PostgreSQL workspaces, encrypted provider connections, business discovery, AI-assisted research/campaign drafting, and resumable jobs. These require your own infrastructure and provider accounts. They are separate from the public demo and are not presented as a managed production service. See [Deployment](docs/DEPLOYMENT.md).

## Run the demo locally

Use Node.js 24 and npm:

```sh
git clone https://github.com/briankelp/tudla.git
cd tudla
npm ci
npm run build:demo
npm run sample
```

Open [127.0.0.1:3100](http://127.0.0.1:3100/). No `.env` file is needed. For development with hot reload, run `npm run dev:demo` and open [127.0.0.1:5173](http://127.0.0.1:5173/).

With Docker, run `docker compose up -d --build` and open the same port 3100. The default image contains only the static demo; Compose binds it to loopback and starts no database or worker. Stop it with `docker compose stop`.

## Project structure

| Path                 | Purpose                                                      |
| -------------------- | ------------------------------------------------------------ |
| `apps/web`           | React/TypeScript interface and browser-local demo            |
| `apps/server`        | Optional authenticated API, providers, and worker            |
| `packages/contracts` | Shared schemas, record rules, and validation                 |
| `packages/database`  | PostgreSQL schema, migrations, and workspace isolation       |
| `tests`              | Unit, static-site, and disposable-database integration tests |
| `eval`               | Synthetic research and campaign evaluation fixtures          |
| `tools`              | Static serving, database setup, maintenance, and evaluation  |

## Checks

```sh
npm run build
npm test
npm run eval
npm run eval:campaigns
```

Data-access, authentication, queue, and migration changes also need the [local integration tests](docs/DEPLOYMENT.md#local-integration-tests). Never run those tests against a live database. CI uses its own disposable PostgreSQL service and no hosted/provider credentials.

## Documentation and contributions

- [Architecture](CODEBASE_EXPLAINED.md), [deployment](docs/DEPLOYMENT.md), and [static hosting](docs/STATIC-DEMO.md)
- [Contributing](CONTRIBUTING.md), [security reporting](SECURITY.md), and [privacy](PRIVACY.md)
- [Remaining work](IMPROVEMENTS.md) and [documentation index](docs/README.md)

AI output needs human review. Provider calls can incur charges, and source/provider terms govern what data you can collect, store, and redistribute. The app prepares email drafts; sending happens in your email application.

## License

[ISC](LICENSE). Dependencies and fonts retain their own [licenses and notices](THIRD_PARTY_NOTICES.md).

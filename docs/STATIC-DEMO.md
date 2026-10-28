# Static demo

Public URL: [tudla-demo.vercel.app](https://tudla-demo.vercel.app/). `#demo` opens the sample workspace directly.

## Runtime

The published site consists only of `apps/web/dist`. Records and unfinished campaign drafts stay in the visitor's browser. The build excludes live authentication, provider calls, a database, serverless API, and a worker. The public [privacy notice](https://tudla-demo.vercel.app/privacy.html) describes storage, hosting, external links, and deletion.

## Vercel configuration

Connect the repository's `main` branch to the existing `tudla-demo` project. Build from the repository root with Node 24. `vercel.json` selects Vite and declares:

| Setting          | Value                         |
| ---------------- | ----------------------------- |
| Install command  | `npm ci --no-audit --no-fund` |
| Build command    | `npm run build:demo`          |
| Output directory | `apps/web/dist`               |

No application secrets or environment variables are needed. The demo build forces `VITE_LIVE_WORKSPACES=false` even if the host has another value. GitHub Actions verifies the application separately from Vercel's deployment.

The content-security policy restricts scripts and connections to the site's own origin and disallows framing. Other headers disable MIME sniffing, referrers, and unused device permissions. These controls apply to the static demo; a separate authenticated installation needs its own configuration.

## Rebuild and verify

```sh
npm ci
npm run build:demo
npm test
npm run sample
```

Check the landing page, sample workspace, GitHub/contact links, privacy page, and `THIRD_PARTY_NOTICES.txt`. Browser-local changes should survive reload. The static server ignores database/provider settings and does not expose a live application API. On Vercel, API paths have no serverless implementation.

For a manual upload, use only the built `apps/web/dist` files and the `headers` portion of `vercel.json`. Select the intended existing project. Never upload the repository root, environment files, database exports, or private records.

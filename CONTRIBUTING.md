# Contributing to Tudla

Use [issues](https://github.com/briankelp/tudla/issues) for reproducible bugs and feature proposals. Report security issues through [SECURITY.md](SECURITY.md), not a public issue. Keep discussion respectful and focused on the work.

## Development

Use Node 24 and npm. Install from the lockfile with `npm ci`, then run `npm run dev:demo`. The sample needs no environment file or provider account.

Before submitting a pull request:

```sh
npm run build
npm test
npm run eval
npm run eval:campaigns
```

For data-access, authentication, queue, or migration changes, also run the integration suite against a disposable local PostgreSQL instance as described in [Deployment](docs/DEPLOYMENT.md#local-integration-tests). Test keyboard and narrow-screen behavior when changing the interface.

Keep changes focused. Describe the problem, resulting behavior, and checks run. Use synthetic examples and redact identifiers in screenshots. Do not include environment files, database exports, generated build output, or credentials. Check `git diff --cached` before committing. Do not enable live provider calls or modify a hosted database as part of ordinary testing.

## Licensing

By submitting a contribution, you confirm that you have the right to contribute it under this repository's [ISC license](LICENSE). Do not copy employer/client code or third-party code whose license is incompatible. Preserve applicable dependency and asset notices. Contributions receive maintainer review; a pull request does not grant deployment or write access.

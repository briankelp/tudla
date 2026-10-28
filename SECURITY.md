# Security

## Report a vulnerability privately

Use [GitHub's private vulnerability reporting](https://github.com/briankelp/tudla/security/advisories/new), or email [brianfallaria@gmail.com](mailto:brianfallaria@gmail.com?subject=Tudla%20security%20report).

Include the affected version or commit, reproduction steps, and likely impact. Use synthetic records and redact credentials. Do not put vulnerabilities, customer records, access tokens, or logs containing personal data in a public issue. Reports and fixes are handled on a best-effort basis; there is no support SLA.

## Supported scope

Security fixes target the current `main` branch. The public demo is a static, browser-local sample. It does not accept accounts, store records on a server, call AI or discovery providers, or send email. Its content-security policy restricts network connections to the site's own origin.

Self-hosted authenticated workspaces are separate deployments. Their operators are responsible for updates, HTTPS, identity configuration, database permissions, backups, retention, provider accounts, and access revocation. Read [Deployment](docs/DEPLOYMENT.md) before enabling them. The implementation and automated checks are not a security certification or a guarantee that a deployment is suitable for sensitive data.

## Handling secrets and records

- Keep `.env` files, provider credentials, database exports, encryption keys, and real business/customer records out of Git and issue attachments. Example database passwords are for isolated local development only.
- Generate unique database passwords and a 32-byte encryption key for a live installation. Keep recoverable key versions outside the database, with access limited to the operator.
- The browser demo's local storage is readable by the browser profile and is not an encrypted secret store. Use sample records; never paste API keys or sensitive information into demo notes or drafts.
- Database setup and integration tests require privileged connections. Run tests against a disposable local PostgreSQL instance, never a live application database.
- AI output can be wrong, and public source data can contain prompt injection. Review generated text, retain source evidence, and do not treat a model assessment as verified business information.
- If a credential is exposed, revoke or rotate it at its provider first. Deleting a file or a commit does not invalidate the credential or remove copies already made.

## Contributions and dependencies

CI runs with read-only repository access and no deployment/provider secrets. Builds from forks require maintainer approval. Dependency alerts are enabled; automated dependency-update commits are disabled. Maintainers apply and review updates using their own GitHub identities. Changes to authentication, credential handling, data access, migrations, provider requests, or workflows need focused review and relevant tests before release.

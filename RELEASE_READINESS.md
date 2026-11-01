# Release readiness - 2 November 2026

The existing application passed a complete local verification run. The active
backend is MongoDB. Deployment workflow configuration still needs the settings
listed below; passing application tests does not certify external providers.

## Final verification

| Check | Result |
| --- | --- |
| Unit tests | 98 passed |
| Production-build demo browser suite | All 25 passed in one full run |
| MongoDB integration and signed-in browser suite | All 34 passed in one full run |
| Route generation and TypeScript | Passed |
| Lint | Passed |
| Production build | Passed |
| Read-only production core/database preflight | Passed outside the network sandbox |
| Full production workflow preflight | Blocked by the six local settings below |

Integration checks use an isolated temporary MongoDB replica set. The signed-in
browser suite uses the real Next.js API against that temporary database. The
demo suite serves the production build with anonymous authentication mocked.
The initial sandboxed deployment database check timed out; the same read-only
core check passed outside the sandbox. Test servers were stopped after the run.

## Included application work

- Shared UI polish, light/dark and mobile layouts, brief accessible animations,
  and visible browser-demo credentials with populated sample sections.
- INR defaults, Indian number grouping and numeric currency-labelled exports,
  while preserving existing live record currencies and statutory models.
- Interactive saved operations demos; core demo re-entry, reset persistence,
  stale-tab protection and explicit handling of unreadable browser storage.
- Record search, role-filtered quick actions, keyboard/focus handling, session
  form drafts, filtered CSV downloads, sorting and 10/25/50-row pagination.
- Existing module fixes and active-backend workflows described in
  [MODULE_STATUS.md](MODULE_STATUS.md) and [FEATURE_AUDIT.md](FEATURE_AUDIT.md).
- CI runs type checking, lint, unit tests, build, signed-in integration/browser
  checks and the complete demo browser suite. Type checking generates Next.js
  route types first; generated files and local secrets are excluded from Git.

These are the local results for this release. GitHub Actions runs separately
when the source is pushed. External bank, payment, delivery and carrier adapters
retain their documented provider boundaries. INR selection does not implement
Indian GST or income-tax rules.

## Deployment configuration remaining

The full local production preflight requires:

- APP_ENCRYPTION_KEY
- CONNECTOR_ENCRYPTION_KEY
- NOTIFY_PROVIDER=webhook
- NOTIFY_WEBHOOK_URL
- DELIVERY_WEBHOOK_SECRET
- CRON_SECRET

Keep stable encryption keys for existing encrypted data. Store actual provider
credentials and worker secrets in the deployment secret manager, not Git.
Configure an authenticated scheduler and verify signed, deduplicated delivery
with the selected provider. See [PRODUCTION.md](PRODUCTION.md),
[AUTOMATION.md](AUTOMATION.md) and [UPI_SETUP.md](UPI_SETUP.md).

The core preflight checks connectivity, transaction-capable database topology,
schema version and the business plan; it does not audit every index or certify
provider delivery. After supplying workflow settings, run the full production
preflight, confirm required indexes, and verify scheduling/provider delivery in
the intended deployment. This release pass did not migrate production data,
activate live schedules, send external messages or deploy the application.

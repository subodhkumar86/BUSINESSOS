# One Vercel deployment

The repository root is the single Next.js app for `https://businessos-topaz.vercel.app`. It serves the React UI at `/`, `/login`, `/app/*` and other workspace routes, plus the backend at `/api/v1/*` on that same domain.

## Existing Vercel project settings

In Settings > Build and Deployment:

| Setting | Value |
| --- | --- |
| Root Directory | `.` (repository root) |
| Framework Preset | Next.js |
| Build Command | `npm run build` |
| Output Directory | `.next` (remove any old `dist` override) |
| Node.js | 24.x |

`vercel.json` sets the Next.js framework, build and output defaults. Remove stale Vite settings or API rewrites from the Vercel dashboard before redeploying. Both surfaces use the same domain and cookies. Do not create a second backend Vercel project.

## Environment variables

Add these server-side values to the Vercel project:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The supplied MongoDB Atlas connection string, stored as a Vercel secret environment value |
| `MONGODB_DB` | `business` |
| `APP_ORIGIN` | `https://businessos-topaz.vercel.app` |
| `COOKIE_SECURE` | `true` |

`MONGODB_URI` is supported for compatibility and takes precedence if present. Remove an old value or point it at the same cluster. When `MONGODB_DB` is absent, the database name from the connection URI is used.

For multiple trusted aliases, separate origins with commas. Preview deployments need their exact origin included in their preview-scoped `APP_ORIGIN`. Do not expose MongoDB credentials with a public environment-variable prefix or commit them to the repository. Local credentials are kept in gitignored `.env`; `.vercelignore` excludes local environment files from deployment uploads.

Configure Atlas network access for the deployment and use a dedicated application database user. MongoDB must support transactions; a standalone server is insufficient.

Before registrations are enabled, run `npm run db:migrate` once from a trusted environment using the same MongoDB variables. This creates indexes and default subscription plans. It is idempotent and does not overwrite existing plans. Database setup is not performed during the Vercel build.

Run `npm run verify` before release. Then run `npm run check:production` in a trusted environment with the deployment's variables. The preflight is read-only: it checks Node.js 24, HTTPS origins, secure cookies, encryption keys, recovery/delivery configuration, worker credentials, database connectivity, transaction-capable topology, schema setup and the registration plan. Missing workflow configuration fails before database access. It loads `.env.production.local`, `.env.local`, `.env.production` and `.env` using Next.js production precedence; shell variables take priority. It never prints connection strings or secrets. A successful preflight does not replace integration tests or prove that the provider accepts messages or that the scheduler runs.

For database troubleshooting only, `npm run check:production -- --core-only` skips workflow configuration checks and labels its result accordingly. It is not a release-readiness check.

Run `npm run test:integration` after a successful build and `npm run test:e2e` before release. Integration tests use an isolated temporary database rather than your production data. Review `MIGRATION_STATUS.md` before enabling modules: deployment preparation does not complete the advanced workflows listed there.

### Workflow configuration

Repeat `npm run db:migrate` before releasing the expanded workflows so their indexes are installed. The command preserves existing subscription-plan edits.

Set `APP_ENCRYPTION_KEY` to a stable, randomly generated 32-byte base64 key (or 64 hex characters) for MFA and encrypted recovery delivery. Set `CONNECTOR_ENCRYPTION_KEY` independently for provider credentials. Keep both in the secret manager and retain them with your disaster-recovery materials; changing a key without migrating its encrypted data prevents decryption. No keys or provider credentials were generated or printed by this audit.

For actual notification delivery, configure `NOTIFY_PROVIDER=webhook`, an HTTPS `NOTIFY_WEBHOOK_URL` without embedded credentials/fragments and a random `DELIVERY_WEBHOOK_SECRET` of at least 32 characters. Production delivery refuses a missing/short signing secret and HTTP endpoints, including localhost. Redirects are rejected so queued message bodies are not forwarded to a different endpoint. The receiver must verify the HMAC signature and deduplicate `x-businessos-delivery-id`. Only successful provider acceptance marks an item sent. Connector records are encrypted configuration metadata; the delivery adapter currently uses these deployment-level webhook variables.

Configure a scheduler to call `/api/v1/internal/outbox/run` with `Authorization: Bearer <CRON_SECRET>`; use a random `CRON_SECRET` of at least 32 characters. Each HTTP run processes at most five messages, with leases, bounded retry attempts and backoff. A trusted Node.js worker can instead run `npm run outbox:deliver` for a larger batch. These commands dispatch queued messages when a provider is configured. Queuing campaign messages or reminders does not itself send them. No scheduler has been activated by this work.

For enabled hourly/daily low-stock schedules, separately invoke `/api/v1/internal/automation/run` using the same bearer secret. Each call processes at most three due workspaces and creates up to ten review tasks per workspace. `npm run automation:run` is the trusted CLI alternative for one batch. The worker never sends notifications or places orders; schedules and tasks commit together. Disabled/unauthorised scheduling accounts or lost plan access block the schedule until explicitly saved again by an authorised operator. See [AUTOMATION.md](AUTOMATION.md) for timing, concurrency and monitoring. No live scheduler or tenant schedule has been activated by this work.

`ALLOW_DEVELOPMENT_RESET_TOKENS=true` permits reset-token responses only outside production for local testing. Leave it false in deployed environments. In production, reset messages are encrypted and queued for delivery; the outbox worker must be scheduled.

To provision the single platform administrator, supply `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` and optionally `SUPER_ADMIN_NAME` through a trusted environment, then run `npm run admin:provision`. It creates a dedicated platform workspace, refuses a conflicting administrator email and revokes sessions when updating that account. Registration cannot create a platform administrator.

### Verification on 25 October 2026

The unit suite includes UPI intent validation and production configuration/delivery checks. The expanded database checks exercise the real MongoDB request handler, including transactions, accounting, roles, approvals, delivery leases and MFA/recovery. See [FEATURE_AUDIT.md](FEATURE_AUDIT.md) for exact scope and final check results. The earlier core production preflight passed outside the network sandbox, but the full preflight now correctly fails because encryption keys, webhook delivery and worker secrets are not configured. The `tsx` startup problem has been removed from active scripts.

`npm run test:live` adds a real signed-in browser flow against a temporary database. `npm run test:e2e` runs browser-demo checks with mocked authentication. Chromium is installed in the workspace cache; use `$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache/playwright'` in PowerShell for the demo suite. Live tests select the workspace installation automatically when present. Install Chromium on a new machine with `npm exec -- playwright install chromium --only-shell`.

No deployment, production migration, live administrator provisioning, external message or payment was performed. Stable encryption secrets, notification-provider credentials, scheduling and provider-specific payment/bank/carrier integrations still need deployment configuration.

Redeploy, then verify `/api/v1/health` returns `ok: true` and `/login` loads on the same hostname. The code is prepared for this deployment; local configuration changes do not update the Vercel dashboard or publish a deployment automatically.

Next.js/Vercel reference: [project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Next.js SPA integration](https://nextjs.org/docs/app/guides/single-page-applications).

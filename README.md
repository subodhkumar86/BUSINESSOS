# BusinessOS

One Next.js application serves the React frontend and `/api/v1` backend from the same domain. MongoDB stores business data and sessions. Redis is not required.

## Local development

Use Node.js 24 and MongoDB Atlas or a MongoDB replica set.

```powershell
npm.cmd ci
Copy-Item .env.example .env
# Set your MongoDB connection in .env, then:
npm.cmd run db:migrate
npm.cmd run dev
```

Open http://localhost:3000. There is one development server and one production build:

```powershell
npm.cmd run build
npm.cmd start
```

## Vercel

Deploy this repository as **one Next.js project**, with Root Directory `.` and output `.next`. The React pages and API routes ship together. See [PRODUCTION.md](PRODUCTION.md) for the settings and environment variables to apply to the existing Vercel project. No separate API domain, proxy server or frontend API URL is required.

## Project layout

- `app/`: frontend routes, shared layout and Next.js API entrypoint.
- `src/`: React UI and shared business rules.
- `server/mongo/`: active MongoDB API, sessions and transactions.
- `scripts/mongo-setup.ts`: MongoDB indexes and default plans.
- `tests/`: business-rule tests, MongoDB integration tests and browser tests.

The previous SQL implementation remains as inactive reference source in `server/` and older scripts/tests. It is excluded from the active application TypeScript entrypoints and is not a second server to deploy. Active npm scripts use MongoDB only. Superseded deployment configs have been removed.

## Verification

See [RELEASE_READINESS.md](RELEASE_READINESS.md) for the latest local verification
and the deployment configuration still required before release.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:integration
npm.cmd run test:e2e
npm.cmd run test:live
```

Integration tests start an isolated temporary MongoDB replica set and download a database binary on their first run. Build first so they can also test the real Next.js HTTP routes. Before running browser tests for the first time, run `npm.cmd exec -- playwright install chromium --only-shell`.

Live browser tests use a separate Next.js cache directory so an existing
development server can stay running. Build before running the demo suite: its
launcher serves the production build on a free local port and stops that test
server after completion. It also finds the workspace Chromium installation
automatically. `E2E_BASE_URL` opts into a separately managed server.

## Demo access

New workspaces and browser demos default to Indian rupees (INR). Monetary
displays use Indian grouping, such as ₹1,25,000.75, including budgets, RFQs,
stock, operations and report currency labels. Existing browser samples adopt
INR without changing their numeric amounts. Existing live tenant currencies
and bank transactions retain their recorded currency; no FX conversion is
performed. Currency selection does not replace the jurisdiction-specific tax
or payroll calculation models with Indian statutory rules.

The login screen displays `demo@businessos.app` / `Demo@12345`. Select **Use demo
credentials**, then **Sign in**, or choose **Explore browser demo** directly.
These credentials open local sample data; they do not authenticate to the server
or grant access to a live tenant. Demo budgets, recruitment, operations, RFQs,
workflow records and approval previews accompany the editable core sample data.
**Reset sample data** reloads the core demo records if an older browser session
is still showing sparse data. New workspace registration offers labelled sample
records by default; users can uncheck the option for an empty workspace.

Demo assets, facilities, visitors, campaigns, risks and production tracking now
support local creation, edits and workflow transitions. Changes persist across
reloads. Each section offers **Refresh demo records** and **Reset this demo
section**. A stale tab must refresh before saving, and auditor preview remains
read-only. Demo production tracks output/defects without posting stock or journals;
campaign editing does not send or queue messages. Other advanced preview sections
retain their existing sample-data behavior. Each operations section is limited to
200 local records; failed browser-storage writes are reported without claiming
the changes were saved.

## Feature coverage

[MODULE_STATUS.md](MODULE_STATUS.md) maps every workspace and its connected
sections, including the remaining provider and deployment boundaries.

Connected workflows include finance/inventory, manual bank reconciliation, warehouse dispatch/returns, budgets, suppliers/RFQs, recruitment/payroll accrual, employee self-service, documents, support, communication, approval chains, MFA/recovery and platform plan administration. [FEATURE_AUDIT.md](FEATURE_AUDIT.md) records fixes and test coverage; [MIGRATION_STATUS.md](MIGRATION_STATUS.md) lists exact integration boundaries. Live payments, bank/carrier provider sync, SSO and trained forecasting are not implied by these workflows. Existing PostgreSQL data is not automatically imported into MongoDB.

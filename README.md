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

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:integration
npm.cmd run test:e2e
```

Integration tests start an isolated temporary MongoDB replica set and download a database binary on their first run. Build first so they can also test the real Next.js HTTP routes. Before running browser tests for the first time, run `npm.cmd exec -- playwright install chromium --only-shell`.

## Feature coverage

Authentication, role-filtered workspaces, core finance/inventory actions, CRM and basic workflows are implemented. The complete Growth PRD is still in progress; [MIGRATION_STATUS.md](MIGRATION_STATUS.md) lists supported contracts and remaining integrations. Existing PostgreSQL data is not automatically imported into MongoDB.

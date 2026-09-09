# BusinessOS — PRD stack foundation

The project now uses the PRD's **React + TypeScript, Node.js + TypeScript REST API, PostgreSQL and Redis** stack. React is the option selected from the PRD's “Next.js / React + TypeScript” recommendation; Vite remains the frontend build tool. There is no SQLite backend.

## Start locally

Requirements: Node.js 24+, Docker Desktop with a running Linux engine (or existing PostgreSQL 17+ and Redis 7.4+ services).

```powershell
npm.cmd ci
Copy-Item .env.example .env
# Start the database and session store:
docker compose up -d --wait postgres redis
npm.cmd run db:migrate
npm.cmd run dev:api
```

In a second terminal:

```powershell
npm.cmd run dev
```

Open http://127.0.0.1:5173. Create an owner account with a password of at least 12 characters. New workspaces start empty unless you select sample records. Browser demo remains available and preserves earlier `businessos-v1` local data; it does not upload that data automatically.

### Local demo tenants

After migrations, seed three isolated sample tenants with:

```powershell
npm.cmd run db:seed-demo
```

All three demo owners use the password `DemoBusinessOS!2026`:

| Tenant ID                              | Organisation       | Login email             | Password              |
| -------------------------------------- | ------------------ | ----------------------- | --------------------- |
| `10000000-0000-4000-8000-000000000001` | Acme Trading Ltd   | `owner@acme.demo`       | `DemoBusinessOS!2026` |
| `10000000-0000-4000-8000-000000000002` | Northstar Services | `owner@northstar.demo`  | `DemoBusinessOS!2026` |
| `10000000-0000-4000-8000-000000000003` | Greenfield Studio  | `owner@greenfield.demo` | `DemoBusinessOS!2026` |

The seeder is idempotent by email and writes the same sample inventory baselines and audit evidence as normal workspace registration. Set `DEMO_PASSWORD` before running it to use a different local-only password.

### Role test accounts

The Acme tenant also includes one account for every supported role. These accounts use `DemoRoleBusinessOS!2026`:

| Role               | Login email            | Password                  |
| ------------------ | ---------------------- | ------------------------- |
| Finance admin      | `finance@acme.demo`    | `DemoRoleBusinessOS!2026` |
| HR admin           | `hr@acme.demo`         | `DemoRoleBusinessOS!2026` |
| Operations manager | `operations@acme.demo` | `DemoRoleBusinessOS!2026` |
| Sales CRM user     | `sales@acme.demo`      | `DemoRoleBusinessOS!2026` |
| Department manager | `department@acme.demo` | `DemoRoleBusinessOS!2026` |
| Employee           | `employee@acme.demo`   | `DemoRoleBusinessOS!2026` |
| Auditor            | `audit@acme.demo`      | `DemoRoleBusinessOS!2026` |

The same role aliases are seeded for `northstar.demo` and `greenfield.demo`. Override the shared value with `DEMO_ROLE_PASSWORD` for local testing.

Alternatively, `docker compose --profile app up --build -d` starts the API with PostgreSQL and Redis; run `npm.cmd run dev` for the frontend.

Local Compose credentials are development-only, bound to loopback. Production must supply managed secrets, TLS, `COOKIE_SECURE=true`, explicit origins and appropriate network controls. Use the non-superuser `businessos_app` database role, not the PostgreSQL administrator. The API startup does not run migrations automatically except in the explicitly configured local Compose command. See [PRODUCTION.md](PRODUCTION.md) for the deployment checklist.

## What changed

- Frontend and shared workflow logic migrated to strict TypeScript.
- Node TypeScript REST endpoints under `/api/v1`, validated with Zod.
- PostgreSQL versioned migrations, transactional workspace updates, tenant row-security policies, row locking and optimistic version checks.
- Append-only PostgreSQL journal/audit tables with update/delete rejection triggers. These protect application writes, not against a database administrator who can change the schema.
- Redis sessions with eight-hour expiry, hashed opaque session keys, HttpOnly/SameSite cookies, explicit origin checks, CSRF tokens and shared login throttling.
- Owner registration, sign-in/sign-out, password change, sign-out-everywhere, and owner-created tenant accounts across the supported role matrix. RBAC is enforced on core actions and protected module endpoints; auditors have read-only access. Field-level permissions are not yet implemented.
- Team settings list users and let the owner disable or restore non-owner accounts. Access changes and password rotation increment a PostgreSQL session version; every request revalidates it. Restoring access never restores an old session. Owners cannot disable themselves. Security actions are audited.
- Startup checks reject superuser/BYPASSRLS database credentials and missing account-security migrations. Existing sessions issued before migration 002 require a fresh sign-in.
- Server-derived tenant scope. The client cannot choose a tenant ID or write a whole workspace snapshot.
- Idempotency keys for action retries, transactional inventory/finance updates, and rejection of stale writes.
- Structured request logs with request IDs, status and duration; no password/request body logging.
- Docker setup and CI workflow for build, lint, domain tests and real PostgreSQL/Redis integration tests.

The nine core screens and existing invoice, expense, inventory, purchasing, CRM, payroll accrual, project, task, report export and rule-based insight workflows remain available. Server mode writes through the API; demo mode is explicitly local.

## API contract

| Endpoint                                          | Access                                       | Purpose                                                                       |
| ------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------- |
| GET /api/v1/health                                | Public                                       | PostgreSQL/Redis readiness                                                    |
| POST /api/v1/auth/register                        | Public, rate limited                         | Create tenant and owner                                                       |
| POST /api/v1/auth/login                           | Public, rate limited                         | Issue Redis session                                                           |
| POST /api/v1/auth/logout                          | Session + CSRF                               | Revoke session                                                                |
| POST /api/v1/auth/password                        | Session + CSRF + current password            | Change password and revoke all sessions                                       |
| POST /api/v1/auth/revoke-sessions                 | Session + CSRF                               | Sign out every device                                                         |
| GET /api/v1/workspace                             | Session                                      | Read permitted tenant snapshot                                                |
| POST /api/v1/actions                              | Owner + CSRF                                 | Validate and commit a workflow action                                         |
| GET/POST /api/v1/payroll/runs/:id/payment-batches | Scoped roles / owner or finance admin + CSRF | Read or idempotently generate a pending payroll payment batch                 |
| GET /api/v1/finance/export.csv                    | Owner / finance admin / auditor              | Download a tenant-scoped, audited finance CSV                                 |
| GET /api/v1/audit-logs                            | Owner / auditor                              | Read the latest tenant-scoped immutable audit events                          |
| GET /api/v1/bi/metrics                            | Session                                      | Read metrics derived from the caller's permitted tenant data                  |
| POST /api/v1/ai/ask                               | Non-auditor session + CSRF                   | Run and audit explainable deterministic analysis; no external model is called |
| POST /api/v1/ai/forecast                          | Non-auditor session + CSRF                   | Produce and audit a labelled deterministic scenario forecast                  |
| GET /api/v1/users                                 | Owner                                        | List own tenant users                                                         |
| POST /api/v1/users                                | Owner + CSRF                                 | Create a non-owner tenant account; no email is sent                           |
| PATCH /api/v1/users/:id/access                    | Owner + CSRF                                 | Enable or disable a non-owner tenant account                                  |
| GET /api/v1/modules/:module                       | Session                                      | Search and list tenant-scoped growth-module records                           |
| POST /api/v1/modules/:module                      | Owner + CSRF                                 | Create an audited growth-module record                                        |
| PATCH /api/v1/modules/:module/:id                 | Owner + CSRF                                 | Update an audited growth-module record                                        |
| DELETE /api/v1/modules/:module/:id                | Owner + CSRF                                 | Delete an audited growth-module record                                        |
| GET /api/v1/banks/accounts/:id/transactions       | Finance admin                                | List tenant-scoped bank transactions                                          |
| POST /api/v1/banks/accounts/:id/transactions      | Finance admin + CSRF                         | Add a manual bank transaction                                                 |
| PATCH /api/v1/banks/accounts/:id/transactions/:id | Finance admin + CSRF                         | Reconcile a bank transaction                                                  |
| POST /api/v1/auth/password-reset/request          | Public                                       | Start a rate-limited password recovery request                                |
| POST /api/v1/auth/password-reset/confirm          | Public                                       | Consume a single-use reset token and rotate the password                      |
| GET /api/v1/documents                             | Session                                      | List tenant-scoped document metadata                                          |
| POST /api/v1/documents                            | Owner + CSRF                                 | Register document metadata and a server storage key                           |
| PATCH /api/v1/documents/:id                       | Owner + CSRF                                 | Archive or restore document metadata                                          |
| GET /api/v1/support/tickets                       | Session                                      | List tenant support tickets                                                   |
| POST /api/v1/support/tickets                      | Owner + CSRF                                 | Create an audited support ticket                                              |
| PATCH /api/v1/support/tickets/:id                 | Owner + CSRF                                 | Update ticket status or priority                                              |
| GET /api/v1/tax/filings                           | Session                                      | List tenant filing periods                                                    |
| POST /api/v1/tax/filings                          | Owner/finance admin + CSRF                   | Create a filing period                                                        |
| PATCH /api/v1/tax/filings/:id                     | Owner/finance admin + CSRF                   | Update filing status                                                          |
| GET /api/v1/warehouse/locations                   | Session                                      | List warehouse locations                                                      |
| POST /api/v1/warehouse/locations                  | Owner + CSRF                                 | Create a warehouse location                                                   |
| PATCH /api/v1/warehouse/locations/:id             | Owner + CSRF                                 | Activate or deactivate a location                                             |
| GET /api/v1/suppliers                             | Session                                      | List tenant suppliers                                                         |
| POST /api/v1/suppliers                            | Owner + CSRF                                 | Create a supplier                                                             |
| PATCH /api/v1/suppliers/:id                       | Owner + CSRF                                 | Update supplier status                                                        |

Mutations require an allowed `Origin`. Actions also require a UUID `Idempotency-Key` and JSON `{version, action}`. Version conflicts return 409. The UI refreshes state after a conflict while retaining the form for review. Authentication derives the tenant from the server-held session.

Core workspace business records currently use a tenant-scoped JSONB aggregate with separate relational identities, audit, journals and idempotency records. Growth-module records use a tenant-scoped relational table with RLS, strict schemas, search, lifecycle actions, and audit events. These are still a migration foundation, not the PRD's finished specialized schemas for tax, warehouse, billing, support, and supply-chain invariants. Every core workspace write locks the tenant aggregate; this deliberately serializes tenant writes and is not designed for large enterprise throughput. The identity table supports global email lookup for login; tenant data tables enforce PostgreSQL RLS.

## Verification

```powershell
npm.cmd run typecheck
npm.cmd run build
npm.cmd run lint
npm.cmd test
```

Run the isolated integration suite after Docker Desktop is healthy:

```powershell
npm.cmd run doctor
npm.cmd run test:stack
```

The runner starts a uniquely named Compose project from `compose.test.yaml`, using PostgreSQL on port 55432 and Redis on port 56379. It migrates the dedicated `businessos_test` database twice (checking migration idempotence), runs the API tests, and removes only its test containers. PostgreSQL data is in temporary memory storage; it never uses the regular Compose database or volumes. Keep those two test ports free. CI uses this same runner.

If using independently provisioned test services, set `TEST_DATABASE_URL` and `TEST_REDIS_URL`, migrate first, then run `npm.cmd run test:integration`. The database name must be `businessos_test`; application database URLs are rejected by the test suite.

Integration cases cover cross-tenant ID attacks, CSRF/origin rejection, auditor permissions, account disable/restore, multi-session password rotation, sign-out-everywhere, concurrent writes, idempotency, purchasing side effects, RLS and append-only triggers.

**Verification in this workspace:** lint, typecheck, production client build and 23 unit/workflow/security tests pass. The production Compose configuration parses. The real PostgreSQL/Redis integration suite and browser E2E run should be executed in CI or a deployment environment before launch.

## Accounting and remaining PRD scope

Sample opening balances predate the sample journal. This is not a complete general ledger, balance sheet, bank reconciliation or tax system. Inventory uses recorded unit cost. Payroll approvals accrue gross pay; they do not calculate statutory deductions or send money. CSV/JSON downloads work; PDF/XLSX and restore/import remain unimplemented.

Remaining production work follows the PRD stack:

- Normalize the module schema and add full finance, stock movement and payroll invariants.
- Add MFA, reset/recovery, verification, broader RBAC, field-level access, and entitlements.
- Redis-backed durable jobs for notifications/forecasts and transactional event delivery.
- S3-compatible object storage for documents/media; OpenSearch when full-text search is implemented.
- Paystack/Flutterwave/bank providers through a payment adapter layer, signed webhooks and replay protection.
- Email/SMS/WhatsApp adapters; no direct sending from the UI.
- Server-only model gateway, retrieval, feature store and forecasting jobs. Current analysis is labelled deterministic, not AI-generated.
- Remaining operations/growth modules, billing, administration, monitoring, backups/restore, staged deployment and security/load review.

No banking, AI or messaging credentials are configured and no live external transaction is performed.

Implementation references: [node-postgres transactions](https://node-postgres.com/features/transactions), [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [Redis Node client](https://redis.io/docs/latest/develop/clients/nodejs/).

## Latest implementation and local recovery

See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for current verified workflows and remaining work. The full PRD is not yet complete.

To exercise account recovery locally, set RETURN_RESET_TOKEN=true in your local environment and restart the API. On the sign-in screen choose Forgot password, enter an existing account email, and request a code. The development response opens the reset form. You can also open /reset-password and paste a code. Codes expire after 30 minutes and are single-use; a successful reset invalidates existing sessions. Production never returns these codes. Email delivery still needs an adapter.

Billing shows configured feature access and the active-seat limit, not proof of payment. Adding or reactivating users at capacity returns an actionable error. Tenant owners cannot provision platform super-admin accounts.

## Workflow and administration additions

Run `npm.cmd run db:migrate` before starting an existing database after pulling these changes. Migration 024 adds the HR, appointments, compliance and knowledge workflows. See `WORKFLOW_CONTRACTS.md` for schemas, permissions and lifecycle rules.

- HR: recruitment, leave requests and measurable performance goals.
- Front Office: real appointment records with room conflict prevention.
- Compliance: certifications/policies and corrective-action findings.
- Support: knowledge article drafting/publication/archive.
- Finance: CSV and XLSX period exports.
- Platform Admin: real tenant metadata and subscription configuration. Provision super-admin accounts only through trusted administrative tooling; tenant owners cannot grant that role.

The current implementation status and remaining PRD requirements are maintained in `IMPLEMENTATION_STATUS.md`.

Warehouse **Shipments** connects picking → packing → dispatch to inventory and COGS. Choose a product and source location (or explicitly unallocated stock). Stock is checked at dispatch; insufficient stock prevents the entire posting. Apply migration 025 before using the updated API. See `WORKFLOW_CONTRACTS.md` for lifecycle, concurrency and retry rules.

## Completion expansion — 9 September 2026

Run `npm.cmd run db:migrate` first; migrations `027-029` add branches, approval chains/requests, forecast runs, the notification outbox and interview/file-object tables.

- Finance exports now include deterministic server-generated **PDF** alongside CSV/XLSX (`GET /api/v1/finance/export.pdf`), with the same period scoping, role checks and export audits.
- Forecasts are reproducible: `POST /api/v1/ai/forecast` persists `model_version=deterministic-rules-v2`, horizon, baseline, assumptions, confidence, data window and feature snapshot; `GET /api/v1/ai/forecasts[/:id]` re-reads the stored run.
- Configurable multi-step approvals: `GET/POST/PATCH /api/v1/approvals/chains` plus `GET/POST/PATCH /api/v1/approvals/requests` with default PO/payroll/payment chains, amount matching, role-step enforcement, separation of duties and audited decisions.
- Branches: `GET/POST/PATCH /api/v1/branches` with unique codes and optimistic versions for BUS-012 scoping.
- Recruitment interviews: `GET/POST /api/v1/hr/candidates/:id/interviews` with scheduling, scoring schema and audit events.
- Notification adapters: `POST/GET /api/v1/notifications/outbox` queues email/SMS/WhatsApp/push through a provider interface (`NOTIFY_PROVIDER`, default `local-log`), and `POST /.../:id/deliver` runs the audited local delivery worker. External credentials are not required and nothing is sent outside the database.
- New **Approvals & Branches** workspace screen manages branches, chains, forecast runs, the outbox and pending approvals in one place.

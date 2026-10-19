# MongoDB migration status

Active stack: one Next.js app (`app/`) hosting the React frontend (`src/`) and MongoDB backend (`server/mongo/`) in one Vercel deployment. No Redis service, client, queue or session-store dependency is used by the active stack.

## Ported API contracts

| Surface | Routes |
| --- | --- |
| Authentication | POST auth/register, auth/login, auth/logout, auth/password, auth/revoke-sessions |
| Workspace | GET workspace; POST actions |
| Team | GET/POST users; PATCH users/:id/access |
| Finance | GET finance/dashboard, finance/statements, bi/metrics, audit-logs |
| Payroll | GET payroll/runs/:id/payslips; accrual and approvals through actions |
| CRM | GET crm/lead-scores; GET/POST crm/customers; PATCH crm/customers/:id; GET/POST crm/customers/:id/interactions |
| Workflows | GET/POST workflows/:kind; PATCH workflows/:kind/:id (leave, goals, reviews, appointments, certifications, findings, knowledge) |
| Module records | GET/POST modules/:module; PATCH modules/:module/:id; excludes platform admin |
| Analysis | POST ai/ask: calculated facts from permitted snapshot, no LLM or trained forecasts |
| Configuration | GET billing/entitlements; GET health; indexed MongoDB plans |

The existing React UI is preserved. Some advanced panels still use legacy endpoints and show an explicit unavailable error until those contracts are ported.

## Pending PRD/legacy workflows

- Bank accounts, provider adapters, signed webhooks, transaction imports and reconciliation endpoints.
- Payroll payment batches, bank dispatch, payment callbacks and actual payslip delivery.
- Detailed warehouse allocation/transfers/shipments/returns, dedicated supplier contracts and RFQs.
- Document binary upload, revisions, comments, sharing and external support portals.
- Detailed budgets, statutory tax configuration/remittance and jurisdiction review.
- Notification outbox worker/provider delivery; durable scheduled jobs and retries. Future jobs should use MongoDB leases/atomic claims rather than Redis.
- Configurable approval chains, branch/department scoping and explicit employee-user linking. Employee self-service is blocked rather than inferring identity from names.
- Production admin, billing changes, SSO/MFA/recovery, provider credential storage and production observability.
- Forecasting/model history, scenarios, advanced reports/exports and server-side search.
- Existing-data import, backup/restore validation, full browser E2E, load tests and external provider contract/security review.

Generic module records support basic metadata management; they do not imply completion of specialised inventory, production, compliance or accounting workflows.

## Security and consistency

Tenant IDs come from database sessions, not request bodies. Every business query includes tenant scope. Mutation requests validate origin and CSRF. Every session read checks expiration, account status and version; TTL expiration cleanup alone is never trusted. Shared MongoDB counters throttle login attempts. Session secrets are stored as SHA-256 digests and passwords use scrypt.

Core writes read a tenant version, validate business rules and commit state plus ledger events plus idempotency records in a MongoDB transaction. Security/module writes contend on the same tenant document so disabling a user conflicts with in-flight mutations. Ledgers have no API update/delete endpoints; storage-level immutability and least-privilege production database roles still require deployment work. Tenant snapshots remain bounded by MongoDB's document size limit; large enterprises will require normalised entity collections and paginated reads.

The setup command creates indexes and default plans without overwriting administrator changes. It does not run legacy SQL migrations or import existing production data.

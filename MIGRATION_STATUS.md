# Active application status

BusinessOS uses one Next.js application for the React UI and `/api/v1` API, with MongoDB transactions and database sessions. Redis and the old PostgreSQL server are not required. The SQL implementation remains reference source.

## Connected workflows

| Area | Implemented behavior |
| --- | --- |
| Accounts | Registration/login, secure sessions, password changes, session revocation, one-time password recovery, encrypted authenticator MFA with confirmation and replay protection |
| Team | Role/seat enforcement, disabling accounts, explicit employee-account linking; link changes revoke sessions |
| Finance | Invoices/collections, expenses, append-only journals, statements and CSV/XLSX/PDF exports |
| Banking | Manual accounts, statement entry/CSV imports, duplicate detection, conservative suggestions, reviewed reconciliation and single collection posting |
| UPI | INR invoice intents, owner-managed merchant payee settings, manual bank-review receipts with UTR/reference history, duplicate-reference protection and atomic invoice collection |
| Budgets | Dated departmental budgets, closure, budgeted expenses with atomic cash journals, spend totals and overspend protection |
| Inventory | Product opening, purchase approvals/receipt, adjustments, counts, fulfillment and stock evidence |
| Warehouse | Location creation, stock allocation/transfers, picking/packing/dispatch, source balances, COGS, linked return inspection/restocking, quantity limits and valuation reversal |
| Purchasing | Suppliers and RFQs with quote amounts and lifecycle validation; configurable purchase-order approval chains |
| Supply | Manually booked inbound shipments linked to approved POs and ordered transit/clearance/delivery milestones; PO receipt posts inventory separately |
| HR | Employees, sequential recruitment/onboarding, payroll accrual, payslips and pending payment batches; configurable payroll approval chains |
| Self-service | Linked employees see their own leave/goals and can submit/update permitted records; HR/owner makes leave decisions |
| Operational registers | Asset records with calculated book value, facility work orders, visitors/check-in/out, campaigns, risks and certifications/findings |
| Production | Ordered stages and output/defect validation; configured materials are consumed once and finished stock, journals and valuation differences post atomically |
| CRM/support | Customers, interaction history, consent, tickets, resolved-ticket feedback and CSAT/NPS summaries |
| Documents | Real uploads up to 2 MB, binary revisions, comments, downloads, expiring revision-specific shares, access auditing and share revocation on archive |
| Tax | Tenant configuration and filing lifecycle records. Marking filed/paid records an external event; it does not submit a return or transfer funds |
| Communication | Persistent chat, announcements, per-user read receipts, consent-based campaign queues and due appointment reminder queues |
| Automation | Run now low-stock checks plus optional hourly/daily schedules, protected due-work worker, atomic task/history/schedule writes, open-task deduplication and current account/plan checks; manual runs create at most 50 tasks, scheduled runs ten per workspace |
| Delivery | Persistent outbox, atomic leases, retry backoff, bounded worker, signed webhook adapter and explicit provider failures |
| Approvals | Frozen ordered approval steps, roles, different approvers, optimistic versions and final source-record approval |
| Configuration | Onboarding progress, branch labels, encrypted connector credential storage, live seat usage and reviewable billing change requests |
| Platform | MongoDB administrator provisioning, tenant metadata directory, plan configuration/assignment, aggregate integration status and health; tenant financial contents are excluded |
| Analysis | Permission-scoped deterministic answers, search and explicitly labelled constant-value scenario history |
| Backups | Downloadable tenant business-record snapshots with a size limit; accounts, sessions, MFA/recovery and provider secrets are excluded |

See [FEATURE_AUDIT.md](FEATURE_AUDIT.md) for evidence and boundaries, and [PRODUCTION.md](PRODUCTION.md) for release configuration.

## Remaining integrations and scope limits

- Live bank feeds, signed bank/payment callbacks, payroll bank dispatch, automatic payment confirmation and subscription charging require provider-specific adapters/contracts. Manual reconciliation and pending payment batches are implemented; they do not claim money was transferred.
- Email/SMS/WhatsApp/push delivery requires the configured signed webhook provider and a scheduler for the outbox worker. Connector records alone do not activate a provider adapter. The current worker uses deployment-level delivery configuration.
- Carrier/3PL tracking sync and automatic ETAs require a provider adapter; internal milestones work without one.
- Branches are directory labels. Branch/department record-level scoping and multi-entity consolidation are not implemented.
- Low-stock task automation supports Run now and hourly/daily eligibility through the protected scheduler worker. Deployment scheduling must be configured separately. Free-text rules store review notes only. Stock-change event triggers, arbitrary trigger/action execution, trained forecasts, model evaluation/history and SSO are not implemented.
- RFQ acceptance records a procurement decision. It does not automatically create a PO because an RFQ may describe a service or an item not yet in the product register.
- Asset book values are calculated register values; they do not automatically purchase assets or post periodic depreciation journals.
- Document categories are organisational labels, not separate access policies. Document access follows the tenant document-role policy. External customer support portals are not implemented.
- Snapshot backups are not full database backups or an exercised restore procedure. Existing PostgreSQL data is not imported automatically. Database-managed backup/restore, load tests and provider certification remain deployment work.
- Tax settings are user-configured inputs; no jurisdiction certification or automatic statutory remittance is implied.

## Consistency and security

Tenant scope comes from authenticated database sessions. Mutations validate origin/CSRF and recheck the current account inside transactions. Warehouse financial writes commit stock, location balances, ledgers, audit and idempotency receipts together. Generic stock adjustments cannot consume stock allocated to warehouse locations. Repeated dispatch/restock/transfer/budget-expense requests replay the committed response rather than posting again.

MFA secrets, connector credentials and recovery message bodies are encrypted at rest using configured keys. Recovery tokens and sessions are hashed. Recovery tokens expire, are single-use and do not disable MFA. The outbox only marks a message sent after provider acceptance; receivers must deduplicate stable delivery IDs for uncertain network retries.

MongoDB setup is idempotent and adds the indexes used by the current workflows without resetting edited plans. Run it before releasing the changes. Tenant snapshots remain subject to MongoDB's document limit; large deployments need normalised entity collections and paginated reads beyond the current 500-record panel windows.

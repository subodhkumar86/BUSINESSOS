# Additional PRD workflow contracts

Scope: PRD sections 7.1, 10, 12, 18 and 25. No external messages or payments are sent by these workflows.

Routes: GET/POST /api/v1/workflows/:kind; PATCH /api/v1/workflows/:kind/:id.
Kinds: leave, goals, appointments, certifications, findings, knowledge.

All routes require a current authenticated session; mutations require CSRF. Tenant row-level security, strict schemas, server-side role checks, plan checks, row locking, optimistic versions and transactional audits apply. Creation retries require an idempotency key; the same key with different input is rejected.

- Leave: owner/HR manage requests for existing tenant employees; auditors read. Start/end dates must be valid and ordered. Pending requests can be approved or rejected. Overlapping pending/approved leave for one employee is rejected. Self-approval is forbidden. No automatic payroll deduction.
- Goals: owner/HR define an existing employee's measurable goal and deadline; track progress; close only when target is reached. Auditors read.
- Appointments: owner/sales create scheduled bookings with guest, host, room and explicit timestamps. Overlapping active room bookings are rejected. Complete or cancel once; no automatic external reminders.
- Certifications: owner/operations manage policy/certification records with issuer and expiry date. Audit/HR/finance may read. Revocation is final.
- Findings: owner/operations create audit findings, corrective actions and due dates. Closure requires resolution evidence. Audit/HR/finance may read.
- Knowledge: owner/sales draft and publish support articles. Other tenant users read published articles; auditors may inspect drafts. Archived articles are not served to ordinary readers. External customer authentication remains separate work.

Evidence: unit tests for validation/transitions and PostgreSQL integration tests for isolation, permissions, conflicts, retry behavior and auditing. UI provides labelled fields, status filters, search, loading, errors, success and empty states.

## Integrated warehouse shipments

PRD: sections 7.1 (warehouse), 11 (inventory-to-finance), BUS-002, BUS-005, BUS-010 and acceptance sections 25–27.

GET/POST `/api/v1/warehouse/shipments`; PATCH `/api/v1/warehouse/shipments/:id`.
Owner/operations create and change shipments; auditors read. Operations entitlement, tenant ownership, current sessions and CSRF are mandatory. Create and update require UUID idempotency keys. Each shipment contains one product, quantity, order reference, customer and optional source warehouse location. Missing location explicitly means unallocated stock. Stock is checked at dispatch, not reserved at creation.

Lifecycle: picking → packed → dispatched; picking/packed may be cancelled. Updates require the current version. Dispatch locks the tenant and shipment, checks source stock, reduces location allocation and global product stock, appends immutable stock movement and balanced COGS/inventory journal, updates tenant version and shipment status, and appends actor/source audit records in one transaction. A retry with the same key returns the stored response; different payloads cannot reuse the key. No partial write may survive insufficient stock or stale input. Source shipment ID and movement ID remain linked. Cancellation never reverses a dispatched shipment.

Legacy fulfillment queue items remain tracking-only and labelled accordingly. This shipment workflow does not create invoices, collect customer payment, reserve stock, or process returns/refunds.

## Shipment returns and inspection

PRD sections 7.1 (warehouse returns/inspection/restocking), 11 (shared inventory/finance events), BUS-002, BUS-005 and BUS-010.

GET/POST `/api/v1/warehouse/shipment-returns`; PATCH `/api/v1/warehouse/shipment-returns/:id`. Owner/operations mutate, auditors read; current session, CSRF, operations entitlement, tenant isolation, UUID idempotency keys and optimistic versions apply.

A return links to an existing dispatched shipment and its immutable stock movement. Quantity across all non-cancelled returns cannot exceed quantity shipped, including returns still under inspection and damaged returns. Tenant locks serialize this check. Create captures quantity, reason and destination (explicitly unallocated when absent).

Lifecycle: inspecting → inspected (condition and inspection notes required) → restocked or closed_damaged. Only restockable goods can restock. Damaged goods close without increasing saleable stock or reversing COGS. Open returns can be cancelled; completed returns cannot be changed. Inspection is evidence, not a stock posting.

Restock increases product quantity and optional warehouse allocation, appends a return stock movement at original dispatch unit cost, posts Inventory debit / Cost of goods sold credit, updates tenant/return versions, and appends audit plus idempotency receipt in one transaction. If the product cost has changed, fail rather than silently mix valuation methods; revaluation/lot costing is separate work. Stock quantity/precision ceilings apply.

This does not issue customer credits/refunds, transfer money, create revenue/tax reversals, or process exchanges. Legacy tracking-only returns remain separate and must not generate hidden financial events.

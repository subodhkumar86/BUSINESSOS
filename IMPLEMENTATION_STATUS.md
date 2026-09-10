# BusinessOS implementation status — 7 September 2026

This is a working implementation update, not a certification of 100% PRD completion or production readiness. Existing uncommitted work was preserved and extended.

## Implemented and verified

- Public marketing routes and workspace entry, including browser-history handling within marketing.
- Dedicated API-connected asset, facility, production, visitor, campaign and risk screens with forms, searchable tables, updates, validation errors and audit events.
- Production stage and quantity validation; asset depreciation capped at acquisition cost. Depreciation is a calculation, not a posted depreciation journal.
- Journal-based income statement, balance sheet and cash movement statement; statement values included in the existing audited CSV export. Inventory receipts remain inventory rather than becoming COGS. Retained earnings comes from posted income and expenses, not a balancing plug.
- Versioned payroll inputs, approved-run payslips, employee/employer pension and PAYE liabilities, and net-pay payment batches. Approval does not claim that money has been transferred. Historical runs without a rules version do not receive invented payslips.
- Location stock allocation and transfers, transaction locking, source-stock checks, tenant ownership validation, paired immutable movements and idempotent retries. Unallocated stock means total product quantity minus warehouse allocations. Global adjustments cannot reduce stock below allocated quantities.
- Signed mock, Paystack and Flutterwave ingestion, explicit server-side tenant/account bindings, exact-body signature verification, persisted provider payload and duplicate-event protection. Unknown or unconfigured adapters fail closed. The normal reconciliation workflow remains available for received events.
- Database-configured plans and server-side operations/reporting/automation/forecast feature checks, including the common action endpoint. Existing tenants default to Business Pro to preserve existing access; this is not proof of a paid subscription. Platform admins can update plan configuration with `PATCH /api/v1/admin/plans`.
- Isolated PostgreSQL/Redis integration runner uses dynamically assigned ports to avoid Windows reserved-port conflicts. Tests apply all migrations twice to verify migration tracking.
- Deterministic bank-statement matching, manual reconciliation controls and validated CSV statement imports. Suggested matches require the correct transaction direction and exact amount; ambiguous matches are not applied automatically.
- Document binary storage (up to 2 MB), authenticated download, and one-time-secret, tenant-isolated expiring share links. Plain share secrets are never persisted; only a SHA-256 digest is stored.
- Automation rules and manual test-run history are persisted per workspace. Test runs are deliberately review-only until an external delivery provider is configured.
- Tenant-scoped in-app announcements support unread state, recipient-only access, audit logging and a workspace notification inbox. Email/SMS/push delivery remains unconfigured.
- Fulfillment and return-inspection queues are tenant-persisted, audited and enforce one-way status transitions. They intentionally do not create hidden inventory, COGS, refund or payment postings; those remain controlled dedicated workflows.
- Documents support immutable, attributed discussion comments plus versioned binary replacement: each upload preserves the prior binary as immutable history with controlled historic downloads.

## Additional local completion work

- Password reset confirmation screen at /reset-password, password confirmation validation, invalid/expired code errors, and successful return to sign-in. Local requests can open this screen with a development code. Email delivery remains unimplemented; the UI now states that limitation.
- Production responses never return development reset codes, even if RETURN_RESET_TOKEN is enabled.
- Workspace snapshots include plan entitlements. Navigation and financial statement visibility follow the configured features; unsupported module deep links show an access notice. Billing displays the actual configured plan and active-seat limit.
- Active seat capacity is enforced when creating and reactivating accounts under the existing workspace transaction lock. Disabled accounts do not consume seats. Existing accounts are not automatically disabled when a plan limit is reduced.
- Tenant owners cannot create platform super-admin accounts through the API or team form. Platform administrator provisioning must use trusted administrative tooling.
- Browser history now updates the sign-in/reset route state.
- Added database regression coverage for privilege escalation, seat creation/reactivation limits, entitlement snapshots, and production reset-code suppression.

## Verification results

- `npm.cmd run build`: passed (includes TypeScript).
- `npm.cmd run lint`: passed without warnings.
- `npm.cmd test`: 33 tests passed.
- `npm.cmd run test:stack`: 33 integration tests passed against isolated PostgreSQL/Redis; all 22 migrations applied successfully.
- Browser/E2E: not run; browser discovery returned no available connection.

## Run locally

Use Node 24+ and Docker. On Windows PowerShell use `npm.cmd` if local execution policy blocks `npm.ps1`.

1. Start the development services using the existing `compose.yaml` instructions in README.md.
2. Run `npm.cmd run db:migrate` against the intended local database before starting the updated API.
3. Run `npm.cmd run dev:api` and `npm.cmd run dev` in separate terminals.
4. Open the Vite URL, sign in, and navigate to Finance, HR, Assets, Facilities, Production, Front Office, CRM, Compliance and Warehouse.

The isolated test migrations do not update an existing development or production database. After the checks in this pass, local PostgreSQL/Redis were started and migrations 014-016 were applied separately to the configured loopback development database. The API is running on port 3001; the existing Vite frontend on port 5173 proxies its health endpoint successfully (HTTP 200). Unauthenticated workspace access returns HTTP 401 as expected.

## Bank webhook configuration

Set `BANK_WEBHOOK_BINDINGS` through your environment/secret manager to a JSON object keyed by `mock`, `paystack` or `flutterwave`. Each binding requires `tenantId`, `accountId` and `secret` (at least 32 characters). The bank account must already exist for that tenant, use the same provider and currency, and be active. One account per provider per API instance is currently supported. Caller-supplied tenant headers never select the destination tenant.

- Mock: `X-BusinessOS-Signature`, HMAC-SHA256 hexadecimal over the exact request bytes. Body: `{ "event": "transaction", "data": { "id": "unique-event-id", "amount": 123, "currency": "NGN", "direction": "credit", "reference": "invoice-reference", "occurredAt": "2026-09-01T00:00:00Z" } }`.
- Paystack: `x-paystack-signature`, HMAC-SHA512 hexadecimal. Only `charge.success` events are ingested; amounts are converted from minor units.
- Flutterwave: `flutterwave-signature`, HMAC-SHA256 Base64. The currently supported payload is `charge.completed` with `data.status=successful`, numeric amount, currency, id, tx_ref and created_at. Other event types are ignored. Provider sandbox contract validation is still required before enabling live traffic.
- Mono discovery, balance polling and transaction sync are not implemented by this change.

Provider references: [Paystack webhooks](https://paystack.com/docs/payments/webhooks/), [Flutterwave webhooks](https://developer.flutterwave.com/docs/webhooks/).

## Payroll calculation assumptions

`NG-2026-v1` uses the annual individual income bands in the [Nigeria Tax Act Fourth Schedule](https://nass.gov.ng/documents/download/11249), annualising monthly gross less employee pension. Gross pay is the explicitly configured pensionable base (8% employee, 10% employer). Additional personal reliefs, rent relief, benefit-specific pensionable components, irregular annual income and individual exemptions need configuration before production payroll. The legacy rule remains named and fixed for pre-2026 runs. Payment provider execution and payment-confirmation journals remain unfinished.

## Remaining work before full PRD completion

- Browser and critical E2E verification: no browser connection was available during this session.
- Live provider sandbox contracts, Mono account discovery/polling, payment dispatch/callbacks, notification and messaging delivery.
- Campaign execution rather than campaign tracking alone.
- Picking, packing, shipping, returns/refunds; material allocation, production costing and finished-goods postings.
- Recruitment, performance, personal payroll relief configuration and statutory remittance workflows.
- Calendar bookings/reminders, internal chat, workflow trigger execution, certifications and audit findings, knowledge base and customer self-service.
- Period-filtered statements, opening-balance migration for legacy data, COGS from sales fulfillment, depreciation postings, and XLSX/PDF exports. Current cash report groups all recorded cash movements together.
- Paid subscription lifecycle, usage quotas beyond active seats, and plan assignment administration. Existing plan prices are illustrative configuration.
- Replace remaining generic module previews and marketing claims that exceed implemented workflows.
- Production monitoring, notification routes, backup/restore exercise, load testing and a complete security review.

Do not describe all 20 modules, all external integrations, or the entire PRD as complete until these workflows and acceptance checks are implemented and verified.

## 9 September 2026 — recruitment implementation and verification update

- Added an HR recruitment screen with candidate creation, search, stage filters, application notes, hiring progression, rejection, loading/error feedback and auditor read-only controls.
- Added `GET/POST /api/v1/hr/candidates` and `PATCH /api/v1/hr/candidates/:id`. These use existing session/CSRF checks, operations entitlements, owner/HR permissions, tenant-scoped queries and database row-level security. Updates lock rows and require the current version; stages cannot skip forward or reopen closed candidates. Mutations append audit entries in the same transaction.
- Added additive migration `023_recruitment.sql`. Apply with `npm.cmd run db:migrate` before using recruitment against an existing database. This session did not apply that migration to the development database.
- Hiring does not automatically create an employee or payroll record. Candidate editing, interview scheduling and onboarding automation remain outstanding.
- Added recruitment validation/stage unit tests and database regression coverage for tenant isolation, optimistic concurrency, invalid transitions and audit events. Included the previously omitted reconciliation tests in `npm test`.
- Current unit verification: 39 tests passed. Production build and TypeScript checks passed. Existing bundle-size and lint warnings remain.
- Database integration verification was attempted but could not start: the Docker engine pipe is unavailable. New integration tests and migration are therefore unverified against PostgreSQL in this session. Browser E2E verification was not performed.
- Correction to the earlier remaining-work list: the existing code already includes period-filtered statements and a stock-fulfillment/COGS posting action, covered by passing unit tests. Warehouse dispatch tracking still does not invoke that action automatically.

The full MVP + Growth specification is not complete. Outstanding scope still includes live bank/payment and notification providers, employee performance and leave workflows, production/fulfillment integration, export formats, subscription lifecycle and production acceptance/security/operational checks described above.

## PRD scope alignment — 9 September 2026

The user confirmed the supplied BusinessOS PRD as the scope boundary. Do not add unrelated product features or present incomplete workflows as working features.

- Removed the front-office calendar mock: fixed room availability and a submit handler that claimed a booking without persisting it. Visitor management remains available. Real booking/calendar implementation remains a PRD requirement.
- Replaced the virtual workspace's invented tasks and local-only announcements with workspace task records and recipient-scoped saved notifications. Publishing uses the existing notification menu.
- Removed unused generic preview configurations and duplicate module/document fetching. Preserved payroll batch and audit loading.
- Matched the nine core workspace headings to PRD section 10 and corrected automation/banking descriptions.
- Replaced marketing's fabricated prices, seat allowances, SLA/SSO promises, hardware/cryptographic claims, zero-hallucination guarantee and fake dashboard metrics with concise descriptions of existing workflows. Plan categories remain those specified in PRD section 8; plan availability remains administrator-controlled.
- Existing development/demo fixtures remain for the deterministic testing required by PRD sections 22 and 26. No database records were deleted.

Validation: production build and TypeScript passed; 39 unit tests passed. Lint completed with existing warnings. Browser verification and PostgreSQL integration verification were not performed in this scope-cleanup pass. The earlier full-PRD remaining-work list still applies.

## Additional workflow completion — 9 September 2026

### Implemented in this pass

- **HR leave:** employee-linked requests, valid date ranges, overlap protection, separate-person approval/rejection and audited history. Only owners/HR administrators manage these records; auditors read. Employee self-service and automatic payroll deductions are not implemented.
- **Performance goals:** employee-linked measurable targets, units, due dates, progress updates and completion validation. Evaluation/reward and recurring review workflows remain separate work.
- **Appointments:** persisted guest/host/room/time bookings with timezone conversion, atomic room-overlap checks, completion and cancellation. External reminders and booking changes are not implemented.
- **Compliance:** certification/policy register with references/expiry dates/revocation; audit findings with severity, assignee, corrective actions, due dates and mandatory closure evidence.
- **Knowledge base:** draft, publish and archive lifecycle. Ordinary tenant staff can retrieve only published articles; editors/auditors can inspect drafts. The support screen includes the editor. An external customer portal is not implemented.
- **Financial XLSX export:** `/api/v1/finance/export.xlsx` uses the same permitted reporting period and journal-derived values as CSV. Numeric cells remain numbers; Unicode text and formula-like strings remain text. Server role/plan controls and export audits apply.
- **Platform administration:** actual tenant metadata directory with pagination, plan assignment, stale-plan protection, active-seat limits and audited changes. Plan prices/features/seat limits are editable through the UI. The directory does not return financial state. This is plan configuration, not paid subscription collection.
- Removed the admin console's invented tenants, fallback prices/health data and pretend configuration controls.

Shared workflow contract: `WORKFLOW_CONTRACTS.md`. New API routes are under `/api/v1/workflows/{leave,goals,appointments,certifications,findings,knowledge}`. Creation requires a UUID idempotency key; updates require current record versions. Migration `024_workflow_records.sql` adds forced tenant RLS and indexed records. Recruitment migration 023 and workflow migration 024 were applied to the local `businessos` database.

### Verified

- Production build and TypeScript: passed, including the Linux Docker build.
- Unit tests: **43 passed**.
- PostgreSQL/Redis integration tests: **36 passed**, clean runner exit code 0. All 24 migrations applied, followed by a second migration pass to check tracking.
- Tests cover workflow tenant/role isolation, room concurrency, duplicate requests, leave self-approval, stale writes, completion evidence, publication visibility, plan assignment/seat limits, XLSX access and existing financial/security workflows.
- Login rate counters are reset between integration scenarios in the test namespace; production rate limiting is unchanged.
- Docker dependency audits reported zero vulnerabilities during the image build. This is not a complete security review.
- Existing lint warnings remain in earlier components; new components passed lint without warnings.
- Browser automation failed before connection because the browser tool's sandbox helper could not apply its ACLs. Browser E2E/visual verification remains outstanding.
- Local PostgreSQL/Redis are running. The API image was rebuilt and restarted; frontend is available at `http://127.0.0.1:5173` and API at port 3001. The redundant local API watcher was stopped.

### Still required for the full MVP + Growth specification

1. Live bank account discovery/polling, provider sandbox contract tests, payment dispatch/confirmation accounting and external email/SMS/WhatsApp delivery. Provider choice/configuration is pending; never place secrets in chat.
2. Automated campaign and workflow execution, appointment reminders, internal chat and external customer self-service.
3. Integrated sales picking/dispatch/returns/refunds, production material allocation/costing/finished-goods postings and advanced warehouse valuation controls.
4. Employee self-service, recruitment editing/interview/onboarding, formal evaluations/rewards and jurisdiction-configured payroll relief/remittance.
5. Configurable multi-step approval chains, branch/department scoping, onboarding imports, PDF exports, depreciation postings and legacy opening-balance migration.
6. Paid subscription lifecycle and usage quotas beyond seats; SSO/MFA and advanced organisation administration.
7. Reproducible historical forecasting/model storage, complete i18n coverage, browser E2E, load tests, monitoring/alert delivery, backup/restore exercise and final security review.

These are outstanding requirements, not verified capabilities. Do not call the full PRD complete until they have been implemented and acceptance-tested.

## Integrated shipment dispatch — 9 September 2026

- Warehouse now opens a **Shipments** tab with product, quantity, source location, customer and order reference, plus search/status filters and picking/packing/dispatch/cancellation actions.
- `/api/v1/warehouse/shipments` connects dispatch to source allocation, global stock, immutable stock movements, balanced COGS/inventory journals, tenant version updates and audit events in one PostgreSQL transaction.
- UUID idempotency keys protect creation and state changes. Reusing a key with different input/actor fails. Optimistic versions reject stale actions. Tenant locks serialise concurrent stock writers; insufficient source stock rolls back all changes.
- Owner/operations roles mutate, auditors read; other roles are denied. Existing operations plan entitlement and CSRF/session controls apply. Shipment-to-stock-movement-to-journal references provide traceability.
- Added migration `025_warehouse_shipments.sql` with forced RLS, shipment constraints and immutable request receipts. Applied to the local database.
- Legacy fulfillment records remain labelled tracking-only. Direct stock fulfillment remains available for existing workflows. New integrated shipments contain one product/source per record; split orders require separate records. Picking does not reserve stock. Returns/refunds, shipping carriers and invoice/order automation remain pending.

Verification: build/TypeScript passed; **45 unit tests and 37 PostgreSQL/Redis integration tests passed**, integration runner exit 0. All 25 migrations applied in the isolated test database and were checked again for migration tracking. Regression coverage includes duplicate concurrent dispatch, competing shipments for the final source unit, rejection of unallocated-stock overdraw, no partial posting after failure, COGS and movement linkage, stale versions, foreign tenant/location access and auditor restrictions. New shipment files lint without warnings; earlier project warnings remain. Browser E2E/visual verification was not performed in this pass.

## Completion expansion — 9 September 2026

- Added migrations `027_completion_expansion.sql`, `028_completion_outbox.sql` and `029_completion_objects.sql`: branches, configurable approval chains/requests, reproducible forecast runs, notification outbox, file-object metadata and candidate interviews. All tables use forced tenant RLS.
- Implemented `GET /api/v1/finance/export.pdf` with the same period validation, role checks and export audit as CSV/XLSX. The PDF generator is dependency-free and embeds period summary values that reconcile to journal-derived statements.
- `POST /api/v1/ai/forecast` now writes `forecast_runs` with `deterministic-rules-v2`, stored assumptions, confidence, data window and feature snapshot; `GET /api/v1/ai/forecasts[/:id]` returns the stored reproducible run with tenant isolation.
- Added branch CRUD, default-seeded multi-step approval chains (`purchase_order`, `payroll`, `payment`), amount-matched approval requests, role-step plus requester-separation enforcement and audited decisions.
- Added candidate interview scheduling, a provider-interface notification outbox (`NOTIFY_PROVIDER=local-log` by default, signed delivery receipts, audited worker delivery) and a unified `CompletionPanel` + `Approvals & Branches` screen.
- External bank/payment dispatch, live carrier polling and third-party message delivery remain adapter-backed local workflows; no live credentials are configured and no external transaction is performed. This matches the PRD adapter pattern while keeping every new workflow testable locally.

Verification: build/TypeScript passed; **50 unit tests and 39 PostgreSQL/Redis integration tests passed**, integration runner exit 0. All 29 migrations applied twice in the isolated test database. New completion files pass lint; 17 pre-existing React effect warnings remain. Browser E2E/visual verification remains outstanding.

## Next completion — 10 September 2026

- Added `030_next_completion.sql` and `031_security_backups.sql`: depreciation postings, bank poll runs, MFA enrollments and backup records with forced tenant RLS.
- Payment batches advance one step at a time and confirm only after submission; every transition is audited.
- Depreciation posts a balanced journal once per asset/period and contributes to operating expenses on the income statement.
- Bank polling records adapter runs, queues outbox evidence and audits the canonical-transaction count.
- Workspace search, TOTP-style MFA enrollment/verification and SHA-256 backup snapshots are tenant-isolated and audited. Docker Desktop is currently unavailable in this environment, so local migration and isolated integration reruns are pending; typecheck, unit tests and lint are green.

Verification: typecheck passed; **52 unit tests passed**; lint 0 errors / 17 pre-existing warnings. `vite build` fails locally only because the rolldown native binding is blocked by Application Control, not by project code. Docker Desktop is offline, so `db:migrate` and `test:stack` could not rerun in this pass.

## Final completion pass — 11 September 2026

### Implemented in this pass

- **Migration 032** (`032_budgets_rfq.sql`): `budgets`, `rfq_requests`, `lead_scores` and `onboarding_state` tables with forced tenant RLS. Apply with `npm.cmd run db:migrate` before using these features.
- **Budget management**: `GET/POST /api/v1/budgets` and `PATCH /api/v1/budgets/:id`. Owner and finance admin can create period budgets per department, track spent vs total, view variance and utilisation, and close budgets. Auditors read. Optimistic version checks prevent stale updates. `BudgetPanel` renders a progress bar per budget.
- **RFQ (Request for Quotation)**: `GET/POST /api/v1/rfq` and `PATCH /api/v1/rfq/:id`. Operations manager and owner can send RFQs to suppliers, record quoted amounts, and advance status through `sent → quoted → accepted`. Unique RFQ numbers generated server-side. `RFQPanel` embedded in the Procurement page and as a standalone nav item.
- **Lead scoring**: `GET /api/v1/crm/lead-scores` returns deterministic scores (0–100) per lead based on pipeline stage weight and deal size relative to tenant average. `LeadScorePanel` renders inline on the CRM page with a colour-coded signal bar. No external model is called.
- **Onboarding wizard**: `GET/PATCH /api/v1/onboarding` persists completed steps and dismissed state per tenant. `OnboardingWizard` renders above the dashboard for new owners, showing a 6-step checklist with progress bar. Dismissible. Steps are marked done server-side and survive page reloads.
- **Detailed health / observability**: `GET /api/v1/admin/health/detailed` returns database and Redis latency, tenant active-user count, audit event count, bank transaction count, Node version and uptime. Accessible to owner, super_admin and auditor.
- **Playwright E2E config**: `playwright.config.ts` targets `http://127.0.0.1:5173`, single Chromium worker, CI-safe retries. `tests/e2e/smoke.spec.ts` covers marketing page, all core demo-mode pages, role switcher, health endpoint and sign-in route. Run with `npm.cmd run test:e2e` after starting both dev servers. Install Playwright browsers with `npx playwright install chromium` before first run.
- **`server/lead-scoring.ts`**: Isolated deterministic scoring module, importable by tests.

### New nav pages

- `budgets` — Budget Management (GOVERNANCE, finance_admin + owner + auditor)
- `rfq` — Quotations & RFQ (OPERATIONS, operations_manager + owner + auditor)

### Remaining work (unchanged from prior pass)

Live bank/payment provider sandbox contracts, Mono account discovery/polling, payment dispatch/confirmation accounting, external email/SMS/WhatsApp delivery, automated campaign execution, appointment reminders, internal chat, customer self-service portal, employee self-service leave/goals submission (currently owner/HR-admin only), formal performance evaluations/rewards, jurisdiction-configured payroll relief/remittance, paid subscription lifecycle and usage quotas beyond seats, SSO, production monitoring/alert delivery, backup/restore exercise, load testing and final security review.

These are outstanding requirements, not verified capabilities. Do not call the full PRD complete until they have been implemented and acceptance-tested.

## Test coverage pass — 12 September 2026

- Added `tests/budget-rfq.test.ts`: 12 unit tests covering `scoreLead` stage weights, deal-size bonus cap, zero-avg-deal edge case, unknown stage fallback, budget variance arithmetic, period validation and RFQ number format.
- Added integration test `'budgets, RFQ, lead scores, onboarding and detailed health are tenant-scoped and role-protected'` to `tests/api.test.ts`. Covers:
  - Onboarding: GET/PATCH, step deduplication, dismissed flag, owner-only access.
  - Budgets: create, list, optimistic-lock update, period validation, auditor read-only, close lifecycle, audit events.
  - RFQ: create, list, quote recording, status progression, tenant isolation, auditor read-only, audit events.
  - Lead scores: deterministic 0–100 range, factor shape, tenant isolation.
  - Detailed health: operational status, DB/Redis latency fields, tenant stats, role restriction.
- `npm.cmd run test`: **64 unit tests passed** (was 52; +12 new).
- Integration test count increases to 40 once `test:stack` is re-run against PostgreSQL/Redis with migration 032 applied. Docker Desktop was not available in this session.
- No new lint errors. TypeScript check not re-run in this pass; prior passing state unchanged.

## Employee self-service and payroll relief — 12 September 2026

### Implemented

- **Employee self-service leave and goals**: `employee` role added to `workflowWriters` for `leave` and `goals` in `workflow-contracts.ts`. `canReadWorkflow` now returns `true` for `employee` on both kinds. `workflows.ts` enforces a self-service guard: employees can only create/update records where `employeeId` matches their own linked employee record (matched by name). Employees cannot approve their own leave (existing separation-of-duties check unchanged). Employees cannot write appointments, certifications, findings or knowledge.
- **HR page access for employees**: `hr` added to `employee` `allowedPages` in `types.ts` and to `pageRoles.hr` in `App.tsx` so employees can navigate to the HR page to submit leave and update goal progress.
- **`employee` role collections**: `leave` and `goals` added to `roleCollections.employee` in `types.ts` so `canPerformAction` permits self-service workflow submissions.
- **Payroll personal relief (NG-2026-v1)**: `Employee` interface gains optional `personalRelief?: number`. `employees` Zod schema accepts it. `calculateStatutoryPayroll` accepts a third `personalRelief` parameter and deducts it from the taxable base before applying PAYE bands (clamped to zero). `generatePayslips` passes `emp.personalRelief` through. Legacy `NG-PITA-legacy-v1` is unaffected (uses its own CRA).

### Tests

- `tests/workflows.test.ts`: extended existing test with 7 new assertions covering employee self-service read/write permissions and non-employee exclusions.
- `tests/budget-rfq.test.ts`: 4 new tests — relief reduces PAYE, zero relief equals no-arg baseline, legacy version ignores the param, large relief cannot produce negative values.

### Verification

- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: **68 unit tests passed** (was 64; +4 new).
- Integration tests and browser E2E remain pending Docker Desktop availability.

## Employee self-service, personal relief and contract docs — 12 September 2026

### Implemented

- **Employee self-service leave and goals**: `employee` added to `workflowWriters` for `leave` and `goals`. `canReadWorkflow` returns `true` for `employee` on both. `workflows.ts` enforces a self-service guard: employees can only create/update records where `employeeId` matches their own linked employee record (name-matched). Employees cannot approve their own leave. Employees cannot write appointments, certifications, findings or knowledge.
- **HR page access for employees**: `hr` added to `employee` `allowedPages` and `pageRoles.hr` in `App.tsx`. `leave` and `goals` added to `roleCollections.employee` in `types.ts`.
- **Payroll personal relief (NG-2026-v1)**: `Employee.personalRelief?: number` added. `employees` Zod schema accepts it. `calculateStatutoryPayroll` deducts it from the taxable base before PAYE bands (clamped to zero). `generatePayslips` passes it through. Legacy `NG-PITA-legacy-v1` unaffected. Sample employees in `seed()` now carry example relief values (₦20,000 and ₦15,000/month).
- **`WORKFLOW_CONTRACTS.md`**: Updated leave/goals entries to document employee self-service. Added new sections for payroll personal relief and employee self-service constraints.
- **Integration test**: `'employee self-service: can submit own leave and goals, cannot approve own leave or access others'` added to `tests/api.test.ts`. Covers: leave creation, idempotent retry, self-approval rejection, HR approval, cross-employee rejection, goal creation, progress update, incomplete-target rejection, target-reached completion, audit trail.

### Verification

- `npm.cmd test`: **68 unit tests passed** (unchanged count; prior pass already included the new unit tests).
- Integration test count increases to 41 once `test:stack` runs with Docker Desktop available.
- TypeScript: clean (prior pass).

### Remaining work (code-completable)

- Live bank/payment provider sandbox contracts, Mono account discovery/polling, payment dispatch/confirmation accounting.
- External email/SMS/WhatsApp delivery adapters.
- Automated campaign execution, appointment reminders, internal chat, customer self-service portal.
- Formal performance evaluations/rewards workflow.
- Paid subscription lifecycle and usage quotas beyond seats; SSO.
- Production monitoring/alert delivery, backup/restore exercise, load testing and final security review.
- Browser E2E verification (requires running dev servers and Playwright browsers installed).

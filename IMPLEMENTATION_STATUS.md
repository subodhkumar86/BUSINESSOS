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
- `npm.cmd test`: 27 tests passed.
- `npm.cmd run test:stack`: 26 integration tests passed against isolated PostgreSQL/Redis; all 16 migrations applied successfully.
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
- Live provider sandbox contracts, Mono account discovery/polling, payment dispatch/callbacks, document binary storage and secure external sharing, notification and messaging delivery.
- Full customer profiles and interaction history; campaign execution rather than campaign tracking alone.
- Picking, packing, shipping, returns/refunds; material allocation, production costing and finished-goods postings.
- Recruitment, performance, personal payroll relief configuration and statutory remittance workflows.
- Calendar bookings/reminders, internal chat, workflow trigger execution, certifications and audit findings, knowledge base and customer self-service.
- Period-filtered statements, opening-balance migration for legacy data, COGS from sales fulfillment, depreciation postings, and XLSX/PDF exports. Current cash report groups all recorded cash movements together.
- Paid subscription lifecycle, usage quotas beyond active seats, and plan assignment administration. Existing plan prices are illustrative configuration.
- Replace remaining generic module previews and marketing claims that exceed implemented workflows.
- Production monitoring, notification routes, backup/restore exercise, load testing and a complete security review.

Do not describe all 20 modules, all external integrations, or the entire PRD as complete until these workflows and acceptance checks are implemented and verified.

# Feature and workflow audit — 1 November 2026

## Module completion follow-up

Pagination follow-up: shared core tables render 10, 25 or 50 rows per page, with
visible ranges and labelled previous/next controls. Search, sort and page-size
changes return to the first page. Stale page numbers clamp when matching data
shrinks. CSV downloads still include all matching sorted rows across pages.
Page-size choices stay in the current workspace session; pagination does not
change saved records or fetch additional server data.

Table-sort follow-up: shared core-table headers cycle ascending, descending and
original order using keyboard-accessible buttons and `aria-sort`. Sorting is
independent per collection and uses actual amounts, calculated purchase-order
totals, resolved product names and date timestamps where applicable. Natural
text ordering handles numbered names; equal values remain stable and missing
values stay last in either direction. Filtering and CSV export use the same
sorted rows without changing saved workspace records.

Filtered-view export follow-up: shared core tables download only matching rows
and displayed data columns, omitting action controls and nested metadata.
Amounts remain numeric with currency-labelled headers; purchase-order totals
use quantity times unit cost. UTF-8 BOM, CSV quoting and formula neutralization
preserve Unicode and protect text cells. Empty exports are disabled; live view
export controls require the reports entitlement and use only already-loaded,
role-scoped data. These browser-generated view exports do not create server
audit events; the existing server financial-report download remains available.

Create-dialog follow-up: core record/payroll forms keep an in-memory draft per
form type when closed, restore it on reopening, and clear it after successful
save or explicit discard. Drafts end when the workspace unmounts; they are not
written to browser storage or the server. Dialogs make the background inert,
lock background scrolling, return focus to their launcher, trap enabled form
controls, and ignore close attempts while a save is pending. The global command
shortcut cannot open a second dialog over an active create form.

Record-filter follow-up: core tables, task lists and stock movements match all
search words across primitive fields, normalize whitespace/case/Unicode, and
ignore nested metadata. Shared tables show matching/total counts, distinguish
empty collections from unmatched filters, and offer a clear action. The global
search field supports Escape and returns focus after clearing. It appears only
on modules that actually use it; advanced panels retain their own controls.

Browser-save follow-up: demo state is read on each workspace mount instead of
being captured once when the JavaScript module loads. Leaving and reopening the
demo now shows the latest saved records. Core demo writes compare the stored
snapshot with the last loaded/saved snapshot and reject stale-tab saves without
clearing the form. Unreadable stored data requires an explicit sample reset
before editing, so fallback samples cannot silently overwrite it. Successful
resets establish a new baseline only after browser storage accepts the write.

Motion follow-up: module headings, dashboard cards, auth surfaces, dialogs and
status messages have brief entry transitions. Dashboard bars reveal in sequence;
the login chart draws once. Pointer hover and press feedback is limited to
appropriate controls. Animations do not loop, and the new effects are enabled
only when reduced motion is not requested. Mobile avoids hover-only effects.
Heading remounting restarts its entry animation on module navigation without
remounting workspace state or record forms. Its key is namespaced separately
from operational panels; a module-switching check caught and prompted a fix for
duplicate headings caused by a shared sibling key.

Quick-search follow-up: the command palette searches loaded invoices, products,
leads, employees, projects and tasks by name or ID. Selecting a record opens its
module with the record-name filter applied. Results respect module visibility;
create actions use the existing role permissions, with AI/export actions gated
by their corresponding module. The combobox exposes active results to assistive
technology, traps dialog focus, restores the launcher on close, and handles
empty-result arrow navigation and the close button's Enter key correctly.

Verification/fix follow-up: the API client rejects malformed successful
responses instead of treating an unconfirmed write as saved. Null or malformed
error bodies retain their HTTP status, and protected 401 responses still end the
session. Demo sample reset now persists before changing the screen, reports
storage failures and is disabled for auditor previews. Regression checks cover
malformed responses, session expiry and reset persistence after browser reload.
The full run passed 90 unit tests, 19 demo browser tests, 34 integration/live
browser checks, type checking, lint and build. The read-only production core
database check passed; full workflow preflight still requires the documented
encryption keys, notification provider and scheduler secrets.

UI polish follow-up: shared font fallbacks keep the application readable when
external fonts are unavailable. Tables use aligned numerals, alternating rows
and clearer hover states; keyboard focus and reduced-motion preferences are
supported. Mobile module buttons have larger touch targets. The demo cash-flow
chart supports mouse and keyboard month selection, with announced revenue,
expenses and net flow details in the recorded currency. Axis labels use lakhs.

INR follow-up: new registrations, seed data and saved browser samples default to
Indian rupees. Login previews, marketing, billing, finance, inventory, budgets,
RFQs, rewards, operations, logistics and tax amount displays use INR or the
recorded live currency, with Indian grouping. The shared formatter preserves
paise. Financial exports identify their currency while spreadsheet amounts stay
numeric. Existing live balances and statutory calculation models are preserved.
Verification: 88 unit tests, 19 demo browser tests, 33 MongoDB integration checks,
type checking, lint and the production build passed.

Interactive demo follow-up: assets, facilities, visitors, campaigns, risks and
production tracking now support local creation, edits and validated workflow
transitions. Records persist across reloads; section refresh/reset controls,
stale-tab conflict detection and auditor permissions protect saved changes.
Production demos do not post inventory or journals, and campaign demos do not
send messages. Storage failures are reported without claiming a successful save.
Verification passed: 87 unit tests, 19 production-build demo browser tests,
type checking, lint and build. The 34 integration checks below belong to the
preceding UI refresh and were not rerun for this browser-local change.

UI/demo follow-up: login and workspace styling now share a teal/navy design with
responsive cards, tables, navigation, sample cash-flow visualisation and dark
mode. The login screen shows browser-demo credentials and a fill button. That
credential pair opens local sample data without server authentication. Extra
sample records cover operations, HR workflows, budgets, recruitment, RFQs and
approval previews. Reset sample data reloads editable core demo records. Actual
tenant data remains scoped to its authenticated session. Verification passed:
83 unit tests, 18 demo browser tests against the production build, 34 integration
checks including real sign-in, type checking, lint and build. Desktop, dark-mode
and mobile screenshots were inspected.

- Approvals & Branches was missing from the page-title registry, so selecting it
  silently displayed Overview. Its route now opens the intended module. Both
  browser suites verify the active page, preventing a generic visible heading
  from passing a navigation test on the wrong screen.
- Saved branch records, approval chains, scenario evidence and backup downloads
  now have visible history. Owners can edit approval thresholds/steps and pause
  chains with optimistic versions. Pending requests retain their original steps.
  Eligible approvers see decision controls and can record comments; prior
  decisions remain visible. Department managers can reach their approval queue.
- Owner-only branch/chain controls and owner/operations delivery controls are
  hidden from readers. Operational panels respect their server read/write roles,
  avoiding inaccessible campaign/risk forms and unnecessary denied requests.
- Connectors can be reopened and edited, disabled and refreshed. Blank replacement
  credentials preserve stored encrypted values. Updates require the current
  version, and neither list nor save responses reveal credentials. Database tests
  cover stale edits, preservation, encryption, role checks and tenant isolation.
- Production batches use finished-good/material selectors and quantity fields
  instead of requiring users to paste product IDs and JSON. Inventory production
  requires materials; tracking-only batches retain their explicit mode. Successful
  production writes refresh the workspace stock snapshot.
- Employee creation exposes optional monthly personal relief and omits blank
  values so existing payroll validation continues to work. Settings, footer and
  workspace CSV labels display the workspace currency.
- Browser test servers use dedicated cache directories. The demo test launcher
  owns and stops its child process tree, addressing Windows teardown hangs while
  leaving an existing development server running.
- The workspace now lives in the persistent root layout. Cold catch-all route
  transitions previously remounted it and could return a demo user to sign-in
  midway through a workflow. Anonymous session discovery no longer emits a
  session-expired event; protected requests retain normal expiry handling.

Verification for this follow-up: type checking, all 83 unit tests, lint and the
production build passed. All 34 integration/live-browser checks passed, including
branch/chain save and reload, scenario history, persisted backup links, connector
editing and production batch creation. Demo-suite results are tracked in
[RELEASE_READINESS.md](RELEASE_READINESS.md). No production mutation, external
delivery or deployment was performed.

See [MODULE_STATUS.md](MODULE_STATUS.md) for every workspace and its boundaries.

This audit distinguishes implemented code, executed checks and remaining integration work. It is not a claim that the entire historical Growth PRD or every external provider is complete.

## Fixed defects and missing contracts

- Low-stock automation now evaluates real stock and creates review tasks, with one open linked task per product, a 50-task creation limit per run, persisted counts/history and idempotent retry handling. Settings use optimistic versions; only owner/operations can run it, auditors can inspect it, and the current plan must include automation and operations. Free-text review buttons no longer claim that conditions were evaluated or actions executed.

- Optional hourly/daily low-stock schedules now use a protected worker and a shared transaction-safe task executor. Worker calls consider at most three due workspaces, create at most ten tasks per workspace, and atomically advance eligibility with run/task writes. Disabled scheduling accounts, revoked roles and lost entitlements block schedules. Concurrent calls recheck eligibility under the tenant lock. The UI supports saving/disabling schedules, refresh and scheduled/manual history labels. Deployment scheduling remains separately configured.

Scheduled-automation verification: 83 unit tests and all 33 live integration/browser tests passed. Tests cover worker authentication/methods, concurrent eligibility checks, ten-task backlog batches, account deactivation, plan downgrade, schedule save/reload/disable UI and existing financial/workflow regressions. Type checking, lint and the updated production build passed. The browser check also caught and fixed the schedule dropdown's missing explicit accessible label. No production job, external scheduler or actual payment/message was executed.

- API preflight responses now include PUT in their allowed methods, matching settings routes already exposed by Next.js. Both internal workers share constant-time bearer verification and reject unauthenticated calls before opening a database connection.

Automation follow-up verification: all 81 unit tests and 32 live integration/browser tests passed. Coverage includes actual UI task creation, concurrent retry deduplication, stale settings, completed-task re-review, auditor restrictions, plan enforcement, tenant isolation and a 51-product batch processed as 50 + 1 tasks. Type checking, lint and the production build passed. See [AUTOMATION.md](AUTOMATION.md) for use and scope. The temporary MongoDB test server now has a 60-second startup allowance after a slow Windows startup exceeded its former 10-second limit.

- Advanced panels previously reached missing MongoDB endpoints. Dedicated handlers now persist their workflow records and validate permissions and transitions.
- Allocated warehouse quantities could have been consumed through generic stock actions. Those actions now reject reductions below location allocations.
- RFQs could be marked quoted without recording a price. Quote recording requires a positive amount before acceptance; UI no longer claims a supplier email was sent.
- Budget spend had no connection to expenses. A budget expense now posts the expense, cash journal, allocation record and spend total in one idempotent transaction.
- Knowledge draft queries did not filter ordinary readers. Staff now receive only published articles.
- Employee self-service was blocked. Owners can link an account to an explicit employee record; name matching is not used, and link changes invalidate sessions.
- Document requests were limited to 32 KB even though the upload UI offered 2 MB. Upload/revision routes now accept bounded base64 JSON and validate the decoded byte count. Revision history retains prior binaries, and archiving revokes shares.
- Billing showed invented paid invoices and a fixed seat count. Connected workspaces use live counts, show no fabricated receipts, and persist plan-change requests for review.
- Connector forms accessed the event target after an asynchronous request. They now retain the form reference.
- Production materials JSON could throw an uncaught client error. The form now reports invalid JSON.
- Statement CSV parsing split quoted commas and multiline fields incorrectly. A tested parser handles quotes, BOM, line endings and malformed rows.
- MFA setup now requires a generated authenticator code and current password; no generated preview code enables MFA. Login requires a fresh code, and enrollment changes revoke prior sessions.
- The integration runner's `tsx` startup failed in this environment. Active scripts use Node 24 TypeScript transformation; MongoDB binaries download into the workspace cache.
- CRM scores returned incomplete UI fields and omitted the negotiation stage. The API now uses the tested scoring function and returns the opportunity name, stage and ID.
- The financial-statement API ignored date filters. It now validates and applies reporting periods consistently with exports.
- Employee HR pages loaded management-only panels and caused avoidable permission errors. They now show self-service panels and the linked employee record. MFA is accessible from each signed-in user's Settings page.
- Mutations recheck subscription entitlements within the database transaction, so an in-flight request cannot keep using an obsolete plan after a concurrent administrator change.

## Verification coverage

`npm test` exercises domain accounting, inventory, security, payroll rules, exports, workflow contracts, shipment/return rules and CSV parsing.

`npm run test:integration` starts an isolated MongoDB replica set and exercises the real request handler. It covers isolation, roles, CSRF, transaction rollback, stale versions, duplicate writes, dispatch/return valuation, budget spend, bank reconciliation, production accounting, recruitment, employee links, knowledge visibility, approval chains, documents/shares, feedback, campaign consent, reminders, delivery leases, platform boundaries and MFA/recovery. Delivery providers are mocked; no real messages or payments are sent by the tests. It also starts the production Next.js server and checks the HTTP API and frontend routes.

`npm run test:live` adds a signed-in Chromium test against a development Next.js server and the isolated database. It exercises UI-created products, collected invoices, persistence after reload, document upload beyond the former 32 KB limit, employee self-service and MFA, INR invoice links and manual bank account creation, plus navigation through connected modules. Test-server database variables explicitly override local environment files.

`npm run test:e2e` retains the browser-demo suite. These tests mock authentication and are separate from the live database browser check.

## Deployment work still required

Production preflight now also validates both encryption keys, notification provider/HTTPS URL, webhook signing secret, worker secret and development recovery-token flags. The current environment correctly fails these checks instead of reporting full readiness from database connectivity alone. `--core-only` explicitly limits the check to core/database troubleshooting.

Production notification delivery refuses missing signing secrets, HTTP endpoints, URL credentials/fragments and redirects. Unit tests exercise fail-closed behavior and exact-body HMAC signing with a mocked provider; no external message is sent.

The follow-up run passed all 80 unit tests, including four production-readiness/delivery checks, and all 29 database/production-HTTP integration tests. Type checking, lint and the production build passed. The full preflight reports six missing workflow settings in the current environment; it does not report this deployment ready.

Use the existing production MongoDB connection; the read-only core configuration/database preflight passed outside the network sandbox. Apply current indexes with `npm run db:migrate` before release. This work has not changed production data, provisioned a live administrator, sent external messages, moved funds or deployed the application.

Configure stable encryption keys before MFA, recovery or connector credentials are used. Configure the signed notification webhook and scheduler for actual delivery. Provider-specific payments, bank feeds, carrier sync, full backup restoration and the other boundaries in [MIGRATION_STATUS.md](MIGRATION_STATUS.md) remain explicit rather than simulated success.

## UPI addition

INR registration, owner-managed merchant payee settings and tenant-scoped unpaid invoice UPI links are implemented. Links preserve invoice amount and reference and never mark payment settled. Manual bank receipt verification uses the existing collection workflow. See [UPI_SETUP.md](UPI_SETUP.md). Automated gateway settlement and refunds remain external integrations.

The follow-up adds a dedicated manual UPI receipt workflow. Owner/finance users record full-amount bank-review evidence and receipt time; reference uniqueness, idempotency and invoice status checks prevent reuse or duplicate collection. Receipt, invoice paid status, journal and audit commit together. Auditor access is read-only. Receipt histories persist on reload. A typed reference is not presented as provider-authenticated evidence.

Receipt-workflow verification: 81 unit tests and 30 live integration/browser tests passed. The checks include concurrent idempotent receipts, duplicate-reference rollback, amount/date validation, auditor restrictions, UI receipt collection and persisted history after reload. Type checking, lint and the production build passed. No actual payment or external notification was performed.

Bank forms now default to the workspace currency, offer INR and submit the supported manual provider. Unsupported Open Banking options no longer cause a predictable validation failure.

The real browser check caught a missing `PUT` export on the Next.js API route, which blocked UPI settings despite direct-handler tests passing. The HTTP route now forwards PUT requests to the authenticated handler.

Final verification: 76 unit tests and 30 live integration/browser tests passed, including employee self-service and MFA UI checks. Type checking and lint passed. The browser-demo run completed all 17 individual tests, but its Windows development-server teardown required interruption; it is not counted as a clean suite exit.

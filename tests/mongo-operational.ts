import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import { database } from '../server/mongo/database.ts'
import { totp } from '../server/mongo/totp.ts'
import { hashPassword } from '../server/mongo/security.ts'
import { initialState } from '../server/mongo/workspace.ts'
type Login = { cookie: string; csrf: string; version: number }
type Call = (
  path: string,
  method?: string,
  data?: unknown,
  auth?: Login,
  extra?: Record<string, string>,
) => Promise<Response>
export async function verifyOperationalWorkflows(
  t: TestContext,
  call: Call,
  owner: Login,
) {
  async function send(
    path: string,
    method = 'GET',
    data?: unknown,
    auth = owner,
    key?: string,
  ) {
    const response = await call(
      path,
      method,
      data,
      auth,
      key ? { 'Idempotency-Key': key } : {},
    )
    assert.ok(
      response.ok,
      `${method} ${path}: ${response.status} ${await response.clone().text()}`,
    )
    return response.json()
  }
  async function login(
    email: string,
    password = 'TestBusinessOS!2026',
    code?: string,
  ) {
    const response = await call('/auth/login', 'POST', {
      email,
      password,
      ...(code ? { code } : {}),
    })
    assert.equal(response.status, 200, await response.clone().text())
    const data = await response.json()
    return {
      cookie: response.headers.get('set-cookie')!.split(';')[0],
      csrf: data.csrf,
      version: data.version,
    } satisfies Login
  }
  async function action(action: unknown, auth = owner) {
    const workspace = await send('/workspace', 'GET', undefined, auth)
    return send(
      '/actions',
      'POST',
      { version: workspace.version, action },
      auth,
      randomUUID(),
    )
  }
  await t.test(
    'UPI settings stay tenant scoped and INR links never collect invoices',
    async () => {
      assert.equal(
        (await call('/payments/upi/requests', 'GET', undefined, owner)).status,
        409,
      )
      const registered = await call('/auth/register', 'POST', {
        name: 'UPI owner',
        organisation: 'INR business',
        email: 'upi@example.test',
        password: 'TestBusinessOS!2026',
        currency: 'INR',
        sample: false,
      })
      assert.equal(registered.status, 201, await registered.clone().text())
      const data = await registered.json()
      const indian: Login = {
        cookie: registered.headers.get('set-cookie')!.split(';')[0],
        csrf: data.csrf,
        version: data.version,
      }
      assert.equal(
        (await send('/workspace', 'GET', undefined, indian)).state.currency,
        'INR',
      )
      assert.equal(
        (await call('/payments/upi/requests', 'GET', undefined, indian)).status,
        409,
      )
      await send(
        '/payments/upi/settings',
        'PUT',
        { vpa: 'business@bank', name: 'Indian business' },
        indian,
      )
      assert.equal(
        (await send('/payments/upi/settings', 'GET', undefined, owner)).payee,
        null,
      )
      const created = await action(
        {
          type: 'create',
          collection: 'invoices',
          data: { name: 'UPI customer', amount: 125.5 },
        },
        indian,
      )
      const payments = await send(
        '/payments/upi/requests',
        'GET',
        undefined,
        indian,
      )
      assert.equal(payments.requests.length, 1)
      const url = new URL(payments.requests[0].url)
      assert.equal(url.searchParams.get('am'), '125.50')
      assert.equal(url.searchParams.get('pa'), 'business@bank')
      assert.equal(
        (await send('/workspace', 'GET', undefined, indian)).state.invoices[0]
          .status,
        'Unpaid',
      )
      assert.equal(
        (
          await call(
            '/payments/upi/settings',
            'PUT',
            { vpa: 'invalid', name: 'Bad' },
            indian,
          )
        ).status,
        400,
      )
      const receiptInput = {
        invoiceId: created.state.invoices[0].id,
        reference: 'upi2026000123',
        amount: 125.5,
        receivedAt: '2026-01-01T10:00:00Z',
        verifiedInBank: true,
      }
      assert.equal(
        (
          await call(
            '/payments/upi/receipts',
            'POST',
            { ...receiptInput, amount: 100 },
            indian,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
      assert.equal(
        (
          await call(
            '/payments/upi/receipts',
            'POST',
            { ...receiptInput, verifiedInBank: false },
            indian,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        400,
      )
      assert.equal(
        (
          await call(
            '/payments/upi/receipts',
            'POST',
            { ...receiptInput, receivedAt: '2999-01-01T00:00:00Z' },
            indian,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        400,
      )
      const before = await send('/workspace', 'GET', undefined, indian)
      const receiptKey = randomUUID()
      const [receipt, repeated] = await Promise.all([
        send(
          '/payments/upi/receipts',
          'POST',
          receiptInput,
          indian,
          receiptKey,
        ),
        send(
          '/payments/upi/receipts',
          'POST',
          receiptInput,
          indian,
          receiptKey,
        ),
      ])
      assert.equal(repeated.receipt.id, receipt.receipt.id)
      assert.equal(receipt.receipt.verification, 'manual_bank_review')
      assert.equal(receipt.receipt.reference, 'UPI2026000123')
      await send(
        '/users',
        'POST',
        {
          name: 'UPI auditor',
          email: 'upi-auditor@example.test',
          password: 'TestBusinessOS!2026',
          role: 'auditor',
        },
        indian,
      )
      const auditor = await login('upi-auditor@example.test')
      assert.equal(
        (await send('/payments/upi/receipts', 'GET', undefined, auditor))
          .receipts.length,
        1,
      )
      assert.equal(
        (
          await call('/payments/upi/receipts', 'POST', receiptInput, auditor, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
        403,
      )
      const collected = await send('/workspace', 'GET', undefined, indian)
      assert.equal(collected.state.invoices[0].status, 'Paid')
      assert.equal(
        collected.state.journals.length,
        before.state.journals.length + 1,
      )
      assert.equal(
        (await send('/payments/upi/receipts', 'GET', undefined, owner)).receipts
          .length,
        0,
      )
      assert.equal(
        (
          await call('/payments/upi/receipts', 'POST', receiptInput, indian, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
        409,
      )
      const another = await action(
        {
          type: 'create',
          collection: 'invoices',
          data: { name: 'Duplicate reference check', amount: 125.5 },
        },
        indian,
      )
      const secondId = another.state.invoices.find(
        (invoice: { name: string }) =>
          invoice.name === 'Duplicate reference check',
      ).id
      assert.equal(
        (
          await call(
            '/payments/upi/receipts',
            'POST',
            {
              ...receiptInput,
              invoiceId: secondId,
              reference: 'UPI2026000123',
            },
            indian,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
      assert.equal(
        (
          await send('/workspace', 'GET', undefined, indian)
        ).state.invoices.find(
          (invoice: { id: string }) => invoice.id === secondId,
        ).status,
        'Unpaid',
      )
      await action(
        {
          type: 'status',
          collection: 'invoices',
          id: secondId,
          status: 'Paid',
        },
        indian,
      )
      assert.equal(
        (await send('/payments/upi/requests', 'GET', undefined, indian))
          .requests.length,
        0,
      )
    },
  )
  await t.test(
    'lead scores match UI contracts and financial statements honour date filters',
    async () => {
      const created = await action({
        type: 'create',
        collection: 'leads',
        data: { name: 'Scored opportunity', amount: 100 },
      })
      const lead = created.state.leads[0]
      await action({
        type: 'status',
        collection: 'leads',
        id: lead.id,
        status: 'Negotiation',
      })
      const score = (await send('/crm/lead-scores')).scores.find(
        (row: { leadId: string }) => row.leadId === lead.id,
      )
      assert.equal(score.name, 'Scored opportunity')
      assert.equal(score.status, 'Negotiation')
      assert.equal(score.score, 90)
      assert.equal(
        (await send('/finance/statements?from=2999-01-01&to=2999-12-31')).income
          .revenue,
        0,
      )
      assert.equal(
        (
          await call(
            '/finance/statements?from=2026-12-31&to=2026-01-01',
            'GET',
            undefined,
            owner,
          )
        ).status,
        400,
      )
    },
  )
  await t.test(
    'manual bank imports deduplicate and reconciling collections posts cash once',
    async () => {
      const created = await action({
        type: 'create',
        collection: 'invoices',
        data: { name: 'Bank workflow customer', amount: 123.45 },
      })
      const invoice = created.state.invoices.find(
        (i: { name: string }) => i.name === 'Bank workflow customer',
      )
      const bank = await send('/banks/accounts', 'POST', {
        provider: 'manual',
        externalRef: 'BANK-FLOW',
        name: 'Manual operating account',
        currency: 'INR',
      })
      const transaction = {
        externalRef: 'STMT-1',
        occurredAt: '2026-10-24T10:00:00Z',
        amount: 123.45,
        direction: 'credit',
        reference: invoice.name,
      }
      const path = '/banks/accounts/' + bank.id + '/transactions'
      const entry = await send(path, 'POST', transaction)
      assert.equal(entry.match_status, 'suggested')
      assert.equal(
        (await send(path + '/import', 'POST', { transactions: [transaction] }))
          .skipped,
        1,
      )
      const cashBefore = (await send('/finance/statements')).cashFlow
        ?.closingCash
      await send(path + '/' + entry.id, 'PATCH', { matchStatus: 'matched' })
      const after = await send('/workspace')
      assert.equal(
        after.state.invoices.find((i: { id: string }) => i.id === invoice.id)
          .status,
        'Paid',
      )
      const count = after.state.journals.length
      await send(path + '/' + entry.id, 'PATCH', { matchStatus: 'matched' })
      assert.equal((await send('/workspace')).state.journals.length, count)
      assert.equal(
        (
          await call(
            path + '/' + entry.id,
            'PATCH',
            { matchStatus: 'unmatched' },
            owner,
          )
        ).status,
        409,
      )
      assert.equal(
        (
          await call(
            path + '/import',
            'POST',
            { transactions: [{ ...transaction, amount: 99 }] },
            owner,
          )
        ).status,
        409,
      )
      assert.ok(cashBefore === undefined || Number.isFinite(cashBefore))
    },
  )
  await t.test(
    'production consumes materials once, posts finished stock and keeps the balance sheet balanced',
    async () => {
      await action({
        type: 'create',
        collection: 'products',
        data: {
          name: 'Raw material',
          sku: 'RAW-FLOW',
          qty: 10,
          cost: 5,
          min: 1,
        },
      })
      const workspace = await action({
        type: 'create',
        collection: 'products',
        data: {
          name: 'Finished goods',
          sku: 'FIN-FLOW',
          qty: 0,
          cost: 10,
          min: 1,
        },
      })
      const raw = workspace.state.products.find(
          (p: { sku: string }) => p.sku === 'RAW-FLOW',
        ),
        finished = workspace.state.products.find(
          (p: { sku: string }) => p.sku === 'FIN-FLOW',
        )
      const batch = await send('/production/batches', 'POST', {
        batchNumber: 'FLOW-BATCH',
        productName: finished.name,
        outputProductId: finished.id,
        materials: [{ productId: raw.id, quantity: 4 }],
        plannedQty: 2,
      })
      assert.equal(
        (
          await call(
            '/production/batches/' + batch.id,
            'PATCH',
            { status: 'completed' },
            owner,
          )
        ).status,
        409,
      )
      await send('/production/batches/' + batch.id, 'PATCH', {
        status: 'running',
      })
      await send('/production/batches/' + batch.id, 'PATCH', {
        completedQty: 2,
        defectCount: 0,
      })
      await send('/production/batches/' + batch.id, 'PATCH', {
        status: 'qa_check',
      })
      await send('/production/batches/' + batch.id, 'PATCH', {
        status: 'completed',
      })
      assert.equal(
        (
          await call(
            '/production/batches/' + batch.id,
            'PATCH',
            { status: 'completed' },
            owner,
          )
        ).status,
        409,
      )
      const final = await send('/workspace')
      assert.equal(
        final.state.products.find((p: { id: string }) => p.id === raw.id).qty,
        6,
      )
      assert.equal(
        final.state.products.find((p: { id: string }) => p.id === finished.id)
          .qty,
        2,
      )
      assert.equal((await send('/finance/statements')).balance.isBalanced, true)
    },
  )
  await t.test(
    'employee links isolate self-service and knowledge drafts stay private',
    async () => {
      const workspace = await action({
        type: 'create',
        collection: 'employees',
        data: {
          name: 'Linked employee',
          department: 'Operations',
          amount: 1000,
        },
      })
      const employee = workspace.state.employees.find(
        (e: { name: string }) => e.name === 'Linked employee',
      )
      const user = await send('/users', 'POST', {
        name: 'Different display name',
        email: 'linked@example.test',
        role: 'employee',
        password: 'TestBusinessOS!2026',
      })
      const old = await login('linked@example.test')
      await send('/users/' + user.id + '/employee', 'PATCH', {
        employeeId: employee.id,
      })
      assert.equal(
        (await call('/workspace', 'GET', undefined, old)).status,
        401,
      )
      const auth = await login('linked@example.test'),
        own = await send('/workspace', 'GET', undefined, auth)
      assert.deepEqual(
        own.state.employees.map((e: { id: string }) => e.id),
        [employee.id],
      )
      const leave = await send(
        '/workflows/leave',
        'POST',
        {
          employeeId: employee.id,
          startDate: '2026-11-02',
          endDate: '2026-11-03',
          reason: 'Personal leave',
        },
        auth,
        randomUUID(),
      )
      assert.equal(
        (
          await call(
            '/workflows/leave/' + leave.id,
            'PATCH',
            { version: 1, status: 'approved' },
            auth,
          )
        ).status,
        403,
      )
      await send('/workflows/leave/' + leave.id, 'PATCH', {
        version: 1,
        status: 'approved',
      })
      assert.equal(
        (
          await call(
            '/workflows/leave',
            'POST',
            {
              employeeId: randomUUID(),
              startDate: '2026-11-06',
              endDate: '2026-11-06',
              reason: 'Spoofed',
            },
            auth,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        403,
      )
      const article = await send(
        '/workflows/knowledge',
        'POST',
        {
          title: 'Private draft',
          category: 'Operations',
          content: 'Draft content',
        },
        owner,
        randomUUID(),
      )
      assert.ok(
        !(
          await send('/workflows/knowledge', 'GET', undefined, auth)
        ).records.some((row: { id: string }) => row.id === article.id),
      )
      await send('/workflows/knowledge/' + article.id, 'PATCH', {
        version: article.version,
        status: 'published',
      })
      assert.ok(
        (
          await send('/workflows/knowledge', 'GET', undefined, auth)
        ).records.some((row: { id: string }) => row.id === article.id),
      )
    },
  )
  await t.test(
    'connector edits preserve hidden credentials and reject stale versions across tenants',
    async () => {
      const savedKey = process.env.CONNECTOR_ENCRYPTION_KEY
      process.env.CONNECTOR_ENCRYPTION_KEY = randomBytes(32).toString('base64')
      try {
        const input = {
          category: 'email',
          provider: 'Review webhook',
          status: 'sandbox',
          configuration: {
            sender: 'ops@example.test',
            webhookUrl: 'https://example.test/notify',
          },
          credentials: { apiKey: 'private-test-credential' },
        }
        const created = await send('/connectors', 'POST', input)
        assert.equal(created.version, 1)
        assert.equal(created.encrypted_credentials, undefined)
        const d = await database()
        const stored = await d.records.findOne({ _id: created.id })
        assert.ok(stored?.data.encrypted_credentials)
        assert.ok(
          !String(stored.data.encrypted_credentials).includes(
            input.credentials.apiKey,
          ),
        )
        const changed = await send('/connectors', 'POST', {
          ...input,
          credentials: undefined,
          version: 1,
          status: 'disabled',
        })
        assert.equal(changed.version, 2)
        assert.equal(
          (await d.records.findOne({ _id: created.id }))?.data
            .encrypted_credentials,
          stored.data.encrypted_credentials,
        )
        const listing = await send('/connectors')
        assert.ok(!JSON.stringify(listing).includes(input.credentials.apiKey))
        assert.ok(
          !JSON.stringify(listing).includes(
            String(stored.data.encrypted_credentials),
          ),
        )
        assert.equal(
          (await call('/connectors', 'POST', { ...input, version: 1 }, owner))
            .status,
          409,
        )
        assert.equal(
          (await call('/connectors', 'POST', input, owner)).status,
          409,
        )
        const other = await login('upi@example.test')
        assert.ok(
          !(await send('/connectors', 'GET', undefined, other)).connectors.some(
            (row: { id: string }) => row.id === created.id,
          ),
        )
        assert.equal(
          (await call('/connectors', 'POST', { ...input, version: 2 }, other))
            .status,
          409,
        )
        const auditor = await login('upi-auditor@example.test')
        assert.equal(
          (await call('/connectors', 'GET', undefined, auditor)).status,
          403,
        )
      } finally {
        if (savedKey === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY
        else process.env.CONNECTOR_ENCRYPTION_KEY = savedKey
      }
    },
  )
  await t.test(
    'ordered approval chains control purchase receipt and inbound milestones',
    async () => {
      for (const n of [1, 2])
        await send('/users', 'POST', {
          name: 'Approver ' + n,
          email: `approver${n}@example.test`,
          role: 'operations_manager',
          password: 'TestBusinessOS!2026',
        })
      const requester = await login('approver1@example.test'),
        reviewer = await login('approver2@example.test')
      await send('/approvals/chains', 'POST', {
        name: 'Two-step purchasing',
        scope: 'purchase_order',
        steps: [{ role: 'operations_manager' }, { role: 'owner' }],
      })
      const product = (await send('/workspace', 'GET', undefined, requester))
        .state.products[0]
      const created = await action(
        {
          type: 'create',
          collection: 'orders',
          data: { name: 'Approval supplier', product: product.id, qty: 2 },
        },
        requester,
      )
      const order = created.state.orders[0]
      const queued = await action(
        {
          type: 'status',
          collection: 'orders',
          id: order.id,
          status: 'Approved',
        },
        requester,
      )
      assert.ok(queued.notice)
      assert.equal(
        queued.state.orders.find((o: { id: string }) => o.id === order.id)
          .status,
        'Pending',
      )
      let approval = (await send('/approvals/requests')).requests.find(
        (row: { entity_id: string }) => row.entity_id === order.id,
      )
      assert.equal(
        (
          await call(
            '/approvals/requests/' + approval.id,
            'POST',
            { version: approval.version, decision: 'approve' },
            requester,
          )
        ).status,
        403,
      )
      approval = await send(
        '/approvals/requests/' + approval.id,
        'POST',
        { version: approval.version, decision: 'approve' },
        reviewer,
      )
      assert.equal(approval.status, 'pending')
      approval = await send('/approvals/requests/' + approval.id, 'POST', {
        version: approval.version,
        decision: 'approve',
      })
      assert.equal(approval.status, 'approved')
      const shipment = await send('/supply/shipments', 'POST', {
        purchaseOrderId: order.id,
        carrier: 'Manual carrier',
        trackingCode: 'FLOW-TRACK',
        destination: 'Main warehouse',
        eta: '2026-11-01',
        logisticsCost: 50,
      })
      for (const [index, status] of [
        'in_transit',
        'customs_cleared',
        'delivered',
      ].entries())
        await send('/supply/shipments/' + shipment.id, 'PATCH', {
          version: index + 1,
          status,
        })
      await action(
        {
          type: 'status',
          collection: 'orders',
          id: order.id,
          status: 'Received',
        },
        requester,
      )
      assert.equal(
        (await send('/workspace')).state.orders.find(
          (o: { id: string }) => o.id === order.id,
        ).status,
        'Received',
      )
    },
  )
  await t.test(
    'tax settings, filing stages, onboarding, real exports and billing requests persist',
    async () => {
      const initial = (await send('/tax/settings')).settings
      await send('/tax/settings', 'PATCH', {
        countryCode: initial.country_code,
        jurisdiction: initial.jurisdiction,
        currency: initial.currency,
        financialYearStartMonth: 4,
        vatRate: initial.vat_rate,
        withholdingRate: initial.withholding_rate,
        incomeTaxRate: initial.income_tax_rate,
        payrollEmployeeRate: 0,
        payrollEmployerRate: 0,
        invoicePrefix: 'QA',
        taxInclusive: false,
        complianceNotes: 'Test configuration only',
      })
      assert.equal(
        (await send('/tax/settings')).settings.financial_year_start_month,
        4,
      )
      const filing = await send('/tax/filings', 'POST', {
        name: 'Workflow filing',
        territory: 'Test territory',
        dueDate: '2026-11-01',
        amount: 100,
      })
      assert.equal(
        (
          await call(
            '/tax/filings/' + filing.id,
            'PATCH',
            { status: 'paid' },
            owner,
          )
        ).status,
        409,
      )
      for (const status of ['ready', 'filed', 'paid'])
        await send('/tax/filings/' + filing.id, 'PATCH', { status })
      await send('/onboarding', 'PATCH', { completedStep: 'profile' })
      await send('/onboarding', 'PATCH', { completedStep: 'profile' })
      assert.deepEqual((await send('/onboarding')).completedSteps, ['profile'])
      for (const format of ['csv', 'xlsx', 'pdf']) {
        const response = await call(
          '/finance/export.' + format,
          'GET',
          undefined,
          owner,
        )
        assert.equal(response.status, 200)
        const bytes = Buffer.from(await response.arrayBuffer())
        assert.ok(bytes.length > 100)
        if (format === 'pdf')
          assert.equal(bytes.subarray(0, 4).toString(), '%PDF')
        if (format === 'xlsx')
          assert.equal(bytes.subarray(0, 2).toString(), 'PK')
      }
      const request = await send('/billing/change-requests', 'POST', {
        plan: 'business_pro',
      })
      assert.equal(request.status, 'requested')
      assert.equal((await send('/billing/entitlements')).plan, 'business')
      assert.ok((await send('/billing/entitlements')).activeSeats >= 4)
      const backup = await send('/admin/backups', 'POST', {
        label: 'Workflow backup',
      })
      const download = await call(
        backup.download.replace('/api/v1', ''),
        'GET',
        undefined,
        owner,
      )
      const backupText = await download.text()
      assert.equal(download.status, 200)
      assert.ok(!backupText.includes('password:'))
      assert.ok(!backupText.includes('security:mfa'))
      assert.equal((await call('/internal/outbox/run')).status, 401)
    },
  )
  await t.test(
    'budget expense postings update spend and cash once while preventing overspend',
    async () => {
      const today = new Date().toISOString().slice(0, 10)
      const budget = await send('/budgets', 'POST', {
        name: 'Expense budget',
        periodFrom: today,
        periodTo: today,
        totalAmount: 100,
      })
      const input = {
          version: budget.version,
          description: 'Budgeted stationery',
          amount: 40,
        },
        key = randomUUID()
      const first = await send(
        '/budgets/' + budget.id + '/expenses',
        'POST',
        input,
        owner,
        key,
      )
      assert.equal(first.spent_amount, 40)
      assert.equal(
        (
          await send(
            '/budgets/' + budget.id + '/expenses',
            'POST',
            input,
            owner,
            key,
          )
        ).spent_amount,
        40,
      )
      assert.equal(
        (await send('/workspace')).state.expenses.filter(
          (e: { name: string }) => e.name === input.description,
        ).length,
        1,
      )
      assert.equal(
        (
          await call(
            '/budgets/' + budget.id + '/expenses',
            'POST',
            { ...input, version: first.version, amount: 70 },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
    },
  )
  await t.test(
    'campaign consent and due reminders queue once; delivery leases prevent duplicate sends',
    async () => {
      await send('/crm/customers', 'POST', {
        name: 'Opted in',
        email: 'opted@example.test',
        marketingOptIn: true,
      })
      await send('/crm/customers', 'POST', {
        name: 'Not opted in',
        email: 'no-consent@example.test',
      })
      const campaign = await send('/marketing/campaigns', 'POST', {
        name: 'Workflow campaign',
        channel: 'email',
        budget: 100,
        spend: 0,
      })
      const path = '/marketing/campaigns/' + campaign.id + '/queue',
        body = { subject: 'Test campaign', body: 'This is a test message.' }
      assert.equal((await send(path, 'POST', body)).queued, 1)
      assert.equal((await send(path, 'POST', body)).skipped, 1)
      const start = new Date(Date.now() + 3600000).toISOString(),
        end = new Date(Date.now() + 7200000).toISOString(),
        reminder = new Date(Date.now() - 1000).toISOString()
      await send(
        '/workflows/appointments',
        'POST',
        {
          title: 'Workflow appointment',
          guest: 'Test guest',
          guestEmail: 'guest@example.test',
          host: 'Owner',
          room: 'Test room',
          startAt: start,
          endAt: end,
          reminderAt: reminder,
        },
        owner,
        randomUUID(),
      )
      assert.equal(
        (await send('/workflows/appointments/reminders/run', 'POST', {}))
          .queued,
        1,
      )
      assert.equal(
        (await send('/workflows/appointments/reminders/run', 'POST', {}))
          .queued,
        0,
      )
      const outbox = (await send('/notifications/outbox')).messages.find(
        (message: { campaign_id: string }) =>
          message.campaign_id === campaign.id,
      )
      const oldFetch = globalThis.fetch,
        oldProvider = process.env.NOTIFY_PROVIDER,
        oldEndpoint = process.env.NOTIFY_WEBHOOK_URL
      let release!: () => void,
        started!: () => void,
        requests = 0
      const wait = new Promise<void>((resolve) => {
          release = resolve
        }),
        entered = new Promise<void>((resolve) => {
          started = resolve
        })
      process.env.NOTIFY_PROVIDER = 'webhook'
      process.env.NOTIFY_WEBHOOK_URL = 'https://provider.example.test/notify'
      globalThis.fetch = async (input, init) => {
        if (String(input) !== process.env.NOTIFY_WEBHOOK_URL)
          return oldFetch(input, init)
        requests++
        started()
        await wait
        return new Response('{}', { status: 200 })
      }
      try {
        const first = send(
          '/notifications/outbox/' + outbox.id + '/deliver',
          'POST',
          {},
        )
        await entered
        assert.equal(
          (
            await call(
              '/notifications/outbox/' + outbox.id + '/deliver',
              'POST',
              {},
              owner,
            )
          ).status,
          409,
        )
        release()
        assert.equal((await first).status, 'sent')
        assert.equal(
          (
            await send(
              '/notifications/outbox/' + outbox.id + '/deliver',
              'POST',
              {},
            )
          ).status,
          'sent',
        )
        assert.equal(requests, 1)
      } finally {
        release()
        globalThis.fetch = oldFetch
        if (oldProvider === undefined) delete process.env.NOTIFY_PROVIDER
        else process.env.NOTIFY_PROVIDER = oldProvider
        if (oldEndpoint === undefined) delete process.env.NOTIFY_WEBHOOK_URL
        else process.env.NOTIFY_WEBHOOK_URL = oldEndpoint
      }
    },
  )
  await t.test(
    'platform administration changes plans without exposing tenant business data',
    async () => {
      const d = await database(),
        tenant = randomUUID(),
        id = randomUUID()
      await d.tenants.insertOne({
        _id: tenant,
        state: initialState('Test platform', false),
        version: 0,
        plan: 'enterprise',
        createdAt: new Date(),
      })
      await d.users.insertOne({
        _id: id,
        id,
        tenant,
        name: 'Test administrator',
        email: 'platform@example.test',
        role: 'super_admin',
        active: true,
        sessionVersion: 0,
        password: await hashPassword('TestBusinessOS!2026'),
      })
      const admin = await login('platform@example.test')
      assert.equal(
        (await call('/admin/tenants', 'GET', undefined, owner)).status,
        403,
      )
      const directory = await send('/admin/tenants', 'GET', undefined, admin)
      assert.ok(!JSON.stringify(directory).includes('journals'))
      assert.ok(!JSON.stringify(directory).includes('invoices'))
      assert.ok(
        (await send('/workspace', 'GET', undefined, admin)).state.invoices
          .length === 0,
      )
      const member = await d.users.findOne({ email: 'owner@example.test' })
      await send(
        '/admin/tenants/' + member!.tenant + '/plan',
        'PATCH',
        { planId: 'business_pro', expectedPlanId: 'business' },
        admin,
      )
      assert.equal((await send('/billing/entitlements')).plan, 'business_pro')
      const scenario = await send('/ai/forecast', 'POST', { metric: 'cash' })
      assert.equal(scenario.engine, 'constant-baseline-v1')
      assert.ok(scenario.assumptions.includes('no trained model'))
      assert.ok(
        (await send('/ai/forecasts')).forecasts.some(
          (row: { id: string }) => row.id === scenario.id,
        ),
      )
      assert.equal(
        (
          await call(
            '/admin/tenants/' + member!.tenant + '/plan',
            'PATCH',
            { planId: 'starter', expectedPlanId: 'business' },
            admin,
          )
        ).status,
        409,
      )
      await send(
        '/admin/tenants/' + member!.tenant + '/plan',
        'PATCH',
        { planId: 'starter', expectedPlanId: 'business_pro' },
        admin,
      )
      assert.equal(
        (
          await call('/warehouse/shipments', 'POST', {}, owner, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
        403,
      )
      const current = await send('/workspace')
      assert.equal(
        (
          await call(
            '/actions',
            'POST',
            {
              version: current.version,
              action: {
                type: 'create',
                collection: 'employees',
                data: {
                  name: 'Blocked by current plan',
                  department: 'Operations',
                  amount: 1000,
                },
              },
            },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        403,
      )
      await send(
        '/admin/tenants/' + member!.tenant + '/plan',
        'PATCH',
        { planId: 'business_pro', expectedPlanId: 'starter' },
        admin,
      )
    },
  )
  await t.test(
    'RFC 6238 MFA rejects login bypass and replay; password reset is one-time and keeps MFA',
    async () => {
      assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082')
      process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64')
      process.env.ALLOW_DEVELOPMENT_RESET_TOKENS = 'true'
      await send('/users', 'POST', {
        name: 'MFA tester',
        email: 'mfa@example.test',
        role: 'employee',
        password: 'TestBusinessOS!2026',
      })
      const auth = await login('mfa@example.test')
      const enrollment = await send('/auth/mfa', 'POST', undefined, auth)
      const counter = Math.floor(Date.now() / 30000)
      await send(
        '/auth/mfa/confirm',
        'POST',
        {
          code: totp(enrollment.secret, counter),
          currentPassword: 'TestBusinessOS!2026',
        },
        auth,
      )
      assert.equal(
        (await call('/workspace', 'GET', undefined, auth)).status,
        401,
      )
      assert.equal(
        (
          await call('/auth/login', 'POST', {
            email: 'mfa@example.test',
            password: 'TestBusinessOS!2026',
          })
        ).status,
        401,
      )
      const next = await login(
        'mfa@example.test',
        'TestBusinessOS!2026',
        totp(enrollment.secret, counter + 1),
      )
      assert.equal(
        (
          await call('/auth/login', 'POST', {
            email: 'mfa@example.test',
            password: 'TestBusinessOS!2026',
            code: totp(enrollment.secret, counter + 1),
          })
        ).status,
        401,
      )
      const recovery = await send('/auth/password-reset/request', 'POST', {
        email: 'mfa@example.test',
      })
      assert.ok(recovery.developmentToken)
      await send('/auth/password-reset/confirm', 'POST', {
        token: recovery.developmentToken,
        newPassword: 'NewTestPassword!2026',
      })
      assert.equal(
        (
          await call('/auth/password-reset/confirm', 'POST', {
            token: recovery.developmentToken,
            newPassword: 'AnotherPassword!2026',
          })
        ).status,
        400,
      )
      assert.equal(
        (await call('/workspace', 'GET', undefined, next)).status,
        401,
      )
      assert.equal(
        (
          await call('/auth/login', 'POST', {
            email: 'mfa@example.test',
            password: 'NewTestPassword!2026',
          })
        ).status,
        401,
      )
      const d = await database(),
        user = await d.users.findOne({ email: 'mfa@example.test' }),
        row = await d.records.findOne({
          tenant: user!.tenant,
          kind: 'security:mfa',
          'data.user_id': user!.id,
        })
      assert.equal(row!.data.enabled, true)
      assert.ok(!JSON.stringify(row).includes(enrollment.secret))
      delete process.env.ALLOW_DEVELOPMENT_RESET_TOKENS
    },
  )
}

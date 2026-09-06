import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../server/app.ts'
import type { Snapshot } from '../src/types.ts'
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw Error(
    'Set TEST_DATABASE_URL and TEST_REDIS_URL to dedicated test services. These tests create isolated test tenants.',
  )
if (new URL(process.env.TEST_DATABASE_URL).pathname !== '/businessos_test')
  throw Error(
    'Integration tests require the dedicated businessos_test database. Use npm run test:stack.',
  )
const origin = 'http://127.0.0.1:5173'
const app = await createApp({
  databaseUrl: process.env.TEST_DATABASE_URL,
  redisUrl: process.env.TEST_REDIS_URL,
  origins: [origin],
  prefix: 'bos-test:' + randomUUID() + ':',
})
await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve))
const address = app.server.address()
if (!address || typeof address === 'string')
  throw Error('Test server did not bind')
const base = `http://127.0.0.1:${address.port}/api/v1`
interface Account {
  cookie: string
  snapshot: Snapshot
}
async function call(
  path: string,
  method = 'GET',
  body?: unknown,
  account?: Account,
  extra: Record<string, string> = {},
) {
  const res = await fetch(base + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(account
        ? { Cookie: account.cookie, 'X-CSRF-Token': account.snapshot.csrf }
        : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return {
    status: res.status,
    data: await res.json(),
    cookie: res.headers.get('set-cookie')?.split(';')[0] || '',
    headers: res.headers,
  }
}
async function register() {
  const r = await call('/auth/register', 'POST', {
    name: 'Test owner',
    organisation: 'Test ' + randomUUID(),
    email: randomUUID() + '@example.test',
    password: 'test-password-12345',
    sample: true,
  })
  assert.equal(r.status, 201)
  assert.match(r.headers.get('set-cookie') || '', /HttpOnly/)
  return { cookie: r.cookie, snapshot: r.data } as Account
}
let owner: Account, other: Account
const save = (
  account: Account,
  action: unknown,
  key = randomUUID(),
  version = account.snapshot.version,
) =>
  call('/actions', 'POST', { action, version }, account, {
    'Idempotency-Key': key,
  })
try {
  owner = await register()
  other = await register()
  await test('unauthenticated, cross-origin and missing CSRF requests are rejected', async () => {
    assert.equal((await call('/workspace')).status, 401)
    assert.equal(
      (
        await call('/auth/register', 'POST', {}, undefined, {
          Origin: 'https://evil.example',
        })
      ).status,
      403,
    )
    assert.equal(
      (await call('/actions', 'POST', {}, owner, { 'X-CSRF-Token': '' }))
        .status,
      403,
    )
  })
  await test('tenant owners cannot access platform-admin endpoints', async () => {
    for (const path of [
      '/admin/overview',
      '/admin/plans',
      '/admin/integrations',
      '/admin/ai-controls',
    ]) {
      assert.equal((await call(path, 'GET', undefined, owner)).status, 403)
    }
  })
  await test('tenant is derived from session; foreign record IDs and tenant injection are rejected', async () => {
    const r = await save(other, {
      type: 'create',
      collection: 'tasks',
      data: { name: 'Private other task' },
    })
    assert.equal(r.status, 200)
    other.snapshot = r.data
    const id = r.data.state.tasks[0].id
    assert.equal(
      (
        await save(owner, {
          type: 'status',
          collection: 'tasks',
          id,
          status: 'Completed',
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await save(owner, {
          type: 'settings',
          name: 'Hijacked',
          tenant: other.snapshot.user.id,
        })
      ).status,
      400,
    )
    const workspace = await call('/workspace', 'GET', undefined, owner)
    assert.equal(
      workspace.data.state.tasks.some((t: { id: string }) => t.id === id),
      false,
    )
  })
  await test('version checking and idempotency preserve one invoice and one posting', async () => {
    const key = randomUUID(),
      action = {
        type: 'create',
        collection: 'invoices',
        data: { name: 'Integration invoice', amount: 1200 },
      },
      before = owner.snapshot.version
    const r = await save(owner, action, key)
    assert.equal(r.status, 200)
    owner.snapshot = r.data
    const again = await save(owner, action, key, before)
    assert.equal(again.status, 200)
    assert.equal(again.data.version, r.data.version)
    assert.equal(
      again.data.state.invoices.filter(
        (i: { name: string }) => i.name === 'Integration invoice',
      ).length,
      1,
    )
    assert.equal(
      (
        await save(
          owner,
          { ...action, data: { name: 'Changed', amount: 2 } },
          key,
        )
      ).status,
      409,
    )
    assert.equal(
      (
        await save(
          owner,
          { type: 'create', collection: 'tasks', data: { name: 'Stale' } },
          randomUUID(),
          before,
        )
      ).status,
      409,
    )
  })
  await test('strict server schema rejects omitted required values and forged posted status', async () => {
    assert.equal(
      (
        await save(owner, {
          type: 'create',
          collection: 'invoices',
          data: { name: 'Missing amount' },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await save(owner, {
          type: 'create',
          collection: 'invoices',
          data: { name: 'Forged', amount: 100, status: 'Paid' },
        })
      ).status,
      400,
    )
    assert.equal(
      (await save(owner, { type: 'payroll', period: '2026-13' })).status,
      400,
    )
  })
  await test('purchase lifecycle persists stock, payable and immutable source journal', async () => {
    const p = owner.snapshot.state.products[0],
      qty = p.qty
    const email = randomUUID() + '@example.test',
      password = 'procurement-role-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Procurement', email, password, role: 'operations_manager' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    const procurement = {
      cookie: login.cookie,
      snapshot: login.data,
    } as Account
    let r = await save(procurement, {
      type: 'create',
      collection: 'orders',
      data: { name: 'Integration supplier', product: p.id, qty: 3 },
    })
    assert.equal(r.status, 200)
    const id = r.data.state.orders[0].id
    assert.equal(
      (
        await save(procurement, {
          type: 'status',
          collection: 'orders',
          id,
          status: 'Approved',
        })
      ).status,
      400,
    )
    owner.snapshot = (await call('/workspace', 'GET', undefined, owner)).data
    r = await save(owner, {
      type: 'status',
      collection: 'orders',
      id,
      status: 'Approved',
    })
    assert.equal(r.status, 200)
    owner.snapshot = r.data
    assert.equal(
      r.data.state.orders.find((order: { id: string }) => order.id === id)
        .approvedBy,
      owner.snapshot.user.email,
    )
    r = await save(owner, {
      type: 'status',
      collection: 'orders',
      id,
      status: 'Received',
    })
    assert.equal(r.status, 200)
    owner.snapshot = r.data
    assert.equal(
      r.data.state.products.find((x: { id: string }) => x.id === p.id).qty,
      qty + 3,
    )
    assert.equal(r.data.state.journals[0].source, id)
    assert.equal(
      (
        await save(owner, {
          type: 'status',
          collection: 'orders',
          id,
          status: 'Received',
        })
      ).status,
      400,
    )
  })
  await test('auditor can read its workspace and cannot mutate or create users', async () => {
    const email = randomUUID() + '@example.test',
      password = 'auditor-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Auditor', email, password, role: 'auditor' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    assert.equal(login.status, 200)
    const auditor = { cookie: login.cookie, snapshot: login.data }
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      200,
    )
    assert.equal(
      (await save(auditor, { type: 'settings', name: 'Forbidden' })).status,
      403,
    )
    assert.equal((await call('/users', 'GET', undefined, auditor)).status, 403)
    assert.equal((await call('/auth/logout', 'POST', {}, auditor)).status, 200)
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      401,
    )
  })
  await test('module roles can perform permitted actions and are denied outside their scope', async () => {
    const financeEmail = randomUUID() + '@example.test',
      employeeEmail = randomUUID() + '@example.test',
      password = 'role-password-123'
    for (const [name, email, role] of [
      ['Finance', financeEmail, 'finance_admin'],
      ['Employee', employeeEmail, 'employee'],
    ])
      assert.equal(
        (await call('/users', 'POST', { name, email, password, role }, owner))
          .status,
        201,
      )
    const financeLogin = await call('/auth/login', 'POST', {
      email: financeEmail,
      password,
    })
    const employeeLogin = await call('/auth/login', 'POST', {
      email: employeeEmail,
      password,
    })
    const finance = {
      cookie: financeLogin.cookie,
      snapshot: financeLogin.data,
    } as Account
    const employee = {
      cookie: employeeLogin.cookie,
      snapshot: employeeLogin.data,
    } as Account
    assert.equal(
      (
        await save(finance, {
          type: 'create',
          collection: 'expenses',
          data: { name: 'Role expense', amount: 10 },
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await save(finance, {
          type: 'create',
          collection: 'employees',
          data: { name: 'Denied', department: 'Ops', amount: 10 },
        })
      ).status,
      403,
    )
    employee.snapshot = (
      await call('/workspace', 'GET', undefined, employee)
    ).data
    assert.equal(employee.snapshot.state.invoices.length, 0)
    assert.equal(employee.snapshot.state.employees.length, 0)
    assert.equal(employee.snapshot.state.tasks.length > 0, true)
    assert.equal(finance.snapshot.state.employees.length, 0)
    assert.equal(
      (
        await save(employee, {
          type: 'create',
          collection: 'tasks',
          data: { name: 'My task' },
        })
      ).status,
      200,
    )
    assert.equal(
      (await call('/tax/filings', 'GET', undefined, finance)).status,
      200,
    )
    for (const path of [
      '/documents',
      '/support/tickets',
      '/tax/filings',
      '/warehouse/locations',
      '/suppliers',
    ])
      assert.equal((await call(path, 'GET', undefined, employee)).status, 403)
  })
  await test('finance admins can register tenant-scoped bank accounts', async () => {
    const email = randomUUID() + '@example.test',
      password = 'bank-role-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Bank finance', email, password, role: 'finance_admin' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    const finance = { cookie: login.cookie, snapshot: login.data } as Account
    const created = await call(
      '/banks/accounts',
      'POST',
      {
        provider: 'manual',
        externalRef: randomUUID(),
        name: 'Operating account',
        currency: 'NGN',
      },
      finance,
    )
    assert.equal(created.status, 201)
    const listed = await call('/banks/accounts', 'GET', undefined, finance)
    assert.equal(listed.status, 200)
    assert.equal(listed.data.accounts.length, 1)
    const accountId = listed.data.accounts[0].id
    const invoice = await save(finance, {
      type: 'create',
      collection: 'invoices',
      data: { name: 'Bank matching invoice', amount: 2500 },
    })
    assert.equal(invoice.status, 200)
    finance.snapshot = invoice.data
    const transaction = await call(
      `/banks/accounts/${accountId}/transactions`,
      'POST',
      {
        externalRef: randomUUID(),
        occurredAt: new Date().toISOString(),
        amount: 2500,
        direction: 'credit',
        reference: 'Customer settlement',
      },
      finance,
    )
    assert.equal(transaction.status, 201)
    assert.equal(transaction.data.match_status, 'suggested')
    assert.equal(transaction.data.matched_entity_type, 'invoice')
    const reconciled = await call(
      `/banks/accounts/${accountId}/transactions/${transaction.data.id}`,
      'PATCH',
      { matchStatus: 'matched' },
      finance,
    )
    assert.equal(reconciled.status, 200, JSON.stringify(reconciled.data))
    assert.equal(reconciled.data.invoiceSettled, true)
    const workspace = await call('/workspace', 'GET', undefined, finance)
    assert.equal(
      workspace.data.state.invoices.find(
        (item: { id: string }) => item.id === invoice.data.state.invoices[0].id,
      ).status,
      'Paid',
    )
    assert.equal(
      workspace.data.state.journals.some(
        (item: { source: string; debit: string; credit: string }) =>
          item.source === invoice.data.state.invoices[0].id &&
          item.debit === 'Cash' &&
          item.credit === 'Accounts receivable',
      ),
      true,
    )
    assert.equal(
      (
        await call(
          `/banks/accounts/${accountId}/transactions`,
          'GET',
          undefined,
          finance,
        )
      ).data.transactions[0].match_status,
      'matched',
    )
    assert.equal(
      (await call('/banks/accounts', 'GET', undefined, other)).status,
      403,
    )
  })
  await test('payroll payment batches require approval, finance authority, and an idempotency key', async () => {
    const password = 'payroll-workflow-password-123',
      hrEmail = randomUUID() + '@example.test',
      financeEmail = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Payroll HR', email: hrEmail, password, role: 'hr_admin' },
          owner,
        )
      ).status,
      201,
    )
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Payroll finance',
            email: financeEmail,
            password,
            role: 'finance_admin',
          },
          owner,
        )
      ).status,
      201,
    )
    const hrLogin = await call('/auth/login', 'POST', {
      email: hrEmail,
      password,
    })
    const financeLogin = await call('/auth/login', 'POST', {
      email: financeEmail,
      password,
    })
    const hr = { cookie: hrLogin.cookie, snapshot: hrLogin.data } as Account
    const finance = {
      cookie: financeLogin.cookie,
      snapshot: financeLogin.data,
    } as Account
    const drafted = await save(hr, { type: 'payroll', period: '2026-10' })
    assert.equal(drafted.status, 200)
    const payrollId = drafted.data.state.payroll[0].id
    const key = randomUUID()
    assert.equal(
      (
        await call(
          `/payroll/runs/${payrollId}/payment-batches`,
          'POST',
          {},
          finance,
          { 'Idempotency-Key': key },
        )
      ).status,
      400,
    )
    owner.snapshot = (await call('/workspace', 'GET', undefined, owner)).data
    const approved = await save(owner, {
      type: 'status',
      collection: 'payroll',
      id: payrollId,
      status: 'Approved',
    })
    assert.equal(approved.status, 200)
    finance.snapshot = (
      await call('/workspace', 'GET', undefined, finance)
    ).data
    assert.equal(
      (
        await call(
          `/payroll/runs/${payrollId}/payment-batches`,
          'POST',
          {},
          hr,
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
      403,
    )
    const created = await call(
      `/payroll/runs/${payrollId}/payment-batches`,
      'POST',
      {},
      finance,
      { 'Idempotency-Key': key },
    )
    assert.equal(created.status, 201)
    assert.equal(created.data.batch.status, 'pending')
    const retry = await call(
      `/payroll/runs/${payrollId}/payment-batches`,
      'POST',
      {},
      finance,
      { 'Idempotency-Key': key },
    )
    assert.equal(retry.status, 201)
    assert.equal(retry.data.batch.id, created.data.batch.id)
    assert.equal(
      (
        await call(
          `/payroll/runs/${payrollId}/payment-batches`,
          'POST',
          {},
          finance,
          { 'Idempotency-Key': randomUUID() },
        )
      ).status,
      409,
    )
  })
  await test('finance CSV exports are tenant-scoped, audited, and role-protected', async () => {
    const financeEmail = randomUUID() + '@example.test',
      password = 'export-role-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Export finance',
            email: financeEmail,
            password,
            role: 'finance_admin',
          },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', {
      email: financeEmail,
      password,
    })
    const finance = { cookie: login.cookie, snapshot: login.data } as Account
    const response = await fetch(base + '/finance/export.csv', {
      headers: { Origin: origin, Cookie: finance.cookie },
    })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /^text\/csv/)
    assert.match(
      response.headers.get('content-disposition') || '',
      /businessos-finance-report\.csv/,
    )
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(await response.text(), /Cash position/)
    const employeeEmail = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Export employee',
            email: employeeEmail,
            password,
            role: 'employee',
          },
          owner,
        )
      ).status,
      201,
    )
    const employeeLogin = await call('/auth/login', 'POST', {
      email: employeeEmail,
      password,
    })
    const employee = {
      cookie: employeeLogin.cookie,
      snapshot: employeeLogin.data,
    } as Account
    assert.equal(
      (await call('/finance/export.csv', 'GET', undefined, employee)).status,
      403,
    )
  })
  await test('decision intelligence returns scoped, explainable metrics and audits requests', async () => {
    const metrics = await call('/bi/metrics', 'GET', undefined, owner)
    assert.equal(metrics.status, 200)
    assert.equal(metrics.data.engine, 'deterministic-rules-v1')
    assert.equal(typeof metrics.data.metrics.cash, 'number')
    const answer = await call(
      '/ai/ask',
      'POST',
      { question: 'What is our cash runway?' },
      owner,
    )
    assert.equal(answer.status, 200)
    assert.equal(answer.data.engine, 'deterministic-rules-v1')
    assert.equal(answer.data.dataWindow, 'Current tenant workspace snapshot')
    assert.ok(Array.isArray(answer.data.sources))
    const forecast = await call(
      '/ai/forecast',
      'POST',
      { metric: 'cash' },
      owner,
    )
    assert.equal(forecast.status, 200)
    assert.equal(forecast.data.metric, 'cash')
    const audit = await call('/audit-logs', 'GET', undefined, owner)
    assert.ok(
      audit.data.entries.some(
        (entry: { action: string }) => entry.action === 'ai_question_asked',
      ),
    )
    const auditorEmail = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Insight auditor',
            email: auditorEmail,
            password: 'auditor-password-123',
            role: 'auditor',
          },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', {
      email: auditorEmail,
      password: 'auditor-password-123',
    })
    const auditor = { cookie: login.cookie, snapshot: login.data } as Account
    assert.equal(
      (await call('/ai/ask', 'POST', { question: 'What is cash?' }, auditor))
        .status,
      403,
    )
  })
  await test('owner disables and restores auditor without reviving old sessions', async () => {
    const email = randomUUID() + '@example.test',
      password = 'access-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Access auditor', email, password, role: 'auditor' },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', { email, password })
    assert.equal(login.status, 200)
    const auditor: Account = { cookie: login.cookie, snapshot: login.data },
      id = auditor.snapshot.user.id
    const members = await call('/users', 'GET', undefined, owner)
    assert.equal(
      members.data.users.find((u: { id: string }) => u.id === id).active,
      true,
    )
    assert.equal(
      (
        await call(
          '/users/' + owner.snapshot.user.id + '/access',
          'PATCH',
          { active: false },
          owner,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await call(
          '/users/' + id + '/access',
          'PATCH',
          { active: false },
          other,
        )
      ).status,
      404,
    )
    assert.equal(
      (
        await call(
          '/users/' + id + '/access',
          'PATCH',
          { active: false },
          auditor,
        )
      ).status,
      403,
    )
    assert.equal(
      (
        await call(
          '/users/' + id + '/access',
          'PATCH',
          { active: false },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      401,
    )
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      401,
    )
    assert.equal(
      (await call('/users/' + id + '/access', 'PATCH', { active: true }, owner))
        .status,
      200,
    )
    assert.equal(
      (await call('/workspace', 'GET', undefined, auditor)).status,
      401,
    )
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      200,
    )
  })
  await test('password change and sign-out-everywhere revoke every previous session', async () => {
    const email = randomUUID() + '@example.test',
      password = 'previous-password-123',
      newPassword = 'replacement-password-123'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          { name: 'Security auditor', email, password, role: 'auditor' },
          owner,
        )
      ).status,
      201,
    )
    const first = await call('/auth/login', 'POST', { email, password }),
      second = await call('/auth/login', 'POST', { email, password })
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    const a: Account = { cookie: first.cookie, snapshot: first.data },
      b: Account = { cookie: second.cookie, snapshot: second.data }
    assert.equal(
      (
        await call(
          '/auth/password',
          'POST',
          { currentPassword: 'incorrect', newPassword },
          a,
        )
      ).status,
      400,
    )
    assert.equal((await call('/workspace', 'GET', undefined, b)).status, 200)
    assert.equal(
      (
        await call(
          '/auth/password',
          'POST',
          { currentPassword: password, newPassword },
          a,
        )
      ).status,
      200,
    )
    assert.equal((await call('/workspace', 'GET', undefined, a)).status, 401)
    assert.equal((await call('/workspace', 'GET', undefined, b)).status, 401)
    assert.equal(
      (await call('/auth/login', 'POST', { email, password })).status,
      401,
    )
    const fresh = await call('/auth/login', 'POST', {
      email,
      password: newPassword,
    })
    assert.equal(fresh.status, 200)
    const signedIn: Account = { cookie: fresh.cookie, snapshot: fresh.data }
    assert.equal(
      (await call('/auth/revoke-sessions', 'POST', {}, signedIn)).status,
      200,
    )
    assert.equal(
      (await call('/workspace', 'GET', undefined, signedIn)).status,
      401,
    )
  })
  await test('concurrent writes cannot both commit the same workspace version', async () => {
    owner.snapshot = (await call('/workspace', 'GET', undefined, owner)).data
    const result = await Promise.all([
      save(owner, {
        type: 'create',
        collection: 'tasks',
        data: { name: 'Concurrent A' },
      }),
      save(owner, {
        type: 'create',
        collection: 'tasks',
        data: { name: 'Concurrent B' },
      }),
    ])
    assert.deepEqual(result.map((r) => r.status).sort(), [200, 409])
    owner.snapshot = result.find((r) => r.status === 200)!.data
  })

  await test('module records are tenant-scoped and have an audited lifecycle', async () => {
    const initial = await call('/modules/billing', 'GET', undefined, owner)
    assert.equal(initial.status, 200)
    assert.ok(initial.data.records.length >= 3)
    const created = await call(
      '/modules/billing',
      'POST',
      { name: 'Integration plan', detail: 'Plan usage', status: 'Draft' },
      owner,
    )
    assert.equal(created.status, 201)
    const id = created.data.id
    assert.equal(
      (await call('/modules/billing?q=Integration', 'GET', undefined, owner))
        .data.records.length,
      1,
    )
    assert.equal(
      (
        await call(
          '/modules/billing/' + id,
          'PATCH',
          { status: 'Active' },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/modules/billing/' + id, 'DELETE', undefined, other)).status,
      404,
    )
    assert.equal(
      (await call('/modules/billing/' + id, 'DELETE', undefined, owner)).status,
      200,
    )
    assert.equal(
      (await call('/modules/billing?q=Integration', 'GET', undefined, owner))
        .data.records.length,
      0,
    )
    const email = randomUUID() + '@example.test'
    assert.equal(
      (
        await call(
          '/users',
          'POST',
          {
            name: 'Module finance',
            email,
            password: 'module-finance-password',
            role: 'finance_admin',
          },
          owner,
        )
      ).status,
      201,
    )
    const login = await call('/auth/login', 'POST', {
      email,
      password: 'module-finance-password',
    })
    const finance = { cookie: login.cookie, snapshot: login.data } as Account
    assert.equal(
      (await call('/modules/billing', 'GET', undefined, finance)).status,
      200,
    )
    assert.equal(
      (await call('/modules/admin', 'GET', undefined, finance)).status,
      403,
    )
  })

  await test('document metadata is validated, tenant-scoped, and archived instead of deleted', async () => {
    const created = await call(
      '/documents',
      'POST',
      { filename: 'policy.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
      owner,
    )
    assert.equal(created.status, 201)
    assert.match(created.data.storageKey, /\/policy\.pdf$/)
    const id = created.data.id
    assert.equal(
      (await call('/documents/' + id, 'PATCH', { status: 'archived' }, owner))
        .status,
      200,
    )
    assert.equal(
      (await call('/documents/' + id, 'PATCH', { status: 'archived' }, other))
        .status,
      404,
    )
    const listed = await call('/documents', 'GET', undefined, owner)
    assert.equal(listed.status, 200)
    assert.equal(
      listed.data.documents.find(
        (document: { id: string }) => document.id === id,
      ).status,
      'archived',
    )
  })

  await test('support tickets and tax filings enforce audited state transitions', async () => {
    const ticket = await call(
      '/support/tickets',
      'POST',
      {
        subject: 'Delivery update',
        customer: 'Northstar',
        priority: 'high',
        slaDueAt: null,
      },
      owner,
    )
    assert.equal(ticket.status, 201)
    assert.equal(
      (
        await call(
          '/support/tickets/' + ticket.data.id,
          'PATCH',
          { status: 'resolved' },
          owner,
        )
      ).status,
      200,
    )
    const filing = await call(
      '/tax/filings',
      'POST',
      {
        name: 'VAT September',
        territory: 'Nigeria',
        dueDate: '2026-09-21',
        amount: 5000,
      },
      owner,
    )
    assert.equal(filing.status, 201)
    assert.equal(
      (
        await call(
          '/tax/filings/' + filing.data.id,
          'PATCH',
          { status: 'ready' },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/support/tickets', 'GET', undefined, other)).status,
      200,
    )
    assert.equal(
      (await call('/tax/filings', 'GET', undefined, other)).status,
      200,
    )
  })

  await test('warehouse locations and suppliers enforce tenant-scoped operations', async () => {
    const location = await call(
      '/warehouse/locations',
      'POST',
      { name: 'Main warehouse', code: 'WH-01' },
      owner,
    )
    assert.equal(location.status, 201)
    assert.equal(
      (
        await call(
          '/warehouse/locations/' + location.data.id,
          'PATCH',
          { status: 'inactive' },
          owner,
        )
      ).status,
      200,
    )
    const supplier = await call(
      '/suppliers',
      'POST',
      { name: 'Kora Imports', contact: 'ops@kora.test', leadDays: 14 },
      owner,
    )
    assert.equal(supplier.status, 201)
    assert.equal(
      (
        await call(
          '/suppliers/' + supplier.data.id,
          'PATCH',
          { status: 'review' },
          owner,
        )
      ).status,
      200,
    )
    assert.equal(
      (await call('/warehouse/locations', 'GET', undefined, other)).status,
      200,
    )
    assert.equal(
      (await call('/suppliers', 'GET', undefined, other)).status,
      200,
    )
  })

  await test('password recovery issues a single-use reset and revokes sessions', async () => {
    process.env.RETURN_RESET_TOKEN = 'true'
    const requested = await call('/auth/password-reset/request', 'POST', {
      email: owner.snapshot.user.email,
    })
    assert.equal(requested.status, 200)
    assert.ok(requested.data.developmentToken)
    const reset = await call('/auth/password-reset/confirm', 'POST', {
      token: requested.data.developmentToken,
      newPassword: 'recovered-password-123',
    })
    assert.equal(reset.status, 200)
    assert.equal(
      (await call('/workspace', 'GET', undefined, owner)).status,
      401,
    )
    assert.equal(
      (
        await call('/auth/login', 'POST', {
          email: owner.snapshot.user.email,
          password: 'recovered-password-123',
        })
      ).status,
      200,
    )
    assert.equal(
      (
        await call('/auth/password-reset/confirm', 'POST', {
          token: requested.data.developmentToken,
          newPassword: 'another-password-123',
        })
      ).status,
      400,
    )
    delete process.env.RETURN_RESET_TOKEN
  })

  await test('PostgreSQL FORCE RLS and ledger triggers enforce isolation and append-only writes', async () => {
    const roles = await app.store.pool.query(
      'SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
    assert.equal(roles.rows[0].rolsuper, false)
    assert.equal(roles.rows[0].rolbypassrls, false)
    const a = (
      await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1', [
        owner.snapshot.user.id,
      ])
    ).rows[0].tenant_id
    const b = (
      await app.store.pool.query('SELECT tenant_id FROM users WHERE id=$1', [
        other.snapshot.user.id,
      ])
    ).rows[0].tenant_id
    await app.store.tenant(a, async (c) => {
      assert.equal(
        (await c.query('SELECT * FROM tenants WHERE id=$1', [b])).rowCount,
        0,
      )
    })
    await assert.rejects(
      app.store.tenant(a, (c) =>
        c.query('DELETE FROM journals WHERE tenant_id=$1', [a]),
      ),
      /append-only/,
    )
    await assert.rejects(
      app.store.tenant(a, (c) =>
        c.query("UPDATE audit SET payload='{}' WHERE tenant_id=$1", [a]),
      ),
      /append-only/,
    )
    assert.equal(
      (await app.store.pool.query('SELECT * FROM tenants')).rowCount,
      0,
    )
  })
} finally {
  await app.close()
}

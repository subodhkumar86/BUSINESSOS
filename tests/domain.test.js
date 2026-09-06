import test from 'node:test'
import assert from 'node:assert/strict'
import { seed, transition, metrics } from '../src/domain.ts'
const create = (s, collection, data) =>
  transition(s, { type: 'create', collection, data })
const status = (s, collection, id, value) =>
  transition(s, { type: 'status', collection, id, status: value })
test('purchase approval and receipt update stock and AP exactly once', () => {
  const original = seed()
  let s = create(original, 'orders', {
    name: 'Supplier',
    product: 'p2',
    qty: 10,
  })
  const id = s.orders[0].id
  assert.throws(() => status(s, 'orders', id, 'Received'))
  s = status(s, 'orders', id, 'Approved')
  assert.equal(s.orders[0].requestedBy, 'Local workspace owner')
  assert.equal(s.orders[0].approvedBy, 'Local workspace owner')
  assert.match(s.orders[0].approvedAt, /^\d{4}-\d{2}-\d{2}T/)
  s = status(s, 'orders', id, 'Received')
  assert.equal(s.products.find((p) => p.id === 'p2').qty, 15)
  assert.equal(metrics(s).payables, 420000)
  assert.deepEqual(
    [s.journals[0].debit, s.journals[0].credit, s.journals[0].amount],
    ['Inventory', 'Accounts payable', 420000],
  )
  assert.throws(() => status(s, 'orders', id, 'Received'))
  assert.equal(original.products.find((p) => p.id === 'p2').qty, 5)
  assert.equal(s.audit.length, 3)
})
test('invoice collection changes cash and receivables without duplicate collection', () => {
  let s = create(seed(), 'invoices', {
    name: 'Test customer',
    amount: 1000,
    status: 'Unpaid',
  })
  const id = s.invoices[0].id,
    before = metrics(s)
  s = status(s, 'invoices', id, 'Paid')
  assert.equal(metrics(s).cash, before.cash + 1000)
  assert.equal(metrics(s).receivables, before.receivables - 1000)
  assert.throws(() => status(s, 'invoices', id, 'Paid'))
  assert.equal(s.journals.length, 2)
})
test('payroll snapshots inputs, rejects duplicate period and accrues without payment', () => {
  let s = transition(seed(), { type: 'payroll', period: '2026-09' })
  const id = s.payroll[0].id,
    cash = metrics(s).cash
  s = create(s, 'employees', {
    name: 'New hire',
    department: 'Sales',
    amount: 100000,
  })
  assert.equal(s.payroll[0].amount, 630000)
  assert.equal(s.payroll[0].inputs.length, 2)
  s = status(s, 'payroll', id, 'Approved')
  assert.equal(s.payroll[0].preparedBy, 'Local workspace owner')
  assert.equal(s.payroll[0].approvedBy, 'Local workspace owner')
  assert.equal(metrics(s).cash, cash)
  assert.throws(() => transition(s, { type: 'payroll', period: '2026-09' }))
  assert.throws(() => status(s, 'payroll', id, 'Approved'))
})
test('invalid amounts and quantities never mutate state', () => {
  const s = seed(),
    before = JSON.stringify(s)
  for (const amount of [-1, 0, 'abc', Infinity])
    assert.throws(() => create(s, 'expenses', { name: 'Invalid', amount }))
  assert.throws(() =>
    create(s, 'orders', { name: 'Supplier', product: 'p1', qty: 1.5 }),
  )
  assert.throws(() =>
    create(s, 'products', {
      name: 'Duplicate',
      sku: 'WK-001',
      qty: 1,
      cost: 10,
      min: 0,
    }),
  )
  assert.equal(JSON.stringify(s), before)
})
test('expense posting affects cash and audit with balanced account pair', () => {
  const s = seed(),
    next = create(s, 'expenses', { name: 'Delivery', amount: 5000 })
  assert.equal(metrics(next).cash, metrics(s).cash - 5000)
  assert.equal(next.journals[0].debit, 'Operating expenses')
  assert.equal(next.journals[0].credit, 'Cash')
  assert.equal(next.audit[0].entity, 'expenses')
  assert.ok(next.audit[0].date)
})
test('won and lost opportunities are excluded from open pipeline', () => {
  let s = seed(),
    before = metrics(s).pipeline
  s = status(s, 'leads', 'l1', 'Won')
  assert.equal(metrics(s).pipeline, before - 1450000)
  assert.throws(() => status(s, 'leads', 'l1', 'Invalid'))
})

test('required fields, forged statuses and invalid payroll periods are rejected', () => {
  const s = seed()
  assert.throws(() => create(s, 'invoices', { name: 'Missing amount' }))
  assert.throws(() =>
    create(s, 'invoices', { name: 'Forged', amount: 100, status: 'Paid' }),
  )
  assert.throws(() =>
    create(s, 'employees', { name: 'Missing department', amount: 100 }),
  )
  assert.throws(() => transition(s, { type: 'payroll', period: '2026-13' }))
})
test('journal source links to the invoice rather than the collection action', () => {
  let s = create(seed(), 'invoices', {
    name: 'Traceable',
    amount: 100,
    status: 'Unpaid',
  })
  const id = s.invoices[0].id
  assert.equal(s.journals[0].source, id)
  s = status(s, 'invoices', id, 'Paid')
  assert.equal(s.journals[0].source, id)
})

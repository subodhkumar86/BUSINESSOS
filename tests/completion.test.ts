import { validateProductionUpdate, depreciation } from '../server/operational-rules.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  seed,
  transition,
  generateIncomeStatement,
  generateBalanceSheet,
  generateCashFlowStatement,
  calculateStatutoryPayroll,
  generatePayslips,
} from '../src/domain.ts'
import {
  verifyBankSignature,
  normalizeBankEvent,
} from '../server/bank-webhooks.ts'
import { reportingPeriod } from '../src/reporting.ts'

test('period reports carry forward cash and retain cumulative equity without including future postings', () => {
  const state = seed()
  state.openingCash = 100
  state.journals = [
    { id:'1', date:'2026-08-31T23:59:59Z', source:'a', amount:500, debit:'Cash', credit:'Sales' },
    { id:'2', date:'2026-09-01T00:00:00Z', source:'b', amount:120, debit:'Accounts receivable', credit:'Sales' },
    { id:'3', date:'2026-09-30T23:59:59Z', source:'c', amount:20, debit:'Operating expenses', credit:'Cash' },
    { id:'4', date:'2026-10-01T00:00:00Z', source:'d', amount:900, debit:'Cash', credit:'Sales' },
  ]
  const period = {from:'2026-09-01',to:'2026-09-30'}
  assert.equal(generateIncomeStatement(state,period).netProfit,100)
  const cash = generateCashFlowStatement(state,period)
  assert.equal(cash.openingCash,600)
  assert.equal(cash.closingCash,580)
  const balance = generateBalanceSheet(state,period)
  assert.equal(balance.assets.cash,580)
  assert.equal(balance.equity.retainedEarnings,600)
  assert.equal(balance.isBalanced,true)
  assert.equal(generateIncomeStatement(state,{from:'2027-01-01'}).revenue,0)
  assert.equal(generateCashFlowStatement(state,{from:'2027-01-01'}).openingCash,1480)
  for (const invalid of [{from:'2026-02-30'},{to:'bad'},{from:'2026-10-01',to:'2026-09-01'}])
    assert.equal(reportingPeriod.safeParse(invalid).success,false)
})

test('journal statements distinguish stock purchases, revenue, collections and payroll', () => {
  let state = seed()
  state = transition(state, {
    type: 'create',
    collection: 'invoices',
    data: { name: 'Customer', amount: 1000 },
  })
  const invoice = state.invoices[0].id
  state = transition(state, {
    type: 'create',
    collection: 'orders',
    data: { name: 'Supplier', product: 'p1', qty: 2 },
  })
  const order = state.orders[0].id
  state = transition(state, {
    type: 'status',
    collection: 'orders',
    id: order,
    status: 'Approved',
  })
  state = transition(state, {
    type: 'status',
    collection: 'orders',
    id: order,
    status: 'Received',
  })
  assert.equal(generateIncomeStatement(state).cogs, 0)
  assert.equal(generateIncomeStatement(state).netProfit, 1000)
  assert.equal(generateBalanceSheet(state).isBalanced, true)
  state = transition(state, {
    type: 'status',
    collection: 'invoices',
    id: invoice,
    status: 'Paid',
  })
  assert.equal(generateIncomeStatement(state).revenue, 1000)
  assert.equal(generateCashFlowStatement(state).netCashFlow, 1000)
  state = transition(state, { type: 'payroll', period: '2026-09' })
  assert.equal(generateIncomeStatement(state).netProfit, 1000)
  state = transition(state, {
    type: 'status',
    collection: 'payroll',
    id: state.payroll[0].id,
    status: 'Approved',
  })
  assert.equal(generateBalanceSheet(state).isBalanced, true)
  assert.equal(generateIncomeStatement(state).operatingExpenses, 693000)
  assert.equal(generateCashFlowStatement(state).netCashFlow, 1000)
  state.journals.push({
    id: 'unknown',
    date: '2026-09-01',
    source: 'test',
    debit: 'Unclassified asset',
    credit: 'Cash',
    amount: 10,
  })
  assert.equal(generateBalanceSheet(state).isBalanced, false)
})
test('fulfillment reduces stock once and posts a matching COGS entry', () => {
  let state = seed()
  const before = state.products.find((product) => product.id === 'p1')!
  state = transition(state, { type: 'stock_fulfill', data: { product: 'p1', quantity: 3, expectedQty: before.qty, reference: 'SO-9001' } })
  assert.equal(state.products.find((product) => product.id === 'p1')!.qty, before.qty - 3)
  assert.equal(state.stockMovements[0].kind, 'fulfillment')
  assert.equal(state.stockMovements[0].valueDelta, -3 * before.cost)
  assert.equal(generateIncomeStatement(state).cogs, 3 * before.cost)
  assert.equal(generateBalanceSheet(state).isBalanced, true)
  assert.throws(() => transition(state, { type: 'stock_fulfill', data: { product: 'p1', quantity: 99, expectedQty: before.qty - 3, reference: 'SO-9002' } }))
})
test('2026 payroll has progressive bands, pension, preserved inputs and no draft payslips', () => {
  assert.equal(calculateStatutoryPayroll(70000).payeTax, 0)
  const calc = calculateStatutoryPayroll(350000)
  assert.equal(calc.employeePension, 28000)
  assert.equal(calc.employerPension, 35000)
  assert.equal(calc.payeTax, 40460)
  assert.equal(calc.netSalary, 281540)
  for (const bad of [-1, Infinity, NaN])
    assert.throws(() => calculateStatutoryPayroll(bad))
  let state = transition(seed(), { type: 'payroll', period: '2026-09' })
  const id = state.payroll[0].id
  assert.deepEqual(generatePayslips(state, id), [])
  state = transition(state, {
    type: 'status',
    collection: 'payroll',
    id,
    status: 'Approved',
  })
  const before = generatePayslips(state, id)
  state.employees[0].amount = 1
  assert.deepEqual(generatePayslips(state, id), before)
})
test('webhooks verify exact raw bytes and reject forged, missing and wrong-provider signatures', () => {
  const raw = Buffer.from(
      '{"event":"charge.success","data":{"id":1,"amount":12345,"currency":"NGN","reference":"order-1","paid_at":"2026-09-01T00:00:00Z"}}',
    ),
    secret = 'test-secret-only-12345678901234567890'
  const signature = createHmac('sha512', secret).update(raw).digest('hex')
  assert.equal(verifyBankSignature('paystack', raw, signature, secret), true)
  assert.equal(
    verifyBankSignature(
      'paystack',
      Buffer.concat([raw, Buffer.from(' ')]),
      signature,
      secret,
    ),
    false,
  )
  assert.equal(verifyBankSignature('paystack', raw, undefined, secret), false)
  assert.equal(verifyBankSignature('mono', raw, signature, secret), false)
  assert.equal(
    normalizeBankEvent('paystack', JSON.parse(raw.toString()))?.amount,
    123.45,
  )
  assert.equal(
    normalizeBankEvent('paystack', { event: 'charge.failed', data: {} }),
    null,
  )
  assert.throws(() =>
    normalizeBankEvent('mock', { event: 'transaction', data: { amount: 0 } }),
  )
})

test('production completion requires quantity and stage evidence; depreciation is capped',()=>{
 const current={status:'running',planned_qty:10,completed_qty:5,defect_count:1}
 assert.throws(()=>validateProductionUpdate(current,{status:'completed'}))
 assert.throws(()=>validateProductionUpdate(current,{completedQty:11}))
 assert.throws(()=>validateProductionUpdate(current,{defectCount:6}))
 assert.doesNotThrow(()=>validateProductionUpdate({...current,status:'qa_check'},{status:'completed',completedQty:10}))
 assert.deepEqual(depreciation(10000,20,2),{accumulated:4000,bookValue:6000})
 assert.deepEqual(depreciation(10000,20,10),{accumulated:10000,bookValue:0})
 assert.throws(()=>depreciation(10000,101,1))
})

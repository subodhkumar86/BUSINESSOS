import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestReconciliation } from '../server/reconciliation.ts'

const sources = [
  { id: 'invoice-a', type: 'invoice' as const, amount: 50000, label: 'Northstar Limited' },
  { id: 'expense-a', type: 'expense' as const, amount: 18000, label: 'Office Internet' },
]

test('reconciliation suggests a unique amount match for finance review', () => {
  const suggestion = suggestReconciliation(
    { amount: 50000, direction: 'credit', reference: 'transfer received' },
    sources,
  )
  assert.equal(suggestion?.source.id, 'invoice-a')
  assert.equal(suggestion?.confidence, 70)
})

test('reconciliation raises confidence when the reference supports the source', () => {
  const suggestion = suggestReconciliation(
    { amount: 50000, direction: 'credit', reference: 'Northstar Limited settlement' },
    sources,
  )
  assert.equal(suggestion?.confidence, 95)
  assert.match(suggestion?.reason || '', /matching reference/i)
})

test('reconciliation leaves ambiguous exact-amount candidates unmatched', () => {
  const suggestion = suggestReconciliation(
    { amount: 50000, direction: 'credit', reference: 'transfer received' },
    [...sources, { id: 'invoice-b', type: 'invoice', amount: 50000, label: 'Greenfield Studio' }],
  )
  assert.equal(suggestion, null)
})

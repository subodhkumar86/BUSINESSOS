import test from 'node:test'
import assert from 'node:assert/strict'
import { pdfReport } from '../server/pdf.ts'
import { chainInput, approvalDecision } from '../server/approvals.ts'
import { deliveryAdapter, signDelivery } from '../server/notify.ts'
test('PDF export starts with a valid header and embeds statement values', () => {
  const pdf = pdfReport('BusinessOS Financial Report', [{ label: 'Net profit', value: '1234' }], { tenant: 'Acme', actor: 'owner@test', period: 'all' })
  assert.match(pdf.subarray(0, 5).toString(), /%PDF-/)
  assert.ok(pdf.includes(Buffer.from('Net profit')))
})
test('approval chains require steps and decisions require a verdict', () => {
  assert.equal(chainInput.safeParse({ name: 'PO', scope: 'purchase_order', steps: [{ role: 'owner' }] }).success, true)
  assert.equal(chainInput.safeParse({ name: 'PO', scope: 'purchase_order', steps: [] }).success, false)
  assert.equal(approvalDecision.safeParse({ version: 1, decision: 'approve' }).success, true)
  assert.equal(approvalDecision.safeParse({ version: 0, decision: 'maybe' }).success, false)
})
test('delivery adapter exposes provider and signs queued messages', () => {
  assert.ok(deliveryAdapter().provider.length > 0)
  assert.equal(signDelivery('abc').length, 64)
})

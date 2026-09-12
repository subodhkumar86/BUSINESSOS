import test from 'node:test'
import assert from 'node:assert/strict'
import { pdfReport } from '../server/pdf.ts'
import { chainInput, approvalDecision } from '../server/approvals.ts'
import { deliveryAdapter, deliverMessage, signDelivery } from '../server/notify.ts'
import { newMfaSecret, mfaCode, verifyMfaCode } from '../server/mfa.ts'
import { globalSearch } from '../server/search.ts'
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
test('delivery never claims success when no external provider is configured', async () => {
  const result = await deliverMessage({ id: 'message-1', tenant_id: 'tenant-1', channel: 'email', recipient: 'ops@example.test', subject: '', body: 'Hello', attempts: 0 })
  assert.equal(result.status, 'failed')
  assert.match(result.error, /NOTIFY_PROVIDER=webhook/)
})
test('MFA codes verify within clock skew and reject forgeries', () => {
  const secret = newMfaSecret()
  const code = mfaCode(secret)
  assert.equal(verifyMfaCode(secret, code), true)
  assert.equal(verifyMfaCode(secret, '000000'), code === '000000')
})
test('global search requires two characters and stays scoped to workspace records', () => {
  const state = { products: [{ id: 'p1', name: 'Keyboard' }], invoices: [], leads: [], employees: [], projects: [], tasks: [] }
  assert.deepEqual(globalSearch(state, 'x'), [])
  assert.equal(globalSearch(state, 'keyb')[0].kind, 'product')
})

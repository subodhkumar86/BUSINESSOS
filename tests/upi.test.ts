import test from 'node:test'
import assert from 'node:assert/strict'
import { upiIntent, upiReceipt } from '../server/upi.ts'
const payee = { vpa: 'merchant@bank', name: 'Acme & Sons' }
const invoice = {
  id: '12345678-1234-4234-8234-123456789012',
  name: 'A & B',
  amount: 12.5,
}
test('manual UPI receipts require bank verification, exact precision and a normalised bank reference', () => {
  const input = {
    invoiceId: invoice.id,
    amount: 12.5,
    reference: ' abc123456 ',
    receivedAt: '2026-01-01T10:00:00Z',
    verifiedInBank: true,
  }
  assert.equal(upiReceipt.parse(input).reference, 'ABC123456')
  for (const changes of [
    { verifiedInBank: false },
    { verifiedInBank: undefined },
    { amount: 1.001 },
    { amount: -1 },
    { reference: 'bad ref' },
    { reference: 'abc' },
    { receivedAt: 'yesterday' },
    { tenant: 'forged' },
  ])
    assert.equal(upiReceipt.safeParse({ ...input, ...changes }).success, false)
})
test('UPI intent encodes payee and binds amount, INR currency and invoice reference', () => {
  const url = new URL(upiIntent(payee, invoice, 'INR'))
  assert.equal(url.protocol, 'upi:')
  assert.equal(url.searchParams.get('pn'), payee.name)
  assert.equal(url.searchParams.get('tn'), 'Invoice A & B')
  assert.equal(url.searchParams.get('am'), '12.50')
  assert.equal(url.searchParams.get('cu'), 'INR')
  assert.equal(url.searchParams.get('tr'), invoice.id.replaceAll('-', ''))
})
test('UPI rejects other currencies, malformed payees and invalid precision or amount', () => {
  assert.throws(() => upiIntent(payee, invoice, 'NGN'))
  assert.throws(() =>
    upiIntent({ ...payee, vpa: 'javascript:alert(1)' }, invoice, 'INR'),
  )
  for (const amount of [0, -1, NaN, Infinity, 1.001])
    assert.throws(() => upiIntent(payee, { ...invoice, amount }, 'INR'))
})

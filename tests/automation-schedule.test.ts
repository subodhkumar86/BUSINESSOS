import test from 'node:test'
import assert from 'node:assert/strict'
import { nextStockRun } from '../server/automation-schedule.ts'
test('stock schedule calculates explicit hourly and daily UTC eligibility and supports disabling', () => {
  const now = Date.parse('2026-10-25T23:30:00Z')
  assert.equal(nextStockRun('off', now), null)
  assert.equal(nextStockRun('hourly', now), '2026-10-26T00:30:00.000Z')
  assert.equal(nextStockRun('daily', now), '2026-10-26T23:30:00.000Z')
})
test('deferred scheduled work becomes eligible in one minute without waiting a full interval', () => {
  const now = Date.parse('2026-10-25T23:59:30Z')
  assert.equal(nextStockRun('daily', now, true), '2026-10-26T00:00:30.000Z')
  assert.equal(nextStockRun('off', now, true), null)
})

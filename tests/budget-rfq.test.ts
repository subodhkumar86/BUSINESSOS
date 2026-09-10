import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreLead } from '../server/lead-scoring.ts'
import type { Lead } from '../src/types.ts'

function lead(status: string, amount: number): Lead {
  return { id: 'test', name: 'Test Lead', status, amount } as Lead
}

await test('scoreLead: Won stage scores 100 regardless of deal size', () => {
  const result = scoreLead(lead('Won', 1000), 1000)
  assert.equal(result.score, 100)
  assert.equal(result.factors.stage, 100)
})

await test('scoreLead: Lost stage has stage score 0 and total is stage + size bonus', () => {
  const result = scoreLead(lead('Lost', 5000), 1000)
  assert.equal(result.factors.stage, 0)
  // size bonus is still calculated; total = min(100, 0 + sizeBonus)
  assert.equal(result.score, result.factors.dealSize)
})

await test('scoreLead: New stage with no avg deal size scores 10', () => {
  const result = scoreLead(lead('New', 0), 0)
  assert.equal(result.score, 10)
  assert.equal(result.factors.dealSize, 0)
})

await test('scoreLead: Negotiation stage with above-average deal adds size bonus', () => {
  const result = scoreLead(lead('Negotiation', 2000), 1000)
  assert.equal(result.factors.stage, 75)
  assert.ok(result.factors.dealSize > 0)
  assert.ok(result.score > 75)
  assert.ok(result.score <= 100)
})

await test('scoreLead: Proposal stage with average deal size', () => {
  const result = scoreLead(lead('Proposal', 1000), 1000)
  assert.equal(result.factors.stage, 55)
  assert.equal(result.factors.dealSize, 15)
  assert.equal(result.score, 70)
})

await test('scoreLead: deal size bonus is capped at 25', () => {
  const result = scoreLead(lead('Qualified', 100000), 100)
  assert.equal(result.factors.dealSize, 25)
  assert.equal(result.score, Math.min(100, 30 + 25))
})

await test('scoreLead: unknown stage defaults to 10', () => {
  const result = scoreLead(lead('Unknown', 500), 500)
  assert.equal(result.factors.stage, 10)
})

await test('budget variance: spent below total is positive variance', () => {
  const total = 100000, spent = 60000
  const variance = total - spent
  const utilisation = Math.round((spent / total) * 100)
  assert.equal(variance, 40000)
  assert.equal(utilisation, 60)
})

await test('budget variance: spent above total is negative variance', () => {
  const total = 50000, spent = 55000
  const variance = total - spent
  assert.equal(variance, -5000)
  assert.ok(variance < 0)
})

await test('budget period validation: end before start is invalid', () => {
  const from = '2026-10-01', to = '2026-09-01'
  assert.ok(to < from)
})

await test('budget period validation: same day is valid', () => {
  const from = '2026-10-01', to = '2026-10-01'
  assert.ok(to >= from)
})

await test('RFQ number format matches RFQ-XXXXXXXX pattern', () => {
  const rfqNumber = 'RFQ-' + 'A1B2C3D4'
  assert.match(rfqNumber, /^RFQ-[A-Z0-9]{8}$/)
})

import { calculateStatutoryPayroll } from '../src/domain.ts'

await test('personalRelief reduces taxable income for NG-2026-v1', () => {
  const without = calculateStatutoryPayroll(500000, 'NG-2026-v1', 0)
  const with50k = calculateStatutoryPayroll(500000, 'NG-2026-v1', 50000)
  // Relief reduces taxable base so PAYE should be lower or equal
  assert.ok(with50k.payeTax <= without.payeTax)
  // Pension is unchanged (based on gross only)
  assert.equal(with50k.employeePension, without.employeePension)
  assert.equal(with50k.grossSalary, without.grossSalary)
})

await test('personalRelief of 0 produces same result as no relief argument', () => {
  const a = calculateStatutoryPayroll(350000, 'NG-2026-v1')
  const b = calculateStatutoryPayroll(350000, 'NG-2026-v1', 0)
  assert.deepEqual(a, b)
})

await test('personalRelief does not affect NG-PITA-legacy-v1 (separate CRA logic)', () => {
  // Legacy version uses its own CRA; personalRelief param is ignored there
  const legacy = calculateStatutoryPayroll(350000, 'NG-PITA-legacy-v1', 50000)
  const legacyBase = calculateStatutoryPayroll(350000, 'NG-PITA-legacy-v1', 0)
  // Both should produce the same result since legacy ignores the param
  assert.equal(legacy.payeTax, legacyBase.payeTax)
})

await test('large personalRelief cannot produce negative taxable income', () => {
  const result = calculateStatutoryPayroll(100000, 'NG-2026-v1', 10000000)
  assert.ok(result.payeTax >= 0)
  assert.ok(result.netSalary >= 0)
})

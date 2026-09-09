import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateVAT,
  calculateWHT,
  determineCompanyScale,
  calculateCIT,
} from '../src/tax.ts'

test('VAT exclusive calculation applies exact 7.5% rate', () => {
  const result = calculateVAT(100000)
  assert.equal(result.baseAmount, 100000)
  assert.equal(result.vatAmount, 7500)
  assert.equal(result.totalAmount, 107500)
  assert.equal(result.effectiveRate, 0.075)
})

test('VAT inclusive calculation back-calculates net base and VAT', () => {
  const result = calculateVAT(107500, true)
  assert.equal(result.baseAmount, 100000)
  assert.equal(result.vatAmount, 7500)
  assert.equal(result.totalAmount, 107500)
})

test('WHT deduction reflects correct statutory category rates', () => {
  // 5% on contracts and supplies
  const supplyWht = calculateWHT(200000, 'contracts_supplies')
  assert.equal(supplyWht.whtRate, 0.05)
  assert.equal(supplyWht.whtDeducted, 10000)
  assert.equal(supplyWht.netPayable, 190000)

  // 10% on professional consultancy
  const profWht = calculateWHT(500000, 'consultancy_professional')
  assert.equal(profWht.whtRate, 0.1)
  assert.equal(profWht.whtDeducted, 50000)
  assert.equal(profWht.netPayable, 450000)
})

test('Company income tax categorizes turnover and computes liability', () => {
  // Small business exemption (< 25m turnover) -> 0% CIT
  assert.equal(determineCompanyScale(15_000_000), 'small')
  const smallCit = calculateCIT(15_000_000, 3_000_000)
  assert.equal(smallCit.scale, 'small')
  assert.equal(smallCit.citRate, 0.0)
  assert.equal(smallCit.citPayable, 0)

  // Medium business (25m - 100m turnover) -> 20% CIT
  assert.equal(determineCompanyScale(45_000_000), 'medium')
  const mediumCit = calculateCIT(45_000_000, 10_000_000)
  assert.equal(mediumCit.scale, 'medium')
  assert.equal(mediumCit.citRate, 0.2)
  assert.equal(mediumCit.citPayable, 2_000_000)

  // Large business (> 100m turnover) -> 30% CIT
  assert.equal(determineCompanyScale(250_000_000), 'large')
  const largeCit = calculateCIT(250_000_000, 50_000_000)
  assert.equal(largeCit.scale, 'large')
  assert.equal(largeCit.citRate, 0.3)
  assert.equal(largeCit.citPayable, 15_000_000)
})

test('Invalid tax inputs are rejected with validation error', () => {
  for (const bad of [-100, Infinity, NaN]) {
    assert.throws(() => calculateVAT(bad))
    assert.throws(() => calculateWHT(bad, 'contracts_supplies'))
    assert.throws(() => calculateCIT(bad, 1000))
  }
})

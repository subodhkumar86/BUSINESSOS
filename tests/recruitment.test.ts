import test from 'node:test'
import assert from 'node:assert/strict'
import {
  candidateInput,
  candidateUpdate,
  canAdvanceCandidate,
} from '../server/recruitment.ts'

test('candidate input rejects forged tenancy, missing fields and malformed email', () => {
  const valid = {
    name: ' Amina ',
    email: 'amina@example.test',
    position: 'Engineer',
  }
  assert.equal(candidateInput.parse(valid).name, 'Amina')
  for (const input of [
    { ...valid, tenantId: 'forged' },
    { ...valid, email: 'invalid' },
    { ...valid, name: ' ' },
    { ...valid, status: 'hired' },
  ])
    assert.equal(candidateInput.safeParse(input).success, false)
  assert.equal(
    candidateUpdate.safeParse({ version: 0, status: 'hired' }).success,
    false,
  )
})
test('hiring stages cannot skip approval steps or reopen closed candidates', () => {
  for (const [from, to] of [
    ['applied', 'screening'],
    ['screening', 'interview'],
    ['interview', 'offer'],
    ['offer', 'hired'],
    ['offer', 'rejected'],
  ])
    assert.equal(canAdvanceCandidate(from, to), true)
  for (const [from, to] of [
    ['applied', 'hired'],
    ['interview', 'screening'],
    ['hired', 'rejected'],
    ['rejected', 'applied'],
    ['unknown', 'screening'],
  ])
    assert.equal(canAdvanceCandidate(from, to), false)
})

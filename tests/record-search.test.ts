import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesRecord } from '../src/record-search.ts'
import { sortRecords } from '../src/record-sort.ts'
import { paginateRecords } from '../src/record-page.ts'

test('pagination keeps row order, correct boundaries and full input for exports', () => {
  const rows = Array.from({ length: 23 }, (_, index) => index)
  const last = paginateRecords(rows, 2, 10)
  assert.deepEqual(last.rows, [20, 21, 22])
  assert.deepEqual([last.from, last.to, last.pageCount], [21, 23, 3])
  assert.equal(rows.length, 23)
  assert.deepEqual(paginateRecords(rows, 0, 25).rows, rows)
})

test('pagination clamps stale pages after filtering and handles empty or invalid input', () => {
  assert.equal(paginateRecords([1, 2], 99).page, 0)
  assert.deepEqual(paginateRecords([], -2), { rows: [], page: 0, size: 10, pageCount: 1, from: 0, to: 0 })
  assert.equal(paginateRecords([1], Number.NaN, 0).size, 10)
  assert.equal(paginateRecords([1], Number.NaN).page, 0)
})

test('record sorting compares actual amounts and keeps equal records stable without mutation', () => {
  const rows = [{ id: 'a', amount: 125000 }, { id: 'b', amount: 90 }, { id: 'c', amount: 90 }, { id: 'd', amount: -10 }]
  assert.deepEqual(sortRecords(rows, row => row.amount, 'asc').map(row => row.id), ['d', 'b', 'c', 'a'])
  assert.deepEqual(sortRecords(rows, row => row.amount, 'desc').map(row => row.id), ['a', 'b', 'c', 'd'])
  assert.deepEqual(rows.map(row => row.id), ['a', 'b', 'c', 'd'])
})

test('record sorting uses natural text order and keeps missing values last in either direction', () => {
  const values = ['Item 10', null, 'item 2', '', 'Item 1', Number.NaN]
  assert.deepEqual(sortRecords(values, value => value, 'asc'), ['Item 1', 'item 2', 'Item 10', null, '', Number.NaN])
  assert.deepEqual(sortRecords(values, value => value, 'desc'), ['Item 10', 'item 2', 'Item 1', null, '', Number.NaN])
})

test('record search matches all words across fields and normalizes whitespace and case', () => {
  assert.equal(matchesRecord(['Northstar Limited', 'Unpaid', 125000], '  NORTHSTAR   unpaid  '), true)
  assert.equal(matchesRecord(['Northstar Limited', 'Paid'], 'northstar unpaid'), false)
  assert.equal(matchesRecord(['Northstar Limited', 'Unpaid', 125000], 'northstar 125000'), true)
  assert.equal(matchesRecord([], '  '), true)
})

test('record search supports Unicode and ignores nested metadata and absent values', () => {
  assert.equal(matchesRecord(['ＡＣＭＥ', 'भारत'], 'acme भारत'), true)
  assert.equal(matchesRecord([null, undefined, { secret: 'hidden' }, ['hidden']], 'hidden'), false)
  assert.equal(matchesRecord(['a+b (limited)'], 'a+b (limited)'), true)
})

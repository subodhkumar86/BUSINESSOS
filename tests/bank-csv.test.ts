import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBankCSV } from '../src/bank-csv.ts'
const header = 'externalRef,occurredAt,amount,direction,reference\r\n'
test('bank CSV preserves quoted commas, escaped quotes and multiline references', () => {
  const rows = parseBankCSV(
    '\ufeff' +
      header +
      'REF-1,2026-10-24T10:00:00Z,25.50,CREDIT,"Acme, ""Ltd""\nInvoice 1"\r\n',
  )
  assert.equal(rows[0].reference, 'Acme, "Ltd"\nInvoice 1')
  assert.equal(rows[0].amount, 25.5)
  assert.equal(rows[0].direction, 'credit')
})
test('bank CSV rejects malformed quotes, dates, headers and nonpositive amounts before importing', () => {
  for (const input of [
    header + 'REF-1,2026-10-24T10:00:00Z,25,credit,"Unclosed',
    header + 'REF-1,2026-02-30T10:00:00Z,25,credit,Invoice',
    header + 'REF-1,2026-10-24T10:00:00Z,0,credit,Invoice',
    header + 'REF-1,2026-10-24T10:00:00Z,25,credit,"Invoice"bad',
    header.replace('reference', 'amount') +
      'REF-1,2026-10-24T10:00:00Z,25,credit,Invoice',
  ])
    assert.throws(() => parseBankCSV(input))
})

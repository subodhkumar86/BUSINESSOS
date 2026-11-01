export function parseBankCSV(source: string) {
  const rows: string[][] = []
  let row: string[] = [],
    cell = '',
    quoted = false,
    closed = false
  const text = source.replace(/^\ufeff/, '')
  for (let index = 0; index < text.length; index++) {
    const c = text[index]
    if (quoted) {
      if (c === '"' && text[index + 1] === '"') {
        cell += '"'
        index++
      } else if (c === '"') {
        quoted = false
        closed = true
      } else cell += c
    } else if (c === ',' || c === '\r' || c === '\n') {
      row.push(cell.trim())
      cell = ''
      closed = false
      if (c !== ',') {
        if (row.some(Boolean)) rows.push(row)
        row = []
        if (c === '\r' && text[index + 1] === '\n') index++
      }
    } else if (c === '"') {
      if (cell.trim() || closed)
        throw Error('CSV quotes must enclose a complete field.')
      cell = ''
      quoted = true
    } else {
      if (closed && c.trim())
        throw Error('Unexpected data after a quoted CSV field.')
      cell += c
    }
  }
  if (quoted) throw Error('The CSV contains an unclosed quoted field.')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  const headers = (rows.shift() || []).map((header) => header.toLowerCase())
  const required = [
    'externalref',
    'occurredat',
    'amount',
    'direction',
    'reference',
  ]
  if (
    required.some((header) => !headers.includes(header)) ||
    new Set(headers).size !== headers.length
  )
    throw Error(
      'CSV needs unique externalRef, occurredAt, amount, direction and reference headers.',
    )
  if (!rows.length || rows.length > 100)
    throw Error('Import between 1 and 100 statement entries per batch.')
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw Error(`CSV row ${index + 2} has an incorrect number of columns.`)
    const value = (name: string) => values[headers.indexOf(name)]
    const amount = Number(value('amount')),
      direction = value('direction').toLowerCase(),
      timestamp = value('occurredat')
    const day = timestamp.slice(0, 10),
      date = new Date(timestamp)
    if (
      !/^\d{4}-\d{2}-\d{2}/.test(timestamp) ||
      !Number.isFinite(date.getTime()) ||
      new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) !== day
    )
      throw Error(`CSV row ${index + 2} has an invalid date.`)
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !['credit', 'debit'].includes(direction) ||
      !value('externalref') ||
      !value('reference')
    )
      throw Error(
        `CSV row ${index + 2} needs a positive amount, credit/debit direction, reference and externalRef.`,
      )
    return {
      externalRef: value('externalref'),
      occurredAt: date.toISOString(),
      amount,
      direction,
      reference: value('reference'),
    }
  })
}

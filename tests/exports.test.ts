import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateRawSync } from 'node:zlib'
import { financeWorkbook } from '../server/finance-workbook.ts'
function unzip(buffer: Buffer) {
  const files: Record<string, string> = {}
  let offset = 0
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18),
      nameLength = buffer.readUInt16LE(offset + 26),
      extraLength = buffer.readUInt16LE(offset + 28),
      start = offset + 30 + nameLength + extraLength
    const name = buffer
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString()
    files[name] = inflateRawSync(buffer.subarray(start, start + size)).toString(
      'utf8',
    )
    offset = start + size
  }
  assert.equal(buffer.readUInt32LE(offset), 0x02014b50)
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50)
  assert.equal(buffer.readUInt32LE(buffer.length - 6), offset)
  return files
}
test('XLSX preserves numeric amounts, Unicode and text safely without executable formulas', () => {
  const files = unzip(
    financeWorkbook([
      ['description', 'amount'],
      ['=HYPERLINK("bad")', -123.45],
      ['₦ café <&>', 0],
    ]),
  )
  assert.equal(Object.keys(files).length, 5)
  const sheet = files['xl/worksheets/sheet1.xml']
  assert.match(sheet, /<c r="B2"><v>-123.45<\/v><\/c>/)
  assert.match(sheet, /t="inlineStr"/)
  assert.match(sheet, /₦ café &lt;&amp;&gt;/)
  assert.ok(!sheet.includes('<f>'))
  assert.match(files['[Content_Types].xml'], /spreadsheetml.sheet.main/)
})

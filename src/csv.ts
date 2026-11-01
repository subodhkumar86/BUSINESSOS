/** UTF-8 spreadsheet CSV: quote text safely and keep numeric cells numeric. */
export function csvText(rows: readonly (readonly unknown[])[]) {
  const cell = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
    let text = typeof value === 'string' || typeof value === 'boolean' ? String(value) : ''
    if (/^\s*[=+\-@]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function pdfReport(title: string, lines: { label: string; value: string }[], meta: { tenant: string; actor: string; period: string }) {
  const text = (v: string) => `(${(v ?? '').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').slice(0, 200)})`
  const rows: string[] = []
  rows.push('BT /F1 18 Tf 56 780 Td ' + text(title) + ' Tj ET')
  rows.push(`BT /F1 9 Tf 56 762 Td ${text(meta.tenant + ' | ' + meta.period + ' | ' + meta.actor)} Tj ET`)
  let y = 736
  for (const line of lines.slice(0, 60)) {
    rows.push(`BT /F1 10 Tf 56 ${y} Td ${text(line.label + ': ' + line.value)} Tj ET`)
    y -= 18
  }
  rows.push(`BT /F1 8 Tf 56 40 Td ${text('BusinessOS deterministic PDF export. Reconcile against journal entries in Finance statements.')} Tj ET`)
  const content = rows.join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ]
  let out = '%PDF-1.4\n', offsets: number[] = []
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(out, 'utf8')
}

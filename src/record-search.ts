export function matchesRecord(values: unknown[], query: string) {
  const normalize = (value: string) => value.normalize('NFKC').toLowerCase()
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean)
  const text = normalize(values
    .filter(value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))
    .join(' '))
  return terms.every(term => text.includes(term))
}

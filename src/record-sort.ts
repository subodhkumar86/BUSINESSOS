const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' })

export function sortRecords<T>(rows: readonly T[], value: (row: T) => unknown, direction: 'asc' | 'desc') {
  const primitive = (input: unknown) =>
    typeof input === 'string' && input.trim() ? input :
    typeof input === 'number' && Number.isFinite(input) ? input : null
  return rows.map((row, index) => ({ row, index, value: primitive(value(row)) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null)
        return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1
      const comparison = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value : collator.compare(String(a.value), String(b.value))
      return (direction === 'asc' ? comparison : -comparison) || a.index - b.index
    }).map(entry => entry.row)
}

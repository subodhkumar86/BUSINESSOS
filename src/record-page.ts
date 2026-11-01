export function paginateRecords<T>(rows: readonly T[], requestedPage = 0, requestedSize = 10) {
  const size = [10, 25, 50].includes(requestedSize) ? requestedSize : 10
  const pageCount = Math.max(1, Math.ceil(rows.length / size))
  const page = Math.max(0, Math.min(pageCount - 1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0))
  const start = page * size
  return { rows: rows.slice(start, start + size), page, size, pageCount,
    from: rows.length ? start + 1 : 0, to: Math.min(start + size, rows.length) }
}

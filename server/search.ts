export function globalSearch(state: {
  products: { id: string; name: string }[]; invoices: { id: string; name: string }[];
  leads: { id: string; name: string }[]; employees: { id: string; name: string }[];
  projects: { id: string; name: string }[]; tasks: { id: string; name: string }[];
}, query: string) {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const groups: [string, { id: string; name: string }[]][] = [
    ['product', state.products], ['invoice', state.invoices], ['lead', state.leads],
    ['employee', state.employees], ['project', state.projects], ['task', state.tasks],
  ]
  return groups.flatMap(([kind, rows]) =>
    rows.filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(q)).slice(0, 10).map((row) => ({ kind, id: row.id, name: row.name })),
  ).slice(0, 30)
}

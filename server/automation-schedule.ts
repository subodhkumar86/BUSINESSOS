export type StockSchedule = 'off' | 'hourly' | 'daily'
export function nextStockRun(
  schedule: StockSchedule,
  now = Date.now(),
  deferred = false,
): string | null {
  if (schedule === 'off') return null
  const interval = deferred ? 60000 : schedule === 'hourly' ? 3600000 : 86400000
  return new Date(now + interval).toISOString()
}

export const DEFAULT_CURRENCY = 'INR'

export function formatMoney(value: number, currency = DEFAULT_CURRENCY) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
}

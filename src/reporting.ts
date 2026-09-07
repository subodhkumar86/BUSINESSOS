import { z } from 'zod'
import type { State } from './types'

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(value + 'T00:00:00Z')
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    )
  }, 'Enter a valid calendar date.')
export const reportingPeriod = z
  .object({ from: day.optional(), to: day.optional() })
  .strict()
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    'Start date must not follow end date.',
  )
export type ReportingPeriod = z.infer<typeof reportingPeriod>
export function periodLabel(period: ReportingPeriod) {
  return period.from || period.to
    ? `${period.from || 'Beginning'} to ${period.to || 'Latest posting'} (UTC)`
    : 'All posted journals'
}
export function periodState(
  state: State,
  input: ReportingPeriod = {},
  cumulative = false,
): State {
  const period = reportingPeriod.parse(input)
  return {
    ...state,
    journals: state.journals.filter((journal) => {
      const date = new Date(journal.date).toISOString().slice(0, 10)
      return (
        (cumulative || !period.from || date >= period.from) &&
        (!period.to || date <= period.to)
      )
    }),
  }
}
export function openingCashForPeriod(
  state: State,
  input: ReportingPeriod = {},
) {
  const period = reportingPeriod.parse(input)
  return (
    state.openingCash +
    state.journals.reduce((total, journal) => {
      if (
        !period.from ||
        new Date(journal.date).toISOString().slice(0, 10) >= period.from
      )
        return total
      return (
        total +
        (journal.debit === 'Cash' ? journal.amount : 0) -
        (journal.credit === 'Cash' ? journal.amount : 0)
      )
    }, 0)
  )
}

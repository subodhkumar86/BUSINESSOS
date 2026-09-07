export function validateProductionUpdate(
  current: {
    status: string
    planned_qty: number
    completed_qty: number
    defect_count: number
  },
  update: { status?: string; completedQty?: number; defectCount?: number },
) {
  const stages = ['scheduled', 'running', 'qa_check', 'completed']
  const next = update.status || current.status
  if (
    next !== current.status &&
    stages.indexOf(next) !== stages.indexOf(current.status) + 1
  )
    throw Error('Advance production one stage at a time.')
  if (current.status === 'completed')
    throw Error('Completed batches cannot be edited.')
  const completed = update.completedQty ?? current.completed_qty,
    defects = update.defectCount ?? current.defect_count
  if (completed > current.planned_qty || defects > completed)
    throw Error(
      'Completed quantity cannot exceed planned quantity; defects cannot exceed completed quantity.',
    )
  if (next === 'completed' && completed !== current.planned_qty)
    throw Error('Record all planned output before completing the batch.')
}
export function depreciation(cost: number, rate: number, years: number) {
  if (
    ![cost, rate, years].every(Number.isFinite) ||
    cost < 0 ||
    rate < 0 ||
    rate > 100 ||
    years < 0
  )
    throw Error('Invalid depreciation inputs.')
  const accumulated =
    Math.round(Math.min(cost, ((cost * rate) / 100) * years) * 100) / 100
  return {
    accumulated,
    bookValue: Math.round((cost - accumulated) * 100) / 100,
  }
}

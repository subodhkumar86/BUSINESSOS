export function requiredFeature(path: string): string | undefined {
  if (/^\/api\/v1\/ai\/forecast$/.test(path)) return 'forecast'
  if (/^\/api\/v1\/modules\/automation(?:\/|$)/.test(path)) return 'automation'
  if (/^\/api\/v1\/finance\/(statements|export\.(csv|xlsx))$/.test(path)) return 'reports'
  if (
    /^\/api\/v1\/(hr|payroll|warehouse|suppliers|assets|facilities|production)(?:\/|$)/.test(
      path,
    )
  )
    return 'operations'
  if (
    /^\/api\/v1\/modules\/(warehouse|assets|facilities|production|supply)(?:\/|$)/.test(
      path,
    )
  )
    return 'operations'
  return undefined
}
export function actionFeature(action: {
  type?: string
  collection?: string
}): string | undefined {
  return action.type === 'payroll' ||
    ['employees', 'payroll', 'orders', 'projects'].includes(
      action.collection || '',
    )
    ? 'operations'
    : undefined
}

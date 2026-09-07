export interface Entitlements {
  plan: string
  features: string[]
  seatLimit: number
}

export function pageFeature(page: string): string | undefined {
  if (
    [
      'hr',
      'procurement',
      'projects',
      'suppliers',
      'warehouse',
      'assets',
      'facilities',
      'production',
      'supply',
    ].includes(page)
  )
    return 'operations'
  if (page === 'automation') return 'automation'
  if (page === 'ai') return 'forecast'
  return undefined
}

export function includesFeature(
  entitlements: Entitlements | undefined,
  feature: string | undefined,
) {
  return !feature || Boolean(entitlements?.features.includes(feature))
}

import { operations } from './operations.ts'
import { demoOperations } from './demo-data.ts'
import { validateProductionUpdate } from '../server/operational-rules.ts'

export type DemoOperation = Record<string, string | number | null>
const key = (module: string) => `businessos-demo-operations-v1:${module}`
const snake = (value: string) =>
  value.replace(/[A-Z]/g, (character) => '_' + character.toLowerCase())
const transitions: Record<string, Record<string, string[]>> = {
  assets: {
    operational: ['maintenance', 'retired'],
    maintenance: ['operational', 'retired'],
    retired: [],
  },
  facilities: {
    open: ['in_progress'],
    in_progress: ['completed'],
    completed: [],
  },
  frontoffice: {
    scheduled: ['checked_in', 'cancelled'],
    checked_in: ['completed'],
    completed: [],
    cancelled: [],
  },
  campaigns: {
    planning: ['active', 'completed'],
    active: ['paused', 'completed'],
    paused: ['active', 'completed'],
    completed: [],
  },
  compliance: {
    identified: ['mitigating', 'accepted'],
    mitigating: ['controlled', 'accepted'],
    controlled: ['mitigating'],
    accepted: ['mitigating'],
  },
  production: {
    scheduled: ['running'],
    running: ['qa_check'],
    qa_check: ['completed'],
    completed: [],
  },
}
export const allowedDemoStatuses = (module: string, status: string) => [
  status,
  ...(transitions[module][status] || []),
]
export function loadDemoOperations(module: string): {
  rows: DemoOperation[]
  error: string
} {
  try {
    const raw = localStorage.getItem(key(module))
    if (!raw) return { rows: demoOperations(module), error: '' }
    const saved = JSON.parse(raw)
    if (
      !Array.isArray(saved) ||
      saved.length > 200 ||
      saved.some(
        (row) =>
          !row ||
          typeof row !== 'object' ||
          typeof row.id !== 'string' ||
          !operations[module].statuses.includes(row.status) ||
          Object.values(row).some(
            (value) =>
              value !== null && !['string', 'number'].includes(typeof value),
          ),
      )
    )
      throw Error('Invalid demo records')
    return { rows: saved, error: '' }
  } catch {
    return {
      rows: demoOperations(module),
      error:
        'Saved demo records could not be read. Sample records are shown; refresh or reset this demo section before saving.',
    }
  }
}
export function storeDemoOperations(module: string, rows: DemoOperation[]) {
  try {
    localStorage.setItem(key(module), JSON.stringify(rows))
  } catch {
    throw Error(
      'Browser storage is unavailable or full. Changes were not saved.',
    )
  }
}
export function resetDemoOperations(module: string) {
  const rows = demoOperations(module)
  storeDemoOperations(module, rows)
  return rows
}
export function demoOperationChange(
  module: string,
  rows: DemoOperation[],
  input: Record<string, unknown>,
  id?: string,
): DemoOperation[] {
  const config = operations[module]
  const old = id ? rows.find((row) => row.id === id) : undefined
  if (id && !old)
    throw Error('Demo record not found. Refresh records before editing.')
  if (!id && rows.length >= 200)
    throw Error(
      'This demo section supports 200 records. Reset this section to start again.',
    )
  const data: DemoOperation = {}
  if (
    !id &&
    config.fields.some(
      ([name]) =>
        ![
          'materials',
          'outputProductId',
          'company',
          'description',
          'mitigationPlan',
        ].includes(name) &&
        (input[name] === undefined || input[name] === null),
    )
  )
    throw Error('Complete all required fields.')
  for (const [name, value] of Object.entries(input)) {
    if (name === 'materials') {
      if (!Array.isArray(value) || value.length)
        throw Error(
          'Demo production supports tracking only. Sign in for inventory production.',
        )
      continue
    }
    if (name === 'outputProductId') {
      if (value) throw Error('Sign in for inventory production.')
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0 || value > 1e10)
        throw Error('Enter a valid, non-negative amount or quantity.')
      if (
        ['plannedQty', 'completedQty', 'defectCount', 'leadsCount'].includes(
          name,
        ) &&
        (!Number.isInteger(value) || value > 100000000)
      )
        throw Error(
          'Quantities must be whole numbers within the supported range.',
        )
      if (name === 'plannedQty' && value === 0)
        throw Error('Planned quantity must be at least one.')
      if (name === 'depreciationRate' && value > 100)
        throw Error('Depreciation rate cannot exceed 100%.')
      data[snake(name)] = value
    } else if (typeof value === 'string') {
      const text = value.trim()
      if (!text && !['description', 'company', 'mitigationPlan'].includes(name))
        throw Error('Complete all required fields.')
      const limit = ['description', 'company', 'mitigationPlan'].includes(name)
        ? 2000
        : 200
      if (text.length > limit)
        throw Error(`Keep this text field within ${limit} characters.`)
      const choices = config.fields.find((field) => field[0] === name)?.[2]
      if (Array.isArray(choices) && !choices.includes(text))
        throw Error('Select a supported value.')
      data[snake(name)] = text
    } else throw Error('Enter a supported value.')
  }
  const now = new Date().toISOString()
  if (old) {
    const before = String(old.status),
      after = String(data.status || before)
    if (after !== before && !transitions[module][before]?.includes(after))
      throw Error('Advance this workflow through the permitted stages.')
    if (module === 'production')
      validateProductionUpdate(
        old as unknown as Parameters<typeof validateProductionUpdate>[0],
        input,
      )
    if (
      !transitions[module][before]?.length &&
      Object.keys(input).some((name) => name !== 'status')
    )
      throw Error('Completed or retired demo records cannot be edited.')
    if (module === 'frontoffice' && after !== before) {
      if (after === 'checked_in') data.check_in_time = now
      if (after === 'completed') data.check_out_time = now
    }
  } else {
    data.id = crypto.randomUUID()
    data.status = config.statuses[0]
    data.version = 0
    data.created_at = now
    if (module === 'assets') data.book_value = data.cost
    if (module === 'production') {
      data.completed_qty = 0
      data.defect_count = 0
    }
    if (module === 'campaigns') {
      data.leads_count = 0
      data.revenue_generated = 0
    }
  }
  const next: DemoOperation = {
    ...old,
    ...data,
    version: Number(old?.version || 0) + 1,
    updated_at: now,
  }
  if (module === 'campaigns')
    next.roi_percent =
      Number(next.spend) > 0
        ? Math.round(
            ((Number(next.revenue_generated) - Number(next.spend)) /
              Number(next.spend)) *
              100,
          )
        : 0
  return id ? rows.map((row) => (row.id === id ? next : row)) : [next, ...rows]
}

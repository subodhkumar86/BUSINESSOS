import test from 'node:test'
import assert from 'node:assert/strict'
import { demoOperations } from '../src/demo-data.ts'
import {
  allowedDemoStatuses,
  demoOperationChange,
  loadDemoOperations,
  resetDemoOperations,
  storeDemoOperations,
} from '../src/demo-operations.ts'

test('demo asset creation retains samples, derives book value and validates inputs', () => {
  const original = demoOperations('assets'),
    snapshot = structuredClone(original)
  const input = {
    name: 'Test laptop',
    serialNumber: 'QA-001',
    category: 'IT',
    cost: 500,
    depreciationRate: 10,
    location: 'Office',
  }
  const next = demoOperationChange('assets', original, input)
  assert.equal(next.length, original.length + 1)
  assert.equal(next[0].book_value, 500)
  assert.equal(next[0].status, 'operational')
  assert.deepEqual(original, snapshot)
  assert.throws(
    () =>
      demoOperationChange('assets', original, {
        ...input,
        depreciationRate: 101,
      }),
    /100%/,
  )
  assert.throws(
    () => demoOperationChange('assets', original, { ...input, name: ' ' }),
    /required/,
  )
  assert.throws(
    () => demoOperationChange('assets', original, { ...input, cost: Infinity }),
    /valid/,
  )
})

test('demo facility and visitor lifecycles reject skips and retain terminal history', () => {
  const initial = demoOperationChange('facilities', [], {
    facilityName: 'Office',
    equipment: 'Lighting',
    condition: 'fair',
    priority: 'low',
    description: 'Sample repair',
  })
  const id = String(initial[0].id)
  assert.throws(
    () =>
      demoOperationChange('facilities', initial, { status: 'completed' }, id),
    /permitted stages/,
  )
  let next = demoOperationChange(
    'facilities',
    initial,
    { status: 'in_progress' },
    id,
  )
  next = demoOperationChange('facilities', next, { status: 'completed' }, id)
  assert.equal(next[0].version, 3)
  assert.deepEqual(allowedDemoStatuses('facilities', 'completed'), [
    'completed',
  ])
  assert.throws(
    () => demoOperationChange('facilities', next, { status: 'open' }, id),
    /permitted stages/,
  )
  const visitor = demoOperationChange('frontoffice', [], {
    visitorName: 'Guest',
    hostPerson: 'Team',
    company: 'Sample',
    purpose: 'Meeting',
  })
  const checked = demoOperationChange(
    'frontoffice',
    visitor,
    { status: 'checked_in' },
    String(visitor[0].id),
  )
  const out = demoOperationChange(
    'frontoffice',
    checked,
    { status: 'completed' },
    String(visitor[0].id),
  )
  assert.ok(!Number.isNaN(Date.parse(String(out[0].check_in_time))))
  assert.ok(!Number.isNaN(Date.parse(String(out[0].check_out_time))))
})

test('demo production requires ordered stages and complete output evidence without inventory inputs', () => {
  const input = {
    batchNumber: 'QA-BATCH',
    productName: 'Sample kit',
    plannedQty: 2,
    materials: [],
    outputProductId: '',
  }
  let rows = demoOperationChange('production', [], input)
  const id = String(rows[0].id)
  assert.throws(
    () => demoOperationChange('production', [], { ...input, plannedQty: 1.5 }),
    /whole numbers/,
  )
  assert.throws(
    () =>
      demoOperationChange('production', [], {
        ...input,
        outputProductId: 'p1',
      }),
    /inventory production/,
  )
  assert.throws(
    () =>
      demoOperationChange('production', [], {
        ...input,
        materials: [{ productId: 'p1', quantity: 1 }],
      }),
    /tracking only/,
  )
  rows = demoOperationChange('production', rows, { status: 'running' }, id)
  assert.throws(
    () => demoOperationChange('production', rows, { completedQty: 3 }, id),
    /planned quantity/,
  )
  rows = demoOperationChange('production', rows, { status: 'qa_check' }, id)
  assert.throws(
    () => demoOperationChange('production', rows, { status: 'completed' }, id),
    /planned output/,
  )
  rows = demoOperationChange(
    'production',
    rows,
    { completedQty: 2, defectCount: 0 },
    id,
  )
  rows = demoOperationChange('production', rows, { status: 'completed' }, id)
  assert.equal(rows[0].status, 'completed')
  assert.throws(
    () => demoOperationChange('production', rows, { completedQty: 1 }, id),
    /cannot be edited/,
  )
})

test('demo storage round-trips records, reports corruption and never claims a failed write succeeded', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
  try {
    const rows = demoOperations('assets')
    storeDemoOperations('assets', rows)
    assert.deepEqual(loadDemoOperations('assets'), { rows, error: '' })
    values.set('businessos-demo-operations-v1:assets', '{broken')
    assert.ok(loadDemoOperations('assets').error)
    assert.equal(values.get('businessos-demo-operations-v1:assets'), '{broken')
    assert.deepEqual(resetDemoOperations('assets'), rows)
    assert.deepEqual(loadDemoOperations('assets').rows, rows)
    globalThis.localStorage.setItem = () => {
      throw Error('Quota exceeded')
    }
    assert.throws(() => storeDemoOperations('assets', []), /not saved/)
    assert.deepEqual(loadDemoOperations('assets').rows, rows)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

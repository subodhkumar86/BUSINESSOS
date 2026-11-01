import { randomUUID } from 'node:crypto'
import type { ClientSession } from 'mongodb'
import type { State, UserRole } from '../../src/types'
import { seed } from '../../src/domain'
import { hydrateInventory } from '../../src/inventory'
import {
  database,
  transaction,
  type AccountDocument,
  type SessionDocument,
  type TenantDocument,
} from './database'
import { fail, publicUser } from './security'

export function scopedState(
  state: State,
  role: UserRole,
  employeeId?: string | null,
): State {
  if (role === 'owner' || role === 'auditor') return state
  const empty: State = {
    ...state,
    openingCash: 0,
    products: [],
    invoices: [],
    expenses: [],
    leads: [],
    employees: [],
    projects: [],
    tasks: [],
    orders: [],
    payroll: [],
    audit: [],
    journals: [],
    stockMovements: [],
  }
  if (role === 'finance_admin')
    return {
      ...empty,
      openingCash: state.openingCash,
      invoices: state.invoices,
      expenses: state.expenses,
      orders: state.orders,
      payroll: state.payroll.map((run) => ({ ...run, inputs: [] })),
      journals: state.journals,
    }
  if (role === 'hr_admin')
    return { ...empty, employees: state.employees, payroll: state.payroll }
  if (role === 'operations_manager')
    return {
      ...empty,
      products: state.products,
      orders: state.orders,
      projects: state.projects,
      tasks: state.tasks,
      stockMovements: state.stockMovements,
    }
  if (role === 'sales_crm_user')
    return { ...empty, invoices: state.invoices, leads: state.leads }
  if (role === 'department_manager')
    return { ...empty, projects: state.projects, tasks: state.tasks }
  if (role === 'employee')
    return {
      ...empty,
      tasks: state.tasks,
      employees: state.employees.filter((e) => e.id === employeeId),
    }
  return empty
}
export function initialState(organisation: string, sample: boolean) {
  const state = seed()
  if (!sample) {
    state.products = []
    state.invoices = []
    state.leads = []
    state.employees = []
    state.projects = []
    state.tasks = []
    state.openingCash = 0
  }
  for (const rows of [
    state.products,
    state.invoices,
    state.leads,
    state.employees,
    state.projects,
    state.tasks,
  ])
    for (const row of rows) row.id = randomUUID()
  state.organisation = organisation
  state.sampleData = sample
  return hydrateInventory({ ...state, stockMovements: undefined })
}
export async function readWorkspace(
  tenant: string,
  session?: ClientSession,
): Promise<TenantDocument> {
  if (!session)
    return transaction((activeSession) => readWorkspace(tenant, activeSession))
  const d = await database(),
    options = { session }
  const doc = await d.tenants.findOne({ _id: tenant }, options)
  if (!doc) fail(404, 'Workspace not found.')
  const audit = await d.audit.find({ tenant }, options).toArray()
  const journals = await d.journals.find({ tenant }, options).toArray()
  const stock = await d.stock.find({ tenant }, options).toArray()
  const state: State = {
    ...doc.state,
    audit: audit
      .map((v) => v.payload as State['audit'][number])
      .sort((a, b) => b.date.localeCompare(a.date)),
    journals: journals
      .map((v) => v.payload as State['journals'][number])
      .sort((a, b) => b.date.localeCompare(a.date)),
    stockMovements: stock
      .map((v) => v.payload as State['stockMovements'][number])
      .sort((a, b) => b.date.localeCompare(a.date)),
  }
  return { ...doc, state }
}
export async function appendEvent(
  tenant: string,
  actor: string,
  action: string,
  entity: string,
  detail: string,
  session: ClientSession,
) {
  const d = await database(),
    id = randomUUID()
  await d.audit.insertOne(
    {
      _id: id,
      tenant,
      payload: {
        id,
        date: new Date().toISOString(),
        actor,
        action,
        entity,
        detail,
      },
    },
    { session },
  )
}
export async function saveWorkspace(
  current: Awaited<ReturnType<typeof readWorkspace>>,
  state: State,
  session: ClientSession,
) {
  const d = await database(),
    tenant = current._id
  const updated = await d.tenants.updateOne(
    { _id: tenant, version: current.version },
    {
      $set: {
        state: { ...state, audit: [], journals: [], stockMovements: [] },
      },
      $inc: { version: 1 },
    },
    { session },
  )
  if (!updated.modifiedCount)
    fail(409, 'Workspace changed. Refresh and try again.')
  // Ledgers are append-only through the API; no update/delete endpoints exist.
  for (const [collection, rows, old] of [
    [d.audit, state.audit, current.state.audit],
    [d.journals, state.journals, current.state.journals],
    [d.stock, state.stockMovements, current.state.stockMovements],
  ] as const) {
    const existing = new Set(old.map((row) => row.id))
    for (const row of rows)
      if (!existing.has(row.id))
        await collection.insertOne(
          { _id: row.id, tenant, payload: row },
          { session },
        )
  }
}
export async function snapshot(
  account: AccountDocument,
  session: SessionDocument,
) {
  const d = await database()
  const doc = await transaction(async (active) => {
    const current = await d.users.findOne(
      {
        _id: account._id,
        tenant: account.tenant,
        active: true,
        sessionVersion: session.sessionVersion,
      },
      { session: active },
    )
    if (!current) fail(401, 'Session expired. Sign in again.')
    return readWorkspace(account.tenant, active)
  })
  const plan = await d.plans.findOne({ _id: doc.plan })
  if (!plan) fail(503, 'Database setup is pending. Run npm run db:migrate.')
  return {
    version: doc.version,
    state: scopedState(doc.state, account.role, account.employeeId),
    user: publicUser(account),
    csrf: session.csrf,
    entitlements: {
      plan: plan._id,
      features: plan.features,
      seatLimit: plan.seatLimit,
    },
  }
}

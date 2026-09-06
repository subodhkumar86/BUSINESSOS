import { randomBytes, randomUUID, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import { seed } from '../src/domain.ts'
import type { State, StockMovement, User } from '../src/types.ts'
import { seedModuleRecords } from '../server/modules.ts'

const derive = promisify(scrypt)
const password = process.env.DEMO_PASSWORD || 'DemoBusinessOS!2026'
const rolePassword = process.env.DEMO_ROLE_PASSWORD || 'DemoRoleBusinessOS!2026'
const demos = [
  {
    tenant: '10000000-0000-4000-8000-000000000001',
    user: '20000000-0000-4000-8000-000000000001',
    organisation: 'Acme Trading Ltd',
    name: 'Acme Owner',
    email: 'owner@acme.demo',
    payroll: '30000000-0000-4000-8000-000000000001',
    paymentBatch: '40000000-0000-4000-8000-000000000001',
    expense: '50000000-0000-4000-8000-000000000001',
    order: '60000000-0000-4000-8000-000000000001',
  },
  {
    tenant: '10000000-0000-4000-8000-000000000002',
    user: '20000000-0000-4000-8000-000000000002',
    organisation: 'Northstar Services',
    name: 'Northstar Owner',
    email: 'owner@northstar.demo',
    payroll: '30000000-0000-4000-8000-000000000002',
    paymentBatch: '40000000-0000-4000-8000-000000000002',
    expense: '50000000-0000-4000-8000-000000000002',
    order: '60000000-0000-4000-8000-000000000002',
  },
  {
    tenant: '10000000-0000-4000-8000-000000000003',
    user: '20000000-0000-4000-8000-000000000003',
    organisation: 'Greenfield Studio',
    name: 'Greenfield Owner',
    email: 'owner@greenfield.demo',
    payroll: '30000000-0000-4000-8000-000000000003',
    paymentBatch: '40000000-0000-4000-8000-000000000003',
    expense: '50000000-0000-4000-8000-000000000003',
    order: '60000000-0000-4000-8000-000000000003',
  },
] as const
const selectedTenant = process.env.DEMO_TENANT?.trim().toLowerCase()
const selectedDemos = selectedTenant
  ? demos.filter((demo) =>
      [demo.organisation, demo.email, demo.tenant]
        .join(' ')
        .toLowerCase()
        .includes(selectedTenant),
    )
  : demos
if (selectedTenant && !selectedDemos.length)
  throw Error('DEMO_TENANT did not match a documented demo tenant.')

async function hash(value: string) {
  const salt = randomBytes(16).toString('hex')
  const derived = (await derive(value, salt, 64)) as Buffer
  return `${salt}:${derived.toString('hex')}`
}

const demoRoles = [
  ['finance_admin', 'Finance Admin', 'finance'],
  ['hr_admin', 'HR Admin', 'hr'],
  ['operations_manager', 'Operations Manager', 'operations'],
  ['sales_crm_user', 'Sales CRM User', 'sales'],
  ['department_manager', 'Department Manager', 'department'],
  ['employee', 'Employee User', 'employee'],
  ['auditor', 'Auditor User', 'audit'],
] as const

async function seedRoleUsers(
  client: import('pg').PoolClient,
  demo: (typeof demos)[number],
  roleHash: string,
) {
  for (const [role, label, alias] of demoRoles) {
    const email = `${alias}@${demo.email.split('@')[1]}`
    const exists = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE email=$1',
      [email],
    )
    if (exists.rowCount) {
      await client.query(
        'UPDATE users SET name=$1,password=$2,role=$3,active=true,session_version=session_version+1 WHERE id=$4 AND tenant_id=$5',
        [
          `${demo.organisation} ${label}`,
          roleHash,
          role,
          exists.rows[0].id,
          demo.tenant,
        ],
      )
    } else {
      await client.query(
        'INSERT INTO users(id,tenant_id,email,name,password,role) VALUES($1,$2,$3,$4,$5,$6)',
        [
          randomUUID(),
          demo.tenant,
          email,
          `${demo.organisation} ${label}`,
          roleHash,
          role,
        ],
      )
    }
  }
}

async function seedOperationalData(
  client: import('pg').PoolClient,
  demo: (typeof demos)[number],
) {
  const owner = (
    await client.query<{ id: string }>('SELECT id FROM users WHERE email=$1', [
      demo.email,
    ])
  ).rows[0].id
  const tenant = (
    await client.query<{ state: State }>(
      'SELECT state FROM tenants WHERE id=$1 FOR UPDATE',
      [demo.tenant],
    )
  ).rows[0]
  if (!tenant) throw Error(`Demo tenant ${demo.organisation} was not created.`)
  const state = tenant.state
  let stateChanged = false
  if (!state.expenses.some((expense) => expense.id === demo.expense)) {
    state.expenses.unshift({
      id: demo.expense,
      name: 'September office operations',
      amount: 185000,
    })
    stateChanged = true
  }
  if (
    !state.orders.some((order) => order.id === demo.order) &&
    state.products[0]
  ) {
    state.orders.unshift({
      id: demo.order,
      name: 'Kora Imports',
      product: state.products[0].id,
      qty: 12,
      cost: state.products[0].cost,
      status: 'Pending',
      requestedBy: demo.email,
      requestedAt: '2026-09-22T09:00:00.000Z',
    })
    stateChanged = true
  }
  let payroll = state.payroll.find((run) => run.id === demo.payroll)
  if (!payroll) {
    payroll = {
      id: demo.payroll,
      name: 'Payroll 2026-09',
      period: '2026-09',
      status: 'Approved',
      amount: state.employees.reduce(
        (sum, employee) => sum + employee.amount,
        0,
      ),
      inputs: structuredClone(state.employees),
      preparedBy: demo.email,
      preparedAt: '2026-09-25T09:00:00.000Z',
      approvedBy: demo.email,
      approvedAt: '2026-09-26T10:00:00.000Z',
    }
    state.payroll.unshift(payroll)
    stateChanged = true
  }
  if (stateChanged)
    await client.query(
      'UPDATE tenants SET state=$1,version=version+1 WHERE id=$2',
      [state, demo.tenant],
    )
  const existingExpenseJournal = await client.query(
    "SELECT 1 FROM journals WHERE tenant_id=$1 AND payload->>'source'=$2",
    [demo.tenant, demo.expense],
  )
  if (!existingExpenseJournal.rowCount)
    await client.query(
      'INSERT INTO journals(id,tenant_id,payload) VALUES($1,$2,$3)',
      [
        randomUUID(),
        demo.tenant,
        {
          id: randomUUID(),
          date: '2026-09-20T10:00:00.000Z',
          source: demo.expense,
          amount: 185000,
          debit: 'Operating expenses',
          credit: 'Cash',
        },
      ],
    )
  const existingJournal = await client.query(
    "SELECT 1 FROM journals WHERE tenant_id=$1 AND payload->>'source'=$2",
    [demo.tenant, demo.payroll],
  )
  if (!existingJournal.rowCount)
    await client.query(
      'INSERT INTO journals(id,tenant_id,payload) VALUES($1,$2,$3)',
      [
        randomUUID(),
        demo.tenant,
        {
          id: randomUUID(),
          date: '2026-09-26T10:00:00.000Z',
          source: demo.payroll,
          amount: payroll.amount,
          debit: 'Payroll expense',
          credit: 'Payroll payable',
        },
      ],
    )
  await client.query(
    `INSERT INTO payroll_payment_batches(id,tenant_id,payroll_run_id,idempotency_key,amount,status,created_by)
     VALUES($1,$2,$3,$4,$5,'pending',$6)
     ON CONFLICT (tenant_id,payroll_run_id) DO NOTHING`,
    [
      demo.paymentBatch,
      demo.tenant,
      demo.payroll,
      randomUUID(),
      payroll.amount,
      owner,
    ],
  )
  await client.query(
    `INSERT INTO bank_accounts(id,tenant_id,provider,external_ref,name,currency,status)
     VALUES($1,$2,'manual','demo-operating-account','Operating account','NGN','active')
     ON CONFLICT (tenant_id,provider,external_ref) DO NOTHING`,
    [randomUUID(), demo.tenant],
  )
  const account = (
    await client.query<{ id: string }>(
      'SELECT id FROM bank_accounts WHERE tenant_id=$1 AND external_ref=$2',
      [demo.tenant, 'demo-operating-account'],
    )
  ).rows[0]
  await client.query(
    `INSERT INTO bank_transactions(id,tenant_id,bank_account_id,external_ref,occurred_at,amount,direction,reference,raw_payload)
     VALUES($1,$2,$3,'demo-opening-credit',now(),5000000,'credit','Opening balance',$4)
     ON CONFLICT (bank_account_id,external_ref) DO NOTHING`,
    [randomUUID(), demo.tenant, account.id, { source: 'demo-seed' }],
  )
  await client.query(
    `INSERT INTO support_tickets(id,tenant_id,ticket_number,subject,customer,priority,status,sla_due_at,assigned_to)
     VALUES($1,$2,'T-DEMO001','Delivery update','Northstar Limited','high','open',now()+interval '2 days',$3)
     ON CONFLICT (tenant_id,ticket_number) DO NOTHING`,
    [randomUUID(), demo.tenant, owner],
  )
  await client.query(
    `INSERT INTO tax_filings(id,tenant_id,name,territory,due_date,amount,status)
     SELECT $1,$2,'VAT September','Nigeria',current_date+21,0,'draft'
     WHERE NOT EXISTS (SELECT 1 FROM tax_filings WHERE tenant_id=$2 AND name='VAT September')`,
    [randomUUID(), demo.tenant],
  )
  await client.query(
    `INSERT INTO warehouse_locations(id,tenant_id,name,code)
     VALUES($1,$2,'Main warehouse','WH-01')
     ON CONFLICT (tenant_id,code) DO NOTHING`,
    [randomUUID(), demo.tenant],
  )
  await client.query(
    `INSERT INTO suppliers(id,tenant_id,name,contact,lead_days,status)
     SELECT $1,$2,'Kora Imports','ops@kora.demo',14,'active'
     WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE tenant_id=$2 AND name='Kora Imports')`,
    [randomUUID(), demo.tenant],
  )
  await client.query(
    `INSERT INTO documents(id,tenant_id,filename,mime_type,size_bytes,storage_key,uploaded_by)
     SELECT $1,$2,'Supplier agreement.pdf','application/pdf',24576,$3,$4
     WHERE NOT EXISTS (SELECT 1 FROM documents WHERE tenant_id=$2 AND filename='Supplier agreement.pdf')`,
    [
      randomUUID(),
      demo.tenant,
      `${demo.tenant}/demo/supplier-agreement.pdf`,
      owner,
    ],
  )
}

function withFreshIds<T extends { id: string }>(rows: T[]) {
  return rows.map((row) => ({ ...row, id: randomUUID() }))
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw Error('Set DATABASE_URL in .env before seeding demo tenants.')

const pool = new Pool({
  connectionString: databaseUrl,
  connectionTimeoutMillis: 5000,
})
const passwordHash = await hash(password)
const rolePasswordHash = await hash(rolePassword)

try {
  for (const demo of selectedDemos) {
    const existing = await pool.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM users WHERE email=$1',
      [demo.email],
    )
    if (existing.rowCount) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SELECT set_config('app.tenant_id',$1,true)", [
          demo.tenant,
        ])
        await seedModuleRecords(client, demo.tenant)
        await seedRoleUsers(client, demo, rolePasswordHash)
        await seedOperationalData(client, demo)
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
      console.log(`${demo.email} already exists; refreshed demo data.`)
      continue
    }

    const state = seed()
    state.organisation = demo.organisation
    state.sampleData = true
    state.products = withFreshIds(state.products)
    state.invoices = withFreshIds(state.invoices)
    state.leads = withFreshIds(state.leads)
    state.employees = withFreshIds(state.employees)
    state.projects = withFreshIds(state.projects)
    state.tasks = withFreshIds(state.tasks)
    const movements: StockMovement[] = state.stockMovements.map((movement) => ({
      ...movement,
      id: randomUUID(),
      actor: demo.email,
    }))
    state.stockMovements = []
    const user: User = {
      id: demo.user,
      name: demo.name,
      email: demo.email,
      role: 'owner',
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.tenant_id',$1,true)", [
        demo.tenant,
      ])
      await client.query('INSERT INTO tenants(id,state) VALUES($1,$2)', [
        demo.tenant,
        state,
      ])
      await client.query(
        'INSERT INTO users(id,tenant_id,email,name,password,role) VALUES($1,$2,$3,$4,$5,$6)',
        [user.id, demo.tenant, user.email, user.name, passwordHash, user.role],
      )
      await seedModuleRecords(client, demo.tenant)
      await seedRoleUsers(client, demo, rolePasswordHash)
      await seedOperationalData(client, demo)
      for (const movement of movements) {
        await client.query(
          'INSERT INTO stock_movements(id,tenant_id,product_id,occurred_at,quantity_before,quantity_delta,quantity_after,unit_cost,value_delta,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            movement.id,
            demo.tenant,
            movement.product,
            movement.date,
            movement.before,
            movement.delta,
            movement.after,
            movement.unitCost,
            movement.valueDelta,
            movement,
          ],
        )
      }
      await client.query(
        'INSERT INTO audit(id,tenant_id,payload) VALUES($1,$2,$3)',
        [
          randomUUID(),
          demo.tenant,
          {
            id: randomUUID(),
            date: new Date().toISOString(),
            actor: demo.email,
            action: 'workspace_created',
            entity: 'security',
            detail: demo.organisation,
          },
        ],
      )
      await client.query('COMMIT')
      console.log(`Created ${demo.organisation} (${demo.tenant})`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
  console.log(`Demo password: ${password}`)
  console.log(`Role demo password: ${rolePassword}`)
} finally {
  await pool.end()
}

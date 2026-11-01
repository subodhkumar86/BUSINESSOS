import { MongoClient, type ClientSession } from 'mongodb'
import type { State, User } from '../../src/types'

export interface TenantDocument {
  _id: string
  state: State
  version: number
  plan: string
  createdAt: Date
  securityRevision?: number
}
export interface AccountDocument extends User {
  _id: string
  tenant: string
  password: string
  active: boolean
  sessionVersion: number
}
export interface SessionDocument {
  _id: string
  tenant: string
  userId: string
  csrf: string
  sessionVersion: number
  expiresAt: Date
}
export interface PlanDocument {
  _id: string
  features: string[]
  seatLimit: number
  price?: string
}
export interface EventDocument {
  _id: string
  tenant: string
  payload:
    | State['audit'][number]
    | State['journals'][number]
    | State['stockMovements'][number]
}
export interface RequestDocument {
  _id: string
  tenant: string
  key: string
  fingerprint: string
  response?: unknown
}
export interface RecordDocument {
  _id: string
  tenant: string
  kind: string
  data: Record<string, unknown>
  version: number
  created_at: string
  updated_at: string
}

const shared = globalThis as typeof globalThis & {
  businessosMongo?: Promise<MongoClient>
}
export async function database() {
  if (!shared.businessosMongo) {
    const url = process.env.MONGODB_URI || process.env.DATABASE_URL
    if (!url)
      throw Error('Set DATABASE_URL (or MONGODB_URI). See .env.example.')
    if (!/^mongodb(?:\+srv)?:\/\//.test(url))
      throw Error('DATABASE_URL must be a MongoDB connection string.')
    shared.businessosMongo = new MongoClient(url, {
      serverSelectionTimeoutMS: 5000,
    }).connect()
    shared.businessosMongo.catch(() => {
      shared.businessosMongo = undefined
    })
  }
  const client = await shared.businessosMongo
  // Without an override, use the database named in the MongoDB connection URI.
  const db = client.db(process.env.MONGODB_DB || undefined)
  return {
    client,
    db,
    tenants: db.collection<TenantDocument>('tenants'),
    users: db.collection<AccountDocument>('users'),
    sessions: db.collection<SessionDocument>('sessions'),
    plans: db.collection<PlanDocument>('plans'),
    audit: db.collection<EventDocument>('audit'),
    journals: db.collection<EventDocument>('journals'),
    stock: db.collection<EventDocument>('stock_movements'),
    requests: db.collection<RequestDocument>('requests'),
    records: db.collection<RecordDocument>('records'),
  }
}
export async function initializeDatabase() {
  const d = await database()
  // Sequential: safe on the first run when collections do not exist yet.
  await d.users.createIndex({ email: 1 }, { unique: true })
  await d.users.createIndex({ tenant: 1 })
  await d.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await d.sessions.createIndex({ tenant: 1, userId: 1 })
  await d.db
    .collection('rate_limits')
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  await d.records.createIndex({ tenant: 1, kind: 1, updated_at: -1 })
  await d.records.createIndex(
    { kind: 1, 'data.enabled': 1, 'data.next_run_at': 1 },
    { name: 'due_automation_schedules' },
  )
  await d.records.createIndex({ kind: 1, 'data.token_digest': 1 })
  await d.records.createIndex({
    kind: 1,
    'data.status': 1,
    'data.next_attempt_at': 1,
  })
  await d.records.createIndex(
    { tenant: 1, 'data.user_id': 1 },
    {
      unique: true,
      partialFilterExpression: { kind: 'security:mfa' },
      name: 'one_mfa_per_user',
    },
  )
  await d.records.createIndex(
    { tenant: 1, 'data.product_id': 1, 'data.location_id': 1 },
    {
      unique: true,
      partialFilterExpression: { kind: 'warehouse:balance' },
      name: 'one_product_location_balance',
    },
  )
  await d.records.createIndex(
    { tenant: 1, 'data.reference': 1 },
    {
      unique: true,
      partialFilterExpression: { kind: 'upi:receipt' },
      name: 'unique_upi_receipt_reference',
    },
  )
  await d.requests.createIndex({ tenant: 1, key: 1 }, { unique: true })
  await d.records.createIndex(
    { tenant: 1, 'data.product_id': 1 },
    {
      unique: true,
      partialFilterExpression: { kind: 'automation:stock_task' },
      name: 'one_stock_review_link_per_product',
    },
  )
  await d.records.createIndex(
    { tenant: 1 },
    {
      unique: true,
      partialFilterExpression: { kind: 'automation:stock_settings' },
      name: 'one_stock_automation_setting',
    },
  )
  for (const collection of [d.audit, d.journals, d.stock])
    await collection.createIndex({ tenant: 1 })
  for (const plan of [
    { _id: 'starter', features: ['core'], seatLimit: 5 },
    {
      _id: 'business',
      features: ['core', 'operations', 'reports'],
      seatLimit: 25,
    },
    {
      _id: 'business_pro',
      features: [
        'core',
        'operations',
        'reports',
        'automation',
        'forecast',
        'bank_feeds',
      ],
      seatLimit: 100,
    },
    {
      _id: 'enterprise',
      features: [
        'core',
        'operations',
        'reports',
        'automation',
        'forecast',
        'bank_feeds',
      ],
      seatLimit: 1000,
    },
  ])
    await d.plans.updateOne(
      { _id: plan._id },
      { $setOnInsert: plan },
      { upsert: true },
    )
  await d.db
    .collection<{ _id: string; version: number }>('schema')
    .updateOne({ _id: 'mongodb' }, { $set: { version: 1 } }, { upsert: true })
}
export async function transaction<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const { client } = await database()
  return client.withSession((session) =>
    session.withTransaction(() => fn(session), {
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' },
    }),
  )
}

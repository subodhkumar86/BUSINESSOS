import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  database,
  initializeDatabase,
  transaction,
} from '../server/mongo/database.ts'
import { hashPassword } from '../server/mongo/security.ts'
import { initialState, appendEvent } from '../server/mongo/workspace.ts'
import { passwordSchema } from '../server/security.ts'

const email = z
  .email()
  .parse(process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase())
const password = passwordSchema.parse(process.env.SUPER_ADMIN_PASSWORD)
const name = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .parse(process.env.SUPER_ADMIN_NAME || 'Platform Super Admin')
try {
  await initializeDatabase()
  const encoded = await hashPassword(password),
    d = await database()
  await transaction(async (session) => {
    await d.db
      .collection<{ _id: string; revision: number }>('platform_locks')
      .updateOne(
        { _id: 'super_admin' },
        { $inc: { revision: 1 } },
        { upsert: true, session },
      )
    const existing = await d.users.findOne({ role: 'super_admin' }, { session })
    if (existing && existing.email !== email)
      throw Error('A different platform administrator already exists.')
    if (existing) {
      await d.users.updateOne(
        { _id: existing._id },
        {
          $set: { name, password: encoded, active: true },
          $inc: { sessionVersion: 1 },
        },
        { session },
      )
      await d.sessions.deleteMany(
        { userId: existing.id, tenant: existing.tenant },
        { session },
      )
      await appendEvent(
        existing.tenant,
        'Trusted provisioning',
        'platform_admin_updated',
        existing.id,
        'Sessions revoked',
        session,
      )
    } else {
      const tenant = randomUUID(),
        id = randomUUID()
      if (await d.users.findOne({ email }, { session }))
        throw Error(
          'This email belongs to a business account. Use a dedicated administrator email.',
        )
      await d.tenants.insertOne(
        {
          _id: tenant,
          state: initialState('BusinessOS Platform', false),
          version: 0,
          plan: 'enterprise',
          createdAt: new Date(),
        },
        { session },
      )
      await d.users.insertOne(
        {
          _id: id,
          id,
          tenant,
          name,
          email,
          password: encoded,
          role: 'super_admin',
          active: true,
          sessionVersion: 0,
        },
        { session },
      )
      await appendEvent(
        tenant,
        'Trusted provisioning',
        'platform_admin_created',
        id,
        'Dedicated platform workspace',
        session,
      )
    }
  })
  console.log(
    'Platform administrator provisioned. No credentials were printed.',
  )
} finally {
  const d = await database()
  await d.client.close()
}

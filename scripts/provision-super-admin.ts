import { randomBytes, randomUUID, scrypt } from 'node:crypto'
import { promisify } from 'node:util'
import { Pool } from 'pg'

const derive = promisify(scrypt)
const email = process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase()
const password = process.env.SUPER_ADMIN_PASSWORD
const name = process.env.SUPER_ADMIN_NAME?.trim() || 'Platform Super Admin'

if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required.')
if (!email || !/^\S+@\S+\.\S+$/.test(email))
  throw Error('SUPER_ADMIN_EMAIL must be a valid email address.')
if (!password || password.length < 12)
  throw Error('SUPER_ADMIN_PASSWORD must be at least 12 characters.')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const client = await pool.connect()
try {
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(707018)')
  const existing = await client.query<{
    id: string
    email: string
  }>("SELECT id,email FROM users WHERE role='super_admin' FOR UPDATE")
  if (existing.rowCount && existing.rows[0].email !== email)
    throw Error(
      'A platform Super Admin already exists. Update that account through trusted administration instead.',
    )
  const tenant = await client.query<{ id: string }>(
    'SELECT id FROM tenants ORDER BY id LIMIT 1 FOR SHARE',
  )
  if (!tenant.rowCount) throw Error('Create a tenant before provisioning the Super Admin.')
  const salt = randomBytes(16).toString('hex')
  const hash = (await derive(password, salt, 64)) as Buffer
  const encoded = `${salt}:${hash.toString('hex')}`
  if (existing.rowCount) {
    await client.query(
      "UPDATE users SET name=$1,password=$2,active=true,session_version=session_version+1 WHERE id=$3 AND role='super_admin'",
      [name, encoded, existing.rows[0].id],
    )
    console.log(`Updated global Super Admin: ${email}`)
  } else {
    await client.query(
      "INSERT INTO users(id,tenant_id,email,name,password,role) VALUES($1,$2,$3,$4,$5,'super_admin')",
      [randomUUID(), tenant.rows[0].id, email, name, encoded],
    )
    console.log(`Provisioned global Super Admin: ${email}`)
  }
  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  client.release()
  await pool.end()
}

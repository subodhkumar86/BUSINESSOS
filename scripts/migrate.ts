import { Pool } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
  max: 1,
})
if (!process.env.DATABASE_URL)
  throw Error(
    'DATABASE_URL is required. Copy .env.example to .env and start PostgreSQL.',
  )
const client = await pool.connect()
try {
  await client.query('SELECT pg_advisory_lock(707017)')
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz DEFAULT now())',
  )
  for (const name of (
    await readdir(new URL('../server/migrations/', import.meta.url))
  )
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if (
      (
        await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [
          name,
        ])
      ).rowCount
    )
      continue
    await client.query('BEGIN')
    try {
      await client.query(
        await readFile(
          new URL('../server/migrations/' + name, import.meta.url),
          'utf8',
        ),
      )
      await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [
        name,
      ])
      await client.query('COMMIT')
      console.log('Applied', name)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    }
  }
} finally {
  await client.query('SELECT pg_advisory_unlock(707017)')
  client.release()
  await pool.end()
}

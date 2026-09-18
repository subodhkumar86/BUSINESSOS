// cPanel diagnostic helper: verifies the Node version, environment variables, the SPA
// build, PostgreSQL (including the row-security requirement) and Redis without a
// terminal.
//
// cPanel > Setup Node.js App > your application > Run JS script > scripts/cpanel-doctor.cjs
//
// It prints "FAIL" lines for anything that still needs fixing and exits non-zero.
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const appRoot = __dirname.replace(/[\\/]scripts$/, '')
process.chdir(appRoot)
const failures = []

function check(label, ok, detail) {
  console.log((ok ? 'OK   ' : 'FAIL ') + label + (detail ? ' - ' + detail : ''))
  if (!ok) failures.push(label)
}

function mask(url) {
  if (!url) return 'missing'
  return url.replace(/\/\/([^:@/]+):[^@/]*@/, '//$1:***@')
}

const envFile = join(appRoot, '.env')
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile)
    console.log('OK   .env loaded from the application root')
  } catch (error) {
    check('.env can be parsed', false, error.message)
  }
} else {
  console.log('INFO no .env file; using cPanel environment variables only')
}

const [major, minor] = process.versions.node.split('.').map(Number)
const typescript =
  process.features && typeof process.features.typescript === 'string'
    ? process.features.typescript
    : 'disabled'
console.log(
  'INFO Node.js ' + process.versions.node + ', type stripping: ' + typescript,
)
check(
  'Node.js runs TypeScript (>=22.18 or 24)',
  typescript === 'strip' || major > 22 || (major === 22 && minor >= 18),
  'select Node.js 22 (22.18+) or 24 in cPanel',
)
check(
  'SPA build present (dist/index.html)',
  existsSync(join(appRoot, 'dist', 'index.html')),
  'run scripts/cpanel-build.cjs',
)

const { DATABASE_URL, REDIS_URL, APP_ORIGIN, COOKIE_SECURE, NODE_ENV } =
  process.env
console.log('INFO NODE_ENV: ' + (NODE_ENV || 'undefined'))
console.log('INFO DATABASE_URL: ' + mask(DATABASE_URL))
console.log('INFO REDIS_URL: ' + mask(REDIS_URL))
console.log('INFO APP_ORIGIN: ' + (APP_ORIGIN || 'missing'))
console.log('INFO COOKIE_SECURE: ' + (COOKIE_SECURE || 'undefined'))
check('DATABASE_URL is set', Boolean(DATABASE_URL))
check('REDIS_URL is set', Boolean(REDIS_URL))
check('APP_ORIGIN is set', Boolean(APP_ORIGIN))
check(
  'APP_ORIGIN uses HTTPS',
  Boolean(
    APP_ORIGIN &&
    APP_ORIGIN.split(',').every((o) => o.trim().startsWith('https://')),
  ),
  'production requires https origins',
)
check('COOKIE_SECURE=true', COOKIE_SECURE === 'true', 'required in production')

async function checkDatabase() {
  if (!DATABASE_URL) return
  const { Pool } = require('pg')
  const pool = new Pool({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: 8000,
    max: 1,
  })
  try {
    const identity = await pool.query(
      'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
    )
    const row = identity.rows[0] || {}
    console.log(
      'INFO PostgreSQL role: ' +
        row.role +
        ' (rolsuper=' +
        row.rolsuper +
        ', rolbypassrls=' +
        row.rolbypassrls +
        ')',
    )
    check(
      'PostgreSQL role is not superuser/BYPASSRLS',
      row.rolsuper === false && row.rolbypassrls === false,
      'the API refuses to start with an administrator role',
    )
    const migrations = await pool.query(
      'SELECT count(*)::int AS applied FROM schema_migrations',
    )
    const applied = migrations.rows[0] ? migrations.rows[0].applied : 0
    check(
      'Migrations applied (' + applied + ' found)',
      applied > 0,
      'run scripts/cpanel-migrate.cjs',
    )
  } catch (error) {
    check('PostgreSQL connection', false, error.message)
  } finally {
    await pool.end().catch(() => {})
  }
}

async function checkRedis() {
  if (!REDIS_URL) return
  const { createClient } = require('redis')
  const client = createClient({
    url: REDIS_URL,
    socket: { connectTimeout: 8000 },
  })
  client.on('error', () => {})
  try {
    await client.connect()
    const pong = await client.ping()
    check('Redis connection', pong === 'PONG', 'PING -> ' + pong)
  } catch (error) {
    check('Redis connection', false, error.message)
  } finally {
    if (client.isOpen) await client.quit().catch(() => {})
  }
}

async function main() {
  await checkDatabase()
  await checkRedis()
  console.log('')
  if (failures.length) {
    console.log('Outstanding items: ' + failures.join('; '))
    process.exitCode = 1
  } else {
    console.log('All cPanel checks passed. Open APP_ORIGIN and sign in.')
  }
}

main().catch((error) => {
  check(
    'Diagnostics completed',
    false,
    error instanceof Error ? error.message : String(error),
  )
  process.exitCode = 1
})

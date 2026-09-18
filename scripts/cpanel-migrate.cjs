// cPanel helper that applies the PostgreSQL migrations without a terminal.
//
// Run it before the first request reaches the API:
// cPanel > Setup Node.js App > your application > Run JS script > scripts/cpanel-migrate.cjs
//
// It uses DATABASE_URL from the cPanel Environment variables section. If the host does
// not inject those variables into script runs, the .env file in the application root is
// loaded first (existing values are never overwritten), then `npm run db:migrate` runs
// in the application root so its own --env-file-if-exists=.env also applies.
const { execSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const appRoot = __dirname.replace(/[\\/]scripts$/, '')
process.chdir(appRoot)
const envFile = join(appRoot, '.env')
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile)
    console.log('Loaded ' + envFile)
  } catch (error) {
    console.error('Could not parse ' + envFile + ': ' + error.message)
  }
}
if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is missing. Add it to the application Environment variables or to .env.',
  )
  process.exitCode = 1
} else {
  try {
    const out = execSync('npm run db:migrate 2>&1', {
      encoding: 'utf8',
      timeout: 180000,
    })
    console.log(out)
  } catch (e) {
    console.log((e.stdout || '') + (e.message || String(e)))
    process.exitCode = 1
  }
}

// Optional cPanel helper that loads the documented demo tenants (Acme Trading Ltd,
// Northstar Services, Greenfield Studio) and one account per role.
//
// cPanel > Setup Node.js App > your application > Run JS script > scripts/cpanel-seed.cjs
//
// Run it only on a demo/staging workspace, never on a workspace with real data.
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
    const out = execSync('npm run db:seed-demo 2>&1', {
      encoding: 'utf8',
      timeout: 300000,
    })
    console.log(out)
  } catch (e) {
    console.log((e.stdout || '') + (e.message || String(e)))
    process.exitCode = 1
  }
}

// cPanel / Passenger startup file for BusinessOS.
//
// cPanel > Setup Node.js App (or Web Apps) > Application startup file: app.cjs
//
// Why this file exists: Passenger requires a startup file in the application root.
// BusinessOS runs its TypeScript server directly (Node >= 22.18 strips types at
// startup), so this CommonJS entry point loads the local .env file when present and
// then imports server/index.ts. Nothing here changes how the Docker/Render image runs.
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const appRoot = __dirname

// Passenger starts the process with an unpredictable working directory. BusinessOS
// resolves the `dist` folder relative to the working directory, so pin it to the
// application root before loading the server.
process.chdir(appRoot)

// Optional convenience for hosts where environment variables are easier to keep in a
// file: <app root>/.env is never committed. Variables already provided by cPanel
// (Environment variables section) always win, because loadEnvFile does not overwrite
// existing values.
const envFile = join(appRoot, '.env')
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile)
    console.log(JSON.stringify({ event: 'env_file_loaded', file: '.env' }))
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'env_file_error',
        message: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

const [major, minor] = process.versions.node.split('.').map(Number)
const typescript =
  process.features && typeof process.features.typescript === 'string'
    ? process.features.typescript
    : 'disabled'
const canStripTypes =
  typescript === 'strip' || major > 22 || (major === 22 && minor >= 18)

if (!canStripTypes) {
  console.error(
    JSON.stringify({
      event: 'unsupported_node_version',
      node: process.versions.node,
      required: '>=22.18.0',
      hint: 'Select Node.js 22 (22.18 or newer) or Node.js 24 for this application in cPanel, then restart the app.',
    }),
  )
  process.exit(1)
}

// cPanel sets NODE_ENV from the Application mode. If it is missing, assume a
// Passenger-managed deployment is a live deployment so the API serves `dist`, keeps
// secure cookies and enforces HTTPS origins.
const underPassenger = Object.keys(process.env).some((key) =>
  key.startsWith('PASSENGER_'),
)
if (underPassenger && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production'
  console.log(
    JSON.stringify({ event: 'node_env_defaulted', value: 'production' }),
  )
}
if (process.env.NODE_ENV !== 'production')
  console.log(
    JSON.stringify({
      event: 'node_env_warning',
      value: process.env.NODE_ENV || 'undefined',
      hint: 'Set Application mode to Production in cPanel so the SPA build and secure cookies are used.',
    }),
  )

// server/index.ts listens on the first http.Server it creates; Passenger ignores the
// port and host arguments and forwards requests to that server over its own socket.
import('./server/index.ts').catch((error) => {
  console.error(
    JSON.stringify({
      event: 'startup_failed',
      message: error instanceof Error ? error.message : String(error),
      hint: 'Check the values in .env or in the cPanel Environment variables section, then restart the application.',
    }),
  )
  // Exit non-zero so Passenger reports a clear startup error instead of timing out.
  process.exit(1)
})

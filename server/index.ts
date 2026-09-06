import { createApp } from './app.ts'
import { resolve } from 'node:path'
const { DATABASE_URL, REDIS_URL, APP_ORIGIN } = process.env
if (!DATABASE_URL || !REDIS_URL || !APP_ORIGIN)
  throw Error(
    'Set DATABASE_URL, REDIS_URL and APP_ORIGIN in .env. See .env.example.',
  )
const production = process.env.NODE_ENV === 'production'
const origins = APP_ORIGIN.split(',').map((value) => {
  const input = value.trim()
  try {
    const parsed = new URL(input)
    if (
      !input ||
      parsed.origin === 'null' ||
      parsed.origin !== input.replace(/\/$/, '') ||
      parsed.username ||
      parsed.password
    )
      throw Error('invalid origin')
    return parsed.origin
  } catch {
    throw Error(
      'APP_ORIGIN must contain comma-separated absolute origins only.',
    )
  }
})
if (production && process.env.COOKIE_SECURE !== 'true')
  throw Error('Production requires COOKIE_SECURE=true.')
if (production && origins.some((origin) => !origin.startsWith('https://')))
  throw Error('Production APP_ORIGIN values must use HTTPS.')
const port = Number(process.env.PORT || 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error('PORT must be a valid TCP port number.')
const app = await createApp({
  databaseUrl: DATABASE_URL,
  redisUrl: REDIS_URL,
  origins,
  secure: process.env.COOKIE_SECURE === 'true',
  staticDir: production ? resolve('dist') : undefined,
})
app.server.listen(
  port,
  process.env.API_HOST || (production ? '0.0.0.0' : '127.0.0.1'),
  () => console.log('BusinessOS API ready on port ' + port),
)
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0))
  })

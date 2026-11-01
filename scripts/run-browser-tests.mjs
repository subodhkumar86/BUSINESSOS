import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { once } from 'node:events'

// Own the server directly so Windows teardown can stop the complete Next.js
// process tree without relying on Playwright's intermediate command shell.
const env = { ...process.env }
delete env.BUSINESSOS_BROWSER_TEST
env.NODE_ENV = 'production'
env.NEXT_TELEMETRY_DISABLED = '1'
if (!env.PLAYWRIGHT_BROWSERS_PATH && existsSync('.cache/playwright'))
  env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright')
let server, runner
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return
  if (process.platform === 'win32') {
    child.kill()
  } else {
    // Both direct children are process-group leaders on Unix.
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error.code !== 'ESRCH') throw error
    }
  }
}
async function cleanup() {
  await stop(runner)
  await stop(server)
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143))
  })
try {
  if (!env.E2E_BASE_URL) {
    if (!existsSync('.next/BUILD_ID'))
      throw Error('Run npm run build before browser tests.')
    const socket = createServer()
    socket.listen(0, '127.0.0.1')
    await once(socket, 'listening')
    const port = socket.address().port
    await new Promise((resolve, reject) =>
      socket.close((error) => (error ? reject(error) : resolve())),
    )
    env.E2E_BASE_URL = `http://127.0.0.1:${port}`
    server = spawn(
      process.execPath,
      ['scripts/browser-server.mjs', String(port)],
      {
        env,
        stdio: 'inherit',
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    )
    let launchError
    server.once('error', (error) => {
      launchError = error
    })
    const deadline = Date.now() + 120000
    let ready = false
    while (Date.now() < deadline) {
      if (launchError) throw launchError
      if (server.exitCode !== null || server.signalCode !== null)
        throw Error('Browser test server exited before becoming ready.')
      try {
        ready = (
          await fetch(env.E2E_BASE_URL + '/login', {
            signal: AbortSignal.timeout(5000),
          })
        ).ok
      } catch {
        /* Server is starting. */
      }
      if (ready) break
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    if (!ready)
      throw Error(
        'Browser test server did not become ready within 120 seconds.',
      )
  }
  runner = spawn(
    process.execPath,
    ['node_modules/playwright/cli.js', 'test', ...process.argv.slice(2)],
    {
      env,
      stdio: 'inherit',
      windowsHide: true,
      detached: process.platform !== 'win32',
    },
  )
  const [code] = await once(runner, 'exit')
  process.exitCode = code ?? 1
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Browser tests could not run.',
  )
  process.exitCode = 1
} finally {
  await cleanup()
}

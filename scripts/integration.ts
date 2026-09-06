import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
const project = 'bos-test-' + randomUUID().slice(0, 8)
function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env,
      shell: false,
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(Error(`${command} exited with code ${code}`)),
    )
  })
}
const compose = ['compose', '-p', project, '-f', 'compose.test.yaml']
const database =
    'postgresql://businessos_app:test_app_only@127.0.0.1:55432/businessos_test',
  redis = 'redis://127.0.0.1:56379/15'
let started = false
try {
  const info = await promisify(execFile)(
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    { timeout: 15000, windowsHide: true },
  )
  if (!/^\d+\./.test(info.stdout.trim()))
    throw Error(info.stderr.trim() || 'Docker engine is unavailable.')
  started = true
  await run('docker', [
    ...compose,
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    '90',
  ])
  await run(process.execPath, ['scripts/migrate.ts'], {
    ...process.env,
    DATABASE_URL: database,
  })
  // Running twice checks that applied migrations are not re-executed.
  await run(process.execPath, ['scripts/migrate.ts'], {
    ...process.env,
    DATABASE_URL: database,
  })
  await run(process.execPath, ['--test', 'tests/api.test.ts'], {
    ...process.env,
    TEST_DATABASE_URL: database,
    TEST_REDIS_URL: redis,
  })
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  if (started) {
    try {
      await run('docker', [...compose, 'down', '--timeout', '5'])
    } catch (e) {
      console.error(
        'Test container cleanup failed:',
        e instanceof Error ? e.message : e,
      )
      process.exitCode = 1
    }
  }
}

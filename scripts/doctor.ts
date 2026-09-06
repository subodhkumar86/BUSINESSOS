import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
const exec = promisify(execFile)
console.log('Node:', process.versions.node)
console.log(
  'Environment file:',
  existsSync('.env') ? 'present' : 'missing; copy .env.example to .env',
)
try {
  const { stdout, stderr } = await exec(
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    { timeout: 15000, windowsHide: true },
  )
  if (!/^\d+\./.test(stdout.trim()))
    throw Error(stderr.trim() || 'Docker did not report a running engine.')
  console.log('Docker engine:', stdout.trim())
  console.log('Ready to run: npm run test:stack')
} catch (e) {
  console.error(
    'Docker engine is unavailable. Start or repair Docker Desktop before running PostgreSQL/Redis.',
  )
  const result = e as { stderr?: string; message?: string }
  console.error(
    (result.stderr || result.message || 'Unknown Docker error').trim(),
  )
  process.exitCode = 1
}

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { fail } from './security'

function key() {
  const value =
    process.env.APP_ENCRYPTION_KEY || process.env.CONNECTOR_ENCRYPTION_KEY || ''
  const bytes = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64')
  if (bytes.length !== 32)
    fail(503, 'Set a 32-byte APP_ENCRYPTION_KEY for MFA and recovery delivery.')
  return bytes
}
export function seal(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}
export function unseal(value: string) {
  const bytes = Buffer.from(value, 'base64'),
    cipher = createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12))
  cipher.setAuthTag(bytes.subarray(12, 28))
  return Buffer.concat([
    cipher.update(bytes.subarray(28)),
    cipher.final(),
  ]).toString('utf8')
}

import { createHmac, randomBytes } from 'node:crypto'
const STEP = 30, DIGITS = 6
export function newMfaSecret() { return randomBytes(20).toString('base64url') }
function counter(at = Date.now()) { return Math.floor(at / 1000 / STEP) }
export function mfaCode(secret: string, at = Date.now()) {
  const count = Buffer.alloc(8)
  count.writeBigUInt64BE(BigInt(counter(at)))
  const code = parseInt(createHmac('sha1', Buffer.from(secret, 'base64url')).update(count).digest('hex').slice(-8), 16) % 10 ** DIGITS
  return String(code).padStart(DIGITS, '0')
}
export function verifyMfaCode(secret: string, code: string, at = Date.now()) {
  return [-1, 0, 1].some((skew) => mfaCode(secret, at + skew * STEP * 1000) === code)
}

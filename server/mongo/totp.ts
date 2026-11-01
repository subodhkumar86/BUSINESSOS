import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export function newSecret() {
  let bits = ''
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0')
  return bits
    .match(/.{5}/g)!
    .map((chunk) => alphabet[parseInt(chunk, 2)])
    .join('')
}
export function totp(secret: string, counter: number) {
  const bits = [...secret.toUpperCase()]
    .map((c) => {
      const index = alphabet.indexOf(c)
      if (index < 0) throw Error('Invalid authenticator secret.')
      return index.toString(2).padStart(5, '0')
    })
    .join('')
  const key = Buffer.from(
      (bits.match(/.{8}/g) || []).map((byte) => parseInt(byte, 2)),
    ),
    count = Buffer.alloc(8)
  count.writeBigUInt64BE(BigInt(counter))
  const mac = createHmac('sha1', key).update(count).digest(),
    offset = mac[mac.length - 1] & 15
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  )
}
export function verifyTotp(secret: string, code: string, at = Date.now()) {
  if (!/^\d{6}$/.test(code)) return undefined
  const now = Math.floor(at / 30000)
  for (const counter of [now, now - 1, now + 1])
    if (timingSafeEqual(Buffer.from(totp(secret, counter)), Buffer.from(code)))
      return counter
}

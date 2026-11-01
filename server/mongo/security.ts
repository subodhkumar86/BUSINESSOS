import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import {
  database,
  type AccountDocument,
  type SessionDocument,
} from './database'
const derive = promisify(scrypt)
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export function fail(status: number, message: string): never {
  throw new HttpError(status, message)
}
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')
export const publicUser = (user: AccountDocument) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  employeeId: user.employeeId || null,
})
export async function hashPassword(value: string) {
  const salt = randomBytes(16).toString('hex')
  return (
    salt + ':' + ((await derive(value, salt, 64)) as Buffer).toString('hex')
  )
}
export async function passwordMatches(value: string, stored: string) {
  const [salt, expected] = stored.split(':')
  const actual = (await derive(value, salt, 64)) as Buffer
  const target = Buffer.from(expected, 'hex')
  return target.length === actual.length && timingSafeEqual(target, actual)
}
export function allowedOrigins() {
  const values = (
    process.env.APP_ORIGIN || 'http://127.0.0.1:3000,http://localhost:3000'
  )
    .split(',')
    .map((v) => new URL(v.trim()).origin)
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.COOKIE_SECURE !== 'true' ||
      values.some((v) => !v.startsWith('https://')))
  ) {
    throw Error('Production requires HTTPS APP_ORIGIN and COOKIE_SECURE=true.')
  }
  return values
}
export function validateOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin || !allowedOrigins().includes(origin))
    fail(403, 'Request origin is not permitted.')
}
export function cookie(value: string, maxAge = 28800) {
  return `bos_session=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${maxAge}${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`
}
export async function issueSession(account: AccountDocument) {
  const token = randomBytes(32).toString('hex')
  const session: SessionDocument = {
    _id: digest(token),
    tenant: account.tenant,
    userId: account.id,
    sessionVersion: account.sessionVersion,
    csrf: randomBytes(32).toString('hex'),
    expiresAt: new Date(Date.now() + 28800000),
  }
  const d = await database()
  await d.sessions.insertOne(session)
  return { session, token }
}
export async function authenticate(request: Request) {
  const token = /(?:^|;\s*)bos_session=([a-f0-9]{64})(?:;|$)/.exec(
    request.headers.get('cookie') || '',
  )?.[1]
  if (!token) fail(401, 'Sign in to continue.')
  const d = await database()
  // Expiration is checked in the query; TTL cleanup is asynchronous.
  const session = await d.sessions.findOne({
    _id: digest(token),
    expiresAt: { $gt: new Date() },
  })
  if (!session) fail(401, 'Session expired. Sign in again.')
  const account = await d.users.findOne({
    _id: session.userId,
    tenant: session.tenant,
    active: true,
    sessionVersion: session.sessionVersion,
  })
  if (!account) fail(401, 'Session expired. Sign in again.')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    validateOrigin(request)
    if (request.headers.get('x-csrf-token') !== session.csrf)
      fail(403, 'Invalid CSRF token.')
  }
  return { session, account }
}
export function requireRole(account: AccountDocument, roles: string[]) {
  if (!roles.includes(account.role))
    fail(403, 'You do not have permission to perform this action.')
}
export async function throttle(key: string, maximum = 20) {
  const d = await database(),
    bucket = Math.floor(Date.now() / 60000)
  const limits = d.db.collection<{
    _id: string
    count: number
    expiresAt: Date
  }>('rate_limits')
  const row = await limits.findOneAndUpdate(
    { _id: digest(key) + ':' + bucket },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 2) * 60000) },
    },
    { upsert: true, returnDocument: 'after' },
  )
  if ((row?.count || 0) > maximum)
    fail(429, 'Too many attempts. Please try again in a minute.')
}

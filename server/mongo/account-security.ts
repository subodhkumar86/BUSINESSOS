import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { database, transaction, type AccountDocument } from './database'
import {
  allowedOrigins,
  digest,
  fail,
  hashPassword,
  passwordMatches,
  throttle,
  validateOrigin,
} from './security'
import { appendEvent } from './workspace'
import {
  findRecord,
  insertRecord,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'
import { passwordSchema } from '../security'
import { seal, unseal } from './vault'
import { newSecret, verifyTotp } from './totp'

export async function checkLoginMfa(account: AccountDocument, code: unknown) {
  const d = await database(),
    row = await d.records.findOne({
      tenant: account.tenant,
      kind: 'security:mfa',
      'data.user_id': account.id,
      'data.enabled': true,
    })
  if (!row) return
  const counter = verifyTotp(
    unseal(String(row.data.secret)),
    typeof code === 'string' ? code : '',
  )
  if (counter === undefined || counter <= Number(row.data.last_counter || 0))
    fail(401, 'Enter a fresh code from your authenticator app.')
  const result = await d.records.updateOne(
    {
      _id: row._id,
      tenant: account.tenant,
      kind: 'security:mfa',
      version: row.version,
    },
    { $set: { 'data.last_counter': counter }, $inc: { version: 1 } },
  )
  if (!result.modifiedCount)
    fail(401, 'Authenticator code was already used. Wait for a new code.')
}
export async function publicAccountSecurity(
  request: Request,
  path: string,
  input: () => Promise<unknown>,
): Promise<Response | undefined> {
  if (
    !['/auth/password-reset/request', '/auth/password-reset/confirm'].includes(
      path,
    )
  )
    return
  if (request.method !== 'POST') fail(405, 'Method not supported.')
  validateOrigin(request)
  await throttle('recovery:global', 100)
  const d = await database()
  if (path.endsWith('/request')) {
    const b = z
      .object({
        email: z
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
      })
      .strict()
      .parse(await input())
    await throttle('recovery:' + b.email, 5)
    const development =
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_DEVELOPMENT_RESET_TOKENS === 'true'
    // Validate production delivery encryption uniformly, before account lookup.
    if (!development) seal('configuration-check')
    const account = await d.users.findOne({ email: b.email, active: true })
    let token: string | undefined
    if (account) {
      token = randomBytes(32).toString('hex')
      const value = token
      await transaction(async (session) => {
        const latest = await d.users.findOne(
          {
            _id: account._id,
            active: true,
            sessionVersion: account.sessionVersion,
          },
          { session },
        )
        if (!latest) return
        await d.tenants.updateOne(
          { _id: account.tenant },
          { $inc: { securityRevision: 1 } },
          { session },
        )
        await d.records.deleteMany(
          {
            tenant: account.tenant,
            kind: 'security:reset',
            'data.user_id': account.id,
          },
          { session },
        )
        await insertRecord(
          account.tenant,
          'security:reset',
          {
            user_id: account.id,
            token_digest: digest(value),
            session_version: account.sessionVersion,
            expires_at: new Date(Date.now() + 1800000).toISOString(),
          },
          session,
        )
        if (!development) {
          const link = allowedOrigins()[0] + '/reset-password#token=' + value
          await insertRecord(
            account.tenant,
            'outbox',
            {
              channel: 'email',
              recipient: account.email,
              subject: 'Reset your BusinessOS password',
              body: '',
              encrypted_body: seal(
                'Use this one-time link within 30 minutes: ' + link,
              ),
              sensitive: true,
              status: 'queued',
              attempts: 0,
              provider: 'configured-webhook',
              expires_at: new Date(Date.now() + 1800000).toISOString(),
            },
            session,
          )
        }
      })
    }
    return Response.json(
      {
        ok: true,
        ...(development && token ? { developmentToken: token } : {}),
        message: 'If the account exists, a recovery request has been prepared.',
      },
      { status: 202 },
    )
  }
  const b = z
    .object({
      token: z.string().regex(/^[a-f0-9]{64}$/),
      newPassword: passwordSchema,
    })
    .strict()
    .parse(await input())
  const password = await hashPassword(b.newPassword)
  await transaction(async (session) => {
    const token = await d.records.findOne(
      {
        kind: 'security:reset',
        'data.token_digest': digest(b.token),
        'data.expires_at': { $gt: new Date().toISOString() },
      },
      { session },
    )
    if (!token) fail(400, 'Reset code is invalid or expired.')
    const user = await d.users.findOne(
      {
        _id: String(token.data.user_id),
        tenant: token.tenant,
        active: true,
        sessionVersion: Number(token.data.session_version),
      },
      { session },
    )
    if (!user) fail(400, 'Reset code is invalid or expired.')
    await d.tenants.updateOne(
      { _id: token.tenant },
      { $inc: { securityRevision: 1 } },
      { session },
    )
    await d.users.updateOne(
      { _id: user._id, tenant: token.tenant },
      { $set: { password }, $inc: { sessionVersion: 1 } },
      { session },
    )
    await d.sessions.deleteMany(
      { tenant: token.tenant, userId: user.id },
      { session },
    )
    await d.records.deleteOne(
      { _id: token._id, tenant: token.tenant },
      { session },
    )
    await appendEvent(
      token.tenant,
      user.email,
      'password_reset',
      user.id,
      'Previous sessions revoked; MFA remains enabled.',
      session,
    )
  })
  return Response.json({ ok: true })
}

export async function handleAccountSecurity(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (!['/auth/mfa', '/auth/mfa/confirm'].includes(ctx.path)) return
  const { account, request, path } = ctx,
    tenant = account.tenant,
    method = request.method,
    d = await database()
  const filter = { tenant, kind: 'security:mfa', 'data.user_id': account.id }
  if (method === 'GET' && path === '/auth/mfa') {
    const row = await d.records.findOne(filter)
    return Response.json({
      enabled: row?.data.enabled === true,
      pending: !!row?.data.pending_secret,
    })
  }
  if (method === 'POST' && path === '/auth/mfa') {
    const secret = newSecret(),
      encrypted = seal(secret)
    return Response.json(
      await mutate(ctx, {}, async (session) => {
        const row = await d.records.findOne(filter, { session })
        if (row?.data.enabled)
          fail(409, 'MFA is already enabled. Disable it before re-enrolling.')
        const data = {
          user_id: account.id,
          pending_secret: encrypted,
          pending_expires_at: new Date(Date.now() + 600000).toISOString(),
          enabled: false,
        }
        if (row) await updateRecord(row, data, session)
        else await insertRecord(tenant, 'security:mfa', data, session)
        return {
          secret,
          otpauthUrl:
            'otpauth://totp/' +
            encodeURIComponent('BusinessOS:' + account.email) +
            '?secret=' +
            secret +
            '&issuer=BusinessOS&algorithm=SHA1&digits=6&period=30',
        }
      }),
    )
  }
  if (!(
    (method === 'POST' && path.endsWith('/confirm')) ||
    (method === 'DELETE' && path === '/auth/mfa')
  ))
    fail(405, 'Method not supported.')
  await throttle('mfa:' + tenant + ':' + account.id, 10)
  const input = z
    .object({
      code: z.string().regex(/^\d{6}$/),
      currentPassword: z.string().min(1).max(128),
    })
    .strict()
    .parse(await ctx.input())
  if (!(await passwordMatches(input.currentPassword, account.password)))
    fail(403, 'Current password is incorrect.')
  return Response.json(
    await mutate(ctx, { code: '[redacted]' }, async (session) => {
      const found = await d.records.findOne(filter, { session })
      if (!found) fail(409, 'Start MFA enrollment first.')
      const row = await findRecord(tenant, 'security:mfa', found._id, session),
        confirming = method === 'POST'
      if (
        confirming &&
        (!row.data.pending_secret ||
          String(row.data.pending_expires_at) <= new Date().toISOString())
      )
        fail(409, 'Enrollment expired. Start again.')
      const encrypted = String(
        confirming ? row.data.pending_secret : row.data.secret,
      )
      if (!confirming && !row.data.enabled) fail(409, 'MFA is not enabled.')
      const counter = verifyTotp(unseal(encrypted), input.code)
      if (
        counter === undefined ||
        (!confirming && counter <= Number(row.data.last_counter))
      )
        fail(403, 'Enter a fresh authenticator code.')
      await updateRecord(
        row,
        {
          enabled: confirming,
          secret: confirming ? encrypted : null,
          pending_secret: null,
          pending_expires_at: null,
          last_counter: counter,
        },
        session,
      )
      await d.users.updateOne(
        { _id: account.id, tenant },
        { $inc: { sessionVersion: 1 } },
        { session },
      )
      await d.sessions.deleteMany({ tenant, userId: account.id }, { session })
      return { enabled: confirming }
    }),
  )
}

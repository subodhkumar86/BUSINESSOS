import { createCipheriv, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { database } from './database'
import { fail, requireRole } from './security'
import {
  expose,
  findRecord,
  insertRecord,
  listRecords,
  mutate,
  updateRecord,
  type WorkflowContext,
} from './records'
import { readWorkspace } from './workspace'
import { metrics } from '../../src/domain'
import { deliveryAdapter } from '../notify'
import { deliverOutboxMessage } from './outbox'

const text = z.string().trim().min(1).max(200)
const operationalReaders = [
  'owner',
  'finance_admin',
  'hr_admin',
  'operations_manager',
  'department_manager',
  'auditor',
]
export async function handleControls(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const { path, account, request } = ctx,
    tenant = account.tenant,
    method = request.method,
    d = await database()
  const campaignQueue = path.match(/^\/marketing\/campaigns\/([^/]+)\/queue$/)
  if (campaignQueue || path === '/workflows/appointments/reminders/run') {
    requireRole(account, ['owner', 'sales_crm_user'])
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = campaignQueue
      ? z
          .object({ subject: text, body: z.string().trim().min(1).max(8000) })
          .strict()
          .parse(await ctx.input())
      : z
          .object({})
          .strict()
          .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        let queued = 0,
          skipped = 0
        if (campaignQueue) {
          const id = z.uuid().parse(campaignQueue[1]),
            campaign = await findRecord(tenant, 'campaign', id, session)
          if (!['planning', 'active'].includes(String(campaign.data.status)))
            fail(409, 'Only planning or active campaigns may queue messages.')
          const content = input as { subject: string; body: string }
          const contacts = await d.records
            .find(
              {
                tenant,
                kind: 'customer',
                'data.status': 'active',
                'data.marketing_opt_in': true,
              },
              { session },
            )
            .limit(500)
            .toArray()
          for (const contact of contacts) {
            if (!z.email().safeParse(contact.data.email).success) continue
            if (
              await d.records.findOne(
                {
                  tenant,
                  kind: 'outbox',
                  'data.campaign_id': id,
                  'data.customer_id': contact._id,
                },
                { session },
              )
            ) {
              skipped++
              continue
            }
            await insertRecord(
              tenant,
              'outbox',
              {
                channel: 'email',
                recipient: contact.data.email,
                ...content,
                campaign_id: id,
                customer_id: contact._id,
                status: 'queued',
                attempts: 0,
                provider: deliveryAdapter().provider,
              },
              session,
            )
            queued++
          }
        } else {
          const now = Date.now(),
            appointments = await d.records
              .find(
                {
                  tenant,
                  kind: 'workflow:appointments',
                  'data.status': 'scheduled',
                },
                { session },
              )
              .limit(500)
              .toArray()
          for (const appointment of appointments) {
            const values = appointment.data.values as Record<string, unknown>
            if (
              !values.reminderAt ||
              !z.email().safeParse(values.guestEmail).success ||
              Date.parse(String(values.reminderAt)) > now ||
              Date.parse(String(values.startAt)) <= now
            )
              continue
            if (
              await d.records.findOne(
                {
                  tenant,
                  kind: 'outbox',
                  'data.appointment_id': appointment._id,
                },
                { session },
              )
            ) {
              skipped++
              continue
            }
            await insertRecord(
              tenant,
              'outbox',
              {
                channel: 'email',
                recipient: values.guestEmail,
                subject: 'Appointment reminder: ' + values.title,
                body:
                  String(values.title) +
                  ' starts at ' +
                  values.startAt +
                  ' in ' +
                  values.room,
                appointment_id: appointment._id,
                status: 'queued',
                attempts: 0,
                provider: deliveryAdapter().provider,
              },
              session,
            )
            queued++
          }
        }
        return { queued, skipped }
      }),
    )
  }
  if (path === '/connectors') {
    requireRole(account, ['owner'])
    if (method === 'GET')
      return Response.json({
        connectors: (
          await d.records
            .find(
              { tenant, kind: 'connector' },
              { projection: { 'data.encrypted_credentials': 0 } },
            )
            .sort({ created_at: -1 })
            .toArray()
        ).map((row) => expose(row)),
      })
    if (method !== 'POST') fail(405, 'Method not supported.')
    const input = z
      .object({
        category: z.enum([
          'email',
          'sms',
          'whatsapp',
          'payment',
          'three_pl',
          'bank_feed',
        ]),
        provider: text,
        version: z.number().int().positive().optional(),
        status: z.enum(['draft', 'sandbox', 'active', 'disabled']),
        configuration: z
          .object({
            sender: z.string().trim().max(200).default(''),
            webhookUrl: z.union([z.literal(''), z.url().max(1000)]).default(''),
          })
          .strict(),
        credentials: z
          .object({ apiKey: z.string().min(1).max(4000) })
          .strict()
          .optional(),
      })
      .strict()
      .parse(await ctx.input())
    if (input.category === 'bank_feed' && !ctx.features.includes('bank_feeds'))
      fail(403, 'Your plan does not include bank feeds.')
    let encrypted: string | undefined
    if (input.credentials) {
      const configured = process.env.CONNECTOR_ENCRYPTION_KEY || ''
      const key = /^[a-f0-9]{64}$/i.test(configured)
        ? Buffer.from(configured, 'hex')
        : Buffer.from(configured, 'base64')
      if (key.length !== 32)
        fail(
          503,
          'Set a 32-byte CONNECTOR_ENCRYPTION_KEY before saving credentials.',
        )
      const iv = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([
        cipher.update(JSON.stringify(input.credentials)),
        cipher.final(),
      ])
      encrypted = Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString(
        'base64',
      )
    }
    return Response.json(
      await mutate(
        ctx,
        { ...input, credentials: input.credentials ? '[redacted]' : undefined },
        async (session) => {
          const old = await d.records.findOne(
            {
              tenant,
              kind: 'connector',
              'data.category': input.category,
              'data.provider': input.provider,
            },
            { session },
          )
          const data = {
            category: input.category,
            provider: input.provider,
            status: input.status,
            configuration: input.configuration,
            ...(encrypted ? { encrypted_credentials: encrypted } : {}),
          }
          if (old && old.version !== input.version)
            fail(409, 'Connector changed. Refresh and reopen it before saving.')
          if (!old && input.version !== undefined)
            fail(
              409,
              'Connector no longer matches the selected provider. Create a new connector instead.',
            )
          const saved = old
            ? await updateRecord(old, data, session)
            : await insertRecord(tenant, 'connector', data, session)
          const { encrypted_credentials: _credentials, ...visible } = saved.data
          return { ...visible, id: saved._id, version: saved.version }
        },
      ),
      { status: 201 },
    )
  }
  if (path === '/ai/forecasts' || path === '/ai/forecast') {
    requireRole(account, operationalReaders)
    if (method === 'GET' && path === '/ai/forecasts')
      return Response.json({ forecasts: await listRecords(tenant, 'forecast') })
    requireRole(account, ['owner', 'finance_admin', 'operations_manager'])
    if (method !== 'POST' || path !== '/ai/forecast')
      fail(405, 'Method not supported.')
    if (!ctx.features.includes('forecast'))
      fail(403, 'Your plan does not include scenario runs.')
    const input = z
      .object({ metric: z.enum(['cash', 'pipeline', 'inventory']) })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const current = await readWorkspace(tenant, session),
          state = current.state,
          m = metrics(state)
        const value =
          input.metric === 'inventory'
            ? state.products.reduce((sum, p) => sum + p.qty * p.cost, 0)
            : input.metric === 'pipeline'
              ? state.leads
                  .filter((l) => !['Won', 'Lost'].includes(l.status))
                  .reduce((sum, l) => sum + l.amount, 0)
              : m.cash
        return expose(
          await insertRecord(
            tenant,
            'forecast',
            {
              metric: input.metric,
              engine: 'constant-baseline-v1',
              status: 'completed',
              value: Math.round(value * 100) / 100,
              source_version: current.version,
              data_window: new Date().toISOString(),
              assumptions:
                'Current recorded value held constant; no trained model or prediction of future events.',
              points: [1, 2, 3].map((month) => ({
                month,
                value: Math.round(value * 100) / 100,
              })),
            },
            session,
          ),
        )
      }),
      { status: 201 },
    )
  }
  const backup = path.match(/^\/admin\/backups(?:\/([^/]+))?$/)
  if (backup) {
    requireRole(account, ['owner'])
    const id = backup[1] ? z.uuid().parse(backup[1]) : undefined
    if (method === 'GET') {
      if (id) {
        const row = await findRecord(tenant, 'backup', id)
        return new Response(JSON.stringify(row.data), {
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition':
              'attachment; filename="businessos-workspace-backup.json"',
          },
        })
      }
      return Response.json({
        backups: (
          await d.records
            .find(
              { tenant, kind: 'backup' },
              { projection: { 'data.snapshot': 0 } },
            )
            .sort({ created_at: -1 })
            .toArray()
        ).map((row) => expose(row)),
      })
    }
    if (method !== 'POST' || id) fail(405, 'Method not supported.')
    const input = z
      .object({ label: text })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const current = await readWorkspace(tenant, session)
        const records = await d.records
          .find(
            {
              tenant,
              kind: {
                $nin: [
                  'backup',
                  'connector',
                  'notification:read',
                  'security:mfa',
                  'security:reset',
                  'outbox',
                ],
              },
            },
            { session },
          )
          .toArray()
        const snapshot = {
          state: current.state,
          records,
          source_version: current.version,
        }
        if (Buffer.byteLength(JSON.stringify(snapshot)) > 12 * 1024 * 1024)
          fail(
            413,
            'Workspace exceeds the inline backup limit. Use a database-managed backup.',
          )
        const saved = await insertRecord(
          tenant,
          'backup',
          {
            label: input.label,
            format: 'businessos-workspace-v1',
            snapshot,
            scope:
              'Business records only. Accounts, sessions and connector secrets are excluded.',
          },
          session,
        )
        return {
          id: saved._id,
          label: input.label,
          download: '/api/v1/admin/backups/' + saved._id,
        }
      }),
      { status: 201 },
    )
  }
  const outbox = path.match(/^\/notifications\/outbox(?:\/([^/]+)\/deliver)?$/)
  if (!outbox) return
  requireRole(account, operationalReaders)
  if (method === 'GET' && !outbox[1])
    return Response.json({
      messages: (
        await d.records
          .find(
            { tenant, kind: 'outbox' },
            { projection: { 'data.encrypted_body': 0 } },
          )
          .sort({ created_at: -1 })
          .limit(500)
          .toArray()
      ).map((row) => expose(row)),
    })
  requireRole(account, ['owner', 'operations_manager'])
  if (method !== 'POST') fail(405, 'Method not supported.')
  if (!outbox[1]) {
    const input = z
      .object({
        channel: z.enum(['email', 'sms', 'whatsapp', 'push']),
        recipient: z.string().trim().min(1).max(254),
        subject: z.string().trim().max(200).default(''),
        body: z.string().trim().min(1).max(8000),
      })
      .strict()
      .refine(
        (b) =>
          b.channel !== 'email' || z.email().safeParse(b.recipient).success,
        'Enter a valid recipient email.',
      )
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) =>
        expose(
          await insertRecord(
            tenant,
            'outbox',
            {
              ...input,
              status: 'queued',
              attempts: 0,
              provider: deliveryAdapter().provider,
              error: '',
            },
            session,
          ),
        ),
      ),
      { status: 201 },
    )
  }
  return Response.json(
    await deliverOutboxMessage(
      tenant,
      z.uuid().parse(outbox[1]),
      account.email,
      ctx.checkCurrent,
    ),
  )
}

import { database } from './database'
import { fail, requireRole } from './security'
import {
  insertRecord,
  updateRecord,
  mutate,
  expose,
  listRecords,
  type WorkflowContext,
} from './records'
import { readWorkspace, saveWorkspace } from './workspace'
import { upiIntent, upiPayee, upiReceipt } from '../upi'
import { transition } from '../../src/domain'

export async function handleUpi(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (
    ctx.path !== '/payments/upi/settings' &&
    ctx.path !== '/payments/upi/requests' &&
    ctx.path !== '/payments/upi/receipts'
  )
    return
  requireRole(ctx.account, ['owner', 'finance_admin', 'auditor'])
  const d = await database(),
    tenant = ctx.account.tenant
  if (ctx.path.endsWith('/receipts')) {
    if (ctx.request.method === 'GET')
      return Response.json({
        receipts: await listRecords(tenant, 'upi:receipt'),
      })
    if (ctx.request.method !== 'POST') fail(405, 'Method not allowed.')
    requireRole(ctx.account, ['owner', 'finance_admin'])
    const input = upiReceipt.parse(await ctx.input())
    if (Date.parse(input.receivedAt) > Date.now())
      fail(400, 'Receipt date cannot be in the future.')
    return Response.json(
      await mutate(
        ctx,
        input,
        async (session) => {
          const current = await readWorkspace(tenant, session)
          if (current.state.currency !== 'INR')
            fail(409, 'UPI receipts require an INR workspace.')
          const invoice = current.state.invoices.find(
            (invoice) => invoice.id === input.invoiceId,
          )
          if (!invoice) fail(404, 'Invoice not found.')
          if (invoice.status !== 'Unpaid')
            fail(
              409,
              'Invoice is already collected. Reconcile its existing receipt instead.',
            )
          if (invoice.amount !== input.amount)
            fail(
              409,
              'Verified receipt must match the full invoice amount exactly.',
            )
          if (
            await d.records.findOne(
              {
                tenant,
                kind: 'upi:receipt',
                'data.reference': input.reference,
              },
              { session },
            )
          )
            fail(409, 'This UPI reference has already been recorded.')
          const next = transition(current.state, {
            type: 'status',
            collection: 'invoices',
            id: invoice.id,
            status: 'Paid',
            actor: ctx.account.email,
          })
          await saveWorkspace(current, next, session)
          return {
            receipt: expose(
              await insertRecord(
                tenant,
                'upi:receipt',
                {
                  invoice_id: invoice.id,
                  reference: input.reference,
                  amount: input.amount,
                  currency: 'INR',
                  received_at: input.receivedAt,
                  verified_by: ctx.account.id,
                  verified_by_email: ctx.account.email,
                  verification: 'manual_bank_review',
                },
                session,
              ),
            ),
          }
        },
        true,
      ),
      { status: 201 },
    )
  }
  if (ctx.path.endsWith('/settings')) {
    if (ctx.request.method === 'GET') {
      const row = await d.records.findOne({ tenant, kind: 'upi:settings' })
      return Response.json({ payee: row?.data ?? null })
    }
    if (ctx.request.method !== 'PUT') fail(405, 'Method not allowed.')
    requireRole(ctx.account, ['owner'])
    const input = upiPayee.parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const row = await d.records.findOne(
          { tenant, kind: 'upi:settings' },
          { session },
        )
        if (row) await updateRecord(row, input, session)
        else await insertRecord(tenant, 'upi:settings', input, session)
        return { payee: input }
      }),
    )
  }
  if (ctx.request.method !== 'GET') fail(405, 'Method not allowed.')
  const state = (await readWorkspace(tenant)).state
  if (state.currency !== 'INR')
    fail(
      409,
      'UPI requires an INR workspace. Existing records are not converted.',
    )
  const settings = await d.records.findOne({ tenant, kind: 'upi:settings' })
  if (!settings)
    fail(409, 'The workspace owner must configure the merchant UPI ID first.')
  const payee = upiPayee.parse(settings.data)
  const unpaid = state.invoices.filter((i) => i.status === 'Unpaid')
  for (const invoice of unpaid) {
    if (
      Math.abs(Math.round(invoice.amount * 100) / 100 - invoice.amount) >
        0.000001 ||
      invoice.amount <= 0 ||
      !Number.isSafeInteger(Math.round(invoice.amount * 100))
    )
      fail(
        409,
        'An unpaid invoice has an invalid rupee amount. Correct it before generating UPI links.',
      )
  }
  return Response.json({
    requests: unpaid.map((invoice) => ({
      invoiceId: invoice.id,
      name: invoice.name,
      amount: invoice.amount,
      currency: 'INR',
      url: upiIntent(payee, invoice, state.currency),
    })),
  })
}

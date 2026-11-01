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
import { readWorkspace, saveWorkspace } from './workspace'
import { transition, generatePayslips } from '../../src/domain'
import { suggestReconciliation } from '../reconciliation'

const text = z.string().trim().min(1).max(200)
const transactionInput = z
  .object({
    externalRef: text,
    occurredAt: z.iso.datetime({ offset: true }),
    amount: z.number().finite().positive().max(10000000000),
    direction: z.enum(['credit', 'debit']),
    reference: text,
  })
  .strict()
export async function handleBanking(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const { path, account, request } = ctx,
    tenant = account.tenant,
    method = request.method
  const payroll = path.match(/^\/payroll\/runs\/([^/]+)\/payment-batches$/)
  const bank = path.match(
    /^\/banks\/accounts(?:\/([^/]+)(?:\/(transactions)(?:\/([^/]+))?)?)?$/,
  )
  if (!bank && !payroll) return
  requireRole(account, [
    'owner',
    'finance_admin',
    'auditor',
    ...(payroll ? ['hr_admin'] : []),
  ])
  const d = await database()
  if (payroll) {
    const runId = z.uuid().parse(payroll[1]),
      current = await readWorkspace(tenant),
      run = current.state.payroll.find((p) => p.id === runId)
    if (!run) fail(404, 'Payroll run not found.')
    if (method === 'GET')
      return Response.json({
        batches: (
          await d.records
            .find({
              tenant,
              kind: 'payroll:batch',
              'data.payroll_run_id': runId,
            })
            .toArray()
        ).map((row) => expose(row)),
      })
    requireRole(account, ['owner', 'finance_admin', 'hr_admin'])
    if (method !== 'POST')
      fail(
        405,
        'Payment dispatch requires a configured provider; only batch preparation is available.',
      )
    const input = z
      .object({})
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(
        ctx,
        input,
        async (session) => {
          const state = (await readWorkspace(tenant, session)).state,
            run = state.payroll.find((p) => p.id === runId)
          if (!run || run.status !== 'Approved')
            fail(409, 'Approve the payroll accrual before preparing payment.')
          const existing = await d.records.findOne(
            { tenant, kind: 'payroll:batch', 'data.payroll_run_id': runId },
            { session },
          )
          if (existing) return { batch: expose(existing) }
          const amount =
            Math.round(
              generatePayslips(state, runId).reduce(
                (sum, p) => sum + p.netPay,
                0,
              ) * 100,
            ) / 100
          return {
            batch: expose(
              await insertRecord(
                tenant,
                'payroll:batch',
                {
                  payroll_run_id: runId,
                  amount,
                  status: 'pending',
                  created_by: account.id,
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
  const id = bank![1] ? z.uuid().parse(bank![1]) : undefined,
    transactions = !!bank![2],
    transactionId = bank![3]
  if (!transactions) {
    if (method === 'GET')
      return Response.json({
        accounts: id
          ? [expose(await findRecord(tenant, 'bank:account', id))]
          : await listRecords(tenant, 'bank:account'),
      })
    requireRole(account, ['owner', 'finance_admin'])
    if (method !== 'POST' || id) fail(405, 'Method not supported.')
    const input = z
      .object({
        provider: z.literal('manual'),
        externalRef: text,
        name: text,
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        if (
          await d.records.findOne(
            {
              tenant,
              kind: 'bank:account',
              'data.external_ref': input.externalRef,
            },
            { session },
          )
        )
          fail(409, 'Account reference already exists.')
        return expose(
          await insertRecord(
            tenant,
            'bank:account',
            {
              provider: input.provider,
              external_ref: input.externalRef,
              name: input.name,
              currency: input.currency,
              status: 'disconnected',
            },
            session,
          ),
        )
      }),
      { status: 201 },
    )
  }
  const bankAccount = await findRecord(tenant, 'bank:account', id!)
  if (method === 'GET' && !transactionId)
    return Response.json({
      transactions: (
        await d.records
          .find({ tenant, kind: 'bank:transaction', 'data.account_id': id })
          .sort({ 'data.occurred_at': -1 })
          .limit(500)
          .toArray()
      ).map((row) => expose(row)),
    })
  requireRole(account, ['owner', 'finance_admin'])
  if (method === 'POST' && (!transactionId || transactionId === 'import')) {
    const raw = await ctx.input(),
      bulk = transactionId === 'import'
    const inputs = bulk
      ? z
          .object({ transactions: z.array(transactionInput).min(1).max(100) })
          .strict()
          .parse(raw).transactions
      : [transactionInput.parse(raw)]
    const result = await mutate(ctx, inputs, async (session) => {
      const current = await readWorkspace(tenant, session)
      if (bankAccount.data.currency !== current.state.currency)
        fail(400, 'Reconciliation currently requires the workspace currency.')
      const used = await d.records
        .find(
          {
            tenant,
            kind: 'bank:transaction',
            'data.match_status': { $in: ['suggested', 'matched'] },
          },
          { session },
        )
        .toArray()
      const reserved = new Set(used.map((row) => row.data.matched_entity_id))
      let imported = 0,
        skipped = 0,
        suggested = 0,
        saved
      for (const b of inputs) {
        const existing = await d.records.findOne(
          {
            tenant,
            kind: 'bank:transaction',
            'data.account_id': id,
            'data.external_ref': b.externalRef,
          },
          { session },
        )
        if (existing) {
          const old = existing.data
          if (
            old.amount !== b.amount ||
            old.direction !== b.direction ||
            old.reference !== b.reference ||
            old.occurred_at !== b.occurredAt
          )
            fail(409, 'A statement reference was reused with different data.')
          skipped++
          saved = expose(existing)
          continue
        }
        const sources = [
          ...current.state.invoices.map((i) => ({
            id: i.id,
            type: 'invoice' as const,
            amount: i.amount,
            label: i.name,
          })),
          ...current.state.expenses.map((e) => ({
            id: e.id,
            type: 'expense' as const,
            amount: e.amount,
            label: e.name,
          })),
        ].filter((source) => !reserved.has(source.id))
        const suggestion = suggestReconciliation(b, sources)
        if (suggestion) {
          reserved.add(suggestion.source.id)
          suggested++
        }
        saved = expose(
          await insertRecord(
            tenant,
            'bank:transaction',
            {
              account_id: id,
              external_ref: b.externalRef,
              occurred_at: b.occurredAt,
              amount: b.amount,
              direction: b.direction,
              reference: b.reference,
              match_status: suggestion ? 'suggested' : 'unmatched',
              matched_entity_type: suggestion?.source.type || null,
              matched_entity_id: suggestion?.source.id || null,
              reconciled_at: null,
            },
            session,
          ),
        )
        imported++
      }
      return bulk ? { imported, skipped, suggested } : saved
    })
    return Response.json(result, { status: 201 })
  }
  if (method !== 'PATCH' || !transactionId) fail(405, 'Method not supported.')
  const txId = z.uuid().parse(transactionId)
  const input = z
    .object({
      matchStatus: z.enum(['unmatched', 'matched', 'ignored']),
      matchedEntityType: z.enum(['invoice', 'expense']).optional(),
      matchedEntityId: z.uuid().optional(),
    })
    .strict()
    .parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      const row = await findRecord(tenant, 'bank:transaction', txId, session)
      if (row.data.account_id !== id)
        fail(404, 'Statement entry not found in this account.')
      if (row.data.match_status === 'matched') {
        if (
          input.matchStatus === 'matched' &&
          (!input.matchedEntityId ||
            input.matchedEntityId === row.data.matched_entity_id)
        )
          return expose(row)
        fail(
          409,
          'Matched entries are final; use a controlled correction instead.',
        )
      }
      const changes: Record<string, unknown> = {
        match_status: input.matchStatus,
        matched_entity_type: null,
        matched_entity_id: null,
        reconciled_at: null,
      }
      if (input.matchStatus === 'matched') {
        const entityType =
            input.matchedEntityType || row.data.matched_entity_type,
          entityId = input.matchedEntityId || row.data.matched_entity_id
        if (
          !entityId ||
          entityType !==
            (row.data.direction === 'credit' ? 'invoice' : 'expense')
        )
          fail(400, 'Select a source that matches the statement direction.')
        if (
          await d.records.findOne(
            {
              tenant,
              kind: 'bank:transaction',
              'data.match_status': 'matched',
              'data.matched_entity_id': entityId,
              _id: { $ne: txId },
            },
            { session },
          )
        )
          fail(409, 'This source is already reconciled.')
        const current = await readWorkspace(tenant, session)
        if (bankAccount.data.currency !== current.state.currency)
          fail(400, 'Account and workspace currencies must match.')
        const source = (
          entityType === 'invoice'
            ? current.state.invoices
            : current.state.expenses
        ).find((source) => source.id === entityId)
        if (
          !source ||
          Math.round(source.amount * 100) !==
            Math.round(Number(row.data.amount) * 100)
        )
          fail(400, 'Source and statement amounts must match exactly.')
        if (
          entityType === 'invoice' &&
          current.state.invoices.find((i) => i.id === entityId)?.status ===
            'Unpaid'
        ) {
          const next = transition(current.state, {
            type: 'status',
            collection: 'invoices',
            id: String(entityId),
            status: 'Paid',
            actor: account.email,
          })
          await saveWorkspace(current, next, session)
        }
        changes.matched_entity_type = entityType
        changes.matched_entity_id = entityId
        changes.reconciled_at = new Date().toISOString()
      }
      return expose(await updateRecord(row, changes, session))
    }),
  )
}

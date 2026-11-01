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

const rate = z.number().finite().min(0).max(1)
const settingsSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    jurisdiction: z.string().trim().min(1).max(160),
    currency: z.string().regex(/^[A-Z]{3}$/),
    financialYearStartMonth: z.number().int().min(1).max(12),
    vatRate: rate,
    withholdingRate: rate,
    incomeTaxRate: rate,
    payrollEmployeeRate: rate,
    payrollEmployerRate: rate,
    invoicePrefix: z.string().regex(/^[A-Z0-9-]{1,20}$/),
    taxInclusive: z.boolean(),
    complianceNotes: z.string().trim().max(2000),
  })
  .strict()
const defaults = {
  country_code: 'NG',
  jurisdiction: 'Nigeria',
  currency: 'INR',
  financial_year_start_month: 1,
  vat_rate: 0.075,
  withholding_rate: 0.05,
  income_tax_rate: 0.3,
  payroll_employee_rate: 0,
  payroll_employer_rate: 0,
  invoice_prefix: 'INV',
  tax_inclusive: false,
  compliance_notes: '',
}
export async function handleTaxSettings(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  if (!ctx.path.startsWith('/tax/')) return
  const { account, request, path } = ctx,
    tenant = account.tenant,
    method = request.method,
    d = await database()
  requireRole(account, ['owner', 'finance_admin', 'auditor'])
  if (path === '/tax/settings') {
    if (method === 'GET') {
      const row = await d.records.findOne({ tenant, kind: 'tax:settings' })
      return Response.json({ settings: row?.data || defaults })
    }
    requireRole(account, ['owner', 'finance_admin'])
    if (method !== 'PATCH') fail(405, 'Method not supported.')
    const input = settingsSchema.parse(await ctx.input())
    return Response.json(
      await mutate(ctx, input, async (session) => {
        const data = Object.fromEntries(
          Object.entries(input).map(([key, value]) => [
            key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()),
            value,
          ]),
        )
        const row = await d.records.findOne(
          { tenant, kind: 'tax:settings' },
          { session },
        )
        if (row) await updateRecord(row, data, session)
        else await insertRecord(tenant, 'tax:settings', data, session)
        return { settings: data }
      }),
    )
  }
  const route = path.match(/^\/tax\/filings(?:\/([^/]+))?$/)
  if (!route) return
  const id = route[1] ? z.uuid().parse(route[1]) : undefined
  if (method === 'GET')
    return Response.json({
      filings: id
        ? [expose(await findRecord(tenant, 'tax:filing', id))]
        : await listRecords(tenant, 'tax:filing'),
    })
  requireRole(account, ['owner', 'finance_admin'])
  if ((method !== 'POST' || id) && (method !== 'PATCH' || !id))
    fail(405, 'Method not supported.')
  const input = id
    ? z
        .object({
          status: z.enum(['draft', 'ready', 'filed', 'paid', 'overdue']),
        })
        .strict()
        .parse(await ctx.input())
    : z
        .object({
          name: z.string().trim().min(1).max(200),
          territory: z.string().trim().min(1).max(160),
          dueDate: z.iso.date(),
          amount: z.number().finite().min(0).max(10000000000),
        })
        .strict()
        .parse(await ctx.input())
  return Response.json(
    await mutate(ctx, input, async (session) => {
      if ('status' in input && id) {
        const row = await findRecord(tenant, 'tax:filing', id, session)
        const transitions: Record<string, string[]> = {
          draft: ['ready'],
          ready: ['filed', 'overdue'],
          overdue: ['filed'],
          filed: ['paid'],
          paid: [],
        }
        if (!transitions[String(row.data.status)]?.includes(input.status))
          fail(409, 'Advance the filing through ready, filed and paid stages.')
        return expose(await updateRecord(row, input, session))
      }
      if (!('name' in input)) fail(400, 'Invalid filing.')
      return expose(
        await insertRecord(
          tenant,
          'tax:filing',
          {
            name: input.name,
            territory: input.territory,
            due_date: input.dueDate,
            amount: input.amount,
            status: 'draft',
          },
          session,
        ),
      )
    }),
    { status: id ? 200 : 201 },
  )
}

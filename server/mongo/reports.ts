import {
  generateBalanceSheet,
  generateCashFlowStatement,
  generateIncomeStatement,
} from '../../src/domain'
import { periodState, reportingPeriod } from '../../src/reporting'
import { globalSearch } from '../search'
import { financeWorkbook } from '../finance-workbook'
import { pdfReport } from '../pdf'
import { fail, requireRole } from './security'
import { readWorkspace, scopedState } from './workspace'
import type { WorkflowContext } from './records'

export async function handleReports(
  ctx: WorkflowContext,
): Promise<Response | undefined> {
  const { path, request, account } = ctx
  if (path === '/search' && request.method === 'GET') {
    const query = new URL(request.url).searchParams.get('q') || ''
    return Response.json({
      results: globalSearch(
        scopedState((await readWorkspace(account.tenant)).state, account.role),
        query.slice(0, 200),
      ),
    })
  }
  const match = path.match(/^\/finance\/export\.(csv|xlsx|pdf)$/)
  if (!match) return
  if (request.method !== 'GET') fail(405, 'Method not supported.')
  requireRole(account, ['owner', 'finance_admin', 'auditor'])
  if (!ctx.features.includes('reports'))
    fail(403, 'Your plan does not include financial reports.')
  const period = reportingPeriod.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  const state = (await readWorkspace(account.tenant)).state
  const statements = {
    income: generateIncomeStatement(state, period),
    balance: generateBalanceSheet(state, period),
    cashFlow: generateCashFlowStatement(state, period),
  }
  const rows: unknown[][] = [
    [
      'section',
      'date',
      'description',
      'debit_account',
      'credit_account',
      `amount (${state.currency})`,
    ],
    ...periodState(state, period).journals.map((j) => [
      'journal',
      j.date,
      j.source,
      j.debit,
      j.credit,
      j.amount,
    ]),
  ]
  const lines: { label: string; value: string }[] = []
  function flatten(prefix: string, value: unknown) {
    if (value && typeof value === 'object')
      for (const [key, item] of Object.entries(value))
        flatten(prefix ? prefix + '.' + key : key, item)
    else if (typeof value === 'number') {
      rows.push(['statement', '', prefix, '', '', value])
      lines.push({ label: prefix, value: `${state.currency} ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` })
    }
  }
  flatten('', statements)
  const format = match[1]
  const csvCell = (value: unknown) => {
    let text = String(value ?? '')
    if (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(text))
      text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  const result =
    format === 'xlsx'
      ? financeWorkbook(rows)
      : format === 'pdf'
        ? pdfReport('BusinessOS financial statements', lines, {
            tenant: state.organisation,
            actor: account.email,
            period:
              (period.from || 'Beginning') + ' to ' + (period.to || 'Present'),
          })
        : '\ufeff' +
          rows.map((row) => row.map(csvCell).join(',')).join('\r\n') +
          '\r\n'
  const types = {
    csv: 'text/csv; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf: 'application/pdf',
  }
  return new Response(result, {
    headers: {
      'Content-Type': types[format as keyof typeof types],
      'Content-Disposition': `attachment; filename="businessos-finance-report.${format}"`,
    },
  })
}

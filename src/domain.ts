import { periodState, periodLabel, openingCashForPeriod, type ReportingPeriod } from './reporting.ts'
import { z } from 'zod'
import type {
  State,
  Action,
  IncomeStatement,
  BalanceSheet,
  CashFlowStatement,
  StatutoryPayrollBreakdown,
  EmployeePayslip,
} from './types'
import { hydrateInventory, stockMovement, inventoryValue } from './inventory.ts'
export const stages = ['New', 'Qualified', 'Proposal', 'Won', 'Lost']
export const seed = (): State => hydrateInventory({
  organisation: 'Acme Trading Ltd',
  currency: 'NGN',
  products: [
    {
      id: 'p1',
      name: 'Wireless keyboard',
      sku: 'WK-001',
      qty: 24,
      cost: 18000,
      min: 10,
    },
    {
      id: 'p2',
      name: 'USB-C docking station',
      sku: 'DS-002',
      qty: 5,
      cost: 42000,
      min: 10,
    },
    {
      id: 'p3',
      name: 'Office monitor 27 inch',
      sku: 'MN-003',
      qty: 12,
      cost: 165000,
      min: 5,
    },
  ],
  invoices: [
    { id: 'i1', name: 'Northstar Limited', amount: 840000, status: 'Unpaid' },
    { id: 'i2', name: 'Greenfield Studio', amount: 320000, status: 'Paid' },
  ],
  expenses: [],
  orders: [],
  leads: [
    {
      id: 'l1',
      name: 'Northstar expansion',
      amount: 1450000,
      status: 'Proposal',
    },
    {
      id: 'l2',
      name: 'Lagos office fit-out',
      amount: 2250000,
      status: 'Qualified',
    },
    { id: 'l3', name: 'Greenfield accessories', amount: 480000, status: 'New' },
  ],
  employees: [
    {
      id: 'e1',
      name: 'Amara Okafor',
      department: 'Operations',
      amount: 350000,
    },
    { id: 'e2', name: 'Tunde Adeyemi', department: 'Sales', amount: 280000 },
  ],
  payroll: [],
  projects: [
    {
      id: 'j1',
      name: 'Launch Abuja branch',
      amount: 4500000,
      status: 'In progress',
    },
    { id: 'j2', name: 'September stock audit', amount: 0, status: 'Planned' },
  ],
  tasks: [
    { id: 't1', name: 'Follow up on Northstar invoice', status: 'Open' },
    { id: 't2', name: 'Reorder docking stations', status: 'Open' },
  ],
  audit: [],
  journals: [],
  openingCash: 5000000,
})
export function metrics(s: State) {
  const revenue = s.invoices
    .filter((x) => x.status === 'Paid')
    .reduce((a, x) => a + x.amount, 0)
  const spent = s.expenses.reduce((a, x) => a + x.amount, 0)
  return {
    cash: s.openingCash + revenue - spent,
    revenue,
    receivables: s.invoices
      .filter((x) => x.status === 'Unpaid')
      .reduce((a, x) => a + x.amount, 0),
    payables: s.orders
      .filter((x) => x.status === 'Received')
      .reduce((a, x) => a + x.qty * x.cost, 0),
    stock: s.products.reduce((a, x) => a + inventoryValue(x.qty,x.cost), 0),
    pipeline: s.leads
      .filter((x) => !['Won', 'Lost'].includes(x.status))
      .reduce((a, x) => a + x.amount, 0),
    low: s.products.filter((x) => x.qty < x.min),
  }
}

// Reports use posted journals. Legacy demo records without postings are excluded.
const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
function accountBalance(s: State, account: string) {
  return roundMoney(s.journals.reduce((sum, j) => sum + (j.debit === account ? j.amount : 0) - (j.credit === account ? j.amount : 0), 0))
}
export function generateIncomeStatement(state: State, period: ReportingPeriod = {}): IncomeStatement {
  const s = periodState(state, period)
  const revenue = -accountBalance(s, 'Sales') || 0
  const cogs = accountBalance(s, 'Cost of goods sold')
  const grossProfit = roundMoney(revenue - cogs)
  const operatingExpenses = roundMoney(accountBalance(s, 'Operating expenses') + accountBalance(s, 'Payroll expense') + accountBalance(s, 'Inventory adjustment expense') + accountBalance(s, 'Inventory adjustment gain'))
  return { period: periodLabel(period), revenue, cogs, grossProfit, grossMarginPercent: revenue ? roundMoney(grossProfit / revenue * 100) : 0, operatingExpenses, netProfit: roundMoney(grossProfit - operatingExpenses) }
}
export function generateBalanceSheet(state: State, period: ReportingPeriod = {}): BalanceSheet {
  const s = periodState(state, period, true)
  const cash = roundMoney(s.openingCash + accountBalance(s, 'Cash'))
  const receivables = accountBalance(s, 'Accounts receivable'), inventory = accountBalance(s, 'Inventory')
  const payables = -accountBalance(s, 'Accounts payable'), accruedPayroll = -accountBalance(s, 'Payroll payable')
  const statutoryPayable = -accountBalance(s,'Pension payable')-accountBalance(s,'Tax payable')
  const openingEquity = roundMoney(s.openingCash - accountBalance(s, 'Opening balance equity'))
  const retainedEarnings = generateIncomeStatement(s).netProfit
  const totalAssets = roundMoney(cash + receivables + inventory), totalLiabilities = roundMoney(payables + accruedPayroll + statutoryPayable), totalEquity = roundMoney(openingEquity + retainedEarnings)
  return { asOfDate: period.to || 'Latest posting', assets: {cash,receivables,inventory,totalAssets}, liabilities: {payables,accruedPayroll,statutoryPayable,totalLiabilities}, equity: {openingEquity,retainedEarnings,totalEquity}, isBalanced: Math.abs(totalAssets-totalLiabilities-totalEquity)<0.01 }
}
export function generateCashFlowStatement(state: State, period: ReportingPeriod = {}): CashFlowStatement {
  const s = periodState(state, period)
  const openingCash = roundMoney(openingCashForPeriod(state, period))
  const operatingInflows = roundMoney(s.journals.filter(j => j.debit === 'Cash').reduce((sum,j) => sum+j.amount,0))
  const operatingOutflows = roundMoney(s.journals.filter(j => j.credit === 'Cash').reduce((sum,j) => sum+j.amount,0))
  const netCashFlow = roundMoney(operatingInflows-operatingOutflows)
  return {period:periodLabel(period),openingCash,operatingInflows,operatingOutflows,netCashFlow,closingCash:roundMoney(openingCash+netCashFlow)}
}

/**
 * Statutory Payroll Calculation Engine (Nigerian PITA & Pension Reform Act 2014)
 */
export function calculateStatutoryPayroll(gross: number, rulesVersion = 'NG-2026-v1'): StatutoryPayrollBreakdown {
  if (!Number.isFinite(gross) || gross < 0) throw Error('Gross pay must be a finite non-negative amount.')
  if (rulesVersion === 'NG-2026-v1') {
    const employeePension = roundMoney(gross * 0.08), employerPension = roundMoney(gross * 0.10)
    let remaining = Math.max(0,(gross-employeePension)*12), annualTax=0
    const bands: [number,number][] = [[800000,0],[2200000,0.15],[9000000,0.18],[13000000,0.21],[25000000,0.23],[Infinity,0.25]]
    for (const [width,rate] of bands) { const value=Math.min(remaining,width); annualTax+=value*rate; remaining-=value; if(remaining<=0) break }
    const payeTax = gross <= 70000 ? 0 : roundMoney(annualTax/12)
    const totalDeductions=roundMoney(employeePension+payeTax)
    return {grossSalary:gross,employeePension,employerPension,payeTax,totalDeductions,netSalary:roundMoney(gross-totalDeductions)}
  }
  if (rulesVersion !== 'NG-PITA-legacy-v1') throw Error('Unknown payroll rules version.')
  if (gross <= 0) {
    return { grossSalary: 0, employeePension: 0, employerPension: 0, payeTax: 0, totalDeductions: 0, netSalary: 0 }
  }
  // Employee Pension: 8% of Gross
  const employeePension = Math.round(gross * 0.08)
  // Employer Pension: 10% of Gross
  const employerPension = Math.round(gross * 0.10)

  // Consolidated Relief Allowance (CRA): Higher of 200,000/12 (₦16,667/mo) or 1% of gross, + 20% of gross
  const craFixed = Math.max(16666.67, gross * 0.01)
  const craVariable = gross * 0.20
  const cra = craFixed + craVariable

  // Taxable monthly income
  const taxableIncome = Math.max(0, gross - employeePension - cra)

  // Progressive monthly PAYE Tax brackets (Annual brackets divided by 12)
  let payeTax = 0
  let rem = taxableIncome
  const brackets: [number, number][] = [
    [25000, 0.07],    // First ₦300k/yr -> ₦25k/mo @ 7%
    [25000, 0.11],    // Next ₦300k/yr -> ₦25k/mo @ 11%
    [41666.67, 0.15], // Next ₦500k/yr -> ₦41,667/mo @ 15%
    [41666.67, 0.19], // Next ₦500k/yr -> ₦41,667/mo @ 19%
    [133333.33, 0.21],// Next ₦1.6m/yr -> ₦133,333/mo @ 21%
    [Infinity, 0.24], // Above ₦3.2m/yr @ 24%
  ]

  for (const [limit, rate] of brackets) {
    if (rem <= 0) break
    const chunk = Math.min(rem, limit)
    payeTax += chunk * rate
    rem -= chunk
  }

  // Minimum Tax: 1% of Gross if calculated tax is lower
  const minimumTax = Math.round(gross * 0.01)
  payeTax = Math.round(Math.max(payeTax, minimumTax))

  const totalDeductions = employeePension + payeTax
  const netSalary = Math.max(0, gross - totalDeductions)

  return {
    grossSalary: gross,
    employeePension,
    employerPension,
    payeTax,
    totalDeductions,
    netSalary,
  }
}

/**
 * Generate itemized payslips for all employees in a specific payroll run
 */
export function generatePayslips(s: State, runId: string): EmployeePayslip[] {
  const run = s.payroll.find((p) => p.id === runId)
  if (!run || run.status !== 'Approved') return []
  if (!run.rulesVersion) return []
  const employees = run.inputs

  return employees.map((emp) => {
    const calc = calculateStatutoryPayroll(emp.amount, run.rulesVersion)
    return {
      id: `slip-${run.id}-${emp.id}`,
      employeeId: emp.id,
      employeeName: emp.name,
      department: emp.department,
      period: run.period,
      grossPay: calc.grossSalary,
      employeePension: calc.employeePension,
      employerPension: calc.employerPension,
      payeTax: calc.payeTax,
      totalDeductions: calc.totalDeductions,
      netPay: calc.netSalary,
      currency: s.currency,
    }
  })
}

export const textValue = z.string().trim().min(1).max(200)
const numericInput=z.union([z.number(),z.string().trim().min(1)]).transform(Number)
const amount=numericInput.pipe(z.number().finite().positive().max(1e12).refine(n=>Math.abs(n*100-Math.round(n*100))<0.001,'Use at most two decimal places.'))
const quantity=numericInput.pipe(z.number().int().min(0).max(100000000))
const schemas = {
  invoices: z
    .object({ name: textValue, amount, status: z.literal('Unpaid').optional() })
    .strict(),
  expenses: z.object({ name: textValue, amount }).strict(),
  leads: z
    .object({ name: textValue, amount, status: z.literal('New').optional() })
    .strict(),
  employees: z
    .object({ name: textValue, department: textValue, amount })
    .strict(),
  projects: z
    .object({
      name: textValue,
      amount,
      status: z.literal('Planned').optional(),
    })
    .strict(),
  tasks: z
    .object({ name: textValue, status: z.literal('Open').optional() })
    .strict(),
  products: z
    .object({
      name: textValue,
      sku: textValue,
      qty: quantity,
      cost: amount,
      min: quantity,
    })
    .strict(),
  orders: z
    .object({ name: textValue, product: textValue, qty: quantity.refine(n=>n>0,'Quantity must be positive.') })
    .strict(),
}
export function transition(state: State, action: Action): State {
  const s = hydrateInventory(state),
    id = crypto.randomUUID(),
    date = new Date().toISOString()
  let source = action.id || id
  const post = (value: number, debit: string, credit: string) =>
    s.journals.unshift({
      id: crypto.randomUUID(),
      date,
      source,
      amount: value,
      debit,
      credit,
    })
  if (action.type === 'create') {
    const collection = action.collection as keyof typeof schemas
    if (!schemas[collection]) throw Error('Unknown record type.')
    const result = schemas[collection].safeParse(action.data)
    if (!result.success)
      throw Error(
        result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      )
    source = id
    switch (collection) {
      case 'invoices': {
        const r = schemas.invoices.parse(action.data)
        s.invoices.unshift({ ...r, id, status: 'Unpaid' })
        post(r.amount, 'Accounts receivable', 'Sales')
        break
      }
      case 'expenses': {
        const r = schemas.expenses.parse(action.data)
        s.expenses.unshift({ ...r, id })
        post(r.amount, 'Operating expenses', 'Cash')
        break
      }
      case 'leads':
        s.leads.unshift({
          ...schemas.leads.parse(action.data),
          id,
          status: 'New',
        })
        break
      case 'employees':
        s.employees.unshift({ ...schemas.employees.parse(action.data), id })
        break
      case 'projects':
        s.projects.unshift({
          ...schemas.projects.parse(action.data),
          id,
          status: 'Planned',
        })
        break
      case 'tasks':
        s.tasks.unshift({
          ...schemas.tasks.parse(action.data),
          id,
          status: 'Open',
        })
        break
      case 'products': {
        const r = schemas.products.parse(action.data)
        if (s.products.some((p) => p.sku.toLowerCase() === r.sku.toLowerCase()))
          throw Error('SKU already exists.')
        const product={...r,id}
        const movement=stockMovement(product,0,r.qty,'opening','Opening stock at product registration',id,date)
        s.products.unshift(product)
        s.stockMovements.unshift(movement)
        if(movement.valueDelta>0)post(movement.valueDelta,'Inventory','Opening balance equity')
        break
      }
      case 'orders': {
        const r = schemas.orders.parse(action.data)
        const p = s.products.find((p) => p.id === r.product)
        if (!p) throw Error('Select a product in this workspace.')
        s.orders.unshift({
          ...r,
          id,
          cost: p.cost,
          status: 'Pending',
          requestedBy: action.actor || 'Local workspace owner',
          requestedAt: date,
        })
        break
      }
    }
  } else if (action.type === 'status') {
    if (
      !['invoices', 'orders', 'leads', 'projects', 'tasks', 'payroll'].includes(
        action.collection || '',
      )
    )
      throw Error('Unsupported workflow.')
    const collection = action.collection as
      'invoices' | 'orders' | 'leads' | 'projects' | 'tasks' | 'payroll'
    const r = s[collection].find((x) => x.id === action.id)
    if (!r) throw Error('Record not found.')
    const value = action.status || ''
    if (collection === 'invoices') {
      if (r.status !== 'Unpaid' || value !== 'Paid')
        throw Error('Invoice is already settled.')
      post(
        s.invoices.find((x) => x.id === r.id)!.amount,
        'Cash',
        'Accounts receivable',
      )
    } else if (collection === 'orders') {
      const order = s.orders.find((x) => x.id === r.id)!
      if (r.status === 'Pending' && value === 'Approved') {
        if (action.enforceApproverSeparation && order.requestedBy === action.actor)
          throw Error('A different authorised user must approve this purchase order.')
        order.approvedBy = action.actor || 'Local workspace owner'
        order.approvedAt = date
      } else if (r.status === 'Approved' && value === 'Received') {
        const p = s.products.find((p) => p.id === order.product)
        if (!p) throw Error('Product not found.')
        const movement=stockMovement(p,p.qty,p.qty+order.qty,'receipt','Goods received from '+order.name,order.id,date)
        p.qty=movement.after
        s.stockMovements.unshift(movement)
        post(inventoryValue(order.qty,order.cost), 'Inventory', 'Accounts payable')
      } else
        throw Error(
          'Approve a purchase order before receiving it. Goods can only be received once.',
        )
    } else if (collection === 'leads') {
      if (!stages.includes(value)) throw Error('Invalid sales stage.')
    } else if (collection === 'projects') {
      if (!['Planned', 'In progress', 'Completed'].includes(value))
        throw Error('Invalid project status.')
    } else if (collection === 'tasks') {
      if (!['Open', 'Completed'].includes(value))
        throw Error('Invalid task status.')
    } else if (collection === 'payroll') {
      if (r.status !== 'Draft' || value !== 'Approved')
        throw Error('Payroll already approved.')
      const payroll = s.payroll.find((item) => item.id === r.id)!
      if (action.enforceApproverSeparation && payroll.preparedBy === action.actor)
        throw Error('A different authorised user must approve this payroll run.')
      payroll.approvedBy = action.actor || 'Local workspace owner'
      payroll.approvedAt = date
      post(
        s.payroll.find((x) => x.id === r.id)!.amount,
        'Payroll expense',
        'Payroll payable',
      )
    }
    if (collection === 'payroll') {
      const run = s.payroll.find(item => item.id === r.id)!
      if (run.rulesVersion) {
        const totals=run.inputs.map(emp=>calculateStatutoryPayroll(emp.amount,run.rulesVersion))
        const pension=roundMoney(totals.reduce((n,p)=>n+p.employeePension,0)), tax=roundMoney(totals.reduce((n,p)=>n+p.payeTax,0)), employer=roundMoney(totals.reduce((n,p)=>n+p.employerPension,0))
        if(pension) post(pension,'Payroll payable','Pension payable')
        if(tax) post(tax,'Payroll payable','Tax payable')
        if(employer) post(employer,'Payroll expense','Pension payable')
      }
    }
    r.status = value
  } else if(action.type==='stock_adjust'||action.type==='stock_count'){
    const reason=z.string().trim().min(3,'Add a reason with at least 3 characters.').max(500)
    const base={product:textValue,reason,expectedQty:quantity}
    const result=action.type==='stock_adjust'?z.object({...base,delta:numericInput.pipe(z.number().int().min(-100000000).max(100000000).refine(n=>n!==0,'Quantity change cannot be zero.'))}).strict().safeParse(action.data):z.object({...base,counted:quantity}).strict().safeParse(action.data)
    if(!result.success)throw Error(result.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '))
    const data=result.data,p=s.products.find(p=>p.id===data.product)
    if(!p)throw Error('Product not found in this workspace.')
    if(p.qty!==data.expectedQty)throw Error('Stock changed since this form was opened. Review the latest quantity before saving.')
    const after='delta' in data?p.qty+data.delta:data.counted
    const movement=stockMovement(p,p.qty,after,action.type==='stock_adjust'?'adjustment':'count',data.reason,id,date)
    p.qty=after;s.stockMovements.unshift(movement)
    source=movement.id
    if(movement.delta<0)post(-movement.valueDelta,'Inventory adjustment expense','Inventory')
    if(movement.delta>0)post(movement.valueDelta,'Inventory','Inventory adjustment gain')
  } else if(action.type==='stock_fulfill'){
    const result=z.object({product:textValue,quantity:quantity.refine(n=>n>0,'Quantity must be positive.'),expectedQty:quantity,reference:z.string().trim().min(1).max(200)}).strict().safeParse(action.data)
    if(!result.success)throw Error(result.error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '))
    const data=result.data,p=s.products.find(item=>item.id===data.product)
    if(!p)throw Error('Product not found in this workspace.')
    if(p.qty!==data.expectedQty)throw Error('Stock changed since this fulfillment was prepared. Review the latest quantity before dispatching.')
    if(p.qty<data.quantity)throw Error('Insufficient stock available for this fulfillment.')
    const movement=stockMovement(p,p.qty,p.qty-data.quantity,'fulfillment','Dispatched for '+data.reference,id,date)
    p.qty=movement.after;s.stockMovements.unshift(movement);source=movement.id
    post(-movement.valueDelta,'Cost of goods sold','Inventory')
  } else if (action.type === 'payroll') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(action.period || ''))
      throw Error('Select a valid payroll period.')
    if (s.payroll.some((p) => p.period === action.period))
      throw Error('A payroll run already exists for this period.')
    if (!s.employees.length) throw Error('Add employees first.')
    s.payroll.unshift({
      id,
      name: `Payroll ${action.period}`,
      period: action.period!,
      status: 'Draft',
      amount: s.employees.reduce((a, e) => a + e.amount, 0),
      inputs: structuredClone(s.employees),
      rulesVersion: action.period! >= '2026-01' ? 'NG-2026-v1' : 'NG-PITA-legacy-v1',
      preparedBy: action.actor || 'Local workspace owner',
      preparedAt: date,
    })
  } else if (action.type === 'settings') {
    s.organisation = textValue.parse(action.name)
  } else throw Error('Unknown action.')
  s.audit.unshift({
    id,
    date,
    actor: 'Local workspace owner',
    action: action.type,
    entity: action.type.startsWith('stock_')?'inventory':action.collection || action.type,
    detail:
      action.status ||
      String(action.data?.reason || action.data?.name || action.name || action.period || ''),
  })
  return s
}

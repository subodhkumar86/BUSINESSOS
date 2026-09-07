export interface Product {
  id: string
  name: string
  sku: string
  qty: number
  cost: number
  min: number
}
export interface Invoice {
  id: string
  name: string
  amount: number
  status: 'Unpaid' | 'Paid'
}
export interface Expense {
  id: string
  name: string
  amount: number
}
export interface Lead {
  id: string
  name: string
  amount: number
  status: string
}
export interface Employee {
  id: string
  name: string
  department: string
  amount: number
}
export interface Project {
  id: string
  name: string
  amount: number
  status: string
}
export interface Task {
  id: string
  name: string
  status: string
}
export interface Order {
  id: string
  name: string
  product: string
  qty: number
  cost: number
  status: string
  requestedBy?: string
  requestedAt?: string
  approvedBy?: string
  approvedAt?: string
}
export interface Payroll {
  id: string
  name: string
  period: string
  status: string
  amount: number
  inputs: Employee[]
  rulesVersion?: 'NG-2026-v1' | 'NG-PITA-legacy-v1'
  preparedBy?: string
  preparedAt?: string
  approvedBy?: string
  approvedAt?: string
}
export interface Audit {
  id: string
  date: string
  actor: string
  action: string
  entity: string
  detail: string
}
export interface Journal {
  id: string
  date: string
  source: string
  amount: number
  debit: string
  credit: string
}
export interface StockMovement {
 id:string
 date:string
 product:string
 productName:string
 sku:string
 kind:'baseline'|'opening'|'receipt'|'adjustment'|'count'
 before:number
 delta:number
 after:number
 unitCost:number
 valueDelta:number
 reason:string
 source:string
 actor:string
}
export interface State {
  organisation: string
  currency: string
  sampleData?: boolean
  openingCash: number
  products: Product[]
  invoices: Invoice[]
  expenses: Expense[]
  leads: Lead[]
  employees: Employee[]
  projects: Project[]
  tasks: Task[]
  orders: Order[]
  payroll: Payroll[]
  audit: Audit[]
  journals: Journal[]
  stockMovements:StockMovement[]
}
export type Collection = {
  [K in keyof State]-?: State[K] extends unknown[] ? K : never
}[keyof State]
export type CreateCollection = Exclude<
  Collection,
  'audit' | 'journals' | 'payroll' | 'stockMovements'
>
export interface Action {
  type: string
  collection?: string
  data?: Record<string, unknown>
  id?: string
  status?: string
  period?: string
  name?: string
  actor?: string
  enforceApproverSeparation?: boolean
}
export interface User {
  id: string
  name: string
  email: string
  role: UserRole
}
export const userRoles = [
  'owner',
  'super_admin',
  'finance_admin',
  'hr_admin',
  'operations_manager',
  'sales_crm_user',
  'department_manager',
  'employee',
  'auditor',
] as const
export type UserRole = (typeof userRoles)[number]

const roleCollections: Record<UserRole, readonly string[]> = {
  owner: ['*'],
  super_admin: ['admin', 'settings', 'audit', 'plans', 'integrations', 'tenants'],
  finance_admin: ['invoices', 'expenses', 'payroll', 'tax', 'billing', 'banking', 'reports', 'finance'],
  hr_admin: ['employees', 'payroll', 'recruitment', 'performance'],
  operations_manager: [
    'products',
    'orders',
    'projects',
    'tasks',
    'stock_adjust',
    'stock_count',
    'warehouse',
    'suppliers',
    'assets',
    'facilities',
    'production',
    'supply',
  ],
  sales_crm_user: ['leads', 'customers', 'pipeline', 'campaigns', 'support', 'frontoffice', 'invoices'],
  department_manager: ['projects', 'tasks', 'workspace', 'support', 'automation'],
  employee: ['tasks', 'workspace', 'self_service'],
  auditor: [],
}

export function canPerformAction(role: UserRole, action: Action) {
  const subject = action.collection || action.type
  return roleCollections[role].includes('*') || roleCollections[role].includes(subject)
}

export interface RolePermissionInfo {
  role: UserRole
  title: string
  canDo: string
  restrictions: string
  accessSummary: string
  allowedPages: string[]
}

export const roleMatrix: Record<UserRole, RolePermissionInfo> = {
  super_admin: {
    role: 'super_admin',
    title: 'Super Admin',
    canDo: 'Platform configuration, tenants, plans, audit, integrations and global operations',
    restrictions: 'No access to tenant financial data unless explicitly support-authorised and audited',
    accessSummary: 'Admin Console (/admin/*), platform control, plan limits, system audits',
    allowedPages: ['admin', 'dashboard', 'settings', 'compliance'],
  },
  owner: {
    role: 'owner',
    title: 'Business Owner',
    canDo: 'Full tenant visibility, approvals, settings, user management, reporting and billing',
    restrictions: 'Cannot bypass immutable audit records',
    accessSummary: 'Complete access to all 20 business modules and administrative controls',
    allowedPages: ['*'],
  },
  finance_admin: {
    role: 'finance_admin',
    title: 'Finance Admin',
    canDo: 'Bank feeds, reconciliation, AR/AP, expenses, budgets, tax filings, billing, financial reports',
    restrictions: 'No HR/security administration unless granted',
    accessSummary: 'Finance, Banking, Invoices, Expenses, Tax, Billing, and Financial Analytics',
    allowedPages: ['dashboard', 'finance', 'banking', 'tax', 'billing', 'documents', 'ai', 'settings'],
  },
  hr_admin: {
    role: 'hr_admin',
    title: 'HR Admin',
    canDo: 'Employees, payroll runs, recruitment, performance evaluations and personnel documents',
    restrictions: 'No unrestricted finance or bank administration',
    accessSummary: 'HR, Payroll, Employee Master Data, Team Documents, Goals',
    allowedPages: ['dashboard', 'hr', 'documents', 'workspace', 'ai', 'settings'],
  },
  operations_manager: {
    role: 'operations_manager',
    title: 'Operations Manager',
    canDo: 'Inventory, stock counts/adjustments, suppliers, warehouses, projects, facilities, production, assets',
    restrictions: 'Cannot change ownership, billing or bank configuration',
    accessSummary: 'Inventory, Purchasing, Warehouse, Assets, Facilities, Production, Supply Chain',
    allowedPages: [
      'dashboard',
      'inventory',
      'procurement',
      'suppliers',
      'warehouse',
      'assets',
      'facilities',
      'production',
      'supply',
      'projects',
      'documents',
      'automation',
      'ai',
      'settings',
    ],
  },
  sales_crm_user: {
    role: 'sales_crm_user',
    title: 'Sales / CRM User',
    canDo: 'Leads, customer directory, pipeline, deals, campaigns, customer support tickets',
    restrictions: 'Cannot access restricted HR or company financial/bank records',
    accessSummary: 'Sales & CRM, Deals, Campaigns, Front Office, Customer Support',
    allowedPages: ['dashboard', 'crm', 'support', 'frontoffice', 'documents', 'ai', 'settings'],
  },
  department_manager: {
    role: 'department_manager',
    title: 'Department Manager',
    canDo: 'Assigned department workflows, projects, task delegation, team workspace, support',
    restrictions: 'Scope limited by RBAC; cannot access company finance or payroll',
    accessSummary: 'Projects & Tasks, Team Workspace, Support Tickets, Automations',
    allowedPages: ['dashboard', 'projects', 'workspace', 'support', 'automation', 'documents', 'settings'],
  },
  employee: {
    role: 'employee',
    title: 'Employee',
    canDo: 'Assigned tasks, self-service documents, announcements, virtual workspace collaboration',
    restrictions: 'No management of other departments, no access to financial/HR administrative records',
    accessSummary: 'Assigned Tasks, Self-Service Documents, Team Workspace',
    allowedPages: ['dashboard', 'workspace', 'documents', 'settings'],
  },
  auditor: {
    role: 'auditor',
    title: 'Auditor / Reviewer',
    canDo: 'Read-only reports, compliance logs, risk register, and audit trails across the entire workspace',
    restrictions: 'Strictly read-only; no mutation, create, edit, or approval rights',
    accessSummary: 'Complete read-only visibility for compliance, verification, and audit',
    allowedPages: ['*'],
  },
}

export interface AssetRecord {
  id: string
  name: string
  serialNumber: string
  category: string
  cost: number
  depreciationRate: number
  location: string
  status: 'operational' | 'maintenance' | 'retired'
}

export interface FacilityRecord {
  id: string
  facilityName: string
  equipment: string
  condition: 'good' | 'fair' | 'needs_service' | 'critical'
  lastInspection: string
  nextInspectionDue: string
  workOrderStatus: 'none' | 'open' | 'in_progress' | 'completed'
}

export interface ProductionRecord {
  id: string
  batchNumber: string
  productName: string
  plannedQty: number
  completedQty: number
  defectCount: number
  status: 'scheduled' | 'running' | 'qa_check' | 'completed'
}

export interface FrontOfficeRecord {
  id: string
  visitorName: string
  hostPerson: string
  purpose: string
  appointmentTime: string
  status: 'scheduled' | 'checked_in' | 'completed' | 'cancelled'
}

export interface CommunicationRecord {
  id: string
  title: string
  author: string
  channel: 'announcement' | 'operations' | 'general' | 'leadership'
  content: string
  createdAt: string
}

export interface Snapshot {
  entitlements?: import('./entitlements').Entitlements
  state: State
  version: number
  user: User
  csrf: string
}

export interface IncomeStatement {
  period: string
  revenue: number
  cogs: number
  grossProfit: number
  grossMarginPercent: number
  operatingExpenses: number
  netProfit: number
}

export interface BalanceSheet {
  asOfDate: string
  assets: {
    cash: number
    receivables: number
    inventory: number
    totalAssets: number
  }
  liabilities: {
    payables: number
    accruedPayroll: number
    statutoryPayable: number
    totalLiabilities: number
  }
  equity: {
    openingEquity: number
    retainedEarnings: number
    totalEquity: number
  }
  isBalanced: boolean
}

export interface CashFlowStatement {
  period: string
  operatingInflows: number
  operatingOutflows: number
  netCashFlow: number
  openingCash: number
  closingCash: number
}

export interface StatutoryPayrollBreakdown {
  grossSalary: number
  employeePension: number
  employerPension: number
  payeTax: number
  totalDeductions: number
  netSalary: number
}

export interface EmployeePayslip {
  id: string
  employeeId: string
  employeeName: string
  department: string
  period: string
  grossPay: number
  employeePension: number
  employerPension: number
  payeTax: number
  totalDeductions: number
  netPay: number
  currency: string
}

export interface MarketingCampaignRecord {
  id: string
  name: string
  channel: 'social' | 'email' | 'search' | 'event' | 'referral'
  budget: number
  spend: number
  leadsCount: number
  revenueGenerated: number
  roiPercent: number
  status: 'planning' | 'active' | 'completed' | 'paused'
}

export interface ComplianceRiskRecord {
  id: string
  title: string
  category: 'financial' | 'operational' | 'regulatory' | 'security' | 'vendor'
  severity: 'low' | 'medium' | 'high' | 'critical'
  status: 'identified' | 'mitigating' | 'controlled' | 'accepted'
  mitigationPlan: string
  reviewDate: string
}

export interface StockTransferRecord {
  id: string
  sourceLocation: string
  destinationLocation: string
  product: string
  productName: string
  quantity: number
  status: 'draft' | 'in_transit' | 'completed'
  transferredAt: string
}

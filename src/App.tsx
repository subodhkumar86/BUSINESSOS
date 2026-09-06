import { useEffect, useState, useRef, type ReactNode } from 'react'
import { canPerformAction, userRoles, roleMatrix, type Audit, type UserRole } from './types'
import type {
  State,
  Action,
  Snapshot,
  Collection,
  CreateCollection,
} from './types'
import { request, saveAction, ApiError } from './api'
import { Team } from './Team'
import { hydrateInventory } from './inventory'
import { StockPanel } from './StockPanel'
import { Security } from './Security'
import { RoleMatrix } from './RoleMatrix'
import { AdminConsole } from './AdminConsole'
import { seed, metrics, transition, stages } from './domain'
import './App.css'
interface BankAccount {
  id: string
  provider: string
  external_ref: string
  name: string
  currency: string
  status: 'active' | 'disconnected'
  created_at: string
}
interface BankTransaction {
  id: string
  external_ref: string
  occurred_at: string
  amount: number
  direction: 'credit' | 'debit'
  reference: string
  match_status: 'unmatched' | 'suggested' | 'matched' | 'ignored'
  matched_entity_type: 'invoice' | 'expense' | null
  matched_entity_id: string | null
  reconciled_at: string | null
}
interface DocumentRecord {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  storage_key: string
  version: number
  status: 'active' | 'archived'
  uploaded_by: string
  created_at: string
  updated_at: string
}
interface SupportTicket {
  id: string
  ticket_number: string
  subject: string
  customer: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  status: 'open' | 'pending' | 'resolved' | 'closed'
  sla_due_at: string | null
}
interface TaxFiling {
  id: string
  name: string
  territory: string
  due_date: string
  amount: number
  status: 'draft' | 'ready' | 'filed' | 'paid' | 'overdue'
}
interface WarehouseLocation {
  id: string
  name: string
  code: string
  status: 'active' | 'inactive'
}
interface Supplier {
  id: string
  name: string
  contact: string
  lead_days: number
  status: 'active' | 'review' | 'inactive'
}
interface PayrollPaymentBatch {
  id: string
  payroll_run_id: string
  amount: number
  status: 'pending' | 'submitted' | 'confirmed' | 'failed'
  created_at: string
  updated_at: string
}
interface ModuleRecord {
  id: string
  module: string
  name: string
  detail: string
  status: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}
const pages: [string, string, string, string][] = [
  ['dashboard', 'Overview', '◫', 'CORE'],
  ['finance', 'Finance & AR/AP', '₦', 'CORE'],
  ['banking', 'Banking & Feeds', '🏦', 'CORE'],
  ['inventory', 'Inventory & Stock', '▦', 'CORE'],
  ['crm', 'Sales & CRM', '↗', 'CORE'],
  ['procurement', 'Purchasing & POs', '▤', 'CORE'],
  ['suppliers', 'Suppliers & Vendors', '🤝', 'OPERATIONS'],
  ['warehouse', 'Warehouse Management', '⌂', 'OPERATIONS'],
  ['projects', 'Projects & Tasks', '☑', 'CORE'],
  ['hr', 'HR & Payroll', '♙', 'CORE'],
  ['assets', 'Assets & Depreciation', '📦', 'OPERATIONS'],
  ['facilities', 'Facility Management', '🏭', 'OPERATIONS'],
  ['production', 'Production & Quality', '⚙', 'OPERATIONS'],
  ['frontoffice', 'Front Office & Visitors', '📅', 'GROWTH'],
  ['support', 'Customer Support', '🎫', 'GROWTH'],
  ['documents', 'Documents & Media', '▧', 'GROWTH'],
  ['automation', 'Workflows & Automation', '⚡', 'GROWTH'],
  ['workspace', 'Virtual Workspace', '◌', 'GROWTH'],
  ['tax', 'Tax Management', '%', 'GOVERNANCE'],
  ['supply', 'Supply Chain', '⇄', 'OPERATIONS'],
  ['compliance', 'Compliance & Risk', '✓', 'GOVERNANCE'],
  ['billing', 'Billing & Plans', '$', 'GOVERNANCE'],
  ['ai', 'BI & AI Intelligence', '✧', 'INTELLIGENCE'],
  ['admin', 'Platform Admin', '🛡', 'PLATFORM'],
  ['settings', 'Settings & Security', '⚙', 'GOVERNANCE'],
]
const previewConfigs: Record<
  string,
  {
    eyebrow: string
    title: string
    description: string
    stats: [string, string, string][]
    primaryTitle: string
    primaryItems: [string, string, string][]
    secondaryTitle: string
    secondaryItems: [string, string][]
  }
> = {
  billing: {
    eyebrow: 'REVENUE OPERATIONS',
    title: 'Package the value you create.',
    description: 'Plans, usage, invoices, and entitlements in one operating view.',
    stats: [['Current plan', 'Business', 'Monthly subscription'], ['Seats', '8 / 12', 'Four seats available'], ['Next invoice', '30 Sep', 'Estimated NGN 180,000']],
    primaryTitle: 'Plan usage',
    primaryItems: [['Finance & CRM', 'Included', '100%'], ['Inventory records', '248 / 1,000', '25%'], ['Team seats', '8 / 12', '67%']],
    secondaryTitle: 'Billing readiness',
    secondaryItems: [['Payment method', 'Not connected'], ['Tax invoice profile', 'Needs review'], ['Entitlements', 'Server resolution pending']],
  },
  documents: {
    eyebrow: 'DOCUMENTS & MEDIA',
    title: 'Keep the source of truth close.',
    description: 'Contracts, receipts, policies, and versions organized by workspace.',
    stats: [['Files', '36', 'Across 5 folders'], ['Storage', '1.8 GB', 'Of 10 GB included'], ['Needs review', '4', 'Awaiting an owner']],
    primaryTitle: 'Recent documents',
    primaryItems: [['Supplier agreement.pdf', 'Procurement', 'Updated today'], ['September payroll policy.docx', 'People', 'Updated yesterday'], ['Northstar proposal.pdf', 'Sales', 'Updated 3 days ago']],
    secondaryTitle: 'Storage status',
    secondaryItems: [['Object storage', 'Connection pending'], ['Version history', 'Ready for API'], ['Access controls', 'Tenant scoped']],
  },
  automation: {
    eyebrow: 'WORKFLOWS',
    title: 'Let routine work move itself.',
    description: 'Triggers, approvals, notifications, and scheduled actions.',
    stats: [['Active workflows', '6', '2 need attention'], ['Runs this month', '184', '96% successful'], ['Time saved', '21h', 'Estimated this month']],
    primaryTitle: 'Workflow library',
    primaryItems: [['Low stock alert', 'Inventory', 'Active'], ['Invoice follow-up', 'Finance', 'Active'], ['New hire checklist', 'People', 'Draft']],
    secondaryTitle: 'Delivery health',
    secondaryItems: [['Notifications', 'Provider pending'], ['Scheduled jobs', 'Redis queue ready'], ['Last failure', 'None in 7 days']],
  },
  warehouse: {
    eyebrow: 'OPERATIONS',
    title: 'Move goods with confidence.',
    description: 'Locations, fulfillment, returns, and stock visibility across the network.',
    stats: [['Locations', '3', '1 needs a cycle count'], ['Open picks', '18', '6 due today'], ['On-time dispatch', '94%', 'Last 30 days']],
    primaryTitle: 'Fulfillment queue',
    primaryItems: [['SO-1048 · Northstar', 'Picking', 'Due today'], ['SO-1047 · Greenfield', 'Packed', 'Carrier pending'], ['RTN-003 · Dock station', 'Inspection', 'Needs decision']],
    secondaryTitle: 'Warehouse controls',
    secondaryItems: [['Costing method', 'Recorded unit cost'], ['Bin tracking', 'Backend connection pending'], ['Returns workflow', 'Ready for API']],
  },
  support: {
    eyebrow: 'CUSTOMER EXPERIENCE',
    title: 'Make every request accountable.',
    description: 'Tickets, SLAs, knowledge, and customer feedback in one queue.',
    stats: [['Open tickets', '14', '3 breaching SLA'], ['First response', '2h 18m', 'This month'], ['CSAT', '4.6 / 5', 'Last 30 days']],
    primaryTitle: 'Priority queue',
    primaryItems: [['#2048 · Delivery update', 'Northstar Limited', 'High'], ['#2046 · Invoice copy', 'Greenfield Studio', 'Medium'], ['#2042 · Product exchange', 'Lagos Office', 'Medium']],
    secondaryTitle: 'Support channels',
    secondaryItems: [['Email inbox', 'Connection pending'], ['Knowledge base', '12 articles'], ['Escalations', '3 active']],
  },
  tax: {
    eyebrow: 'COMPLIANCE FINANCE',
    title: 'Stay ready for the next filing.',
    description: 'Tax rules, exemptions, deductions, and filing preparation by territory.',
    stats: [['Next deadline', '21 days', 'VAT return · September'], ['Tax collected', 'NGN 0', 'No rules configured'], ['Exceptions', '2', 'Need accountant review']],
    primaryTitle: 'Filing calendar',
    primaryItems: [['VAT return · September', 'Nigeria', 'Due 21 Sep'], ['PAYE schedule · September', 'Nigeria', 'Due 10 Oct'], ['Annual return', 'Nigeria', 'Due 31 Mar']],
    secondaryTitle: 'Tax setup',
    secondaryItems: [['Territory rules', 'Not configured'], ['Tax registration', 'Needs review'], ['Remittance provider', 'Not connected']],
  },
  supply: {
    eyebrow: 'SUPPLY NETWORK',
    title: 'Plan the next shipment early.',
    description: 'Suppliers, lead times, demand signals, and logistics cost in one view.',
    stats: [['Active suppliers', '12', '2 need review'], ['Inbound orders', '7', 'NGN 4.2m committed'], ['At-risk SKUs', '5', 'Below lead-time cover']],
    primaryTitle: 'Supplier watchlist',
    primaryItems: [['Docking stations · Kora Imports', '14 day lead time', 'On track'], ['Office monitors · Brightline', '21 day lead time', 'At risk'], ['Keyboard stock · TechHub', '7 day lead time', 'On track']],
    secondaryTitle: 'Planning signals',
    secondaryItems: [['Demand forecast', 'Needs history'], ['Carrier integrations', 'Not connected'], ['Multi-warehouse view', 'Ready for API']],
  },
  compliance: {
    eyebrow: 'RISK & GOVERNANCE',
    title: 'Make controls visible.',
    description: 'Policies, certifications, risks, findings, and corrective actions.',
    stats: [['Open risks', '5', '1 critical'], ['Controls tested', '18 / 24', 'This quarter'], ['Policies due', '3', 'Within 30 days']],
    primaryTitle: 'Risk register',
    primaryItems: [['Bank feed credentials', 'Finance', 'Mitigate'], ['Supplier concentration', 'Supply chain', 'Monitor'], ['Payroll access review', 'People', 'Due soon']],
    secondaryTitle: 'Assurance status',
    secondaryItems: [['Audit trail', 'Append-only'], ['Policy library', 'Connection pending'], ['Certifications', '2 expiring soon']],
  },
  workspace: {
    eyebrow: 'COLLABORATION',
    title: 'Turn work into momentum.',
    description: 'Priorities, dependencies, shared notes, templates, and team context.',
    stats: [['Active projects', '8', '2 at risk'], ['Open tasks', '42', '11 due this week'], ['Templates', '9', '3 shared']],
    primaryTitle: 'Team focus',
    primaryItems: [['Launch Abuja branch', 'Operations', '62% complete'], ['September stock audit', 'Finance', 'Starts tomorrow'], ['Northstar renewal', 'Sales', 'Needs owner']],
    secondaryTitle: 'Collaboration status',
    secondaryItems: [['Comments', '18 this week'], ['Shared documents', '36 files'], ['Dependencies', '4 blocked']],
  },
  admin: {
    eyebrow: 'PLATFORM CONTROL',
    title: 'Operate the workspace responsibly.',
    description: 'Users, integrations, entitlements, audit events, and system health.',
    stats: [['Team members', '8', '1 inactive'], ['Integrations', '2', '1 needs attention'], ['System health', 'Good', 'Last checked now']],
    primaryTitle: 'Administration queue',
    primaryItems: [['Review auditor access', 'Security', '2 accounts'], ['Connect notification provider', 'Integrations', 'Pending'], ['Review plan entitlements', 'Billing', 'Needs owner']],
    secondaryTitle: 'Platform status',
    secondaryItems: [['Database', 'PostgreSQL ready'], ['Sessions', 'Redis ready'], ['Backups', 'Restore API pending']],
  },
  assets: {
    eyebrow: 'CAPITAL ASSETS',
    title: 'Track equipment value and maintenance.',
    description: 'Asset registration, serials, purchase cost, location, depreciation, and service schedules.',
    stats: [['Registered assets', '34', 'NGN 48.2m gross book value'], ['Depreciation YTD', 'NGN 4.6m', 'Straight-line method'], ['Maintenance due', '3', 'Within next 14 days']],
    primaryTitle: 'Asset register',
    primaryItems: [
      ['MacBook Pro 16 M3 (Asset-001)', 'Engineering · SN: C02X8892', 'Operational · NGN 3,200,000'],
      ['Dell Precision Workstation (Asset-002)', 'Design · SN: DL-889104', 'Operational · NGN 2,100,000'],
      ['Warehouse Forklift Toyota 8FBE (Asset-003)', 'Logistics · SN: TY-552109', 'Maintenance · NGN 12,500,000'],
    ],
    secondaryTitle: 'Depreciation policy',
    secondaryItems: [['Method', 'Straight-line 20% p.a.'], ['Tax treatment', 'Capital allowance schedule'], ['Disposal audit', 'Required by policy']],
  },
  facilities: {
    eyebrow: 'FACILITY OPERATIONS',
    title: 'Keep physical operations resilient.',
    description: 'Equipment condition monitoring, maintenance work orders, safety inspections, and incident logs.',
    stats: [['Operating facilities', '2', 'Lagos HQ & Abuja Hub'], ['Open work orders', '4', '1 high priority'], ['Safety compliance', '98%', 'Last inspection green']],
    primaryTitle: 'Facility work orders',
    primaryItems: [
      ['Main Office HVAC Unit #1', 'Facility: Lagos HQ · Condition: Good', 'Next check: 15 Oct'],
      ['Backup Generator CAT 250kVA', 'Power Backup · Condition: Fair', 'Oil change due in 10 days'],
      ['Abuja Warehouse Roller Shutter', 'Security / Access · Condition: Operational', 'Inspected yesterday'],
    ],
    secondaryTitle: 'Inspection status',
    secondaryItems: [['Fire safety certificate', 'Valid until Dec 2026'], ['Power backup SLA', '99.9% uptime target'], ['Environmental audit', 'Passed Q3 inspection']],
  },
  production: {
    eyebrow: 'MANUFACTURING & QUALITY',
    title: 'Schedule workflows and protect margins.',
    description: 'Production batches, machinery allocation, raw material consumption, and defect rates.',
    stats: [['Active batches', '3', 'Assembly lines 1 & 2'], ['Throughput rate', '94.2%', 'On-schedule target'], ['Defect rate', '0.4%', 'Below 1.0% tolerance']],
    primaryTitle: 'Production batches',
    primaryItems: [
      ['Batch #PR-2026-088 · Keyboards', 'Assembly line 2 · 500 units', 'In progress · 64%'],
      ['Batch #PR-2026-089 · Docking Stations', 'SMT line 1 · 200 units', 'Scheduled · Material ready'],
      ['Batch #PR-2026-087 · Monitor Mounts', 'QA Passed · 150 units', 'Completed · 0 defects'],
    ],
    secondaryTitle: 'Capacity utilization',
    secondaryItems: [['Assembly Line 1', '78% capacity utilized'], ['Assembly Line 2', '91% capacity utilized'], ['Raw material buffer', '18 days cover']],
  },
  frontoffice: {
    eyebrow: 'FRONT OFFICE & GUESTS',
    title: 'Make every visit professional.',
    description: 'Visitor check-in, appointments calendar, meeting rooms, deliveries, and inquiries.',
    stats: [['Today visitors', '7', '4 checked in'], ['Meeting rooms', '3 / 4', '75% booked'], ['Pending inquiries', '2', 'Avg wait: 4 mins']],
    primaryTitle: 'Visitor register',
    primaryItems: [
      ['Amina Bello · Kora Imports', 'Meeting Host: Amara Okafor · Room A', 'Checked in · 10:30 AM'],
      ['David Eze · Greenfield Audit', 'Meeting Host: Finance Lead · Boardroom', 'Scheduled · 2:00 PM'],
      ['Courier Delivery · Express Logistics', 'Front Desk Receiving', 'Completed · 9:15 AM'],
    ],
    secondaryTitle: 'Reception controls',
    secondaryItems: [['Visitor NDA', 'Digital signature active'], ['Security badge printer', 'Online'], ['Calendar sync', 'Google/Outlook connected']],
  },
  banking: {
    eyebrow: 'CASH & TREASURY',
    title: 'Real-time bank synchronization & reconciliation.',
    description: 'Automated statement sync, rule-based matching engine, and cash position reconciliation.',
    stats: [['Connected accounts', '2 accounts', 'Access Bank & Zenith'], ['Unreconciled', '2 items', 'Needs review'], ['Auto-match rate', '92%', 'Rule engine confidence']],
    primaryTitle: 'Transaction feeds',
    primaryItems: [
      ['Access Bank Corporate (0029381920)', 'Open Banking API adapter', 'Active · NGN 5,420,000'],
      ['Zenith Bank Operations (1019283741)', 'Direct Feed Adapter', 'Active · NGN 1,850,000'],
      ['Reconciliation Matching Engine', '14 auto-matched, 2 pending review', 'Live rule matcher'],
    ],
    secondaryTitle: 'Banking connectivity',
    secondaryItems: [['Open Banking API', 'Central Bank compliant'], ['Webhook verification', 'HMAC-SHA256 active'], ['Replay protection', 'Idempotency verified']],
  },
  suppliers: {
    eyebrow: 'VENDOR MANAGEMENT',
    title: 'Source reliably and negotiate with data.',
    description: 'Supplier directory, lead times, compliance ratings, and order history.',
    stats: [['Active suppliers', '12', '10 approved'], ['Avg lead time', '12.4 days', 'On-time delivery 91%'], ['Committed spend', 'NGN 8.4m', 'Active purchase orders']],
    primaryTitle: 'Approved suppliers',
    primaryItems: [
      ['Docking stations · Kora Imports', '14 day lead time', 'On track'],
      ['Office monitors · Brightline', '21 day lead time', 'At risk'],
      ['Keyboard stock · TechHub', '7 day lead time', 'On track'],
    ],
    secondaryTitle: 'Vendor compliance',
    secondaryItems: [['Tax identification', 'All active verified'], ['Bank account verification', 'Completed'], ['Standard payment terms', 'Net 30 days']],
  },
}
const definitions: Record<
  CreateCollection,
  [string, [string, string, string?][]]
> = {
  invoices: [
    'Create invoice',
    [
      ['name', 'Customer'],
      ['amount', 'Amount', 'number'],
    ],
  ],
  expenses: [
    'Record expense',
    [
      ['name', 'Description'],
      ['amount', 'Amount', 'number'],
    ],
  ],
  products: [
    'Add product',
    [
      ['name', 'Product name'],
      ['sku', 'SKU'],
      ['qty', 'Opening quantity', 'number'],
      ['cost', 'Unit cost', 'number'],
      ['min', 'Reorder threshold', 'number'],
    ],
  ],
  leads: [
    'Create lead',
    [
      ['name', 'Opportunity'],
      ['amount', 'Deal value', 'number'],
    ],
  ],
  orders: [
    'Create purchase order',
    [
      ['name', 'Supplier'],
      ['product', 'Product', 'product'],
      ['qty', 'Quantity', 'number'],
    ],
  ],
  employees: [
    'Add employee',
    [
      ['name', 'Full name'],
      ['department', 'Department'],
      ['amount', 'Monthly gross salary', 'number'],
    ],
  ],
  projects: [
    'Create project',
    [
      ['name', 'Project name'],
      ['amount', 'Budget', 'number'],
    ],
  ],
  tasks: ['Add task', [['name', 'Task']]],
}
function initial(): { data: State; error: string } {
  try {
    const data = localStorage.getItem('businessos-v1')
    if (data) {
      const parsed = JSON.parse(data)
      if (!Array.isArray(parsed.products) || !Array.isArray(parsed.journals))
        throw Error()
      return { data: hydrateInventory(parsed), error: '' }
    }
    return { data: seed(), error: '' }
  } catch {
    return {
      data: seed(),
      error:
        'Saved data could not be read. Sample data is shown; export it before making changes.',
    }
  }
}
const loaded = initial()
function App({
  remote,
  onSnapshot,
}: {
  remote: Snapshot | null
  onSnapshot: (s: Snapshot) => void
}) {
  const [s, setS] = useState(remote?.state || loaded.data),
    [page, setPage] = useState(
      location.pathname.split('/').pop() || 'dashboard',
    ),
    [search, setSearch] = useState(''),
    [modal, setModal] = useState<CreateCollection | 'payroll' | null>(null),
    [error, setError] = useState(remote ? '' : loaded.error),
    [notice, setNotice] = useState(''),
    [growth, setGrowth] = useState(10),
    [expenseShift, setExpenseShift] = useState(0),
    [question, setQuestion] = useState(''),
    [answer, setAnswer] = useState(''),
    [aiLineage, setAiLineage] = useState(''),
    [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]),
    [bankTransactions, setBankTransactions] = useState<BankTransaction[]>([]),
    [bankLoading, setBankLoading] = useState(false),
    [moduleRecords, setModuleRecords] = useState<ModuleRecord[]>([]),
    [moduleLoaded, setModuleLoaded] = useState(false),
    [documents, setDocuments] = useState<DocumentRecord[]>([]),
    [tickets, setTickets] = useState<SupportTicket[]>([]),
    [filings, setFilings] = useState<TaxFiling[]>([]),
    [locations, setLocations] = useState<WarehouseLocation[]>([]),
    [suppliers, setSuppliers] = useState<Supplier[]>([]),
    [paymentBatches, setPaymentBatches] = useState<Record<string, PayrollPaymentBatch>>({}),
    [auditLogs, setAuditLogs] = useState<Audit[]>([])
  const saving = useRef(false),
    [busy, setBusy] = useState(false),
    documentPicker = useRef<HTMLInputElement>(null)
  const [simulatedRole, setSimulatedRole] = useState<UserRole | null>(null)
  const effectiveRole: UserRole = simulatedRole || remote?.user.role || 'owner'
  const readOnly = effectiveRole === 'auditor'
  const m = metrics(s),
    money = (v: unknown) =>
      new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: s.currency,
        maximumFractionDigits: 0,
      }).format(Number(v))
  useEffect(() => {
    const listener = () => {
      setPage(location.pathname.split('/').pop() || 'dashboard')
      setModuleRecords([])
      setModuleLoaded(false)
    }
    window.addEventListener('popstate', listener)
    return () => window.removeEventListener('popstate', listener)
  }, [])
  useEffect(() => {
    if (!remote || (page !== 'finance' && page !== 'banking') || !['owner', 'finance_admin', 'auditor'].includes(effectiveRole))
      return
    let active = true
    request<{ accounts: BankAccount[] }>('/banks/accounts')
      .then((data) => {
        if (!active) return
        setBankAccounts(data.accounts)
        const account = data.accounts[0]
        if (account)
          return request<{ transactions: BankTransaction[] }>(
            `/banks/accounts/${account.id}/transactions`,
          ).then((transactions) => {
            if (active) setBankTransactions(transactions.transactions)
          })
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load bank accounts.')
      })
      .finally(() => {
        if (active) setBankLoading(false)
      })
    return () => {
      active = false
    }
  }, [page, remote, effectiveRole])
  useEffect(() => {
    if (!remote || page !== 'documents') return
    let active = true
    request<{ documents: DocumentRecord[] }>('/documents')
      .then((data) => {
        if (active) {
          setDocuments(data.documents)
          setModuleLoaded(true)
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load documents.')
      })
    return () => {
      active = false
    }
  }, [page, remote])
  useEffect(() => {
    if (!remote || !['support', 'tax', 'warehouse', 'supply'].includes(page)) return
    let active = true
    const path = page === 'support'
      ? '/support/tickets'
      : page === 'tax'
        ? '/tax/filings'
        : page === 'warehouse'
          ? '/warehouse/locations'
          : '/suppliers'
    request<{ tickets?: SupportTicket[]; filings?: TaxFiling[]; locations?: WarehouseLocation[]; suppliers?: Supplier[] }>(path)
      .then((data) => {
        if (!active) return
        if (page === 'support') setTickets(data.tickets || [])
        else if (page === 'tax') setFilings(data.filings || [])
        else if (page === 'warehouse') setLocations(data.locations || [])
        else setSuppliers(data.suppliers || [])
        setModuleLoaded(true)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load module records.')
      })
    return () => {
      active = false
    }
  }, [page, remote])
  useEffect(() => {
    if (!remote || page !== 'hr' || !['owner', 'hr_admin', 'auditor'].includes(remote.user.role)) return
    let active = true
    const approvedRuns = s.payroll.filter((run) => run.status === 'Approved')
    Promise.all(approvedRuns.map(async (run) => {
      const result = await request<{ batches: PayrollPaymentBatch[] }>(`/payroll/runs/${run.id}/payment-batches`)
      return [run.id, result.batches[0]] as const
    }))
      .then((entries) => {
        if (!active) return
        setPaymentBatches(Object.fromEntries(entries.filter((entry): entry is [string, PayrollPaymentBatch] => Boolean(entry[1]))))
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'Could not load payroll payment batches.')
      })
    return () => {
      active = false
    }
  }, [page, remote, s.payroll])
  useEffect(() => {
    if (!remote || page !== 'settings' || !['owner', 'auditor'].includes(remote.user.role)) return
    let active = true
    request<{ entries: Audit[] }>('/audit-logs?limit=100')
      .then((result) => {
        if (active) setAuditLogs(result.entries)
      })
      .catch((error) => {
        if (active) setError(error instanceof Error ? error.message : 'Could not load audit logs.')
      })
    return () => {
      active = false
    }
  }, [page, remote])
  useEffect(() => {
    if (!remote || !previewConfigs[page] || ['documents', 'support', 'tax', 'warehouse', 'supply'].includes(page)) return
    let active = true
    const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''
    request<{ records: ModuleRecord[] }>(`/modules/${page}${query}`)
      .then((data) => {
        if (active) setModuleRecords(data.records)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load module records.')
      })
      .finally(() => {
          if (active) {
            setModuleLoaded(true)
          }
      })
    return () => {
      active = false
    }
  }, [page, remote, search])
  function navigate(id: string) {
    history.pushState({}, '', `/app/${id}`)
    setPage(id)
    setModuleRecords([])
    setModuleLoaded(false)
    setSearch('')
    setError('')
  }
  async function refreshWorkspace() {
    if (!remote) return
    const latest = await request<Snapshot>('/workspace')
    setS(latest.state)
    onSnapshot(latest)
  }
  async function commit(a: Action) {
    if (remote && !canPerformAction(remote.user.role, a)) {
      setError(`Your ${remote.user.role.replaceAll('_', ' ')} role cannot perform this action.`)
      return false
    }
    if (readOnly) {
      setError('Auditor accounts have read-only access.')
      return false
    }
    if (saving.current) return false
    saving.current = true
    setBusy(true)
    try {
      if (remote) {
        const next = await saveAction(remote, a, crypto.randomUUID())
        setS(next.state)
        onSnapshot(next)
      } else {
        const next = transition(s, a)
        localStorage.setItem('businessos-v1', JSON.stringify(next))
        setS(next)
      }
      setModal(null)
      setError('')
      setNotice(
        remote
          ? 'Changes saved to PostgreSQL.'
          : 'Changes saved to this browser.',
      )
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
      if (e instanceof ApiError && e.status === 409) {
        try {
          const latest = await request<Snapshot>('/workspace')
          setS(latest.state)
          onSnapshot(latest)
        } catch {
          /* Keep the original error and unsaved form. */
        }
      }
      return false
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  function download(data: string, name: string, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function csv() {
    if (
      remote &&
      current === 'finance' &&
      ['owner', 'finance_admin', 'auditor'].includes(remote.user.role)
    ) {
      window.open('/api/v1/finance/export.csv', '_blank', 'noopener')
      setNotice('Your audited finance CSV export is being prepared.')
      return
    }
    const rows = [
      ['Metric', 'NGN'],
      ['Cash', m.cash],
      ['Collected revenue', m.revenue],
      ['Receivables', m.receivables],
      ['Payables', m.payables],
      ['Stock value', m.stock],
      ['Open pipeline', m.pipeline],
    ]
    download(
      rows.map((r) => r.join(',')).join('\n'),
      'businessos-report.csv',
      'text/csv',
    )
  }
  const action = (collection: string, id: string, status: string) =>
    commit({ type: 'status', collection, id, status })
  const add = (collection: CreateCollection) => {
    const permitted = !remote || canPerformAction(remote.user.role, { type: 'create', collection })
    return (
    <button
      disabled={busy || readOnly || !permitted}
      title={permitted ? undefined : 'Your role cannot create records in this module.'}
      className="primary"
      onClick={() => {
        setError('')
        setModal(collection)
      }}
    >
      + {definitions[collection][0]}
    </button>
    )
  }
  const badge = (status: unknown) => (
    <span
      className={`badge ${['Paid', 'Approved', 'Completed', 'Won', 'Received'].includes(String(status)) ? 'green' : ''}`}
    >
      {String(status)}
    </span>
  )
  type Row<K extends Collection> = State[K] extends (infer R)[] ? R : never
  function table<K extends Collection>(
    collection: K,
    columns: [string, string, ((value: never, row: Row<K>) => ReactNode)?][],
    actions?: (row: Row<K>) => ReactNode,
  ) {
    const rows = (s[collection] as Row<K>[]).filter((r) =>
      Object.values(r as object).some((v) =>
        String(v).toLowerCase().includes(search.toLowerCase()),
      ),
    )
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
              {actions && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={(r as { id: string }).id}>
                {columns.map(([key, , format]) => (
                  <td key={key}>
                    {format
                      ? format((r as Record<string, unknown>)[key] as never, r)
                      : String((r as Record<string, unknown>)[key] ?? '')}
                  </td>
                ))}
                {actions && <td>{actions(r)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="empty">
            No records found. Add a record or change your search.
          </p>
        )}
      </div>
    )
  }
  const stats = (items: [string, ReactNode, string][]) => (
    <div className="stats">
      {items.map(([name, value, detail]) => (
        <article className="card stat" key={name}>
          <p>{name}</p>
          <strong>{value}</strong>
          <small>{detail}</small>
        </article>
      ))}
    </div>
  )
  const section = (title: string, children: ReactNode, button?: ReactNode) => (
    <section className="card">
      <div className="section-top">
        <h2>{title}</h2>
        {button}
      </div>
      {children}
    </section>
  )
  const titles: Record<string, [string, string]> = {
    dashboard: [
      'Run the business from one place.',
      'Your people, money, and operations. One clear picture.',
    ],
    finance: [
      'Know where the money is.',
      'Track receivables, expenses, and balanced journal postings.',
    ],
    inventory: [
      'Every item. Every movement.',
      'Monitor stock and receive approved purchases.',
    ],
    crm: [
      'Turn opportunities into revenue.',
      'Keep the next conversation moving forward.',
    ],
    procurement: [
      'Purchase with confidence.',
      'From supplier request to approval and goods receipt.',
    ],
    hr: [
      'Your people, well managed.',
      'Employee records and gross payroll approval.',
    ],
    projects: [
      'Make progress visible.',
      'Keep projects and everyday work on track.',
    ],
    ai: [
      'A clearer view of what comes next.',
      'Calculated insights from your workspace records.',
    ],
    settings: [
      'Make BusinessOS yours.',
      'Workspace preferences, data exports, and activity history.',
    ],
    billing: ['Turn growth into a system.', 'Plans, usage, and entitlements for the whole organisation.'],
    documents: ['Keep the source of truth close.', 'Contracts, receipts, policies, and versions in one place.'],
    automation: ['Let routine work move itself.', 'Triggers, approvals, notifications, and scheduled actions.'],
    warehouse: ['Move goods with confidence.', 'Locations, fulfillment, returns, and stock visibility.'],
    support: ['Make every request accountable.', 'Tickets, service levels, knowledge, and feedback.'],
    tax: ['Stay ready for the next filing.', 'Rules, exemptions, deductions, and filing preparation.'],
    supply: ['Plan the next shipment early.', 'Suppliers, lead times, demand signals, and logistics.'],
    compliance: ['Make controls visible.', 'Policies, certifications, risks, findings, and actions.'],
    workspace: ['Turn work into momentum.', 'Priorities, dependencies, notes, and team context.'],
    admin: ['Operate the workspace responsibly.', 'Users, integrations, entitlements, and system health.'],
    banking: ['Real-time cash and bank feeds.', 'Connect accounts, reconcile transactions, and match receipts.'],
    suppliers: ['Vendor and partner management.', 'Contracts, lead-time tracking, compliance, and performance.'],
    assets: ['Track equipment value and maintenance.', 'Registration, serial numbers, depreciation, and service records.'],
    facilities: ['Keep physical operations resilient.', 'Equipment monitoring, work orders, safety compliance, and repairs.'],
    production: ['Schedule workflows and protect margins.', 'Production batches, material allocation, capacity, and quality control.'],
    frontoffice: ['Front desk and visitor experience.', 'Appointments, check-ins, meeting rooms, and customer inquiries.'],
  }
  const canViewPage = (id: string, role: UserRole) => {
    if (role === 'owner' || role === 'auditor') return id !== 'admin'
    if (role === 'super_admin') {
      return ['admin', 'dashboard', 'settings', 'compliance'].includes(id)
    }
    const pageRoles: Record<string, UserRole[]> = {
      dashboard: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager', 'employee'],
      finance: ['finance_admin'],
      banking: ['finance_admin'],
      inventory: ['operations_manager'],
      crm: ['sales_crm_user'],
      procurement: ['operations_manager'],
      suppliers: ['operations_manager'],
      warehouse: ['operations_manager'],
      projects: ['operations_manager', 'department_manager'],
      hr: ['hr_admin'],
      assets: ['operations_manager'],
      facilities: ['operations_manager'],
      production: ['operations_manager'],
      frontoffice: ['sales_crm_user', 'department_manager', 'employee'],
      support: ['sales_crm_user', 'department_manager', 'employee'],
      documents: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager', 'employee'],
      automation: ['operations_manager', 'department_manager'],
      workspace: ['department_manager', 'employee', 'operations_manager'],
      tax: ['finance_admin'],
      supply: ['operations_manager'],
      compliance: ['finance_admin', 'operations_manager', 'hr_admin', 'super_admin'],
      billing: ['finance_admin'],
      ai: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user'],
      settings: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager', 'employee'],
      admin: ['super_admin'],
    }
    return pageRoles[id]?.includes(role) ?? false
  }
  const visiblePages = pages.filter(([id]) => canViewPage(id, effectiveRole))
  const current = titles[page] && canViewPage(page, effectiveRole) ? page : 'dashboard'
  const preview = previewConfigs[current]
  const primaryRecords: ModuleRecord[] = remote && moduleLoaded
    ? current === 'documents'
      ? documents.map((document) => ({
          id: document.id,
          module: 'documents',
          name: document.filename,
          detail: `${document.mime_type} · ${Math.ceil(document.size_bytes / 1024)} KB`,
          status: document.status,
          metadata: { storageKey: document.storage_key },
          created_at: document.created_at,
          updated_at: document.updated_at,
        }))
      : current === 'support'
        ? tickets.map((ticket) => ({
            id: ticket.id,
            module: 'support',
            name: `${ticket.ticket_number} · ${ticket.subject}`,
            detail: ticket.customer,
            status: ticket.status,
            metadata: { priority: ticket.priority },
            created_at: '',
            updated_at: '',
          }))
        : current === 'tax'
          ? filings.map((filing) => ({
              id: filing.id,
              module: 'tax',
              name: filing.name,
              detail: `${filing.territory} · due ${filing.due_date}`,
              status: filing.status,
              metadata: { amount: filing.amount },
              created_at: '',
              updated_at: '',
            }))
          : current === 'warehouse'
            ? locations.map((location) => ({
                id: location.id,
                module: 'warehouse',
                name: location.name,
                detail: location.code,
                status: location.status,
                metadata: {},
                created_at: '',
                updated_at: '',
              }))
            : current === 'supply'
              ? suppliers.map((supplier) => ({
                  id: supplier.id,
                  module: 'supply',
                  name: supplier.name,
                  detail: `${supplier.lead_days} day lead time · ${supplier.contact}`,
                  status: supplier.status,
                  metadata: {},
                  created_at: '',
                  updated_at: '',
                }))
          : moduleRecords
    : (preview?.primaryItems || []).map(([name, detail, status], index) => ({
        id: `preview-${index}`,
        module: current,
        name,
        detail,
        status,
        metadata: {},
        created_at: '',
        updated_at: '',
      }))
  async function addPreviewRecord() {
    if (!preview) return
    if (!remote) {
      setNotice(`${preview.primaryTitle} is ready for the backend connection.`)
      return
    }
    try {
      const created = await request<ModuleRecord>(`/modules/${current}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          name: `${preview.primaryTitle} · New item`,
          detail: 'Created from the workspace',
          status: 'Draft',
        }),
      })
      setModuleRecords((records) => [created, ...records])
      setNotice('New module record created and audited.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create module record.')
    }
  }
  async function registerDocument(file: File) {
    if (!remote) return
    try {
      const document = await request<DocumentRecord>('/documents', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      })
      setDocuments((items) => [document, ...items])
      setNotice('Document metadata registered. Configure object storage to upload the binary.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register document.')
    }
  }
  async function createSupportTicket(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!remote) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const ticket = await request<SupportTicket>('/support/tickets', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          subject: values.subject,
          customer: values.customer,
          priority: values.priority,
          slaDueAt: values.slaDueAt ? new Date(String(values.slaDueAt)).toISOString() : null,
        }),
      })
      setTickets((items) => [ticket, ...items])
      event.currentTarget.reset()
      setNotice('Support ticket created and audited.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create support ticket.')
    }
  }
  async function createTaxFiling(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!remote) return
    const values = Object.fromEntries(new FormData(event.currentTarget))
    try {
      const filing = await request<TaxFiling>('/tax/filings', {
        method: 'POST',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({
          name: values.name,
          territory: values.territory,
          dueDate: values.dueDate,
          amount: Number(values.amount),
        }),
      })
      setFilings((items) => [...items, filing].sort((a, b) => a.due_date.localeCompare(b.due_date)))
      event.currentTarget.reset()
      setNotice('Tax filing created and audited.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create tax filing.')
    }
  }
  async function updatePreviewRecord(record: ModuleRecord, status: string) {
    if (!remote || record.id.startsWith('preview-')) return
    try {
      const endpoint = current === 'documents'
        ? `/documents/${record.id}`
        : current === 'support'
          ? `/support/tickets/${record.id}`
          : current === 'tax'
            ? `/tax/filings/${record.id}`
              : current === 'warehouse'
                ? `/warehouse/locations/${record.id}`
                : current === 'supply'
                  ? `/suppliers/${record.id}`
            : `/modules/${current}/${record.id}`
      await request(endpoint, {
        method: 'PATCH',
        headers: { 'X-CSRF-Token': remote.csrf },
        body: JSON.stringify({ status }),
      })
      if (current === 'documents')
        setDocuments((items) => items.map((item) => item.id === record.id ? { ...item, status: status as DocumentRecord['status'] } : item))
      else if (current === 'support')
        setTickets((items) => items.map((item) => item.id === record.id ? { ...item, status: status as SupportTicket['status'] } : item))
      else if (current === 'tax')
        setFilings((items) => items.map((item) => item.id === record.id ? { ...item, status: status as TaxFiling['status'] } : item))
      else if (current === 'warehouse')
        setLocations((items) => items.map((item) => item.id === record.id ? { ...item, status: status as WarehouseLocation['status'] } : item))
      else if (current === 'supply')
        setSuppliers((items) => items.map((item) => item.id === record.id ? { ...item, status: status as Supplier['status'] } : item))
      else
        setModuleRecords((records) => records.map((item) => item.id === record.id ? { ...item, status } : item))
      setNotice('Module record updated and audited.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update module record.')
    }
  }
  async function deletePreviewRecord(record: ModuleRecord) {
    if (!remote || record.id.startsWith('preview-')) return
    try {
      const isArchive = ['documents', 'support', 'tax', 'warehouse', 'supply'].includes(current)
      const endpoint = current === 'documents'
        ? `/documents/${record.id}`
        : current === 'support'
          ? `/support/tickets/${record.id}`
          : current === 'tax'
            ? `/tax/filings/${record.id}`
              : current === 'warehouse'
                ? `/warehouse/locations/${record.id}`
                : current === 'supply'
                  ? `/suppliers/${record.id}`
            : `/modules/${current}/${record.id}`
      await request(endpoint, {
        method: isArchive ? 'PATCH' : 'DELETE',
        headers: { 'X-CSRF-Token': remote.csrf },
        ...(isArchive ? { body: JSON.stringify({ status: current === 'documents' ? 'archived' : current === 'support' ? 'closed' : current === 'tax' ? 'paid' : 'inactive' }) } : {}),
      })
      if (current === 'documents') {
        setDocuments((items) => items.map((item) => item.id === record.id ? { ...item, status: 'archived' } : item))
        setNotice('Document archived and audited.')
      } else if (current === 'support') {
        setTickets((items) => items.map((item) => item.id === record.id ? { ...item, status: 'closed' } : item))
        setNotice('Support ticket closed and audited.')
      } else if (current === 'tax') {
        setFilings((items) => items.map((item) => item.id === record.id ? { ...item, status: 'paid' } : item))
        setNotice('Tax filing marked paid and audited.')
      } else if (current === 'warehouse') {
        setLocations((items) => items.map((item) => item.id === record.id ? { ...item, status: 'inactive' } : item))
        setNotice('Warehouse location deactivated and audited.')
      } else if (current === 'supply') {
        setSuppliers((items) => items.map((item) => item.id === record.id ? { ...item, status: 'inactive' } : item))
        setNotice('Supplier deactivated and audited.')
      } else {
        setModuleRecords((records) => records.filter((item) => item.id !== record.id))
        setNotice('Module record deleted and audited.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete module record.')
    }
  }
  function handleAiQuestion(qText: string) {
    const q = qText.toLowerCase()
    const monthlySalaries = s.employees.reduce((a, x) => a + x.amount, 0)
    const monthlyExpenses = s.expenses.reduce((a, x) => a + x.amount, 0)
    const totalBurn = monthlySalaries + monthlyExpenses

    if (/runway|burn|months/.test(q)) {
      const months = totalBurn > 0 ? (m.cash / totalBurn).toFixed(1) : '12+'
      setAnswer(`Current estimated operational runway is ${months} months (${Math.round(Number(months) * 4.3)} weeks) at a monthly burn rate of ${money(totalBurn)}.`)
      setAiLineage(`Formula: Cash Balance (${money(m.cash)}) ÷ [Monthly Salaries (${money(monthlySalaries)}) + Monthly Expenses (${money(monthlyExpenses)})]. Sources: General Ledger Cash Account 1010, HR Employee Register, and AP Expense Ledger.`)
    } else if (/cash|money|liquidity/.test(q)) {
      setAnswer(`Current available cash position is ${money(m.cash)}, with ${money(m.receivables)} in open receivables and ${money(m.revenue)} in settled collections.`)
      setAiLineage(`Calculation: Opening Cash (${money(s.openingCash)}) + Paid Customer Invoices (${money(m.revenue)}) − Recorded Expenses (${money(monthlyExpenses)}). Sources: Finance GL accounts and live workspace invoice ledger.`)
    } else if (/stock|inventory|reorder|sku/.test(q)) {
      if (m.low.length) {
        const itemNames = m.low.map((p) => `${p.name} (${p.qty} on hand, min: ${p.min})`).join(', ')
        setAnswer(`${m.low.length} SKUs require immediate reorder: ${itemNames}. Total estimated reorder capital is ${money(m.low.reduce((a, p) => a + ((p.min - p.qty) * p.cost), 0))}.`)
      } else {
        setAnswer(`All ${s.products.length} tracked product SKUs are currently above minimum safety reorder thresholds. Inventory value is ${money(m.stock)}.`)
      }
      setAiLineage(`Sources: Product Inventory master table, evaluated against on-hand quantity < reorder_point rule across active warehouse locations.`)
    } else if (/payroll|salary|wage|employee/.test(q)) {
      setAnswer(`Monthly gross payroll commitment is ${money(monthlySalaries)} across ${s.employees.length} active employees. Last payroll accrual status: ${s.payroll[0]?.status || 'Draft'}.`)
      setAiLineage(`Calculation: Sum of gross_salary from HR active employee records. Excludes employer statutory pension and tax withholding (configured per jurisdiction).`)
    } else if (/pipeline|sales|crm|deal|conversion/.test(q)) {
      const activeDeals = s.leads.filter((l) => !['Won', 'Lost'].includes(l.status))
      setAnswer(`Total open pipeline is ${money(m.pipeline)} across ${activeDeals.length} opportunities. Projected weighted revenue realization is ${money(Math.round(m.pipeline * 0.42))}.`)
      setAiLineage(`Sources: CRM pipeline records, applying historical stage progression weightings (Lead: 15%, Qualified: 40%, Proposal: 70%, Negotiation: 85%).`)
    } else if (/risk|anomaly|hazard|warning/.test(q)) {
      const risks: string[] = []
      if (m.low.length) risks.push(`${m.low.length} stockout alerts`)
      if (bankTransactions.some((t) => t.match_status === 'unmatched')) risks.push('unmatched bank statements')
      if (m.receivables > 0) risks.push(`${money(m.receivables)} in unpaid invoices`)
      setAnswer(`Operational Risk Summary: Identified ${risks.length ? risks.join(', ') : 'no critical operational risks'}.`)
      setAiLineage(`Cross-module inspection: Inventory minimums, Bank feed reconciliation table, and Accounts Receivable aging status.`)
    } else {
      setAnswer(`BusinessOS Intelligence analyzed "${qText}": Cash is ${money(m.cash)}, open pipeline is ${money(m.pipeline)}, inventory value is ${money(m.stock)}, and payroll is ${money(monthlySalaries)}.`)
      setAiLineage(`Aggregated multi-domain snapshot from Finance, CRM, Inventory, and HR.`)
    }
  }
  return (
    <div className="shell" aria-busy={busy}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside>
        <div className="brand">
          <span className="logo">B</span>Business<span>OS</span>
        </div>
        <div className="workspace">
          <span className="avatar">{s.organisation.slice(0, 1)}</span>
          <div>
            <b>{s.organisation}</b>
            <small>{remote ? 'Server workspace' : 'Local workspace'}</small>
          </div>
        </div>
        <p className="nav-label">CORE WORKSPACES</p>
        <nav>
          {visiblePages
            .filter(([, , , cat]) => cat === 'CORE')
            .map(([id, label, icon]) => (
              <button
                className={current === id ? 'active' : ''}
                onClick={() => navigate(id)}
                key={id}
              >
                <span>{icon}</span>
                {label}
                {id === 'inventory' && m.low.length > 0 && (
                  <em>{m.low.length}</em>
                )}
              </button>
            ))}
        </nav>
        {visiblePages.some(([, , , cat]) => cat === 'OPERATIONS') && (
          <>
            <p className="nav-label growth-label">OPERATIONS & SUPPLY</p>
            <nav>
              {visiblePages
                .filter(([, , , cat]) => cat === 'OPERATIONS')
                .map(([id, label, icon]) => (
                  <button
                    className={current === id ? 'active' : ''}
                    onClick={() => navigate(id)}
                    key={id}
                  >
                    <span>{icon}</span>
                    {label}
                  </button>
                ))}
            </nav>
          </>
        )}
        {visiblePages.some(([, , , cat]) => cat === 'GROWTH') && (
          <>
            <p className="nav-label growth-label">GROWTH & COLLABORATION</p>
            <nav>
              {visiblePages
                .filter(([, , , cat]) => cat === 'GROWTH')
                .map(([id, label, icon]) => (
                  <button
                    className={current === id ? 'active' : ''}
                    onClick={() => navigate(id)}
                    key={id}
                  >
                    <span>{icon}</span>
                    {label}
                  </button>
                ))}
            </nav>
          </>
        )}
        {visiblePages.some(([, , , cat]) => cat === 'GOVERNANCE' || cat === 'INTELLIGENCE' || cat === 'PLATFORM') && (
          <>
            <p className="nav-label growth-label">GOVERNANCE & PLATFORM</p>
            <nav>
              {visiblePages
                .filter(([, , , cat]) => cat === 'GOVERNANCE' || cat === 'INTELLIGENCE' || cat === 'PLATFORM')
                .map(([id, label, icon]) => (
                  <button
                    className={current === id ? 'active' : ''}
                    onClick={() => navigate(id)}
                    key={id}
                  >
                    <span>{icon}</span>
                    {label}
                  </button>
                ))}
            </nav>
          </>
        )}
        <div className="aside-bottom">
          <span className="status-dot" />{' '}
          {remote ? 'Saved in PostgreSQL' : 'Saved on this device'}
          <p>Tenant: {effectiveRole.replaceAll('_', ' ')}</p>
          <div className="user">
            <span className="avatar">{effectiveRole.slice(0, 2).toUpperCase()}</span>
            <div>
              <b>{remote?.user.name || roleMatrix[effectiveRole].title}</b>
              <small>
                {roleMatrix[effectiveRole].title}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <header>
          <span>
            Workspace{' '}
            <span className="muted">
              {' '}
              / {pages.find((x) => x[0] === current)?.[1] || current}
            </span>
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {!remote ? (
              <div className="role-switcher-wrap" title="Preview the local demo as another role">
                <span className="role-simulator-badge">DEMO ROLE</span>
                <select
                  aria-label="Local demo role preview"
                  value={effectiveRole}
                  onChange={(e) => {
                    const newRole = e.target.value as UserRole
                    setSimulatedRole(newRole)
                    if (!canViewPage(page, newRole)) {
                      navigate('dashboard')
                    }
                  }}
                >
                  {userRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleMatrix[role].title}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span className="role-tag">{roleMatrix[effectiveRole].title}</span>
            )}
            <span className="local-tag">
              {remote ? 'SERVER MVP' : 'LOCAL MVP'}
            </span>
            <span className="avatar" title={`Role: ${effectiveRole}`}>
              {effectiveRole.slice(0, 2).toUpperCase()}
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">BUSINESS AT A GLANCE</p>
              <h1>{titles[current][0]}</h1>
              <p>{titles[current][1]}</p>
            </div>
            <button onClick={csv}>↓ Export report</button>
          </div>
          {readOnly && (
            <div className="notice" style={{ background: '#fdf5e6', borderColor: '#f39c12', color: '#7e3f00' }}>
              🔒 <b>Auditor Account · Universal Read-Only Access</b>: In accordance with PRD §5, Auditor accounts have view-only access across all records for review and audit trails. All creating, editing, and approval mutations are strictly blocked.
            </div>
          )}
          {effectiveRole !== 'owner' && !readOnly && (
            <div className="notice" style={{ background: '#f6f5fe', borderColor: '#d3cff7', color: '#4d419f' }}>
              👤 <b>Active Role: {roleMatrix[effectiveRole].title}</b> — {roleMatrix[effectiveRole].accessSummary}. <i>Restriction: {roleMatrix[effectiveRole].restrictions}</i>
            </div>
          )}
          {error && (
            <div role="alert" className="alert">
              {error}
            </div>
          )}
          {notice && (
            <div role="status" className="notice">
              {notice}
              <button
                onClick={() => setNotice('')}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {current === 'dashboard' && (
            <>
              <div className="welcome">
                <div>
                  <span className="badge">YOUR OPERATING PULSE</span>
                  <h2>Good decisions start with visibility.</h2>
                  <p>
                    {m.low.length} stock alerts and{' '}
                    {s.orders.filter((o) => o.status === 'Pending').length +
                      s.payroll.filter((p) => p.status === 'Draft').length}{' '}
                    approvals need your attention.
                  </p>
                  <button onClick={() => navigate('ai')}>
                    Explore business insights ↗
                  </button>
                </div>
                <div className="pulse">
                  <span>
                    {s.tasks.filter((t) => t.status === 'Completed').length}/
                    {s.tasks.length}
                  </span>
                  <small>tasks complete</small>
                </div>
              </div>
              {stats([
                [
                  'Cash position',
                  money(m.cash),
                  'Opening cash + collections − expenses',
                ],
                [
                  'Open receivables',
                  money(m.receivables),
                  'Awaiting customer payment',
                ],
                [
                  'Inventory value',
                  money(m.stock),
                  `${s.products.length} products tracked`,
                ],
                ['Sales pipeline', money(m.pipeline), 'Open opportunities'],
              ])}
              <div className="two-col">
                {section(
                  'Sales pipeline',
                  <div className="bars">
                    {stages.slice(0, 4).map((stage, i) => {
                      const total = s.leads
                        .filter((l) => l.status === stage)
                        .reduce((a, l) => a + l.amount, 0)
                      return (
                        <div key={stage}>
                          <div>
                            <span>{stage}</span>
                            <b>{money(total)}</b>
                          </div>
                          <div className="track">
                            <span
                              style={{
                                width: `${Math.min(100, (total / Math.max(1, ...s.leads.map((l) => l.amount))) * 100)}%`,
                                background: [
                                  '#6965dc',
                                  '#8b88e7',
                                  '#a9a7ef',
                                  '#c8c6f5',
                                ][i],
                              }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>,
                  <button onClick={() => navigate('crm')}>View CRM ↗</button>,
                )}
                {section(
                  'Needs your attention',
                  <div className="attention">
                    {m.low.map((p) => (
                      <button key={p.id} onClick={() => navigate('inventory')}>
                        <span className="alert-icon">!</span>
                        <div>
                          <b>{p.name}</b>
                          <small>
                            {p.qty} in stock · reorder below {p.min}
                          </small>
                        </div>
                        <span>↗</span>
                      </button>
                    ))}
                    {s.tasks
                      .filter((t) => t.status === 'Open')
                      .map((t) => (
                        <label className="task" key={t.id}>
                          <input
                            disabled={busy || readOnly}
                            type="checkbox"
                            onChange={() => action('tasks', t.id, 'Completed')}
                          />
                          {t.name}
                        </label>
                      ))}
                    {!m.low.length &&
                      !s.tasks.some((t) => t.status === 'Open') && (
                        <p>You're all caught up.</p>
                      )}
                  </div>,
                )}
              </div>
              {section(
                'Recent activity',
                s.audit.length ? (
                  <div className="activity">
                    {s.audit.slice(0, 5).map((a) => (
                      <div key={a.id}>
                        <span className="activity-dot" />
                        <b>{a.entity}</b>
                        <span>{a.detail}</span>
                        <small>{new Date(a.date).toLocaleString()}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty">
                    Your workspace is ready. New activity will appear here.
                  </p>
                ),
              )}
            </>
          )}
          {current !== 'dashboard' &&
            current !== 'ai' &&
            current !== 'settings' &&
            current !== 'admin' && (
              <div className="toolbar">
                <input
                  aria-label="Search records"
                  placeholder="Search records…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span>
                  {remote ? 'Records saved to server' : 'Records saved locally'}
                </span>
              </div>
            )}
          {current === 'finance' && (
            <>
              {stats([
                ['Cash position', money(m.cash), 'Workspace ledger'],
                ['Receivables', money(m.receivables), 'Unpaid invoices'],
                ['Payables', money(m.payables), 'Received purchase orders'],
                ['Collected revenue', money(m.revenue), 'Paid invoices'],
              ])}
              {['owner', 'finance_admin', 'auditor'].includes(effectiveRole) &&
                section(
                  'Bank accounts',
                  <>
                    {bankLoading ? (
                      <p className="empty">Loading connected accounts…</p>
                    ) : bankAccounts.length ? (
                      <div className="account-list">
                        {bankAccounts.map((account) => (
                          <div className="account-row" key={account.id}>
                            <span className="account-mark">{account.currency}</span>
                            <div>
                              <b>{account.name}</b>
                              <small>
                                {account.provider} · {account.external_ref}
                              </small>
                            </div>
                            {badge(account.status === 'active' ? 'Connected' : 'Disconnected')}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty">
                        No bank account is connected yet. Add a manual account to start reconciliation.
                      </p>
                    )}
                    <form
                      className="inline-form"
                      onSubmit={async (e) => {
                        e.preventDefault()
                        if (!remote) return
                        const values = Object.fromEntries(new FormData(e.currentTarget))
                        try {
                          await request('/banks/accounts', {
                            method: 'POST',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({
                              provider: 'manual',
                              externalRef: values.externalRef,
                              name: values.name,
                              currency: values.currency,
                            }),
                          })
                          const result = await request<{ accounts: BankAccount[] }>('/banks/accounts')
                          setBankAccounts(result.accounts)
                          e.currentTarget.reset()
                          setNotice('Bank account added. Transaction feeds remain disconnected.')
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Could not add bank account.')
                        }
                      }}
                    >
                      <input name="name" placeholder="Account name" required />
                      <input name="externalRef" placeholder="Account reference" required />
                      <select name="currency" defaultValue="NGN" aria-label="Account currency">
                        <option>NGN</option>
                        <option>USD</option>
                        <option>GBP</option>
                      </select>
                      <button className="primary" disabled={busy || bankLoading || readOnly}>
                        Add account
                      </button>
                    </form>
                  </>,
                )}
              {['owner', 'finance_admin', 'auditor'].includes(effectiveRole) && bankAccounts[0] &&
                section(
                  'Bank transactions',
                  <>
                    {bankTransactions.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Reference</th>
                              <th>Amount</th>
                              <th>Direction</th>
                              <th>Source</th>
                              <th>Reconciliation</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bankTransactions.map((transaction) => (
                              <tr key={transaction.id}>
                                <td>{new Date(transaction.occurred_at).toLocaleDateString()}</td>
                                <td>{transaction.reference}</td>
                                <td>{money(transaction.amount)}</td>
                                <td>{transaction.direction}</td>
                                <td>
                                  {transaction.matched_entity_type
                                    ? `${transaction.matched_entity_type === 'invoice' ? 'Invoice' : 'Expense'} ${transaction.matched_entity_id?.slice(0, 8)}`
                                    : 'No source match'}
                                </td>
                                <td>
                                  <select
                                    aria-label={`Reconciliation for ${transaction.reference}`}
                                    value={transaction.match_status}
                                    disabled={busy || readOnly}
                                    onChange={async (event) => {
                                      if (!remote) return
                                      try {
                                        await request(`/banks/accounts/${bankAccounts[0].id}/transactions/${transaction.id}`, {
                                          method: 'PATCH',
                                          headers: { 'X-CSRF-Token': remote.csrf },
                                          body: JSON.stringify({ matchStatus: event.target.value }),
                                        })
                                        setBankTransactions((items) => items.map((item) => item.id === transaction.id ? { ...item, match_status: event.target.value as BankTransaction['match_status'] } : item))
                                        await refreshWorkspace()
                                        setNotice('Transaction reconciliation updated and audited.')
                                      } catch (error) {
                                        setError(error instanceof Error ? error.message : 'Could not update reconciliation.')
                                      }
                                    }}
                                  >
                                    <option value="unmatched">Unmatched</option>
                                    <option value="suggested" disabled={transaction.match_status !== 'suggested'}>Suggested</option>
                                    <option value="matched" disabled={transaction.match_status !== 'suggested'}>Approve suggested match</option>
                                    <option value="ignored">Ignored</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="empty">No bank transactions recorded yet.</p>
                    )}
                    <form
                      className="inline-form"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        if (!remote) return
                        const values = Object.fromEntries(new FormData(event.currentTarget))
                        try {
                          const created = await request<BankTransaction>(`/banks/accounts/${bankAccounts[0].id}/transactions`, {
                            method: 'POST',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({
                              externalRef: values.externalRef,
                              occurredAt: new Date(String(values.occurredAt)).toISOString(),
                              amount: Number(values.amount),
                              direction: values.direction,
                              reference: values.reference,
                            }),
                          })
                          setBankTransactions((items) => [created, ...items])
                          event.currentTarget.reset()
                          setNotice('Bank transaction added as unmatched.')
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Could not add bank transaction.')
                        }
                      }}
                    >
                      <input name="reference" placeholder="Reference" required />
                      <input name="externalRef" placeholder="External ID" required />
                      <input name="occurredAt" type="date" required />
                      <input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required />
                      <select name="direction" defaultValue="credit" aria-label="Transaction direction">
                        <option value="credit">Credit</option>
                        <option value="debit">Debit</option>
                      </select>
                      <button className="primary" disabled={busy || readOnly}>Add transaction</button>
                    </form>
                  </>,
                )}
              {section(
                'Customer invoices',
                table(
                  'invoices',
                  [
                    ['name', 'Customer'],
                    ['amount', 'Amount', money],
                    ['status', 'Status', badge],
                  ],
                  (r) =>
                    r.status === 'Unpaid' ? (
                      <button
                        disabled={busy || readOnly}
                        onClick={() => action('invoices', r.id, 'Paid')}
                      >
                        Record collection
                      </button>
                    ) : (
                      <span>Settled</span>
                    ),
                ),
                add('invoices'),
              )}
              {section(
                'Expenses',
                table('expenses', [
                  ['name', 'Description'],
                  ['amount', 'Amount', money],
                ]),
                add('expenses'),
              )}
              {section(
                'Journal postings',
                table('journals', [
                  ['date', 'Date', (v) => new Date(v).toLocaleDateString()],
                  ['debit', 'Debit account'],
                  ['credit', 'Credit account'],
                  ['amount', 'Amount', money],
                ]),
              )}
              <p className="footnote">
                Sample opening balances are illustrative. No bank connection or
                reconciliation feed is configured.
              </p>
            </>
          )}
          {current === 'banking' && (
            <>
              {stats([
                ['Bank Accounts', bankAccounts.length, 'Registered institutional accounts'],
                ['Connected Feeds', bankAccounts.filter((a) => a.status === 'active').length, 'Active API sync feeds'],
                ['Total Statements', bankTransactions.length, 'Loaded statement lines'],
                [
                  'Reconciled',
                  `${bankTransactions.filter((t) => t.match_status === 'matched').length}/${bankTransactions.length || 0}`,
                  'Matched to general ledger',
                ],
              ])}
              {section(
                'Connected Bank Accounts & Ledgers',
                <>
                  {bankLoading ? (
                    <p className="empty">Loading connected accounts…</p>
                  ) : bankAccounts.length ? (
                    <div className="account-list">
                      {bankAccounts.map((account) => (
                        <div className="account-row" key={account.id}>
                          <span className="account-mark">{account.currency}</span>
                          <div>
                            <b>{account.name}</b>
                            <small>
                              Provider: {account.provider.toUpperCase()} · External Ref: {account.external_ref}
                            </small>
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            {badge(account.status === 'active' ? 'Connected' : 'Disconnected')}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">
                      No bank account is connected yet. Add a manual account or connect via Open Banking to start reconciliation.
                    </p>
                  )}
                  <form
                    className="inline-form"
                    onSubmit={async (e) => {
                      e.preventDefault()
                      if (!remote) return
                      const values = Object.fromEntries(new FormData(e.currentTarget))
                      try {
                        await request('/banks/accounts', {
                          method: 'POST',
                          headers: { 'X-CSRF-Token': remote.csrf },
                          body: JSON.stringify({
                            provider: values.provider || 'manual',
                            externalRef: values.externalRef,
                            name: values.name,
                            currency: values.currency,
                          }),
                        })
                        const result = await request<{ accounts: BankAccount[] }>('/banks/accounts')
                        setBankAccounts(result.accounts)
                        e.currentTarget.reset()
                        setNotice('Bank account connected successfully.')
                      } catch (error) {
                        setError(error instanceof Error ? error.message : 'Could not add bank account.')
                      }
                    }}
                  >
                    <input name="name" placeholder="Account name (e.g. Zenith Corporate)" required />
                    <input name="externalRef" placeholder="Account number / IBAN" required />
                    <select name="provider" defaultValue="mono" aria-label="Provider">
                      <option value="mono">Mono Open Banking</option>
                      <option value="stitch">Stitch Financial</option>
                      <option value="manual">Manual Ledger Feed</option>
                    </select>
                    <select name="currency" defaultValue="NGN" aria-label="Account currency">
                      <option>NGN</option>
                      <option>USD</option>
                      <option>GBP</option>
                      <option>EUR</option>
                    </select>
                    <button className="primary" disabled={busy || bankLoading || readOnly}>
                      + Connect Account
                    </button>
                  </form>
                </>,
              )}
              {bankAccounts[0] &&
                section(
                  'Transaction Feed & Reconciliation Engine',
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                      <div>
                        <b>Automated General Ledger Matching</b>
                        <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                          Matches bank feed inflows/outflows against customer invoice collections and vendor disbursements.
                        </small>
                      </div>
                      <button
                        disabled={busy || readOnly || !bankTransactions.some((t) => t.match_status === 'suggested')}
                        onClick={async () => {
                          if (!remote) return
                          try {
                            for (const tx of bankTransactions.filter((t) => t.match_status === 'suggested')) {
                              await request(`/banks/accounts/${bankAccounts[0].id}/transactions/${tx.id}`, {
                                method: 'PATCH',
                                headers: { 'X-CSRF-Token': remote.csrf },
                                body: JSON.stringify({ matchStatus: 'matched' }),
                              })
                            }
                            setBankTransactions((items) => items.map((t) => t.match_status === 'suggested' ? { ...t, match_status: 'matched' } : t))
                            await refreshWorkspace()
                            setNotice('Suggested transactions were approved and reconciled.')
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Auto-reconciliation error.')
                          }
                        }}
                      >
                        ⚡ Auto-Reconcile All Pending
                      </button>
                    </div>
                    {bankTransactions.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Date</th>
                              <th>Reference / Narration</th>
                              <th>Amount</th>
                              <th>Flow</th>
                              <th>Matched source</th>
                              <th>Reconciliation Status</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {bankTransactions.map((transaction) => (
                              <tr key={transaction.id}>
                                <td>{new Date(transaction.occurred_at).toLocaleDateString()}</td>
                                <td>{transaction.reference}</td>
                                <td><b>{money(transaction.amount)}</b></td>
                                <td>
                                  <span className={`badge ${transaction.direction === 'credit' ? 'green' : ''}`}>
                                    {transaction.direction.toUpperCase()}
                                  </span>
                                </td>
                                <td>
                                  {transaction.matched_entity_type
                                    ? `${transaction.matched_entity_type === 'invoice' ? 'Invoice' : 'Expense'} ${transaction.matched_entity_id?.slice(0, 8)}`
                                    : 'No source match'}
                                </td>
                                <td>
                                  <select
                                    aria-label={`Reconciliation for ${transaction.reference}`}
                                    value={transaction.match_status}
                                    disabled={busy || readOnly}
                                    onChange={async (event) => {
                                      if (!remote) return
                                      try {
                                        await request(`/banks/accounts/${bankAccounts[0].id}/transactions/${transaction.id}`, {
                                          method: 'PATCH',
                                          headers: { 'X-CSRF-Token': remote.csrf },
                                          body: JSON.stringify({ matchStatus: event.target.value }),
                                        })
                                        setBankTransactions((items) =>
                                          items.map((item) =>
                                            item.id === transaction.id
                                              ? { ...item, match_status: event.target.value as BankTransaction['match_status'] }
                                              : item,
                                          ),
                                        )
                                        await refreshWorkspace()
                                        setNotice('Transaction status updated and audited.')
                                      } catch (error) {
                                        setError(error instanceof Error ? error.message : 'Could not update reconciliation.')
                                      }
                                    }}
                                  >
                                    <option value="unmatched">Unmatched</option>
                                    <option value="suggested" disabled={transaction.match_status !== 'suggested'}>Suggested Match</option>
                                    <option value="matched" disabled={transaction.match_status !== 'suggested'}>Approve Suggested Match</option>
                                    <option value="ignored">Ignored</option>
                                  </select>
                                </td>
                                <td>
                                  {transaction.match_status !== 'matched' ? (
                                    <button
                                      disabled={busy || readOnly || transaction.match_status !== 'suggested'}
                                      onClick={async () => {
                                        if (!remote) return
                                        try {
                                          await request(`/banks/accounts/${bankAccounts[0].id}/transactions/${transaction.id}`, {
                                            method: 'PATCH',
                                            headers: { 'X-CSRF-Token': remote.csrf },
                                            body: JSON.stringify({ matchStatus: 'matched' }),
                                          })
                                          setBankTransactions((items) =>
                                            items.map((t) => (t.id === transaction.id ? { ...t, match_status: 'matched' } : t)),
                                          )
                                          await refreshWorkspace()
                                          setNotice(`Transaction ${transaction.reference} approved and reconciled.`)
                                        } catch (e) {
                                          setError(e instanceof Error ? e.message : 'Reconciliation failed.')
                                        }
                                      }}
                                    >
                                      Approve Match
                                    </button>
                                  ) : (
                                    <span style={{ color: '#27ae60', fontWeight: 600, fontSize: '0.85rem' }}>✓ Reconciled</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="empty">No bank transactions recorded yet.</p>
                    )}
                    <form
                      className="inline-form"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        if (!remote) return
                        const values = Object.fromEntries(new FormData(event.currentTarget))
                        try {
                          const created = await request<BankTransaction>(`/banks/accounts/${bankAccounts[0].id}/transactions`, {
                            method: 'POST',
                            headers: { 'X-CSRF-Token': remote.csrf },
                            body: JSON.stringify({
                              externalRef: values.externalRef,
                              occurredAt: new Date(String(values.occurredAt)).toISOString(),
                              amount: Number(values.amount),
                              direction: values.direction,
                              reference: values.reference,
                            }),
                          })
                          setBankTransactions((items) => [created, ...items])
                          event.currentTarget.reset()
                          setNotice('Bank statement entry recorded.')
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Could not add bank transaction.')
                        }
                      }}
                    >
                      <input name="reference" placeholder="Reference / memo" required />
                      <input name="externalRef" placeholder="Statement Ref ID" required />
                      <input name="occurredAt" type="date" defaultValue={new Date().toISOString().split('T')[0]} required />
                      <input name="amount" type="number" min="0.01" step="0.01" placeholder="Amount" required />
                      <select name="direction" defaultValue="credit" aria-label="Transaction direction">
                        <option value="credit">Credit (Inflow)</option>
                        <option value="debit">Debit (Outflow)</option>
                      </select>
                      <button className="primary" disabled={busy || readOnly}>+ Add Statement Entry</button>
                    </form>
                  </>,
                )}
            </>
          )}
          {current === 'inventory' && (
            <>
              {stats([
                ['Stock value', money(m.stock), 'At recorded unit cost'],
                ['Products', s.products.length, 'Unique SKUs'],
                ['Low stock', m.low.length, 'Below reorder threshold'],
              ])}
              {section(
                'Product inventory',
                table('products', [
                  ['name', 'Product'],
                  ['sku', 'SKU'],
                  ['qty', 'On hand'],
                  ['cost', 'Unit cost', money],
                  ['min', 'Reorder at'],
                  [
                    'id',
                    'Health',
                    (_, r) => badge(r.qty < r.min ? 'Low stock' : 'Available'),
                  ],
                ]),
                add('products'),
              )}
            <StockPanel state={s} search={search} busy={busy} readOnly={readOnly} onCommit={commit} onPurchasing={()=>navigate('procurement')}/>
            </>
          )}
          {current === 'crm' && (
            <>
              {stats([
                ['Open pipeline', money(m.pipeline), 'Excludes won and lost'],
                ['Opportunities', s.leads.length, 'All stages'],
                [
                  'Won deals',
                  s.leads.filter((l) => l.status === 'Won').length,
                  'Closed successfully',
                ],
              ])}
              {section(
                'Opportunities',
                table(
                  'leads',
                  [
                    ['name', 'Opportunity'],
                    ['amount', 'Value', money],
                    ['status', 'Stage', badge],
                  ],
                  (r) => (
                    <select
                      disabled={busy || readOnly}
                      aria-label={`Stage for ${r.name}`}
                      value={r.status}
                      onChange={(e) => action('leads', r.id, e.target.value)}
                    >
                      {stages.map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  ),
                ),
                add('leads'),
              )}
            </>
          )}
          {current === 'procurement' &&
            section(
              'Purchase orders',
              table(
                'orders',
                [
                  ['name', 'Supplier'],
                  [
                    'product',
                    'Product',
                    (v) => s.products.find((p) => p.id === v)?.name,
                  ],
                  ['qty', 'Quantity'],
                  ['cost', 'Total', (_, r) => money(r.qty * r.cost)],
                  ['status', 'Status', badge],
                  ['requestedBy', 'Requested by'],
                  ['approvedBy', 'Approved by'],
                ],
                (r) =>
                  r.status === 'Pending' ? (
                    <button
                      disabled={busy || readOnly}
                      onClick={() => action('orders', r.id, 'Approved')}
                    >
                      Approve PO
                    </button>
                  ) : r.status === 'Approved' ? (
                    <button
                      disabled={busy || readOnly}
                      onClick={() => action('orders', r.id, 'Received')}
                    >
                      Receive goods
                    </button>
                  ) : (
                    <span>Stock updated</span>
                  ),
              ),
              add('orders'),
            )}
          {current === 'hr' && (
            <>
              {section(
                'Employees',
                table('employees', [
                  ['name', 'Employee'],
                  ['department', 'Department'],
                  ['amount', 'Gross monthly salary', money],
                ]),
                add('employees'),
              )}
              {section(
                'Payroll runs',
                table(
                  'payroll',
                  [
                    ['name', 'Period'],
                    ['amount', 'Gross pay', money],
                    ['status', 'Status', badge],
                    ['preparedBy', 'Prepared by'],
                    ['approvedBy', 'Approved by'],
                  ],
                  (r) =>
                    r.status === 'Draft' ? (
                      <button
                        disabled={busy || readOnly}
                        onClick={() => action('payroll', r.id, 'Approved')}
                      >
                        Approve accrual
                      </button>
                    ) : (
                      <span>Accrued · unpaid</span>
                    ),
                ),
                <>
                  {s.payroll.filter((run) => run.status === 'Approved').map((run) => (
                    <button
                      key={run.id}
                      disabled={busy || readOnly}
                      onClick={async () => {
                        if (!remote) return
                        try {
                          const result = await request<{ batch: PayrollPaymentBatch }>(`/payroll/runs/${run.id}/payment-batches`, {
                            method: 'POST',
                            headers: {
                              'X-CSRF-Token': remote.csrf,
                              'Idempotency-Key': crypto.randomUUID(),
                            },
                            body: JSON.stringify({}),
                          })
                          setPaymentBatches((items) => ({ ...items, [run.id]: result.batch }))
                          setNotice('Payment batch generated. It is pending provider submission.')
                        } catch (error) {
                          setError(error instanceof Error ? error.message : 'Could not generate payment batch.')
                        }
                      }}
                    >
                      Generate payment batch for {run.period}
                    </button>
                  ))}
                  <button
                  disabled={busy || readOnly}
                  className="primary"
                  onClick={() => setModal('payroll')}
                >
                  + Prepare payroll
                  </button>
                </>,
              )}
              {s.payroll.some((run) => run.status === 'Approved') &&
                section(
                  'Payroll payment batches',
                  <div className="preview-list">
                    {s.payroll.filter((run) => run.status === 'Approved').map((run) => {
                      const batch = paymentBatches[run.id]
                      return (
                        <div className="preview-row" key={run.id}>
                          <div>
                            <b>{run.name}</b>
                            <small>{batch ? `Batch ${batch.id.slice(0, 8)} · ${new Date(batch.created_at).toLocaleString()}` : 'No payment batch generated'}</small>
                          </div>
                          <span className={batch?.status === 'confirmed' ? 'badge green' : 'badge'}>
                            {batch?.status || 'unpaid'}
                          </span>
                        </div>
                      )
                    })}
                  </div>,
                )}
              <p className="footnote">
                Gross payroll only. Country-specific deductions, payslips, and
                payment providers are not configured. Approval records an
                accrual; it does not send money.
              </p>
            </>
          )}
          {current === 'projects' && (
            <>
              {section(
                'Projects',
                table(
                  'projects',
                  [
                    ['name', 'Project'],
                    ['amount', 'Budget', money],
                    ['status', 'Status', badge],
                  ],
                  (r) => (
                    <select
                      disabled={busy || readOnly}
                      aria-label={`Status for ${r.name}`}
                      value={r.status}
                      onChange={(e) => action('projects', r.id, e.target.value)}
                    >
                      {['Planned', 'In progress', 'Completed'].map((x) => (
                        <option key={x}>{x}</option>
                      ))}
                    </select>
                  ),
                ),
                add('projects'),
              )}
              {section(
                'Task list',
                <div className="attention">
                  {s.tasks
                    .filter((t) =>
                      t.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((t) => (
                      <label className="task" key={t.id}>
                        <input
                          disabled={busy || readOnly}
                          type="checkbox"
                          checked={t.status === 'Completed'}
                          onChange={(e) =>
                            action(
                              'tasks',
                              t.id,
                              e.target.checked ? 'Completed' : 'Open',
                            )
                          }
                        />
                        <span
                          className={t.status === 'Completed' ? 'done' : ''}
                        >
                          {t.name}
                        </span>
                      </label>
                    ))}
                </div>,
                add('tasks'),
              )}
            </>
          )}
          {current === 'ai' && (
            <>
              <div className="notice" style={{ background: '#f8f6fe', borderColor: '#d3cbfb', color: '#4b3db2' }}>
                ✧ <b>BusinessOS AI Decision Intelligence Suite</b>: Multi-horizon forecasting, anomaly detection, explainable natural language Q&A, and what-if sensitivity simulations derived from your workspace ledger and operations.
              </div>

              {/* 1. Multi-Horizon Predictive Forecasts */}
              <div className="ai-forecast-grid">
                <div className="forecast-card">
                  <div className="forecast-header">
                    <b>30-Day Cash Flow Forecast</b>
                    <span className="confidence-pill">92% Confidence</span>
                  </div>
                  <p style={{ fontSize: '20px', fontWeight: 800, color: '#38345c', margin: '6px 0' }}>
                    {money(Math.round(m.cash + (m.receivables * 0.75) - (s.employees.reduce((a, x) => a + x.amount, 0) + m.payables)))}
                  </p>
                  <small style={{ color: 'var(--text-muted)' }}>Projected end-of-month cash position</small>
                  <div className="forecast-meta">
                    <span>Baseline cash: <b>{money(m.cash)}</b></span>
                    <span>Expected collections (75%): <b>+{money(Math.round(m.receivables * 0.75))}</b></span>
                    <span>Payroll & AP liabilities: <b>-{money(s.employees.reduce((a, x) => a + x.amount, 0) + m.payables)}</b></span>
                  </div>
                </div>

                <div className="forecast-card">
                  <div className="forecast-header">
                    <b>Pipeline Realization Forecast</b>
                    <span className="confidence-pill">88% Confidence</span>
                  </div>
                  <p style={{ fontSize: '20px', fontWeight: 800, color: '#38345c', margin: '6px 0' }}>
                    {money(Math.round(m.pipeline * 0.42))}
                  </p>
                  <small style={{ color: 'var(--text-muted)' }}>Expected weighted deal closes next 45d</small>
                  <div className="forecast-meta">
                    <span>Total open pipeline: <b>{money(m.pipeline)}</b></span>
                    <span>Weighted win probability: <b>42% average</b></span>
                    <span>Active opportunities: <b>{s.leads.filter((l) => !['Won', 'Lost'].includes(l.status)).length} deals</b></span>
                  </div>
                </div>

                <div className="forecast-card">
                  <div className="forecast-header">
                    <b>Inventory Demand & Stockout Risk</b>
                    <span className="confidence-pill" style={{ background: m.low.length ? '#fff3f0' : '#e8f8f0', color: m.low.length ? '#d9534f' : '#1e824c' }}>
                      {m.low.length ? 'High Risk' : 'Optimal Stock'}
                    </span>
                  </div>
                  <p style={{ fontSize: '20px', fontWeight: 800, color: '#38345c', margin: '6px 0' }}>
                    {m.low.length} SKUs At Risk
                  </p>
                  <small style={{ color: 'var(--text-muted)' }}>Stockout hazard within next 14 days</small>
                  <div className="forecast-meta">
                    <span>Total tracked SKUs: <b>{s.products.length}</b></span>
                    <span>Reorder capital needed: <b>{money(m.low.reduce((a, p) => a + ((p.min - p.qty) * p.cost), 0) || 0)}</b></span>
                    <span>Lead time buffer: <b>7-14 days</b></span>
                  </div>
                </div>
              </div>

              {/* 2. Operational Anomaly Detection Register */}
              {section(
                'AI Anomaly Detection & Operations Risk Register',
                <>
                  <div className="anomaly-list">
                    {m.low.length > 0 && (
                      <div className="anomaly-item">
                        <div>
                          <b style={{ color: '#c0392b' }}>[Critical] Stockout Variance Detected</b>
                          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                            {m.low.map((p) => p.name).join(', ')} {m.low.length === 1 ? 'is' : 'are'} below minimum reorder thresholds. Supplier purchase orders recommended immediately.
                          </p>
                        </div>
                        <button onClick={() => navigate('inventory')}>Order stock ↗</button>
                      </div>
                    )}
                    {bankTransactions.some((t) => t.match_status === 'unmatched') && (
                      <div className="anomaly-item warning">
                        <div>
                          <b style={{ color: '#d35400' }}>[Warning] Unreconciled Statement Entries</b>
                          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                            {bankTransactions.filter((t) => t.match_status === 'unmatched').length} bank feed statement lines have not yet been reconciled against general ledger journals.
                          </p>
                        </div>
                        <button onClick={() => navigate('banking')}>Reconcile ↗</button>
                      </div>
                    )}
                    {m.receivables > 0 && (
                      <div className="anomaly-item info">
                        <div>
                          <b style={{ color: '#2980b9' }}>[Info] Open Receivables Aging</b>
                          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                            {s.invoices.filter((i) => i.status === 'Unpaid').length} open invoices totaling {money(m.receivables)} awaiting customer collection.
                          </p>
                        </div>
                        <button onClick={() => navigate('finance')}>View AR ↗</button>
                      </div>
                    )}
                    {s.orders.some((o) => o.status === 'Pending') && (
                      <div className="anomaly-item warning">
                        <div>
                          <b style={{ color: '#d35400' }}>[Warning] Purchase Orders Awaiting Approval</b>
                          <p style={{ margin: '4px 0 0', fontSize: '13px' }}>
                            {s.orders.filter((o) => o.status === 'Pending').length} procurement orders are pending manager approval.
                          </p>
                        </div>
                        <button onClick={() => navigate('procurement')}>Review POs ↗</button>
                      </div>
                    )}
                    {!m.low.length && !bankTransactions.some((t) => t.match_status === 'unmatched') && (
                      <p className="empty" style={{ padding: '16px' }}>✓ No critical anomalies detected across operations, inventory, and finance.</p>
                    )}
                  </div>
                </>,
              )}

              {/* 3. Natural Language Workspace Intelligence Q&A */}
              {section(
                'Explainable AI Workspace Intelligence',
                <>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>
                    Ask questions in natural language. Every answer provides complete mathematical lineage and cited source records.
                  </p>
                  <div className="prompt-pills">
                    {[
                      'What is our current cash runway?',
                      'Which stock SKUs need immediate reorder?',
                      'What is next month\'s payroll liability?',
                      'What is our sales pipeline conversion velocity?',
                      'Summarize top business operational risks',
                    ].map((promptText) => (
                      <button
                        key={promptText}
                        type="button"
                        className="prompt-pill"
                        onClick={() => {
                          setQuestion(promptText)
                          handleAiQuestion(promptText)
                        }}
                      >
                        {promptText}
                      </button>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleAiQuestion(question)
                    }}
                  >
                    <div className="ask">
                      <input
                        required
                        aria-label="Ask business intelligence question"
                        placeholder="e.g. What is our current cash runway?"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                      />
                      <button className="primary">Analyze →</button>
                    </div>
                  </form>
                  {answer && (
                    <div className="answer" role="status">
                      <b>{answer}</b>
                      {aiLineage && (
                        <div className="lineage-box">
                          <b>Data Lineage & Explainability:</b>
                          <p style={{ margin: '4px 0 0' }}>{aiLineage}</p>
                        </div>
                      )}
                      <p className="footnote">
                        Live workspace telemetry · Model: BusinessOS Deterministic Reasoning Engine · Timestamp: {new Date().toLocaleTimeString()}
                      </p>
                    </div>
                  )}
                </>,
              )}

              {/* 4. What-If Scenario & Sensitivity Simulator */}
              <div className="two-col">
                {section(
                  'What-If Cash & Receivables Simulator',
                  <>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      Simulate the impact of varying collection velocity and operating expense shifts on your net cash runway.
                    </p>
                    <label>
                      Receivables Collection Assumption: <b>{growth}%</b>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={growth}
                        onChange={(e) => setGrowth(Number(e.target.value))}
                      />
                    </label>
                    <label style={{ marginTop: '12px' }}>
                      Operating Expense Variance: <b>{expenseShift > 0 ? `+${expenseShift}%` : `${expenseShift}%`}</b>
                      <input
                        type="range"
                        min="-30"
                        max="50"
                        value={expenseShift}
                        onChange={(e) => setExpenseShift(Number(e.target.value))}
                      />
                    </label>
                    <div className="scenario">
                      <span>
                        Current Cash<b>{money(m.cash)}</b>
                      </span>
                      <span>
                        Simulated Position
                        <b>
                          {money(
                            m.cash +
                              (m.receivables * growth) / 100 -
                              (s.expenses.reduce((a, x) => a + x.amount, 0) * (100 + expenseShift)) / 100,
                          )}
                        </b>
                      </span>
                    </div>
                    <p className="footnote">
                      Model: Cash + (Open Receivables × {growth}%) − (Base Expenses × {100 + expenseShift}%).
                    </p>
                  </>,
                )}
                {section(
                  'Working Capital Sensitivity',
                  <>
                    <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                      Key liquidity buffer indicators based on current operational baseline.
                    </p>
                    <div className="telemetry-list">
                      <div className="telemetry-item">
                        <span>Net Working Capital (Cash + Receivables - Payables)</span>
                        <b>{money(m.cash + m.receivables - m.payables)}</b>
                      </div>
                      <div className="telemetry-item">
                        <span>Monthly Payroll Obligation</span>
                        <b>{money(s.employees.reduce((a, x) => a + x.amount, 0))}</b>
                      </div>
                      <div className="telemetry-item">
                        <span>Estimated Operational Runway</span>
                        <b>
                          {(() => {
                            const burn = s.employees.reduce((a, x) => a + x.amount, 0) + s.expenses.reduce((a, x) => a + x.amount, 0)
                            if (burn <= 0) return 'Infinite (zero burn)'
                            const months = (m.cash / burn).toFixed(1)
                            return `${months} months (${Math.round(Number(months) * 4.3)} weeks)`
                          })()}
                        </b>
                      </div>
                      <div className="telemetry-item">
                        <span>Reorder Working Capital Requirement</span>
                        <b>{money(m.low.reduce((a, p) => a + ((p.min - p.qty) * p.cost), 0) || 0)}</b>
                      </div>
                    </div>
                  </>,
                )}
              </div>
            </>
          )}
          {current === 'settings' && (
            <>
              <RoleMatrix />
              {remote && <Security csrf={remote.csrf} />}
              {remote?.user.role === 'owner' && <Team csrf={remote.csrf} />}
              {section(
                'Organisation',
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    commit({
                      type: 'settings',
                      name: String(
                        new FormData(e.currentTarget).get('name') || '',
                      ),
                    })
                  }}
                >
                  <label>
                    Business name
                    <input name="name" required defaultValue={s.organisation} />
                  </label>
                  <p>
                    Currency: NGN · Storage:{' '}
                    {remote ? 'PostgreSQL' : 'this browser'} · Access:{' '}
                    {remote?.user.role || 'local owner'}
                  </p>
                  <button disabled={busy || readOnly} className="primary">
                    Save preferences
                  </button>
                </form>,
              )}
              {section(
                'Data & environment',
                <>
                  <p>
                    {remote
                      ? 'Authenticated workspace with tenant-scoped server records. Banking and payment integrations are not connected.'
                      : 'This demo uses editable local sample data. Authentication and server storage are not active in demo mode.'}
                  </p>
                  <button
                    onClick={() =>
                      download(
                        JSON.stringify(s, null, 2),
                        'businessos-backup.json',
                      )
                    }
                  >
                    Download workspace backup
                  </button>
                </>,
              )}
              {section(
                'Activity log',
                ['owner', 'auditor'].includes(effectiveRole) ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr><th>Time</th><th>Actor</th><th>Area</th><th>Action</th><th>Details</th></tr>
                      </thead>
                      <tbody>
                        {(remote ? auditLogs : s.audit).map((entry) => (
                          <tr key={entry.id}>
                            <td>{new Date(entry.date).toLocaleString()}</td>
                            <td>{entry.actor}</td>
                            <td>{entry.entity}</td>
                            <td>{entry.action}</td>
                            <td>{entry.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!((remote ? auditLogs : s.audit).length) && <p className="empty">No audit events yet.</p>}
                  </div>
                ) : <p className="empty">Audit records are available to owners and auditors only.</p>,
              )}
            </>
          )}
          {current === 'admin' && (
            <AdminConsole currentRole={effectiveRole} />
          )}
          {preview && (
            <>
              <div className="notice preview-notice">
                {remote
                  ? current === 'documents'
                    ? 'Document metadata is live. Binary object storage is not configured.'
                    : 'Live tenant workspace · changes are validated and audited on the server.'
                  : 'Browser demo · changes stay local until the workspace is connected.'}
              </div>
              {stats(preview.stats)}
              <div className="two-col">
                {section(
                  preview.primaryTitle,
                  <div className="preview-list">
                    {remote && !moduleLoaded ? (
                      <p className="empty">Loading module records…</p>
                    ) : primaryRecords.map((record) => (
                      <div className="preview-row" key={record.id}>
                        <div>
                          <b>{record.name}</b>
                          <small>{record.detail}</small>
                        </div>
                        <select
                          aria-label={`Status for ${record.name}`}
                          value={record.status}
                          disabled={busy || readOnly || record.id.startsWith('preview-')}
                          onChange={(event) => void updatePreviewRecord(record, event.target.value)}
                        >
                          <option>{record.status}</option>
                          <option>Active</option>
                          <option>In progress</option>
                          <option>Completed</option>
                          <option>Needs review</option>
                          <option>Draft</option>
                        </select>
                        <button
                          aria-label={`Delete ${record.name}`}
                          disabled={busy || readOnly || record.id.startsWith('preview-')}
                          onClick={() => void deletePreviewRecord(record)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>,
                  <>
                    {current === 'documents' && (
                      <input
                        ref={documentPicker}
                        type="file"
                        hidden
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          if (file) void registerDocument(file)
                          event.currentTarget.value = ''
                        }}
                      />
                    )}
                    <button
                      disabled={busy || readOnly}
                      onClick={() => current === 'documents' && remote
                        ? documentPicker.current?.click()
                        : void addPreviewRecord()}
                    >
                      {current === 'documents' ? 'Register document' : 'Add workflow'}
                    </button>
                    {current === 'support' && (
                      <form className="inline-form" onSubmit={(event) => void createSupportTicket(event)}>
                        <input name="subject" placeholder="Ticket subject" required />
                        <input name="customer" placeholder="Customer" required />
                        <select name="priority" defaultValue="medium" aria-label="Ticket priority">
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="urgent">Urgent</option>
                        </select>
                        <input name="slaDueAt" type="datetime-local" aria-label="SLA due date" />
                        <button className="primary" disabled={busy || readOnly}>Create ticket</button>
                      </form>
                    )}
                    {current === 'tax' && (
                      <form className="inline-form" onSubmit={(event) => void createTaxFiling(event)}>
                        <input name="name" placeholder="Filing name" required />
                        <input name="territory" placeholder="Territory" defaultValue="Nigeria" required />
                        <input name="dueDate" type="date" required />
                        <input name="amount" type="number" min="0" step="0.01" placeholder="Amount" required />
                        <button className="primary" disabled={busy || readOnly}>Create filing</button>
                      </form>
                    )}
                  </>,
                )}
                {section(
                  preview.secondaryTitle,
                  <div className="preview-list">
                    {preview.secondaryItems.map(([name, status]) => (
                      <div className="preview-row" key={name}>
                        <div>
                          <b>{name}</b>
                          <small>Workspace configuration</small>
                        </div>
                        <span className={status.includes('pending') || status.includes('Needs') ? 'badge' : 'badge green'}>
                          {status}
                        </span>
                      </div>
                    ))}
                  </div>,
                )}
              </div>
              {section(
                'Next implementation slice',
                <div className="workflow-strip">
                  <span><b>1</b> Define tenant data model</span>
                  <span><b>2</b> Add validated API actions</span>
                  <span><b>3</b> Connect permissions and audit</span>
                </div>,
                <button onClick={() => navigate('admin')}>View platform status</button>,
              )}
            </>
          )}
          <footer>
            BusinessOS <span>One workspace. A clearer business.</span>
            <small>{remote ? 'Server MVP · NGN' : 'Local MVP · NGN'}</small>
          </footer>
        </main>
      </div>
      {modal && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null)
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setModal(null)
              if (e.key === 'Tab') {
                const els = [
                  ...e.currentTarget.querySelectorAll('button,input,select'),
                ]
                const first = els[0],
                  last = els.at(-1)
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault()
                  ;(last as HTMLElement).focus()
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault()
                  ;(first as HTMLElement).focus()
                }
              }
            }}
          >
            <div className="section-top">
              <h2 id="modal-title">
                {modal === 'payroll'
                  ? 'Prepare payroll'
                  : definitions[modal][0]}
              </h2>
              <button aria-label="Close dialog" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            {error && (
              <div role="alert" className="alert">
                {error}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const data = Object.fromEntries(new FormData(e.currentTarget))
                if (modal === 'payroll')
                  commit({ type: 'payroll', period: String(data.period) })
                else {
                  const status: string | undefined = (
                    {
                      invoices: 'Unpaid',
                      leads: 'New',
                      projects: 'Planned',
                      tasks: 'Open',
                    } as Partial<Record<CreateCollection, string>>
                  )[modal]
                  commit({
                    type: 'create',
                    collection: modal,
                    data: { ...data, ...(status ? { status } : {}) },
                  })
                }
              }}
            >
              {(modal === 'payroll'
                ? [['period', 'Payroll period', 'month']]
                : definitions[modal][1]
              ).map(([name, label, type], i) => (
                <label key={name}>
                  {label}
                  {type === 'product' ? (
                    <select name={name} required autoFocus={i === 0}>
                      {s.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      autoFocus={i === 0}
                      name={name}
                      type={type || 'text'}
                      required
                      min={
                        type === 'number'
                          ? ['qty', 'min'].includes(name)
                            ? 0
                            : 0.01
                          : undefined
                      }
                      step={
                        type === 'number'
                          ? ['qty', 'min'].includes(name)
                            ? 1
                            : 0.01
                          : undefined
                      }
                    />
                  )}
                </label>
              ))}
              <div className="modal-actions">
                <button type="button" onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button disabled={busy || readOnly} className="primary">
                  {busy ? 'Saving…' : 'Save record'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
export default App

import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { UserRole } from '../src/types.ts'

export const moduleNames = [
  'billing',
  'documents',
  'automation',
  'warehouse',
  'support',
  'tax',
  'supply',
  'compliance',
  'workspace',
  'admin',
  'assets',
  'facilities',
  'production',
  'frontoffice',
  'communication',
  'banking',
] as const
export type ModuleName = (typeof moduleNames)[number]

const moduleReaders: Record<ModuleName, readonly UserRole[]> = {
  billing: ['finance_admin'],
  documents: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager', 'employee'],
  automation: ['operations_manager', 'department_manager'],
  warehouse: ['operations_manager'],
  support: ['sales_crm_user', 'department_manager'],
  tax: ['finance_admin'],
  supply: ['operations_manager'],
  compliance: ['finance_admin', 'operations_manager', 'hr_admin', 'super_admin'],
  workspace: ['department_manager', 'employee', 'operations_manager'],
  admin: ['super_admin'],
  assets: ['operations_manager'],
  facilities: ['operations_manager'],
  production: ['operations_manager'],
  frontoffice: ['sales_crm_user', 'department_manager', 'employee'],
  communication: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager', 'employee'],
  banking: ['finance_admin'],
}

const moduleWriters: Record<ModuleName, readonly UserRole[]> = {
  billing: ['finance_admin'],
  documents: ['finance_admin', 'hr_admin', 'operations_manager', 'sales_crm_user', 'department_manager', 'employee'],
  automation: ['operations_manager', 'department_manager'],
  warehouse: ['operations_manager'],
  support: ['sales_crm_user', 'department_manager'],
  tax: ['finance_admin'],
  supply: ['operations_manager'],
  compliance: ['super_admin'],
  workspace: ['department_manager', 'employee', 'operations_manager'],
  admin: ['super_admin'],
  assets: ['operations_manager'],
  facilities: ['operations_manager'],
  production: ['operations_manager'],
  frontoffice: ['sales_crm_user', 'department_manager', 'employee'],
  communication: ['department_manager', 'operations_manager', 'hr_admin'],
  banking: ['finance_admin'],
}

export function canReadModule(role: UserRole, module: ModuleName) {
  return (
    role === 'owner' ||
    role === 'auditor' ||
    (module === 'admin' && role === 'super_admin') ||
    moduleReaders[module]?.includes(role)
  )
}

export function canWriteModule(role: UserRole, module: ModuleName) {
  return (
    role === 'owner' ||
    (role !== 'auditor' && (moduleWriters[module]?.includes(role) || (module === 'admin' && role === 'super_admin')))
  )
}

const defaults: Record<ModuleName, [string, string, string][]> = {
  billing: [
    ['Finance & CRM', 'Included', '100%'],
    ['Inventory records', '248 / 1,000', '25%'],
    ['Team seats', '8 / 12', '67%'],
  ],
  documents: [
    ['Supplier agreement.pdf', 'Procurement', 'Updated today'],
    ['September payroll policy.docx', 'People', 'Updated yesterday'],
    ['Northstar proposal.pdf', 'Sales', 'Updated 3 days ago'],
  ],
  automation: [
    ['Low stock alert', 'Inventory', 'Active'],
    ['Invoice follow-up', 'Finance', 'Active'],
    ['New hire checklist', 'People', 'Draft'],
  ],
  warehouse: [
    ['SO-1048 · Northstar', 'Picking', 'Due today'],
    ['SO-1047 · Greenfield', 'Packed', 'Carrier pending'],
    ['RTN-003 · Dock station', 'Inspection', 'Needs decision'],
  ],
  support: [
    ['#2048 · Delivery update', 'Northstar Limited', 'High'],
    ['#2046 · Invoice copy', 'Greenfield Studio', 'Medium'],
    ['#2042 · Product exchange', 'Lagos Office', 'Medium'],
  ],
  tax: [
    ['VAT return · September', 'Nigeria', 'Due 21 Sep'],
    ['PAYE schedule · September', 'Nigeria', 'Due 10 Oct'],
    ['Annual return', 'Nigeria', 'Due 31 Mar'],
  ],
  supply: [
    ['Docking stations · Kora Imports', '14 day lead time', 'On track'],
    ['Office monitors · Brightline', '21 day lead time', 'At risk'],
    ['Keyboard stock · TechHub', '7 day lead time', 'On track'],
  ],
  compliance: [
    ['Bank feed credentials', 'Finance', 'Mitigate'],
    ['Supplier concentration', 'Supply chain', 'Monitor'],
    ['Payroll access review', 'People', 'Due soon'],
  ],
  workspace: [
    ['Launch Abuja branch', 'Operations', '62% complete'],
    ['September stock audit', 'Finance', 'Starts tomorrow'],
    ['Northstar renewal', 'Sales', 'Needs owner'],
  ],
  admin: [
    ['Review auditor access', 'Security', '2 accounts'],
    ['Connect notification provider', 'Integrations', 'Pending'],
    ['Review plan entitlements', 'Billing', 'Needs owner'],
  ],
  assets: [
    ['MacBook Pro 16 M3 (Asset-001)', 'Engineering · SN: C02X8892', 'Operational · NGN 3,200,000'],
    ['Dell Precision Workstation (Asset-002)', 'Design · SN: DL-889104', 'Operational · NGN 2,100,000'],
    ['Warehouse Forklift Toyota 8FBE (Asset-003)', 'Logistics · SN: TY-552109', 'Maintenance · NGN 12,500,000'],
  ],
  facilities: [
    ['Main Office HVAC Unit #1', 'Facility: Lagos HQ · Condition: Good', 'Next check: 15 Oct'],
    ['Backup Generator CAT 250kVA', 'Power Backup · Condition: Fair', 'Oil change due in 10 days'],
    ['Abuja Warehouse Roller Shutter', 'Security / Access · Condition: Operational', 'Inspected yesterday'],
  ],
  production: [
    ['Batch #PR-2026-088 · Keyboards', 'Assembly line 2 · 500 units', 'In progress · 64%'],
    ['Batch #PR-2026-089 · Docking Stations', 'SMT line 1 · 200 units', 'Scheduled · Material ready'],
    ['Batch #PR-2026-087 · Monitor Mounts', 'QA Passed · 150 units', 'Completed · 0 defects'],
  ],
  frontoffice: [
    ['Amina Bello · Kora Imports', 'Meeting Host: Amara Okafor · Room A', 'Checked in · 10:30 AM'],
    ['David Eze · Greenfield Audit', 'Meeting Host: Finance Lead · Boardroom', 'Scheduled · 2:00 PM'],
    ['Courier Delivery · Express Logistics', 'Front Desk Receiving', 'Completed · 9:15 AM'],
  ],
  communication: [
    ['Q4 Operational Strategy & Targets', 'From: Leadership · General Channel', 'Active announcement'],
    ['Warehouse Health & Safety Notice', 'From: Operations · Logistics Channel', 'Acknowledged by staff'],
    ['Maintenance Window: Sunday 2:00 AM', 'From: IT Operations · Announcements', 'Scheduled'],
  ],
  banking: [
    ['Access Bank Corporate (0029381920)', 'Open Banking API adapter', 'Active · NGN 5,420,000'],
    ['Zenith Bank Operations (1019283741)', 'Direct Feed Adapter', 'Active · NGN 1,850,000'],
    ['Reconciliation Matching Engine', '14 auto-matched, 2 pending review', 'Live rule matcher'],
  ],
}

export async function seedModuleRecords(c: PoolClient, tenant: string) {
  for (const module of moduleNames) {
    for (const [name, detail, status] of defaults[module]) {
      await c.query(
        `INSERT INTO module_records(id,tenant_id,module,name,detail,status,metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id,module,name) DO NOTHING`,
        [randomUUID(), tenant, module, name, detail, status, {}],
      )
    }
  }
}

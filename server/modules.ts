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
  documents: [
    'finance_admin',
    'hr_admin',
    'operations_manager',
    'sales_crm_user',
    'department_manager',
    'employee',
  ],
  automation: ['operations_manager', 'department_manager'],
  warehouse: ['operations_manager'],
  support: ['sales_crm_user', 'department_manager'],
  tax: ['finance_admin'],
  supply: ['operations_manager'],
  compliance: [
    'finance_admin',
    'operations_manager',
    'hr_admin',
    'super_admin',
  ],
  workspace: ['department_manager', 'employee', 'operations_manager'],
  admin: ['super_admin'],
  assets: ['operations_manager'],
  facilities: ['operations_manager'],
  production: ['operations_manager'],
  frontoffice: ['sales_crm_user', 'department_manager', 'employee'],
  communication: [
    'finance_admin',
    'hr_admin',
    'operations_manager',
    'sales_crm_user',
    'department_manager',
    'employee',
  ],
  banking: ['finance_admin'],
}

const moduleWriters: Record<ModuleName, readonly UserRole[]> = {
  billing: ['finance_admin'],
  documents: [
    'finance_admin',
    'hr_admin',
    'operations_manager',
    'sales_crm_user',
    'department_manager',
    'employee',
  ],
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
    (role !== 'auditor' &&
      (moduleWriters[module]?.includes(role) ||
        (module === 'admin' && role === 'super_admin')))
  )
}

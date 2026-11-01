import { seed, transition } from './domain.ts'
import type { State } from './types'
import type { WorkflowKind, WorkflowRecord } from './workflow-contracts'

export const DEMO_EMAIL = 'demo@businessos.app'
export const DEMO_PASSWORD = 'Demo@12345'
export function demoState(): State {
  let state = seed()
  state.sampleData = true
  for (const [name, amount] of [
    ['Office & internet', 45000],
    ['Delivery and logistics', 28500],
    ['Software subscriptions', 18000],
  ] as const)
    state = transition(state, {
      type: 'create',
      collection: 'expenses',
      data: { name, amount },
      actor: 'Demo workspace',
    })
  for (const [name, amount] of [
    ['Cedar creative studio', 185000],
    ['Atlas retail group', 460000],
    ['Bloom workspace', 235000],
  ] as const)
    state = transition(state, {
      type: 'create',
      collection: 'invoices',
      data: { name, amount },
      actor: 'Demo workspace',
    })
  state = transition(state, {
    type: 'create',
    collection: 'orders',
    data: { name: 'TechHub Hardware Dist.', product: 'p2', qty: 20 },
    actor: 'Demo workspace',
  })
  state.tasks.push({
    id: 'demo-completed-task',
    name: 'Publish the monthly operations report',
    status: 'Completed',
  })
  return state
}
export function demoOperations(
  module: string,
): Record<string, string | number | null>[] {
  const rows: Record<string, Record<string, string | number | null>[]> = {
    assets: [
      {
        name: 'MacBook Pro · Design team',
        serial_number: 'AST-1042',
        category: 'IT equipment',
        cost: 1450000,
        book_value: 1160000,
        location: 'Head office',
        status: 'operational',
      },
      {
        name: 'Delivery van',
        serial_number: 'AST-1028',
        category: 'Vehicles',
        cost: 4800000,
        book_value: 3840000,
        location: 'Main warehouse',
        status: 'maintenance',
      },
      {
        name: 'Warehouse barcode scanners',
        serial_number: 'AST-1056',
        category: 'Equipment',
        cost: 360000,
        book_value: 324000,
        location: 'Dispatch bay',
        status: 'operational',
      },
    ],
    facilities: [
      {
        facility_name: 'Head office',
        equipment: 'Air conditioning · Floor 2',
        condition: 'needs_service',
        priority: 'high',
        description: 'Quarterly filter replacement and servicing',
        status: 'in_progress',
      },
      {
        facility_name: 'Main warehouse',
        equipment: 'Loading bay lighting',
        condition: 'fair',
        priority: 'medium',
        description: 'Replace two overhead LED panels',
        status: 'open',
      },
    ],
    production: [
      {
        batch_number: 'BATCH-1042',
        product_name: 'Workstation accessory kits',
        planned_qty: 120,
        completed_qty: 85,
        defect_count: 2,
        status: 'running',
      },
      {
        batch_number: 'BATCH-1041',
        product_name: 'Conference room bundles',
        planned_qty: 40,
        completed_qty: 40,
        defect_count: 0,
        status: 'completed',
      },
    ],
    frontoffice: [
      {
        visitor_name: 'Riya Mehta',
        host_person: 'Operations team',
        company: 'Atlas Retail',
        purpose: 'Supplier onboarding',
        check_in_time: '09:30',
        check_out_time: null,
        status: 'checked_in',
      },
      {
        visitor_name: 'Daniel Cole',
        host_person: 'Sales team',
        company: 'Cedar Studio',
        purpose: 'Workspace product demo',
        check_in_time: '11:00',
        check_out_time: null,
        status: 'scheduled',
      },
    ],
    campaigns: [
      {
        name: 'Workspace essentials collection',
        channel: 'email',
        budget: 250000,
        spend: 142000,
        leads_count: 38,
        revenue_generated: 780000,
        roi_percent: 449,
        status: 'active',
      },
      {
        name: 'Partner referral programme',
        channel: 'referral',
        budget: 150000,
        spend: 65000,
        leads_count: 21,
        revenue_generated: 420000,
        roi_percent: 546,
        status: 'active',
      },
    ],
    compliance: [
      {
        title: 'Supplier delivery concentration',
        category: 'vendor',
        severity: 'medium',
        mitigation_plan: 'Qualify a second supplier for core accessories',
        status: 'mitigating',
      },
      {
        title: 'Quarterly access review',
        category: 'security',
        severity: 'low',
        mitigation_plan: 'Review permissions and revoke inactive accounts',
        status: 'controlled',
      },
    ],
  }
  return (rows[module] || []).map((row, index) => ({
    ...row,
    id: `demo-${module}-${index}`,
    version: 1,
  }))
}
export function demoWorkflows(kind: WorkflowKind): WorkflowRecord[] {
  const date = new Date().toISOString().slice(0, 10)
  const samples: Record<
    WorkflowKind,
    { status: string; data: Record<string, unknown> }[]
  > = {
    leave: [
      {
        status: 'pending',
        data: {
          employeeId: 'e1',
          startDate: date,
          endDate: date,
          reason: 'Personal day · sample request',
        },
      },
    ],
    goals: [
      {
        status: 'active',
        data: {
          employeeId: 'e2',
          title: 'Grow the partner network',
          target: 20,
          progress: 14,
          unit: 'partners',
          dueDate: date,
        },
      },
    ],
    reviews: [
      {
        status: 'scheduled',
        data: {
          employeeId: 'e1',
          periodStart: date,
          periodEnd: date,
          rating: 4,
          summary: 'Strong delivery and ownership across the operations team.',
          rewardAmount: 25000,
          rewardNote: 'Sample performance award',
        },
      },
    ],
    appointments: [
      {
        status: 'scheduled',
        data: {
          title: 'Atlas Retail · Partnership review',
          guest: 'Riya Mehta',
          host: 'Sales team',
          room: 'Meeting room A',
          startAt: date + 'T10:00:00Z',
          endAt: date + 'T11:00:00Z',
        },
      },
    ],
    certifications: [
      {
        status: 'active',
        data: {
          title: 'Information security policy',
          issuer: 'Internal governance',
          reference: 'POL-2026-008',
          expiresOn: '2027-10-31',
        },
      },
    ],
    findings: [
      {
        status: 'open',
        data: {
          title: 'Complete supplier due diligence',
          assignee: 'Operations team',
          severity: 'medium',
          dueDate: date,
          correctiveAction: 'Collect and review updated supplier documents.',
        },
      },
    ],
    knowledge: [
      {
        status: 'published',
        data: {
          title: 'How to request a return',
          category: 'Customer support',
          content:
            'Share your order reference with support. Our team reviews the request, arranges inspection, and keeps you updated at each step.',
        },
      },
    ],
  }
  return samples[kind].map((sample, index) => ({
    ...sample,
    id: `demo-${kind}-${index}`,
    kind,
    version: 1,
    created_by: 'Demo team',
    created_at: date + 'T09:00:00Z',
    updated_at: date + 'T09:00:00Z',
  }))
}

export const demoBudgets = [
  {
    id: 'demo-budget-1',
    name: 'Q4 operations',
    department: 'Operations',
    period_from: '2026-10-01',
    period_to: '2026-12-31',
    total_amount: 2500000,
    spent_amount: 1620000,
    status: 'active' as const,
    version: 1,
  },
  {
    id: 'demo-budget-2',
    name: 'Brand & growth',
    department: 'Marketing',
    period_from: '2026-10-01',
    period_to: '2026-12-31',
    total_amount: 900000,
    spent_amount: 385000,
    status: 'active' as const,
    version: 1,
  },
]
export const demoRfqs = [
  {
    id: 'demo-rfq-1',
    rfq_number: 'RFQ-1048',
    supplier_name: 'TechHub Hardware',
    product_description: 'USB-C docking stations',
    quantity: 50,
    required_by: '2026-11-20',
    quoted_amount: 1950000,
    status: 'quoted' as const,
    notes: 'Includes delivery and 12-month warranty',
    version: 1,
  },
  {
    id: 'demo-rfq-2',
    rfq_number: 'RFQ-1049',
    supplier_name: 'Kora Office Supply',
    product_description: 'Ergonomic desk accessories',
    quantity: 30,
    required_by: '2026-11-25',
    quoted_amount: null,
    status: 'sent' as const,
    notes: 'Awaiting supplier quotation',
    version: 1,
  },
]
export const demoCandidates = [
  {
    id: 'demo-candidate-1',
    name: 'Priya Sharma',
    email: 'priya@example.test',
    position: 'Operations coordinator',
    notes: 'Sample candidate · interview scheduled',
    status: 'interview',
    version: 1,
  },
  {
    id: 'demo-candidate-2',
    name: 'Alex Morgan',
    email: 'alex@example.test',
    position: 'Customer success specialist',
    notes: 'Sample candidate · strong customer service experience',
    status: 'screening',
    version: 1,
  },
]

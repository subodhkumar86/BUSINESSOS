type Field = [string, string, string | string[]]
type Contract = {
  title: string
  path: string
  key: string
  fields: Field[]
  columns: string[]
  statuses: string[]
}
export const operations: Record<string, Contract> = {
  assets: {
    title: 'Asset register',
    path: '/assets',
    key: 'assets',
    fields: [
      ['name', 'Asset name', 'text'],
      ['serialNumber', 'Serial number', 'text'],
      ['category', 'Category', 'text'],
      ['cost', 'Purchase cost', 'number'],
      ['depreciationRate', 'Annual depreciation %', 'number'],
      ['location', 'Location', 'text'],
    ],
    columns: [
      'name',
      'serial_number',
      'category',
      'cost',
      'book_value',
      'location',
    ],
    statuses: ['operational', 'maintenance', 'retired'],
  },
  facilities: {
    title: 'Maintenance work orders',
    path: '/facilities/work-orders',
    key: 'workOrders',
    fields: [
      ['facilityName', 'Facility', 'text'],
      ['equipment', 'Equipment', 'text'],
      ['condition', 'Condition', ['good', 'fair', 'needs_service', 'critical']],
      ['priority', 'Priority', ['low', 'medium', 'high', 'urgent']],
      ['description', 'Description', 'text'],
    ],
    columns: [
      'facility_name',
      'equipment',
      'condition',
      'priority',
      'description',
    ],
    statuses: ['open', 'in_progress', 'completed'],
  },
  production: {
    title: 'Production batches',
    path: '/production/batches',
    key: 'batches',
    fields: [
      ['batchNumber', 'Batch number', 'text'],
      ['productName', 'Product name', 'text'],
      ['outputProductId', 'Finished-good product ID (optional)', 'text'],
      ['materials', 'Materials JSON', 'text'],
      ['plannedQty', 'Planned quantity', 'number'],
    ],
    columns: [
      'batch_number',
      'product_name',
      'planned_qty',
      'completed_qty',
      'defect_count',
    ],
    statuses: ['scheduled', 'running', 'qa_check', 'completed'],
  },
  frontoffice: {
    title: 'Visitor register',
    path: '/frontoffice/visitors',
    key: 'visitors',
    fields: [
      ['visitorName', 'Visitor name', 'text'],
      ['hostPerson', 'Host', 'text'],
      ['company', 'Company', 'text'],
      ['purpose', 'Purpose', 'text'],
    ],
    columns: [
      'visitor_name',
      'host_person',
      'company',
      'purpose',
      'check_in_time',
      'check_out_time',
    ],
    statuses: ['scheduled', 'checked_in', 'completed', 'cancelled'],
  },
  campaigns: {
    title: 'Marketing campaigns',
    path: '/marketing/campaigns',
    key: 'campaigns',
    fields: [
      ['name', 'Campaign name', 'text'],
      [
        'channel',
        'Channel',
        ['social', 'email', 'search', 'event', 'referral'],
      ],
      ['budget', 'Budget', 'number'],
      ['spend', 'Spend', 'number'],
    ],
    columns: [
      'name',
      'channel',
      'budget',
      'spend',
      'leads_count',
      'revenue_generated',
      'roi_percent',
    ],
    statuses: ['planning', 'active', 'paused', 'completed'],
  },
  compliance: {
    title: 'Risk register',
    path: '/compliance/risks',
    key: 'risks',
    fields: [
      ['title', 'Risk title', 'text'],
      [
        'category',
        'Category',
        ['financial', 'operational', 'regulatory', 'security', 'vendor'],
      ],
      ['severity', 'Severity', ['low', 'medium', 'high', 'critical']],
      ['mitigationPlan', 'Mitigation plan', 'text'],
    ],
    columns: [
      'title',
      'category',
      'severity',
      'mitigation_plan',
      'review_date',
    ],
    statuses: ['identified', 'mitigating', 'controlled', 'accepted'],
  },
}

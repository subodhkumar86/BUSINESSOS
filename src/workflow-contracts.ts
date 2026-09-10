import { z } from 'zod'
import type { UserRole } from './types.ts'
export const workflowKinds = [
  'leave',
  'goals',
  'reviews',
  'appointments',
  'certifications',
  'findings',
  'knowledge',
] as const
export type WorkflowKind = (typeof workflowKinds)[number]
const text = z.string().trim().min(1).max(160)
const notes = z.string().trim().min(1).max(4000)
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value + 'T00:00:00Z')
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    )
  }, 'Enter a valid calendar date.')
const timestamp = z.iso.datetime({ offset: true })
const employeeId = z.string().trim().min(1).max(100)
export const workflowSchemas = {
  leave: z
    .object({ employeeId, startDate: day, endDate: day, reason: notes })
    .strict()
    .refine(
      (v) => v.startDate <= v.endDate,
      'End date must follow start date.',
    ),
  goals: z
    .object({
      employeeId,
      title: text,
      target: z.number().positive().max(1e9),
      unit: text,
      dueDate: day,
    })
    .strict(),
  reviews: z
    .object({
      employeeId,
      periodStart: day,
      periodEnd: day,
      rating: z.number().int().min(1).max(5),
      summary: notes,
      rewardAmount: z.number().finite().min(0).max(1e12).default(0),
      rewardNote: z.string().trim().max(1000).default(''),
    })
    .strict()
    .refine(
      (v) => v.periodStart <= v.periodEnd,
      'Review period end must follow its start.',
    ),
  appointments: z
    .object({
      title: text,
      guest: text,
      host: text,
      room: text,
      startAt: timestamp,
      endAt: timestamp,
    })
    .strict()
    .refine(
      (v) => Date.parse(v.startAt) < Date.parse(v.endAt),
      'Appointment end must follow start.',
    ),
  certifications: z
    .object({ title: text, issuer: text, reference: text, expiresOn: day })
    .strict(),
  findings: z
    .object({
      title: text,
      assignee: text,
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      dueDate: day,
      correctiveAction: notes,
    })
    .strict(),
  knowledge: z.object({ title: text, category: text, content: notes }).strict(),
}
export const workflowPatch = z
  .object({
    version: z.number().int().positive(),
    status: z.string().max(30).optional(),
    progress: z.number().nonnegative().max(1e9).optional(),
    evidence: z.string().trim().min(1).max(4000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.status !== undefined ||
      v.progress !== undefined ||
      v.evidence !== undefined,
    'Supply a change.',
  )
export const workflowStates: Record<WorkflowKind, Record<string, string[]>> = {
  leave: { pending: ['approved', 'rejected'], approved: [], rejected: [] },
  goals: { active: ['completed', 'cancelled'], completed: [], cancelled: [] },
  reviews: {
    scheduled: ['in_review', 'cancelled'],
    in_review: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  appointments: {
    scheduled: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
  certifications: { active: ['revoked'], revoked: [] },
  findings: { open: ['in_progress'], in_progress: ['closed'], closed: [] },
  knowledge: { draft: ['published'], published: ['archived'], archived: [] },
}
export const workflowWriters: Record<WorkflowKind, UserRole[]> = {
  leave: ['owner', 'hr_admin', 'employee'],
  goals: ['owner', 'hr_admin', 'employee'],
  reviews: ['owner', 'hr_admin'],
  appointments: ['owner', 'sales_crm_user'],
  certifications: ['owner', 'operations_manager'],
  findings: ['owner', 'operations_manager'],
  knowledge: ['owner', 'sales_crm_user'],
}
export function canReadWorkflow(kind: WorkflowKind, role: UserRole) {
  if (role === 'super_admin') return false
  return (
    kind === 'knowledge' ||
    role === 'auditor' ||
    workflowWriters[kind].includes(role) ||
    (['certifications', 'findings'].includes(kind) &&
      ['hr_admin', 'finance_admin'].includes(role))
  )
}
export function validateWorkflowChange(
  kind: WorkflowKind,
  current: { status: string; data: Record<string, unknown> },
  input: z.infer<typeof workflowPatch>,
) {
  if (
    input.status &&
    !workflowStates[kind][current.status]?.includes(input.status)
  )
    throw Error('This status transition is not allowed.')
  if (
    input.progress !== undefined &&
    (kind !== 'goals' || current.status !== 'active')
  )
    throw Error('Progress is only editable for active goals.')
  if (
    input.evidence !== undefined &&
    (kind !== 'findings' || current.status === 'closed')
  )
    throw Error('Evidence is only editable for open findings.')
  if (
    kind === 'goals' &&
    input.status === 'completed' &&
    Number(input.progress ?? current.data.progress ?? 0) <
      Number(current.data.target)
  )
    throw Error('Reach the goal target before completing it.')
  if (
    kind === 'findings' &&
    input.status === 'closed' &&
    !String(input.evidence ?? current.data.evidence ?? '').trim()
  )
    throw Error('Resolution evidence is required before closure.')
}
export interface WorkflowRecord {
  id: string
  kind: WorkflowKind
  status: string
  data: Record<string, unknown>
  version: number
  created_by: string
  created_at: string
  updated_at: string
}

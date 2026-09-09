import { z } from 'zod'

export const candidateInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.email().max(254),
    position: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(2000).default(''),
  })
  .strict()
export const candidateUpdate = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(['screening', 'interview', 'offer', 'hired', 'rejected']),
  })
  .strict()
export function canAdvanceCandidate(from: string, to: string) {
  const stages: Record<string, string[]> = {
    applied: ['screening', 'rejected'],
    screening: ['interview', 'rejected'],
    interview: ['offer', 'rejected'],
    offer: ['hired', 'rejected'],
    hired: [],
    rejected: [],
  }
  return stages[from]?.includes(to) || false
}

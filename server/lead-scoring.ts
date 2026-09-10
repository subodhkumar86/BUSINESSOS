import type { Lead } from '../src/types.ts'

const stageWeights: Record<string, number> = {
  New: 10,
  Qualified: 30,
  Proposal: 55,
  Negotiation: 75,
  Won: 100,
  Lost: 0,
}

export function scoreLead(lead: Lead, avgDealSize: number): { score: number; factors: Record<string, number> } {
  const stageScore = stageWeights[lead.status] ?? 10
  const sizeScore = avgDealSize > 0 ? Math.min(25, Math.round((lead.amount / avgDealSize) * 15)) : 0
  const score = Math.min(100, stageScore + sizeScore)
  return {
    score,
    factors: { stage: stageScore, dealSize: sizeScore },
  }
}

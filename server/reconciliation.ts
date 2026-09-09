export type ReconciliationSource = {
  id: string
  type: 'invoice' | 'expense'
  amount: number
  label: string
}

export type ReconciliationSuggestion = {
  source: ReconciliationSource
  confidence: number
  reason: string
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Conservative, deterministic first-pass matching. It only returns a result
 * when the amount agrees exactly and one candidate is clearly stronger than
 * the rest. Ambiguous records stay in the finance review queue.
 */
export function suggestReconciliation(
  transaction: { amount: number; direction: 'credit' | 'debit'; reference: string },
  sources: ReconciliationSource[],
): ReconciliationSuggestion | null {
  const expectedType = transaction.direction === 'credit' ? 'invoice' : 'expense'
  const reference = normalize(transaction.reference)
  const scored = sources
    .filter(
      (source) =>
        source.type === expectedType &&
        Math.abs(source.amount) === Math.abs(transaction.amount),
    )
    .map((source) => {
      const sourceLabel = normalize(source.label)
      const referenceEvidence =
        reference.length >= 4 && sourceLabel.length >= 4 &&
        (reference.includes(sourceLabel) || sourceLabel.includes(reference))
      return {
        source,
        confidence: referenceEvidence ? 95 : 70,
        reason: referenceEvidence
          ? 'Exact amount and matching reference.'
          : 'Exact amount; reference needs reviewer confirmation.',
      }
    })
    .sort((a, b) => b.confidence - a.confidence || a.source.id.localeCompare(b.source.id))

  if (!scored.length) return null
  const [best, second] = scored
  if (best.confidence < 70 || (second && second.confidence === best.confidence)) return null
  return best
}

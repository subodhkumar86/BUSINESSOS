type Insight = {
  answer: string
  engine: string
  dataWindow: string
  sources: { module: string; records: number }[]
  calculation: Record<string, unknown>
  confidence: string
}

/** Server-only optional adapter. It deliberately sends a redacted calculated summary, never raw tenant records. */
export async function enrichWithDeepSeek(question: string, insight: Insight): Promise<Insight> {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) return insight
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-v4-flash', temperature: 0.2, max_tokens: 280,
        messages: [
          { role: 'system', content: 'You are a careful business analyst. Explain only the supplied calculated, tenant-scoped figures. Do not invent figures, legal or tax advice, or perform actions. Be concise and state uncertainty where confidence is limited.' },
          { role: 'user', content: JSON.stringify({ question, deterministicAnswer: insight.answer, calculation: insight.calculation, confidence: insight.confidence, sources: insight.sources }) },
        ],
      }),
    })
    if (!response.ok) return insight
    const body = await response.json() as { choices?: { message?: { content?: string } }[] }
    const answer = body.choices?.[0]?.message?.content?.trim()
    return answer && answer.length <= 3000 ? { ...insight, answer, engine: 'deepseek + deterministic lineage' } : insight
  } catch {
    return insight
  } finally { clearTimeout(timeout) }
}

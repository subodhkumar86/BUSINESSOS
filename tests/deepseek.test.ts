import test from 'node:test'
import assert from 'node:assert/strict'
import { enrichWithDeepSeek } from '../server/deepseek.ts'

const insight = {
  answer: 'Cash is 1200.', engine: 'deterministic-rules-v1', dataWindow: 'Current tenant workspace snapshot',
  sources: [{ module: 'Finance', records: 2 }], calculation: { cash: 1200 }, confidence: 'limited',
}

test('DeepSeek adapter falls back without a key', async () => {
  const saved = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try { assert.deepEqual(await enrichWithDeepSeek('What is cash?', insight), insight) }
  finally { if (saved === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved }
})

test('DeepSeek adapter enriches only the deterministic summary', async () => {
  const savedKey = process.env.DEEPSEEK_API_KEY, savedFetch = globalThis.fetch
  process.env.DEEPSEEK_API_KEY = 'test-key-not-a-real-secret'
  let payload = ''
  globalThis.fetch = async (_url, options) => {
    payload = String(options?.body)
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Cash is stable based on the supplied summary.' } }] }), { status: 200 })
  }
  try {
    const result = await enrichWithDeepSeek('What is cash?', insight)
    assert.equal(result.answer, 'Cash is stable based on the supplied summary.')
    assert.equal(result.engine, 'deepseek + deterministic lineage')
    assert.match(payload, /deterministicAnswer/)
    assert.doesNotMatch(payload, /password|bank credential/i)
  } finally {
    globalThis.fetch = savedFetch
    if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = savedKey
  }
})

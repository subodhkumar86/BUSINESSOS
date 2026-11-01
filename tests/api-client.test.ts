import test from 'node:test'
import assert from 'node:assert/strict'
import { request, ApiError } from '../src/api.ts'

test('API client never reports malformed successful responses as saved', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response('<html>Unavailable</html>', { status: 200 })
    await assert.rejects(request('/actions'), (error: unknown) => error instanceof ApiError && error.status === 502 && /could not be confirmed/.test(error.message))
    globalThis.fetch = async () => Response.json({ saved: true })
    assert.deepEqual(await request('/actions'), { saved: true })
  } finally { globalThis.fetch = original }
})

test('API client handles null and malformed errors and expires protected sessions', async () => {
  const originalFetch = globalThis.fetch
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events: Event[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: (event: Event) => { events.push(event); return true } } })
  try {
    globalThis.fetch = async () => Response.json(null, { status: 401 })
    await assert.rejects(request('/workspace', { sessionRequired: false }), (error: unknown) => error instanceof ApiError && error.status === 401)
    assert.equal(events.length, 0)
    await assert.rejects(request('/workspace'), ApiError)
    assert.equal(events.length, 1)
    globalThis.fetch = async () => Response.json({ error: { internal: 'do not display' } }, { status: 500 })
    await assert.rejects(request('/actions'), (error: unknown) => error instanceof ApiError && !error.message.includes('[object Object]'))
    globalThis.fetch = async () => Response.json({ error: 'Version changed.' }, { status: 409 })
    await assert.rejects(request('/actions'), /Version changed/)
  } finally {
    globalThis.fetch = originalFetch
    if (descriptor) Object.defineProperty(globalThis, 'window', descriptor)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

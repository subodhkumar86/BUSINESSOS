import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { productionProblems } from '../scripts/production-config.mjs'
import {
  deliveryAdapter,
  deliverMessage,
  signDelivery,
} from '../server/notify.ts'

const configured = {
  DATABASE_URL: 'mongodb://example.test/business',
  APP_ORIGIN: 'https://example.test',
  COOKIE_SECURE: 'true',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  CONNECTOR_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('hex'),
  NOTIFY_PROVIDER: 'webhook',
  NOTIFY_WEBHOOK_URL: 'https://delivery.example.test/messages',
  DELIVERY_WEBHOOK_SECRET: 'test-signing-secret-with-at-least-32-characters',
  CRON_SECRET: 'test-worker-secret-with-at-least-32-characters',
}
test('production preflight requires working workflow configuration beyond a database', () => {
  assert.deepEqual(
    productionProblems(configured, { nodeVersion: '24.0.0' }),
    [],
  )
  const core = {
    DATABASE_URL: configured.DATABASE_URL,
    APP_ORIGIN: configured.APP_ORIGIN,
    COOKIE_SECURE: configured.COOKIE_SECURE,
  }
  assert.equal(productionProblems(core, { nodeVersion: '24.0.0' }).length, 6)
  assert.deepEqual(
    productionProblems(core, { coreOnly: true, nodeVersion: '24.0.0' }),
    [],
  )
})
test('production checks reject malformed secrets, origins, unsafe endpoints and development recovery', () => {
  for (const [name, value] of [
    ['APP_ENCRYPTION_KEY', 'invalid'],
    ['CONNECTOR_ENCRYPTION_KEY', 'x'.repeat(32)],
    ['DELIVERY_WEBHOOK_SECRET', ' '.repeat(40)],
    ['CRON_SECRET', 'short'],
    ['APP_ORIGIN', 'https://example.test/login'],
    ['APP_ORIGIN', 'http://example.test'],
    ['NOTIFY_WEBHOOK_URL', 'https://user:password@example.test'],
    ['NOTIFY_WEBHOOK_URL', 'http://localhost/messages'],
    ['NOTIFY_WEBHOOK_URL', 'https://example.test/messages#fragment'],
    ['ALLOW_DEVELOPMENT_RESET_TOKENS', 'true'],
  ])
    assert.ok(
      productionProblems(
        { ...configured, [name]: value },
        { nodeVersion: '24.0.0' },
      ).length > 0,
      name,
    )
})
test('production delivery fails closed without a signing secret and never calls the provider', async () => {
  const saved = { ...process.env },
    originalFetch = globalThis.fetch
  let calls = 0
  try {
    Object.assign(process.env, configured, { NODE_ENV: 'production' })
    delete process.env.DELIVERY_WEBHOOK_SECRET
    globalThis.fetch = async () => {
      calls++
      return new Response('{}')
    }
    assert.equal(deliveryAdapter().configured, false)
    assert.throws(() => signDelivery('payload'), /signing secret/)
    const result = await deliverMessage({
      id: 'delivery-1',
      tenant_id: 'tenant-1',
      channel: 'email',
      recipient: 'test@example.test',
      subject: 'Test',
      body: 'Sensitive body',
      attempts: 0,
    })
    assert.equal(result.status, 'failed')
    assert.equal(calls, 0)
  } finally {
    process.env = saved
    globalThis.fetch = originalFetch
  }
})
test('production webhook validates endpoints and signs the exact payload without following redirects', async () => {
  const saved = { ...process.env },
    originalFetch = globalThis.fetch
  try {
    Object.assign(process.env, configured, { NODE_ENV: 'production' })
    for (const endpoint of [
      'http://localhost/messages',
      'ftp://localhost/messages',
      'https://user:pass@example.test/messages',
      'https://example.test/#fragment',
    ]) {
      process.env.NOTIFY_WEBHOOK_URL = endpoint
      assert.equal(deliveryAdapter().configured, false)
    }
    process.env.NOTIFY_WEBHOOK_URL = configured.NOTIFY_WEBHOOK_URL
    globalThis.fetch = async (_url, options) => {
      assert.equal(options?.redirect, 'error')
      const expected = createHmac('sha256', configured.DELIVERY_WEBHOOK_SECRET)
        .update(String(options?.body))
        .digest('hex')
      assert.equal(
        new Headers(options?.headers).get('x-businessos-delivery-signature'),
        expected,
      )
      return new Response('{}', { status: 200 })
    }
    const result = await deliverMessage({
      id: 'delivery-1',
      tenant_id: 'tenant-1',
      channel: 'email',
      recipient: 'test@example.test',
      subject: 'Test',
      body: 'Sensitive body',
      attempts: 0,
    })
    assert.equal(result.status, 'sent')
  } finally {
    process.env = saved
    globalThis.fetch = originalFetch
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { initializeDatabase, database } from '../server/mongo/database.ts'
import { handleRequest } from '../server/mongo/handler.ts'

const origin = 'http://127.0.0.1:3000'
type Login = { cookie: string; csrf: string; version: number }
async function call(
  path: string,
  method = 'GET',
  data?: unknown,
  auth?: Login,
  extra: Record<string, string> = {},
) {
  return handleRequest(
    new Request('http://localhost:3000/api/v1' + path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}),
        ...extra,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    }),
  )
}
async function register(email: string) {
  const response = await call('/auth/register', 'POST', {
    name: email,
    organisation: 'Test Company',
    email,
    password: 'TestBusinessOS!2026',
    sample: false,
  })
  assert.equal(response.status, 201, await response.clone().text())
  const data = await response.json()
  return {
    cookie: response.headers.get('set-cookie')!.split(';')[0],
    csrf: data.csrf,
    version: data.version,
  } satisfies Login
}

test(
  'MongoDB API: isolation, RBAC, CSRF, ledger writes, retries and revocation',
  { timeout: 900000 },
  async (t) => {
    process.env.NODE_ENV = 'test'
    process.env.APP_ORIGIN = origin
    const replica = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      binary: { version: '8.0.16' },
    })
    // Exercise the deployed DATABASE_URL contract using only the temporary DB.
    process.env.DATABASE_URL = replica.getUri()
    delete process.env.MONGODB_URI
    process.env.MONGODB_DB =
      'businessos_test_' + randomUUID().replaceAll('-', '')
    try {
      await initializeDatabase()
      const owner = await register('owner@example.test'),
        other = await register('other@example.test')
      const d = await database()
      await t.test(
        'origin and CSRF checks reject forged mutations',
        async () => {
          assert.equal(
            (
              await call('/auth/logout', 'POST', {}, owner, {
                'X-CSRF-Token': 'wrong',
              })
            ).status,
            403,
          )
          assert.equal(
            (
              await call('/auth/logout', 'POST', {}, owner, {
                Origin: 'https://evil.example',
              })
            ).status,
            403,
          )
        },
      )
      const key = randomUUID(),
        action = {
          type: 'create',
          collection: 'products',
          data: { name: 'Keyboard', sku: 'KB1', qty: 10, cost: 250, min: 2 },
        }
      let productId = ''
      await t.test(
        'stock and ledger persist atomically; duplicate writes execute once',
        async () => {
          const response = await call(
            '/actions',
            'POST',
            { version: owner.version, action },
            owner,
            { 'Idempotency-Key': key },
          )
          assert.equal(response.status, 200, await response.clone().text())
          const data = await response.json()
          owner.version = data.version
          productId = data.state.products[0].id
          assert.equal(data.state.stockMovements.length, 1)
          assert.equal(data.state.stockMovements[0].after, 10)
          const retry = await call(
            '/actions',
            'POST',
            { version: 0, action },
            owner,
            { 'Idempotency-Key': key },
          )
          assert.equal(retry.status, 200)
          assert.equal((await retry.json()).state.products.length, 1)
          assert.equal(
            (
              await call(
                '/actions',
                'POST',
                {
                  version: owner.version,
                  action: {
                    ...action,
                    data: { ...action.data, sku: 'DIFFERENT' },
                  },
                },
                owner,
                { 'Idempotency-Key': key },
              )
            ).status,
            409,
          )
        },
      )
      await t.test(
        'tenants cannot see or mutate each other records',
        async () => {
          const response = await call('/workspace', 'GET', undefined, other)
          assert.deepEqual((await response.json()).state.products, [])
          const bad = await call(
            '/actions',
            'POST',
            {
              version: 0,
              action: {
                type: 'stock_adjust',
                id: productId,
                data: {
                  product: productId,
                  expectedQty: 10,
                  delta: 2,
                  reason: 'test',
                },
              },
            },
            other,
            { 'Idempotency-Key': randomUUID() },
          )
          assert.equal(bad.status, 400)
        },
      )
      await t.test(
        'concurrent writes detect stale workspace versions',
        async () => {
          const payload = {
            version: owner.version,
            action: {
              type: 'create',
              collection: 'tasks',
              data: { name: 'Review stock' },
            },
          }
          const results = await Promise.all([
            call('/actions', 'POST', payload, owner, {
              'Idempotency-Key': randomUUID(),
            }),
            call('/actions', 'POST', payload, owner, {
              'Idempotency-Key': randomUUID(),
            }),
          ])
          assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
          owner.version = (
            await (await call('/workspace', 'GET', undefined, owner)).json()
          ).version
        },
      )
      await t.test(
        'financial writes append journals and invalid writes roll back',
        async () => {
          const action = {
            type: 'create',
            collection: 'expenses',
            data: { name: 'Rent', amount: 500 },
          }
          const response = await call(
            '/actions',
            'POST',
            { version: owner.version, action },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
          assert.equal(response.status, 200)
          const data = await response.json()
          owner.version = data.version
          assert.equal(data.state.journals.length, 2)
          assert.equal(data.state.journals[0].amount, 500)
          const bad = await call(
            '/actions',
            'POST',
            {
              version: owner.version,
              action: { ...action, data: { name: 'Invalid', amount: -1 } },
            },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
          assert.equal(bad.status, 400)
          assert.equal(
            (await (await call('/workspace', 'GET', undefined, owner)).json())
              .version,
            owner.version,
          )
        },
      )
      await t.test(
        'employee sessions cannot read finance or write inventory; disabling revokes access',
        async () => {
          const create = await call(
            '/users',
            'POST',
            {
              name: 'Employee',
              email: 'employee@example.test',
              password: 'TestBusinessOS!2026',
              role: 'employee',
            },
            owner,
          )
          assert.equal(create.status, 201)
          const response = await call('/auth/login', 'POST', {
            email: 'employee@example.test',
            password: 'TestBusinessOS!2026',
          })
          const data = await response.json()
          const employee = {
            cookie: response.headers.get('set-cookie')!.split(';')[0],
            csrf: data.csrf,
            version: data.version,
          }
          assert.deepEqual(data.state.journals, [])
          assert.deepEqual(data.state.products, [])
          assert.equal(
            (await call('/finance/statements', 'GET', undefined, employee))
              .status,
            403,
          )
          assert.equal(
            (
              await call(
                '/actions',
                'POST',
                { version: data.version, action },
                employee,
                { 'Idempotency-Key': randomUUID() },
              )
            ).status,
            403,
          )
          assert.equal(
            (
              await call(
                '/actions',
                'POST',
                {
                  version: data.version,
                  action: {
                    type: 'payroll',
                    collection: 'tasks',
                    period: '2026-10',
                  },
                },
                employee,
                { 'Idempotency-Key': randomUUID() },
              )
            ).status,
            400,
          )
          const member = await d.users.findOne({
            email: 'employee@example.test',
          })
          assert.equal(
            (
              await call(
                '/users/' + member!.id + '/access',
                'PATCH',
                { active: false },
                owner,
              )
            ).status,
            200,
          )
          assert.equal(
            (await call('/workspace', 'GET', undefined, employee)).status,
            401,
          )
        },
      )
      await t.test(
        'session expiry is immediate even before TTL cleanup',
        async () => {
          const member = await d.users.findOne({ email: 'other@example.test' })
          await d.sessions.updateMany(
            { tenant: member!.tenant },
            { $set: { expiresAt: new Date(0) } },
          )
          assert.equal(
            (await call('/workspace', 'GET', undefined, other)).status,
            401,
          )
        },
      )
      await t.test('CRM records are tenant scoped', async () => {
        const response = await call(
          '/crm/customers',
          'POST',
          { name: 'Customer A' },
          owner,
        )
        assert.equal(response.status, 201)
        const customer = await response.json()
        const replacement = await call('/auth/login', 'POST', {
          email: 'other@example.test',
          password: 'TestBusinessOS!2026',
        })
        const data = await replacement.json(),
          auth = {
            cookie: replacement.headers.get('set-cookie')!.split(';')[0],
            csrf: data.csrf,
            version: data.version,
          }
        assert.deepEqual(
          (await (await call('/crm/customers', 'GET', undefined, auth)).json())
            .customers,
          [],
        )
        assert.equal(
          (
            await call(
              '/crm/customers/' + customer.id,
              'PATCH',
              { name: 'Stolen', version: 1 },
              auth,
            )
          ).status,
          404,
        )
      })
      await t.test(
        'workflow records enforce versions and transitions',
        async () => {
          const key = randomUUID()
          const input = {
            title: 'Returns policy',
            category: 'Operations',
            content: 'Contact the support team for returns.',
          }
          const response = await call(
            '/workflows/knowledge',
            'POST',
            input,
            owner,
            { 'Idempotency-Key': key },
          )
          assert.equal(response.status, 201)
          const row = await response.json()
          const retry = await call(
            '/workflows/knowledge',
            'POST',
            input,
            owner,
            { 'Idempotency-Key': key },
          )
          assert.equal((await retry.json()).id, row.id)
          assert.equal(
            (
              await call(
                '/workflows/knowledge/' + row.id,
                'PATCH',
                { version: 1, status: 'archived' },
                owner,
              )
            ).status,
            409,
          )
          const published = await call(
            '/workflows/knowledge/' + row.id,
            'PATCH',
            { version: 1, status: 'published' },
            owner,
          )
          assert.equal(published.status, 200)
          assert.equal((await published.json()).version, 2)
          assert.equal(
            (
              await call(
                '/workflows/knowledge/' + row.id,
                'PATCH',
                { version: 1, status: 'archived' },
                owner,
              )
            ).status,
            409,
          )
        },
      )
      await t.test(
        'logout and session revocation invalidate MongoDB sessions',
        async () => {
          assert.equal(
            (await call('/auth/revoke-sessions', 'POST', {}, owner)).status,
            200,
          )
          assert.equal(
            (await call('/workspace', 'GET', undefined, owner)).status,
            401,
          )
        },
      )
      await t.test(
        'built Next.js route serves the live health endpoint',
        async () => {
          const child = spawn(
            process.execPath,
            ['node_modules/next/dist/bin/next', 'start', '-p', '3317'],
            {
              env: {
                ...process.env,
                NODE_ENV: 'production',
                APP_ORIGIN: 'https://example.test',
                COOKIE_SECURE: 'true',
                NEXT_TELEMETRY_DISABLED: '1',
              },
              stdio: 'ignore',
              windowsHide: true,
            },
          )
          try {
            let ready = false
            for (let attempt = 0; attempt < 60; attempt++) {
              if (child.exitCode !== null)
                throw Error('Next.js exited before becoming ready.')
              try {
                const response = await fetch(
                  'http://127.0.0.1:3317/api/v1/health',
                )
                assert.equal(response.status, 200)
                const data = await response.json()
                assert.equal(data.database, 'MongoDB')
                assert.equal(data.backend, 'Next.js')
                ready = true
                break
              } catch {
                await new Promise((resolve) => setTimeout(resolve, 500))
              }
            }
            assert.equal(
              ready,
              true,
              'Next.js health endpoint did not become ready.',
            )
            for (const path of ['/', '/login', '/app/dashboard']) {
              const response = await fetch('http://127.0.0.1:3317' + path)
              assert.equal(
                response.status,
                200,
                `Frontend route failed: ${path}`,
              )
              assert.match(
                response.headers.get('content-type') || '',
                /text\/html/,
              )
              assert.match(await response.text(), /BusinessOS/)
            }
          } finally {
            child.kill()
          }
        },
      )
    } finally {
      const d = await database()
      await d.db.dropDatabase()
      await d.client.close()
      await replica.stop()
      delete (globalThis as typeof globalThis & { businessosMongo?: unknown })
        .businessosMongo
    }
  },
)

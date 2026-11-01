import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import { database } from '../server/mongo/database.ts'
type Login = { cookie: string; csrf: string; version: number }
type Call = (
  path: string,
  method?: string,
  data?: unknown,
  auth?: Login,
  extra?: Record<string, string>,
) => Promise<Response>
export async function verifyStockAutomation(
  t: TestContext,
  call: Call,
  owner: Login,
) {
  const path = '/automation/stock-review'
  async function send(
    route: string,
    method = 'GET',
    data?: unknown,
    key?: string,
    auth = owner,
  ) {
    const response = await call(
      route,
      method,
      data,
      auth,
      key ? { 'Idempotency-Key': key } : {},
    )
    assert.ok(
      response.ok,
      `${method} ${route}: ${response.status} ${await response.clone().text()}`,
    )
    return response.json()
  }
  async function action(action: unknown) {
    const current = await send('/workspace')
    return send(
      '/actions',
      'POST',
      { version: current.version, action },
      randomUUID(),
    )
  }
  await t.test(
    'stock automation creates real tasks atomically, deduplicates retries and enforces plan/roles',
    async () => {
      const disabled = await send(path)
      assert.equal(disabled.enabled, false)
      assert.equal(
        (
          await call(path + '/run', 'POST', {}, owner, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
        409,
      )
      const settings = await send(path, 'PUT', {
        enabled: true,
        version: disabled.version,
      })
      assert.equal(
        (
          await call(
            path,
            'PUT',
            { enabled: false, version: disabled.version },
            owner,
          )
        ).status,
        409,
      )
      await action({
        type: 'create',
        collection: 'products',
        data: {
          name: 'Automation stock',
          sku: 'AUTO-LOW',
          qty: 0,
          min: 5,
          cost: 1,
        },
      })
      const before = await send('/workspace')
      const key = randomUUID()
      const [first, retry] = await Promise.all([
        send(path + '/run', 'POST', {}, key),
        send(path + '/run', 'POST', {}, key),
      ])
      assert.equal(first.run.id, retry.run.id)
      assert.ok(first.run.created > 0)
      const after = await send('/workspace')
      assert.equal(
        after.state.tasks.length,
        before.state.tasks.length + first.run.created,
      )
      assert.equal(after.state.journals.length, before.state.journals.length)
      assert.deepEqual(after.state.products, before.state.products)
      const task = after.state.tasks.find((task: { name: string }) =>
        task.name.includes('AUTO-LOW'),
      )
      assert.ok(task)
      const repeat = await send(path + '/run', 'POST', {}, randomUUID())
      assert.equal(repeat.run.created, 0)
      assert.ok(repeat.run.skipped > 0)
      await action({
        type: 'status',
        collection: 'tasks',
        id: task.id,
        status: 'Completed',
      })
      const reopened = await send(path + '/run', 'POST', {}, randomUUID())
      assert.equal(reopened.run.created, 1)
      const history = await send(path)
      assert.equal(history.runs.length, 3)
      await send('/users', 'POST', {
        name: 'Automation auditor',
        email: 'automation-auditor@example.test',
        password: 'TestBusinessOS!2026',
        role: 'auditor',
      })
      const login = await call('/auth/login', 'POST', {
        email: 'automation-auditor@example.test',
        password: 'TestBusinessOS!2026',
      })
      assert.equal(login.status, 200)
      const session = await login.json(),
        auditor = {
          cookie: login.headers.get('set-cookie')!.split(';')[0],
          csrf: session.csrf,
          version: session.version,
        }
      assert.equal(
        (await send(path, 'GET', undefined, undefined, auditor)).runs.length,
        3,
      )
      assert.equal(
        (
          await call(path + '/run', 'POST', {}, auditor, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
        403,
      )
      assert.equal(
        (
          await call(
            path,
            'PUT',
            { enabled: false, version: settings.version },
            auditor,
          )
        ).status,
        403,
      )
      await send(path, 'PUT', { enabled: false, version: settings.version })
      assert.equal(
        (
          await call(path + '/run', 'POST', {}, owner, {
            'Idempotency-Key': randomUUID(),
          })
        ).status,
        409,
      )
      const outsider = await call('/auth/register', 'POST', {
        name: 'Other owner',
        organisation: 'No automation plan',
        email: 'automation-other@example.test',
        password: 'TestBusinessOS!2026',
      })
      const outside = await outsider.json(),
        other = {
          cookie: outsider.headers.get('set-cookie')!.split(';')[0],
          csrf: outside.csrf,
          version: outside.version,
        }
      assert.equal((await call(path, 'GET', undefined, other)).status, 403)
      const d = await database(),
        otherUser = await d.users.findOne({
          email: 'automation-other@example.test',
        })
      await d.tenants.updateOne(
        { _id: otherUser!.tenant },
        { $set: { plan: 'business_pro' } },
      )
      const isolated = await send(path, 'GET', undefined, undefined, other)
      assert.equal(isolated.enabled, false)
      assert.deepEqual(isolated.runs, [])
    },
  )
  await t.test(
    'stock automation bounds large runs and processes deferred products on the next run',
    async () => {
      const settings = await send(path)
      const enabled = await send(path, 'PUT', {
        enabled: true,
        version: settings.version,
      })
      for (let index = 0; index < 51; index++) {
        await action({
          type: 'create',
          collection: 'products',
          data: {
            name: `Batch stock ${index}`,
            sku: `AUTO-BATCH-${index}`,
            qty: 0,
            min: 1,
            cost: 1,
          },
        })
      }
      const first = await send(path + '/run', 'POST', {}, randomUUID())
      assert.equal(first.run.created, 50)
      assert.equal(first.run.deferred, 1)
      const second = await send(path + '/run', 'POST', {}, randomUUID())
      assert.equal(second.run.created, 1)
      assert.equal(second.run.deferred, 0)
      const workspace = await send('/workspace')
      const batchTasks = workspace.state.tasks.filter(
        (task: { name: string }) => task.name.includes('AUTO-BATCH-'),
      )
      assert.equal(batchTasks.length, 51)
      await send(path, 'PUT', { enabled: false, version: enabled.version })
    },
  )
  await t.test(
    'scheduled automation authenticates workers, serialises runs, drains backlog and stops after access changes',
    async () => {
      const oldSecret = process.env.CRON_SECRET
      process.env.CRON_SECRET =
        'automation-test-worker-secret-at-least-32-chars'
      const d = await database(),
        user = await d.users.findOne({ email: 'owner@example.test' }),
        tenant = user!.tenant
      async function due() {
        await d.records.updateOne(
          { tenant, kind: 'automation:stock_settings' },
          {
            $set: {
              'data.next_run_at': new Date(Date.now() - 1000).toISOString(),
            },
          },
        )
      }
      async function worker() {
        const response = await call(
          '/internal/automation/run',
          'POST',
          {},
          undefined,
          { Authorization: 'Bearer ' + process.env.CRON_SECRET },
        )
        assert.equal(response.status, 200, await response.clone().text())
        return response.json()
      }
      try {
        assert.equal(
          (await call('/internal/automation/run', 'POST', {})).status,
          401,
        )
        assert.equal(
          (
            await call('/internal/automation/run', 'POST', {}, undefined, {
              Authorization: 'Bearer wrong',
            })
          ).status,
          401,
        )
        assert.equal(
          (
            await call('/internal/automation/run', 'PUT', {}, undefined, {
              Authorization: 'Bearer ' + process.env.CRON_SECRET,
            })
          ).status,
          405,
        )
        const preflight = await call(path, 'OPTIONS')
        assert.equal(preflight.status, 204)
        assert.ok(
          preflight.headers
            .get('Access-Control-Allow-Methods')!
            .split(',')
            .includes('PUT'),
        )
        let config = await send(path)
        await send(path, 'PUT', {
          enabled: true,
          schedule: 'hourly',
          version: config.version,
        })
        for (let index = 0; index < 12; index++)
          await action({
            type: 'create',
            collection: 'products',
            data: {
              name: `Scheduled stock ${index}`,
              sku: `AUTO-SCHEDULE-${index}`,
              qty: 0,
              min: 1,
              cost: 1,
            },
          })
        await due()
        const before = await send('/workspace')
        const [first, simultaneous] = await Promise.all([worker(), worker()])
        assert.equal(first.completed + simultaneous.completed, 1)
        const after = await send('/workspace')
        assert.equal(after.state.tasks.length, before.state.tasks.length + 10)
        assert.deepEqual(after.state.products, before.state.products)
        config = await send(path)
        assert.equal(
          config.runs.filter(
            (run: { mode: string }) => run.mode === 'scheduled_run',
          ).length,
          1,
        )
        assert.equal(config.runs[0].deferred, 2)
        assert.ok(Date.parse(config.nextRunAt) > Date.now())
        assert.ok(Date.parse(config.nextRunAt) <= Date.now() + 65000)
        assert.equal((await worker()).completed, 0)
        await due()
        assert.equal((await worker()).completed, 1)
        config = await send(path)
        assert.equal(config.runs[0].created, 2)
        assert.ok(Date.parse(config.nextRunAt) > Date.now() + 3500000)
        await send('/users', 'POST', {
          name: 'Scheduling operator',
          email: 'scheduling-operator@example.test',
          password: 'TestBusinessOS!2026',
          role: 'operations_manager',
        })
        const loggedIn = await call('/auth/login', 'POST', {
          email: 'scheduling-operator@example.test',
          password: 'TestBusinessOS!2026',
        })
        assert.equal(loggedIn.status, 200)
        const data = await loggedIn.json(),
          operator = {
            cookie: loggedIn.headers.get('set-cookie')!.split(';')[0],
            csrf: data.csrf,
            version: data.version,
          }
        await send(
          path,
          'PUT',
          { enabled: true, schedule: 'daily', version: config.version },
          undefined,
          operator,
        )
        const operatorUser = await d.users.findOne({
          email: 'scheduling-operator@example.test',
        })
        await send('/users/' + operatorUser!.id, 'PATCH', { active: false })
        await due()
        assert.equal((await worker()).blocked, 1)
        config = await send(path)
        assert.equal(config.scheduleStatus, 'blocked')
        assert.equal(config.nextRunAt, null)
        assert.match(config.blockedReason, /account/)
        await send(path, 'PUT', {
          enabled: true,
          schedule: 'daily',
          version: config.version,
        })
        await due()
        await d.tenants.updateOne(
          { _id: tenant },
          { $set: { plan: 'starter' } },
        )
        assert.equal((await worker()).blocked, 1)
        await d.tenants.updateOne(
          { _id: tenant },
          { $set: { plan: 'business_pro' } },
        )
        config = await send(path)
        assert.match(config.blockedReason, /plan/)
        await send(path, 'PUT', {
          enabled: false,
          schedule: 'off',
          version: config.version,
        })
        assert.equal((await worker()).completed, 0)
      } finally {
        await d.tenants.updateOne(
          { _id: tenant },
          { $set: { plan: 'business_pro' } },
        )
        if (oldSecret === undefined) delete process.env.CRON_SECRET
        else process.env.CRON_SECRET = oldSecret
      }
    },
  )
}

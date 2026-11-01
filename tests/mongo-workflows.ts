import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'

type Login = { cookie: string; csrf: string; version: number }
type Call = (
  path: string,
  method?: string,
  data?: unknown,
  auth?: Login,
  extra?: Record<string, string>,
) => Promise<Response>
export async function verifyCompletedWorkflows(
  t: TestContext,
  call: Call,
  owner: Login,
  other: Login,
) {
  const send = async (
    path: string,
    method = 'GET',
    data?: unknown,
    key?: string,
    auth = owner,
  ) => {
    const response = await call(
      path,
      method,
      data,
      auth,
      key ? { 'Idempotency-Key': key } : {},
    )
    assert.ok(
      response.ok,
      `${method} ${path}: ${response.status} ${await response.clone().text()}`,
    )
    return response.json()
  }
  await t.test(
    'warehouse transfer, dispatch, inspection and restock preserve stock and journals exactly once',
    async () => {
      const workspace = await send('/workspace')
      const opening = await send(
        '/actions',
        'POST',
        {
          version: workspace.version,
          action: {
            type: 'create',
            collection: 'products',
            data: {
              name: 'Workflow widget',
              sku: 'FLOW1',
              qty: 20,
              cost: 10,
              min: 1,
            },
          },
        },
        randomUUID(),
      )
      const product = opening.state.products.find(
        (p: { sku: string }) => p.sku === 'FLOW1',
      )
      const place = await send('/warehouse/locations', 'POST', {
        name: 'Dispatch warehouse',
      })
      assert.equal(
        (
          await call(
            '/warehouse/transfers',
            'POST',
            {
              productId: product.id,
              sourceLocationId: null,
              destinationLocationId: place.id,
              quantity: 21,
            },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
      const key = randomUUID(),
        transfer = {
          productId: product.id,
          sourceLocationId: null,
          destinationLocationId: place.id,
          quantity: 15,
        }
      const first = await send('/warehouse/transfers', 'POST', transfer, key)
      assert.equal(
        (await send('/warehouse/transfers', 'POST', transfer, key)).id,
        first.id,
      )
      assert.equal(
        (
          await call(
            '/warehouse/transfers',
            'POST',
            { ...transfer, quantity: 1 },
            owner,
            { 'Idempotency-Key': key },
          )
        ).status,
        409,
      )
      const fresh = await send('/workspace')
      assert.equal(
        (
          await call(
            '/actions',
            'POST',
            {
              version: fresh.version,
              action: {
                type: 'stock_adjust',
                data: {
                  product: product.id,
                  expectedQty: 20,
                  delta: -10,
                  reason: 'Cannot consume allocated stock',
                },
              },
            },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
      let shipment = await send(
        '/warehouse/shipments',
        'POST',
        {
          orderRef: 'FLOW-SO-1',
          customer: 'Workflow customer',
          productId: product.id,
          quantity: 4,
          sourceLocationId: place.id,
        },
        randomUUID(),
      )
      assert.equal(
        (
          await call(
            '/warehouse/shipments/' + shipment.id,
            'PATCH',
            { version: 1, status: 'dispatched' },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
      shipment = await send(
        '/warehouse/shipments/' + shipment.id,
        'PATCH',
        { version: shipment.version, status: 'packed' },
        randomUUID(),
      )
      const dispatchKey = randomUUID(),
        patch = { version: shipment.version, status: 'dispatched' }
      shipment = await send(
        '/warehouse/shipments/' + shipment.id,
        'PATCH',
        patch,
        dispatchKey,
      )
      assert.equal(
        (
          await send(
            '/warehouse/shipments/' + shipment.id,
            'PATCH',
            patch,
            dispatchKey,
          )
        ).stock_movement_id,
        shipment.stock_movement_id,
      )
      assert.equal(
        (
          await call(
            '/warehouse/shipments/' + shipment.id,
            'GET',
            undefined,
            other,
          )
        ).status,
        404,
      )
      assert.equal(
        (
          await call(
            '/warehouse/shipment-returns',
            'POST',
            { shipmentId: shipment.id, quantity: 5, reason: 'Too many' },
            owner,
            { 'Idempotency-Key': randomUUID() },
          )
        ).status,
        409,
      )
      let returned = await send(
        '/warehouse/shipment-returns',
        'POST',
        {
          shipmentId: shipment.id,
          quantity: 2,
          reason: 'Sealed goods',
          destinationLocationId: place.id,
        },
        randomUUID(),
      )
      returned = await send(
        '/warehouse/shipment-returns/' + returned.id,
        'PATCH',
        {
          version: returned.version,
          status: 'inspected',
          condition: 'restockable',
          inspectionNotes: 'Seals intact',
        },
        randomUUID(),
      )
      const restockKey = randomUUID(),
        restock = { version: returned.version, status: 'restocked' }
      returned = await send(
        '/warehouse/shipment-returns/' + returned.id,
        'PATCH',
        restock,
        restockKey,
      )
      assert.equal(
        (
          await send(
            '/warehouse/shipment-returns/' + returned.id,
            'PATCH',
            restock,
            restockKey,
          )
        ).stock_movement_id,
        returned.stock_movement_id,
      )
      const final = await send('/workspace')
      assert.equal(
        final.state.products.find((p: { id: string }) => p.id === product.id)
          .qty,
        18,
      )
      assert.equal(
        final.state.journals.filter(
          (j: { source: string }) => j.source === shipment.stock_movement_id,
        ).length,
        1,
      )
      assert.equal(
        final.state.journals.filter(
          (j: { source: string }) => j.source === returned.stock_movement_id,
        ).length,
        1,
      )
      const balances = await send('/warehouse/stock')
      assert.equal(
        balances.stock.find(
          (b: { product_id: string }) => b.product_id === product.id,
        ).quantity,
        13,
      )
    },
  )
  await t.test(
    'suppliers, RFQ quotes and budgets validate status transitions and stale versions',
    async () => {
      const supplier = await send('/suppliers', 'POST', {
        name: 'Workflow supplier',
        contact: 'purchasing@example.test',
        leadDays: 0,
      })
      assert.equal(supplier.lead_days, 0)
      await send('/suppliers/' + supplier.id, 'PATCH', { status: 'review' })
      let rfq = await send('/rfq', 'POST', {
        supplierName: supplier.name,
        productDescription: 'Widgets',
        quantity: 2,
      })
      assert.equal(
        (
          await call(
            '/rfq/' + rfq.id,
            'PATCH',
            { version: rfq.version, status: 'quoted' },
            owner,
          )
        ).status,
        400,
      )
      rfq = await send('/rfq/' + rfq.id, 'PATCH', {
        version: rfq.version,
        status: 'quoted',
        quotedAmount: 100,
      })
      rfq = await send('/rfq/' + rfq.id, 'PATCH', {
        version: rfq.version,
        status: 'accepted',
      })
      assert.equal(rfq.quoted_amount, 100)
      const budget = await send('/budgets', 'POST', {
        name: 'Operations',
        periodFrom: '2026-01-01',
        periodTo: '2026-12-31',
        totalAmount: 500,
      })
      await send('/budgets/' + budget.id, 'PATCH', {
        version: budget.version,
        status: 'closed',
      })
      assert.equal(
        (
          await call(
            '/budgets/' + budget.id,
            'PATCH',
            { version: budget.version, status: 'closed' },
            owner,
          )
        ).status,
        409,
      )
      assert.equal(
        (await send('/suppliers', 'GET', undefined, undefined, other)).suppliers
          .length,
        0,
      )
    },
  )
  await t.test(
    'announcements have per-user read receipts; chat survives a new session read',
    async () => {
      const announcement = await send('/notifications', 'POST', {
        title: 'Workflow announcement',
        body: 'Stock count today',
      })
      assert.ok(
        (await send('/notifications?unread=true')).notifications.some(
          (row: { id: string }) => row.id === announcement.id,
        ),
      )
      await send('/notifications/' + announcement.id + '/read', 'PATCH', {})
      assert.ok(
        !(await send('/notifications?unread=true')).notifications.some(
          (row: { id: string }) => row.id === announcement.id,
        ),
      )
      assert.ok(
        (await send('/notifications')).notifications.some(
          (row: { id: string }) => row.id === announcement.id,
        ),
      )
      const message = await send('/workspace/chat', 'POST', {
        body: 'Workflow message',
      })
      assert.ok(
        (await send('/workspace/chat')).messages.some(
          (row: { id: string }) => row.id === message.id,
        ),
      )
      assert.equal(
        (await send('/workspace/chat', 'GET', undefined, undefined, other))
          .messages.length,
        0,
      )
    },
  )
  await t.test(
    'hiring requires sequential stages and onboarding creates one employee',
    async () => {
      let candidate = await send('/hr/candidates', 'POST', {
        name: 'Workflow hire',
        email: 'workflow-hire@example.test',
        position: 'Stock controller',
      })
      assert.equal(
        (
          await call(
            '/hr/candidates/' + candidate.id + '/onboard',
            'POST',
            { department: 'Operations', monthlyCompensation: 1000 },
            owner,
          )
        ).status,
        409,
      )
      for (const status of ['screening', 'interview', 'offer', 'hired'])
        candidate = await send('/hr/candidates/' + candidate.id, 'PATCH', {
          version: candidate.version,
          status,
        })
      const onboard = await send(
        '/hr/candidates/' + candidate.id + '/onboard',
        'POST',
        { department: 'Operations', monthlyCompensation: 1000 },
      )
      assert.equal(
        (
          await send('/hr/candidates/' + candidate.id + '/onboard', 'POST', {
            department: 'Operations',
            monthlyCompensation: 1000,
          })
        ).employeeId,
        onboard.employeeId,
      )
      assert.equal(
        (await send('/workspace')).state.employees.filter(
          (e: { id: string }) => e.id === onboard.employeeId,
        ).length,
        1,
      )
    },
  )
  await t.test(
    'document binaries, revisions, sharing, comments and archival use real persisted content',
    async () => {
      const content = Buffer.from('Original workflow document'),
        input = {
          filename: 'workflow.txt',
          mimeType: 'text/plain',
          sizeBytes: content.length,
          contentBase64: content.toString('base64'),
        }
      const doc = await send('/documents', 'POST', input)
      assert.equal(
        await (
          await call(
            '/documents/' + doc.id + '/content',
            'GET',
            undefined,
            owner,
          )
        ).text(),
        content.toString(),
      )
      assert.equal(
        (
          await call(
            '/documents/' + doc.id + '/content',
            'GET',
            undefined,
            other,
          )
        ).status,
        404,
      )
      const share = await send('/documents/' + doc.id + '/shares', 'POST', {
        expiresHours: 1,
      })
      assert.equal(
        await (await call('/shared-documents/' + share.token)).text(),
        content.toString(),
      )
      await send('/documents/' + doc.id + '/comments', 'POST', {
        body: 'Review complete',
      })
      assert.equal(
        (await send('/documents/' + doc.id + '/comments')).comments.length,
        1,
      )
      const replacement = Buffer.from('Replacement')
      await send('/documents/' + doc.id + '/versions', 'POST', {
        ...input,
        sizeBytes: replacement.length,
        contentBase64: replacement.toString('base64'),
      })
      const versions = (await send('/documents/' + doc.id + '/versions'))
        .versions
      assert.equal(versions.length, 2)
      assert.ok(!JSON.stringify(versions).includes('content_base64'))
      assert.equal(
        await (await call('/shared-documents/' + share.token)).text(),
        content.toString(),
      )
      await send('/documents/' + doc.id, 'PATCH', { status: 'archived' })
      assert.equal((await call('/shared-documents/' + share.token)).status, 404)
    },
  )
  await t.test(
    'support feedback requires resolution and cannot be counted twice',
    async () => {
      const ticket = await send('/support/tickets', 'POST', {
        subject: 'Damaged widget',
        customer: 'Workflow customer',
        priority: 'high',
      })
      const feedback = { csat: 5, nps: 10, comment: 'Solved' }
      assert.equal(
        (
          await call(
            '/support/tickets/' + ticket.id + '/feedback',
            'POST',
            feedback,
            owner,
          )
        ).status,
        409,
      )
      await send('/support/tickets/' + ticket.id, 'PATCH', {
        status: 'resolved',
      })
      await send(
        '/support/tickets/' + ticket.id + '/feedback',
        'POST',
        feedback,
      )
      assert.equal(
        (
          await call(
            '/support/tickets/' + ticket.id + '/feedback',
            'POST',
            feedback,
            owner,
          )
        ).status,
        409,
      )
      const metrics = (await send('/support/feedback/metrics')).metrics
      assert.equal(metrics.responses, 1)
      assert.equal(metrics.nps_score, 100)
    },
  )
}

import type { ClientSession } from 'mongodb'
import { database } from './database'
import { fail } from './security'
import { expose, insertRecord, updateRecord } from './records'
import { readWorkspace, saveWorkspace } from './workspace'
import { transition } from '../../src/domain'

export async function runStockReview(
  tenant: string,
  actor: string,
  session: ClientSession,
  mode: 'manual_run' | 'scheduled_run' = 'manual_run',
  limit = 50,
) {
  const d = await database()
  const settings = await d.records.findOne(
    { tenant, kind: 'automation:stock_settings' },
    { session },
  )
  if (settings?.data.enabled !== true)
    fail(409, 'Enable low-stock task automation before running it.')
  const current = await readWorkspace(tenant, session)
  const plan = await d.plans.findOne({ _id: current.plan }, { session })
  if (
    !plan?.features.includes('operations') ||
    !plan.features.includes('automation')
  )
    fail(
      403,
      'Inventory task automation requires automation and operations access.',
    )
  const low = current.state.products.filter(
    (product) => product.qty < product.min,
  )
  const links = await d.records
    .find({ tenant, kind: 'automation:stock_task' }, { session })
    .toArray()
  const byProduct = new Map(
    links.map((row) => [String(row.data.product_id), row]),
  )
  let next = current.state,
    skipped = 0,
    deferred = 0
  const taskIds: string[] = []
  for (const product of low) {
    const link = byProduct.get(product.id)
    if (
      link &&
      next.tasks.some(
        (task) => task.id === link.data.task_id && task.status === 'Open',
      )
    ) {
      skipped++
      continue
    }
    if (taskIds.length >= limit) {
      deferred++
      continue
    }
    next = transition(next, {
      type: 'create',
      collection: 'tasks',
      data: {
        name: `Review low stock: ${product.sku} — ${product.name}`.slice(
          0,
          200,
        ),
      },
      actor,
    })
    const taskId = next.tasks[0].id
    taskIds.push(taskId)
    const data = {
      product_id: product.id,
      task_id: taskId,
      observed_qty: product.qty,
      reorder_level: product.min,
    }
    if (link) await updateRecord(link, data, session)
    else await insertRecord(tenant, 'automation:stock_task', data, session)
  }
  if (taskIds.length) await saveWorkspace(current, next, session)
  const row = await insertRecord(
    tenant,
    'automation:stock_run',
    {
      matched: low.length,
      created: taskIds.length,
      skipped,
      deferred,
      task_ids: taskIds,
      actor,
      mode,
    },
    session,
  )
  return expose<{ id: string; deferred: number; created: number }>(row)
}

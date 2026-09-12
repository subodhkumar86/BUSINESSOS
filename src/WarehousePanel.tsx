import { ReturnsPanel } from './ReturnsPanel'
import { ShipmentsPanel } from './ShipmentsPanel'
import { useEffect, useState } from 'react'
import { request } from './api'
import { WarehouseTransfers } from './WarehouseTransfers'
import type { Snapshot } from './types'

type FulfillmentStatus = 'picking' | 'packed' | 'dispatched'
type ReturnCondition = 'inspecting' | 'restockable' | 'damaged' | 'salvage'
type ReturnResolution = 'pending' | 'restocked' | 'refunded' | 'exchanged'
interface Stored { id: string; name: string; detail: string; status: string; metadata: Record<string, unknown>; updated_at: string }
interface Fulfillment { id: string; orderRef: string; customer: string; items: string; location: string; assignee: string; status: FulfillmentStatus; updatedAt: string }
interface Return { id: string; rma: string; customer: string; product: string; condition: ReturnCondition; resolution: ReturnResolution; updatedAt: string }
const asFulfillment = (row: Stored): Fulfillment | null => row.metadata.kind === 'fulfillment' ? { id: row.id, orderRef: row.name, customer: String(row.metadata.customer || 'Not specified'), items: row.detail, location: String(row.metadata.location || 'Not specified'), assignee: String(row.metadata.assignee || 'Unassigned'), status: row.status as FulfillmentStatus, updatedAt: row.updated_at } : null
const asReturn = (row: Stored): Return | null => row.metadata.kind === 'return' ? { id: row.id, rma: row.name, customer: String(row.metadata.customer || 'Not specified'), product: row.detail, condition: row.metadata.condition as ReturnCondition, resolution: row.status as ReturnResolution, updatedAt: row.updated_at } : null
const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function WarehousePanel({ remote, onRefresh }: { remote: Snapshot | null; onRefresh:()=>Promise<void> }) {
  const [tab, setTab] = useState<'shipments' | 'transfers' | 'fulfillment' | 'returns' | 'shipment_returns'>('shipments')
  const [fulfillments, setFulfillments] = useState<Fulfillment[]>([]), [returns, setReturns] = useState<Return[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const editable = !remote || remote.user.role !== 'auditor'
  const headers: Record<string, string> = remote ? { 'X-CSRF-Token': remote.csrf } : {}
  async function load() {
    if (!remote) return
    try { const [fulfillmentData, returnData] = await Promise.all([request<{ records: Stored[] }>('/warehouse/fulfillments'), request<{ records: Stored[] }>('/warehouse/returns')]); setFulfillments(fulfillmentData.records.map(asFulfillment).filter((item): item is Fulfillment => Boolean(item))); setReturns(returnData.records.map(asReturn).filter((item): item is Return => Boolean(item))) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load warehouse records.') }
  }
  useEffect(() => { void load() }, [remote])
  async function create(event: React.FormEvent, kind: 'fulfillment' | 'return') {
    event.preventDefault(); if (!editable) return
    const formElement = event.currentTarget as HTMLFormElement
    const form = new FormData(formElement)
    const name = String(form.get(kind === 'fulfillment' ? 'orderRef' : 'rma') || '').trim(), detail = String(form.get(kind === 'fulfillment' ? 'items' : 'product') || '').trim()
    if (!name || !detail) return setError('Complete the required fields.')
    const payload = kind === 'fulfillment' ? { orderRef: name, customer: String(form.get('customer') || '').trim(), items: detail, location: String(form.get('location') || '').trim(), assignee: String(form.get('assignee') || '').trim() } : { rma: name, customer: String(form.get('customer') || '').trim(), product: detail, condition: String(form.get('condition') || 'inspecting') }
    setBusy(true); setError('')
    try {
      if (remote) await request('/warehouse/' + (kind === 'fulfillment' ? 'fulfillments' : 'returns'), { method: 'POST', headers, body: JSON.stringify(payload) })
      await load(); formElement.reset(); setNotice(kind === 'fulfillment' ? 'Fulfillment queue item created.' : 'Return inspection created.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save warehouse record.') } finally { setBusy(false) }
  }
  async function update(id: string, status: string, kind: 'fulfillment' | 'return') {
    setError('')
    try { if (remote) await request('/warehouse/' + (kind === 'fulfillment' ? 'fulfillments/' : 'returns/') + id, { method: 'PATCH', headers, body: JSON.stringify({ status }) }); await load(); setNotice('Warehouse status updated.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update warehouse record.') }
  }
  return <div className="module-panel">
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}><button className={tab === 'shipments' ? 'primary' : ''} onClick={() => setTab('shipments')}>Shipments</button><button className={tab === 'transfers' ? 'primary' : ''} onClick={() => setTab('transfers')}>Stock transfers</button><button className={tab === 'fulfillment' ? 'primary' : ''} onClick={() => setTab('fulfillment')}>Legacy tracking ({fulfillments.filter(item => item.status !== 'dispatched').length} open)</button><button className={tab === 'shipment_returns' ? 'primary' : ''} onClick={() => setTab('shipment_returns')}>Returns &amp; inspection</button><button className={tab === 'returns' ? 'primary' : ''} onClick={() => setTab('returns')}>Previous return records ({returns.filter(item => item.resolution === 'pending').length} pending)</button></div>
    {notice && <p role="status" className="notice success">{notice}</p>}{error && <p role="alert" className="notice error">{error}</p>}
    {tab === 'shipment_returns' && <ReturnsPanel remote={remote} onRefresh={onRefresh} />}
    {tab === 'shipments' && <ShipmentsPanel remote={remote} onRefresh={onRefresh} />}
    {tab === 'transfers' && <WarehouseTransfers remote={remote} />}
    {tab === 'fulfillment' && <><section className="card"><h2>Legacy fulfillment tracking</h2><p className="muted">Dispatch tracking is operational only. Use the inventory workflow for stock and cost-of-goods postings.</p>{editable && <form className="inline-form" onSubmit={event => void create(event, 'fulfillment')}><input name="orderRef" required placeholder="Sales order reference" maxLength={120} /><input name="customer" placeholder="Customer" maxLength={160} /><input name="items" required placeholder="Items and quantities" maxLength={500} /><input name="location" placeholder="Warehouse" maxLength={160} /><input name="assignee" placeholder="Assigned operator" maxLength={160} /><button className="primary" disabled={busy}>Add fulfillment</button></form>}</section><section className="card"><div className="table-scroll"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Location</th><th>Stage</th><th>Updated</th><th>Action</th></tr></thead><tbody>{fulfillments.length ? fulfillments.map(item => <tr key={item.id}><td><b>{item.orderRef}</b></td><td>{item.customer}</td><td>{item.items}</td><td>{item.location}</td><td><span className={item.status === 'dispatched' ? 'badge green' : 'badge'}>{item.status}</span></td><td><small>{dateLabel(item.updatedAt)}</small></td><td>{editable && item.status !== 'dispatched' ? <button type="button" onClick={() => void update(item.id, item.status === 'picking' ? 'packed' : 'dispatched', 'fulfillment')}>{item.status === 'picking' ? 'Mark packed' : 'Mark dispatched'}</button> : <small>{item.status === 'dispatched' ? 'Completed' : 'Read-only'}</small>}</td></tr>) : <tr><td colSpan={7}>No fulfillment queue items.</td></tr>}</tbody></table></div></section></>}
    {tab === 'returns' && <><section className="card"><h2>Returns and inspection</h2><p className="muted">A restock or refund decision is recorded here; stock and payment entries require their dedicated controlled workflows.</p>{editable && <form className="inline-form" onSubmit={event => void create(event, 'return')}><input name="rma" required placeholder="RMA reference" maxLength={120} /><input name="customer" placeholder="Customer" maxLength={160} /><input name="product" required placeholder="Returned product" maxLength={500} /><select name="condition"><option value="inspecting">Inspecting</option><option value="restockable">Restockable</option><option value="damaged">Damaged</option><option value="salvage">Salvage</option></select><button className="primary" disabled={busy}>Register return</button></form>}</section><section className="card"><div className="table-scroll"><table><thead><tr><th>RMA</th><th>Customer</th><th>Product</th><th>Condition</th><th>Resolution</th><th>Updated</th><th>Action</th></tr></thead><tbody>{returns.length ? returns.map(item => <tr key={item.id}><td><b>{item.rma}</b></td><td>{item.customer}</td><td>{item.product}</td><td><span className="badge">{item.condition}</span></td><td><span className={item.resolution === 'pending' ? 'badge' : 'badge green'}>{item.resolution}</span></td><td><small>{dateLabel(item.updatedAt)}</small></td><td>{editable && item.resolution === 'pending' ? <><button type="button" onClick={() => void update(item.id, 'restocked', 'return')}>Restock</button><button type="button" onClick={() => void update(item.id, 'refunded', 'return')}>Refund</button></> : <small>{item.resolution === 'pending' ? 'Read-only' : 'Recorded'}</small>}</td></tr>) : <tr><td colSpan={7}>No returns awaiting inspection.</td></tr>}</tbody></table></div></section></>}
  </div>
}

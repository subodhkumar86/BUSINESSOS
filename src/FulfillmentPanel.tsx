import { useMemo, useState } from 'react'
import type { Action, State } from './types'

export function FulfillmentPanel({ state, busy, readOnly, onCommit }: { state: State; busy: boolean; readOnly: boolean; onCommit: (action: Action) => Promise<boolean> }) {
  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reference, setReference] = useState('')
  const product = useMemo(() => state.products.find(item => item.id === productId), [state.products, productId])
  const amount = Number(quantity)
  const valid = !!product && Number.isInteger(amount) && amount > 0 && amount <= product.qty && reference.trim().length >= 3

  return <section className="card fulfillment-card">
    <div className="section-top"><div><h2>Fulfill a customer order</h2><p>Dispatch inventory with a single traceable record. BusinessOS reduces stock and posts cost of goods sold automatically.</p></div></div>
    <form onSubmit={async event => { event.preventDefault(); if (!product || !valid) return; const saved = await onCommit({ type: 'stock_fulfill', data: { product: product.id, quantity: amount, expectedQty: product.qty, reference: reference.trim() } }); if (saved) { setProductId(''); setQuantity(''); setReference('') } }}>
      <fieldset className="stock-form" disabled={busy || readOnly}>
        <label>Product<select required value={productId} onChange={event => setProductId(event.target.value)}><option value="">Select a product</option>{state.products.map(item => <option key={item.id} value={item.id}>{item.name} · {item.sku} ({item.qty} available)</option>)}</select></label>
        <label>Quantity dispatched<input required type="number" min="1" step="1" max="100000000" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <label>Customer order reference<input required minLength={3} maxLength={200} value={reference} placeholder="For example: SO-1042" onChange={event => setReference(event.target.value)} /></label>
        <div className="stock-preview"><span>Available now <b>{product?.qty ?? '—'}</b></span><span>After dispatch <b>{product && quantity ? Math.max(0, product.qty - amount) : '—'}</b></span><span>COGS posting <b>{product && Number.isFinite(amount) ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: state.currency, maximumFractionDigits: 2 }).format(amount * product.cost) : '—'}</b></span></div>
        <button className="primary" disabled={!valid}>{busy ? 'Saving...' : 'Dispatch and post COGS'}</button>
      </fieldset>
    </form>
  </section>
}

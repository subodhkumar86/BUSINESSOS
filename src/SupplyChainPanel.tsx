import { useState } from 'react'
import type { Snapshot } from './types'

interface Shipment {
  id: string
  poRef: string
  supplier: string
  carrier: string
  trackingCode: string
  destination: string
  eta: string
  status: 'booked' | 'in_transit' | 'customs_cleared' | 'delivered'
  logisticsCost: number
}

const initialShipments: Shipment[] = [
  {
    id: 'shp-1',
    poRef: 'PO-2026-081',
    supplier: 'Kora Imports Ltd',
    carrier: 'DHL Global Forwarding',
    trackingCode: 'DHL-NG-8891024',
    destination: 'Lagos Main Hub',
    eta: 'In 3 days (11 Sep)',
    status: 'in_transit',
    logisticsCost: 180000,
  },
  {
    id: 'shp-2',
    poRef: 'PO-2026-084',
    supplier: 'TechHub Hardware Dist.',
    carrier: 'GIG Logistics Express',
    trackingCode: 'GIG-9910412',
    destination: 'Abuja Distribution Hub',
    eta: 'Tomorrow (9 Sep)',
    status: 'customs_cleared',
    logisticsCost: 95000,
  },
  {
    id: 'shp-3',
    poRef: 'PO-2026-079',
    supplier: 'Brightline Displays',
    carrier: 'Maersk Logistics',
    trackingCode: 'MSK-771802',
    destination: 'Lagos Main Hub',
    eta: 'Delivered',
    status: 'delivered',
    logisticsCost: 340000,
  },
]

export function SupplyChainPanel({ remote }: { remote: Snapshot | null }) {
  const [shipments, setShipments] = useState<Shipment[]>(() => remote ? [] : initialShipments)
  const [notice, setNotice] = useState('')

  const editable = !remote

  function handleAdvanceShipment(id: string) {
    if (!editable) return
    setShipments((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        const nextStatus =
          s.status === 'booked'
            ? 'in_transit'
            : s.status === 'in_transit'
              ? 'customs_cleared'
              : 'delivered'
        return {
          ...s,
          status: nextStatus,
          eta: nextStatus === 'delivered' ? 'Delivered' : s.eta,
        }
      }),
    )
    setNotice('Demo milestone updated for this session. No stock movement was posted.')
  }

  return (
    <div className="module-panel">
      <p className="notice">{remote ? 'Inbound carrier tracking is not configured. Receive purchase orders through Purchasing and manage stock through Warehouse Management.' : 'Sample planning board. Changes last for this session only.'}</p>
      {/* Metrics derive from the current planning board. */}
      <div className="stats-row">
        <div className="stat-card">
          <span className="stat-label">Inbound Shipments</span>
          <b className="stat-value">{shipments.filter((s) => s.status !== 'delivered').length}</b>
          <small>Active freight consignments</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Freight Committed</span>
          <b className="stat-value">
            ₦{shipments.reduce((acc, s) => acc + s.logisticsCost, 0).toLocaleString()}
          </b>
          <small>Carrier logistics expense</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Customs cleared</span>
          <b className="stat-value">{shipments.filter((s) => s.status === 'customs_cleared').length}</b>
          <small>Awaiting warehouse delivery</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Delivered</span>
          <b className="stat-value">{shipments.filter((s) => s.status === 'delivered').length}</b>
          <small>Marked complete on this board</small>
        </div>
      </div>

      {notice && <p role="status" className="notice success">{notice}</p>}

      {/* Inbound Shipment Tracking Table */}
      <section className="card">
        <div className="section-header">
          <h2>Inbound shipment planning</h2>
          <small>Record internal milestone updates for purchase-order transit, clearance and warehouse delivery.</small>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PO Reference</th>
                <th>Supplier</th>
                <th>Logistics Carrier</th>
                <th>Tracking Code</th>
                <th>Destination Hub</th>
                <th>ETA</th>
                <th>Freight Cost</th>
                <th>Milestone Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!shipments.length && <tr><td colSpan={9}>No connected inbound shipments. Carrier tracking is not configured.</td></tr>}
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.poRef}</b></td>
                  <td>{s.supplier}</td>
                  <td>{s.carrier}</td>
                  <td><code>{s.trackingCode}</code></td>
                  <td>{s.destination}</td>
                  <td>{s.eta}</td>
                  <td>₦{s.logisticsCost.toLocaleString()}</td>
                  <td>
                    <span className={s.status === 'delivered' ? 'badge green' : 'badge'}>
                      {s.status.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td>
                    {s.status !== 'delivered' && editable ? (
                      <button
                        type="button"
                        onClick={() => handleAdvanceShipment(s.id)}
                      >
                        Advance Milestone →
                      </button>
                    ) : (
                      <small style={{ color: '#16a34a', fontWeight: 600 }}>Dock Receipt Complete</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card supply-chain-guidance">
        <span className="eyebrow">Operational handoff</span>
        <h2>Use the connected warehouse workflow for stock movement.</h2>
        <p>When inbound goods arrive, receive the approved purchase order and use Warehouse Management for location allocation and stock transfers. Carrier sync, automated ETA calculation and allocation analytics require a configured provider integration.</p>
      </section>
    </div>
  )
}

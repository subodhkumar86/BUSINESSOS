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
  const [shipments, setShipments] = useState<Shipment[]>(initialShipments)
  const [notice, setNotice] = useState('')

  const editable = !remote || remote.user.role !== 'auditor'

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
    setNotice('Shipment transit milestone updated.')
  }

  return (
    <div className="module-panel">
      {/* Telemetry Row */}
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
          <span className="stat-label">On-Time Transit Rate</span>
          <b className="stat-value" style={{ color: '#16a34a' }}>93.8%</b>
          <small>Arrival within lead-time buffer</small>
        </div>
        <div className="stat-card">
          <span className="stat-label">Stockout Hazard Coverage</span>
          <b className="stat-value">18.4 days</b>
          <small>Average buffer cover across hubs</small>
        </div>
      </div>

      {notice && <p role="status" className="notice success">{notice}</p>}

      {/* Inbound Shipment Tracking Table */}
      <section className="card">
        <div className="section-header">
          <h2>Inbound Shipment & Carrier Tracking</h2>
          <small>Real-time purchase order transit, customs clearance, and warehouse dock delivery.</small>
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

      {/* Supply Chain Intelligence & Lead-Time Monitoring */}
      <div className="two-col" style={{ marginTop: '16px' }}>
        <section className="card">
          <h2>Supplier Lead Time Reliability Watchlist</h2>
          <div className="telemetry-list">
            <div className="telemetry-item">
              <div>
                <b>Docking Stations · Kora Imports</b>
                <small style={{ display: 'block', color: 'var(--text-muted)' }}>Target: 14 days · Actual avg: 13.2 days</small>
              </div>
              <span className="badge green">On Track</span>
            </div>
            <div className="telemetry-item">
              <div>
                <b>Office Monitors · Brightline Displays</b>
                <small style={{ display: 'block', color: 'var(--text-muted)' }}>Target: 21 days · Actual avg: 26.8 days</small>
              </div>
              <span className="badge" style={{ background: '#fef3c7', color: '#b45309' }}>+5.8d Delay</span>
            </div>
            <div className="telemetry-item">
              <div>
                <b>Wireless Keyboards · TechHub Dist.</b>
                <small style={{ display: 'block', color: 'var(--text-muted)' }}>Target: 7 days · Actual avg: 6.9 days</small>
              </div>
              <span className="badge green">Reliable</span>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Multi-Warehouse Inventory Allocation</h2>
          <div className="telemetry-list">
            <div className="telemetry-item">
              <span>Lagos Main Hub (Central Storage)</span>
              <b>68% total inventory volume</b>
            </div>
            <div className="telemetry-item">
              <span>Abuja Distribution Hub (Northern Hub)</span>
              <b>24% total inventory volume</b>
            </div>
            <div className="telemetry-item">
              <span>Port Harcourt Depot (South-South)</span>
              <b>8% total inventory volume</b>
            </div>
            <div className="telemetry-item">
              <span>Inter-Hub Rebalancing Status</span>
              <b style={{ color: '#16a34a' }}>Balanced (No transfer bottlenecks)</b>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

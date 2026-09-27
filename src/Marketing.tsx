import { useEffect, useState, type ReactNode } from 'react'
import { useTheme } from './theme'

const featureIcons: Record<string, ReactNode> = {
  'Finance & Banking': (
    <><path d="M3 10 12 4l9 6" /><path d="M5 10v8m4-8v8m6-8v8m4-8v8M3 20h18" /></>
  ),
  'Inventory & Purchasing': (
    <><path d="m4 7 8-4 8 4-8 4-8-4Z" /><path d="M4 7v10l8 4 8-4V7" /><path d="M12 11v10" /></>
  ),
  'HR & Payroll': (
    <><circle cx="12" cy="8" r="3.2" /><path d="M5 20c.7-3.6 3-5.5 7-5.5s6.3 1.9 7 5.5" /></>
  ),
  'Sales & CRM': (
    <><path d="M4 17 10 11l3 3 7-7" /><path d="M15 7h5v5" /></>
  ),
  'Projects & Tasks': (
    <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5L16 9.5" /></>
  ),
  Documents: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
  Operations: (
    <><circle cx="12" cy="12" r="3" /><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" /></>
  ),
  'BI & AI': (
    <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" /><path d="M18.5 16.5 19 18l1.5.5L19 19l-.5 1.5L18 19l-1.5-.5L18 18l.5-1.5Z" /></>
  ),
}

const planIcons: Record<string, ReactNode> = {
  Starter: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h5" /></>,
  Business: <><path d="M4 7h16v13H4z" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /></>,
  'Business Pro': <><path d="M12 3 19 6.5v5c0 4-3 7-7 8.5-4-1.5-7-4.5-7-8.5v-5L12 3Z" /><path d="m9 12 2 2 4-4" /></>,
  Enterprise: <><path d="M4 21V6l8-3 8 3v15" /><path d="M9 21v-5h6v5M8 9h.01M12 9h.01M16 9h.01" /></>,
}

const securityIcons: Record<string, ReactNode> = {
  'Tenant isolation': <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  'Roles and permissions': <><circle cx="8" cy="9" r="3" /><path d="M3 19c.6-3 2.5-4.5 5-4.5s4.4 1.5 5 4.5" /><path d="M16 8h5M16 12h5M16 16h3" /></>,
  'Financial audit trails': <><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h4" /></>,
  'Decision support': <><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 15v-4M12 15V8M16 15v-6" /></>,
}

function CardIcon({ icon }: { icon?: ReactNode }) {
  if (!icon) return null
  return (
    <span className="card-icon" aria-hidden="true">
      <svg
        className="feature-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {icon}
      </svg>
    </span>
  )
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 13 4 4 10-10" />
    </svg>
  )
}

const capabilities = [
  'Role-based access',
  'Full audit trails',
  'Financial statements',
  'Payroll & pensions',
  'Inventory tracking',
  'Document versions',
]

const features = [
  [
    'Finance & Banking',
    'Invoices, expenses, posted journals, financial statements and statement reconciliation.',
  ],
  [
    'Inventory & Purchasing',
    'Products, stock movements, purchase approvals, receiving and warehouse transfers.',
  ],
  [
    'HR & Payroll',
    'Employee records, applicant tracking, payroll calculations, approvals and payslips.',
  ],
  [
    'Sales & CRM',
    'Customers, interactions, opportunities and campaign records.',
  ],
  ['Projects & Tasks', 'Project budgets, progress and task records.'],
  [
    'Documents',
    'Document storage, versions, comments and expiring share links.',
  ],
  [
    'Operations',
    'Supplier, asset, facility, production, visitor and support records.',
  ],
  [
    'BI & AI',
    'Calculated metrics, forecasts, source references and scenario analysis.',
  ],
]
const plans = [
  ['Starter', 'Core finance, CRM, inventory, documents and dashboards.'],
  [
    'Business',
    'HR/payroll, procurement, projects, warehouse and advanced reports.',
  ],
  [
    'Business Pro',
    'Multi-branch, automation, AI forecasting and advanced permissions.',
  ],
  [
    'Enterprise',
    'Custom organisational requirements, integrations and support.',
  ],
]
type Page = 'home' | 'features' | 'pricing' | 'security'
function pageFor(path: string): Page {
  const page = path.replace(/^\//, '')
  return page === 'features' || page === 'pricing' || page === 'security'
    ? page
    : 'home'
}

function DashboardPreview({ onLaunch }: { onLaunch: () => void }) {
  const [tab, setTab] = useState<'overview' | 'finance' | 'inventory' | 'ai'>('overview')

  return (
    <div className="preview-showcase animate-in delay-3">
      <div className="preview-window">
        <div className="preview-titlebar">
          <div className="preview-dots">
            <span className="dot dot-red" />
            <span className="dot dot-amber" />
            <span className="dot dot-green" />
          </div>
          <div className="preview-title">
            <span className="preview-badge">LIVE PLATFORM PREVIEW</span>
            <span>BusinessOS Enterprise Platform · Demo Sandbox</span>
          </div>
          <div className="preview-actions">
            <button className="primary" style={{ minHeight: '1.9rem', fontSize: '0.74rem', padding: '0.2rem 0.75rem' }} onClick={onLaunch}>
              Launch Real Workspace ↗
            </button>
          </div>
        </div>

        <div className="preview-tabs">
          {[
            { id: 'overview', label: 'Operating Pulse', icon: '◫' },
            { id: 'finance', label: 'Finance & Bank Feeds', icon: '₦' },
            { id: 'inventory', label: 'Inventory & Reorders', icon: '▦' },
            { id: 'ai', label: 'BI & AI Intelligence', icon: '✧' },
          ].map((t) => (
            <button
              key={t.id}
              className={`preview-tab-btn ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id as any)}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        <div className="preview-content">
          {tab === 'overview' && (
            <div className="preview-grid">
              <div className="preview-kpi-card">
                <span className="kpi-label">Available Cash (GL 1010)</span>
                <span className="kpi-val">₦14,850,000</span>
                <span className="kpi-sub green">+18.4% vs last month</span>
              </div>
              <div className="preview-kpi-card">
                <span className="kpi-label">Open Receivables (AR)</span>
                <span className="kpi-val">₦4,200,000</span>
                <span className="kpi-sub">12 pending customer invoices</span>
              </div>
              <div className="preview-kpi-card">
                <span className="kpi-label">Stock Valuation</span>
                <span className="kpi-val">₦9,450,000</span>
                <span className="kpi-sub green">98.2% in healthy band</span>
              </div>
              <div className="preview-kpi-card">
                <span className="kpi-label">Operational Runway</span>
                <span className="kpi-val">7.8 months</span>
                <span className="kpi-sub green">Burn: ₦1.9M/mo</span>
              </div>

              <div className="preview-panel-wide">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <b style={{ fontSize: '0.85rem' }}>Synchronized Enterprise Cashflow & Accruals</b>
                  <span className="badge green">Reconciled to PostgreSQL</span>
                </div>
                <div className="preview-bars">
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      <span>Customer Collections & Settled AR</span>
                      <b>₦18,200,000</b>
                    </div>
                    <div className="track"><span style={{ width: '85%', background: '#10b981' }} /></div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      <span>Gross Payroll Accrual (18 Staff)</span>
                      <b>₦4,650,000</b>
                    </div>
                    <div className="track"><span style={{ width: '32%', background: '#3b82f6' }} /></div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.25rem' }}>
                      <span>Supplier POs & Operational Expenses</span>
                      <b>₦3,800,000</b>
                    </div>
                    <div className="track"><span style={{ width: '28%', background: '#f59e0b' }} /></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'finance' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Bank Statement Feed Reconciliation</h3>
                  <small>Automated matching against accounts receivable & expense vouchers</small>
                </div>
                <span className="badge green">Live Sync: 99.4% Matched</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Reference</th><th>Entity</th><th>Amount</th><th>Status</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><b>TXN-2026-089</b><br/><small>Access Bank Feed</small></td>
                      <td>Invoice #1042 · Dangote Sugar</td>
                      <td><b>₦3,500,000</b></td>
                      <td><span className="badge green">Matched</span></td>
                      <td><span className="text-button">View Journal</span></td>
                    </tr>
                    <tr>
                      <td><b>TXN-2026-090</b><br/><small>Zenith Bank Operating</small></td>
                      <td>Expense #88 · Cloud Hosting</td>
                      <td><b>₦240,000</b></td>
                      <td><span className="badge green">Matched</span></td>
                      <td><span className="text-button">View Journal</span></td>
                    </tr>
                    <tr>
                      <td><b>TXN-2026-091</b><br/><small>Access Bank Feed</small></td>
                      <td>Invoice #1049 · BUA Foods</td>
                      <td><b>₦1,250,000</b></td>
                      <td><span className="badge amber">Suggested</span></td>
                      <td><span className="text-button" style={{ fontWeight: 700 }}>Confirm Match</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'inventory' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>Multi-Location Stock & Valuation</h3>
                  <small>Ikeja Central Warehouse & Lekki Fulfillment Depot</small>
                </div>
                <span className="badge blue">2 Warehouses Synced</span>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr><th>Product SKU</th><th>Location</th><th>On Hand</th><th>Unit Cost</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><b>Industrial Cable 50m</b><br/><small>SKU: CBL-IND-50M</small></td>
                      <td>Ikeja Central (Bay 4A)</td>
                      <td><b>142 units</b></td>
                      <td>₦18,500</td>
                      <td><span className="badge green">In Stock</span></td>
                    </tr>
                    <tr>
                      <td><b>Copper Busbar 100A</b><br/><small>SKU: BB-COP-100</small></td>
                      <td>Lekki Depot (Bay 1C)</td>
                      <td><b style={{ color: '#ef4444' }}>8 units</b> (Min: 25)</td>
                      <td>₦32,000</td>
                      <td><span className="badge red">Reorder Alert</span></td>
                    </tr>
                    <tr>
                      <td><b>Modular Circuit Breaker</b><br/><small>SKU: CB-MOD-63A</small></td>
                      <td>Ikeja Central (Bay 2B)</td>
                      <td><b>380 units</b></td>
                      <td>₦9,400</td>
                      <td><span className="badge green">Healthy</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'ai' && (
            <div style={{ display: 'grid', gap: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>BI & AI Decision Intelligence</h3>
                  <small>Deterministic cross-module calculations with full lineage</small>
                </div>
                <span className="badge blue">Deterministic Engine</span>
              </div>
              <div style={{ padding: '1rem', borderRadius: '12px', background: 'var(--brand-subtle)', border: '1px solid var(--brand-border)' }}>
                <p style={{ fontWeight: 600, color: 'var(--brand-primary)', margin: 0 }}>
                  Question: &ldquo;What is our cash runway and are any inventory SKUs at stockout risk?&rdquo;
                </p>
                <div style={{ marginTop: '0.75rem', padding: '0.85rem', borderRadius: '8px', background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}>
                  <p style={{ margin: 0, fontWeight: 500, color: 'var(--text-primary)' }}>
                    Current operational runway is <b>7.8 months</b> at a monthly burn rate of <b>₦1,900,000</b> (₦4.65M gross payroll + ₦3.8M OpEx − ₦6.55M baseline collections).
                    One SKU (<b>Copper Busbar 100A</b>, 8 on hand vs min 25) has breached minimum threshold; recommend raising PO-2026-041 for 30 units (capital required: ₦960,000).
                  </p>
                  <small style={{ marginTop: '0.5rem', display: 'block', color: 'var(--text-muted)' }}>
                    Data Lineage: General Ledger 1010, Payroll register 2026-03, and Product SKU master table.
                  </small>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function Marketing({
  onLaunchApp,
  initialPath = '/',
}: {
  onLaunchApp: () => void
  initialPath?: string
}) {
  const [page, setPage] = useState<Page>(() => pageFor(initialPath))
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const { theme, toggleTheme, isDark } = useTheme()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const sync = () => setPage(pageFor(location.pathname))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  function navigate(next: Page) {
    history.pushState({}, '', next === 'home' ? '/' : '/' + next)
    setPage(next)
    setMenuOpen(false)
  }
  return (
    <div className="marketing-container">
      <div className={scrolled ? 'site-header is-scrolled' : 'site-header'}>
        <header className="marketing-nav">
          <button
            className="nav-brand"
            onClick={() => navigate('home')}
            aria-label="BusinessOS home"
          >
            <span className="brand-logo">B</span>
            <strong>BusinessOS</strong>
          </button>
          <nav
            id="marketing-menu"
            className={menuOpen ? 'nav-links is-open' : 'nav-links'}
            aria-label="Main navigation"
          >
            {(['home', 'features', 'pricing', 'security'] as const).map((tab) => (
              <button
                key={tab}
                className={page === tab ? 'active' : ''}
                aria-current={page === tab ? 'page' : undefined}
                onClick={() => navigate(tab)}
              >
                {tab === 'home'
                  ? 'Overview'
                  : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </nav>
          <div className="nav-actions">
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label="Toggle theme"
            >
              {isDark ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            <button
              className="primary nav-cta"
              onClick={() => {
                setMenuOpen(false)
                onLaunchApp()
              }}
            >
              Open workspace
            </button>
            <button
              className="nav-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="marketing-menu"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </header>
      </div>
      <main>
        {page === 'home' && (
          <>
            <section className="hero-section">
              <span className="hero-blob hero-blob-a" aria-hidden="true" />
              <span className="hero-blob hero-blob-b" aria-hidden="true" />
              <div className="hero-pill animate-in">BusinessOS 2.0 · Enterprise Platform</div>
              <h1 className="hero-title animate-in delay-1">
                Run the whole business{' '}
                <span className="highlight">from one place.</span>
              </h1>
              <p className="hero-subtitle animate-in delay-2">
                Unified finance, multi-location inventory, workforce, banking &
                AI decision intelligence in one single workspace.
              </p>
              <div className="hero-cta-group animate-in delay-3">
                <button className="primary cta-large" onClick={onLaunchApp}>
                  Open workspace ↗
                </button>
                <button
                  className="secondary cta-large"
                  onClick={() => navigate('features')}
                >
                  Explore 28 modules
                </button>
              </div>
              <div className="capability-strip animate-in delay-3">
                {capabilities.map((item) => (
                  <span className="capability-chip" key={item}>
                    <CheckIcon />
                    {item}
                  </span>
                ))}
              </div>
            </section>
            <DashboardPreview onLaunch={onLaunchApp} />
            <section className="pillars-grid">
              {features.slice(0, 4).map(([title, description]) => (
                <article className="pillar-card" key={title}>
                  <CardIcon icon={featureIcons[title]} />
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </section>
            <section className="how">
              <div className="page-header">
                <h2>How BusinessOS works</h2>
                <p>
                  From first record to financial close — one connected flow, with
                  every step traceable.
                </p>
              </div>
              <div className="how-steps">
                {[
                  ['Capture', 'Record invoices, stock, payroll and customer work as it happens.'],
                  ['Connect', 'Finance, operations and people data stay in sync in one workspace.'],
                  ['Decide', 'Review dashboards, approvals and audit trails before you act.'],
                ].map(([title, description], index) => (
                  <article className="how-step" key={title}>
                    <span className="how-num">{index + 1}</span>
                    <h2>{title}</h2>
                    <p>{description}</p>
                  </article>
                ))}
              </div>
            </section>
            <section className="cta-band">
              <h2>Bring the whole business together</h2>
              <p>
                Open the workspace to see finance, inventory, people and
                operations side by side — or explore the browser demo first.
              </p>
              <button className="primary cta-large" onClick={onLaunchApp}>
                Open workspace
              </button>
            </section>
          </>
        )}
        {page === 'features' && (
          <section style={{ maxWidth: 1100, margin: '0 auto 60px', padding: '0 20px' }}>
            <div className="page-header">
              <h1>Business management modules</h1>
              <p>Capture operational records, review financial effects and trace decisions to their sources.</p>
            </div>
            <div className="module-cards-grid">
              {features.map(([title, description]) => (
                <article className="module-card" key={title}>
                  <CardIcon icon={featureIcons[title]} />
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </div>
            <p style={{ marginTop: 24, fontSize: '0.82rem', color: '#64748b', padding: '0 4px' }}>
              Bank synchronisation, payment execution and message delivery depend on configured providers.
            </p>
          </section>
        )}
        {page === 'pricing' && (
          <section>
            <div className="page-header">
              <h1>Plans for different business needs</h1>
              <p>Plan structure follows the BusinessOS product specification. Pricing and availability are configured by the platform administrator.</p>
            </div>
            <div className="pricing-grid">
              {plans.map(([name, description]) => (
                <article className="pricing-card" key={name}>
                  <CardIcon icon={planIcons[name]} />
                  <h2>{name}</h2>
                  <p>{description}</p>
                  <p className="plan-meta">Pricing on configuration</p>
                </article>
              ))}
            </div>
            <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.82rem', color: '#64748b' }}>
              Additional bank feeds, storage, AI analysis, messaging and API capacity form the planned add-on offering.
            </p>
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button className="primary cta-large" onClick={onLaunchApp}>View your workspace plan</button>
            </div>
          </section>
        )}
        {page === 'security' && (
          <section>
            <div className="page-header">
              <h1>Security and control</h1>
              <p>Access controls and audit records support accountable business operations.</p>
            </div>
            <div className="security-grid">
              {[
                ['Tenant isolation', 'Tenant-scoped access checks and database row-level security separate business records.'],
                ['Roles and permissions', 'Permissions control access to finance, HR and operational workflows. Auditors have read-only access.'],
                ['Financial audit trails', 'Posted journals and audit events retain the source and actor for supported financial workflows.'],
                ['Decision support', 'Analysis uses permitted workspace data. Forecasts require review of their assumptions and available history before decisions are made.'],
              ].map(([title, description]) => (
                <article className="security-card" key={title}>
                  <CardIcon icon={securityIcons[title]} />
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </div>
            <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.82rem', color: '#64748b', padding: '0 20px' }}>
              BusinessOS records and coordinates business workflows. It does not hold funds or guarantee statutory tax compliance.
            </p>
          </section>
        )}
      </main>
      <footer className="marketing-footer">
        <div className="footer-grid">
          <div className="footer-brand-col">
            <span className="footer-brand-row">
              <span className="brand-logo">B</span>
              <strong>BusinessOS</strong>
            </span>
            <p>
              Finance, people and operations in one workspace — built for local
              businesses.
            </p>
          </div>
          <div className="footer-col">
            <h3>Product</h3>
            {(['home', 'features', 'pricing', 'security'] as const).map((tab) => (
              <button
                key={tab}
                className="footer-link"
                onClick={() => navigate(tab)}
              >
                {tab === 'home'
                  ? 'Overview'
                  : tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="footer-col">
            <h3>Modules</h3>
            {['Finance & Banking', 'Inventory & Purchasing', 'HR & Payroll', 'Sales & CRM'].map(
              (label) => (
                <button
                  key={label}
                  className="footer-link"
                  onClick={() => navigate('features')}
                >
                  {label}
                </button>
              ),
            )}
          </div>
          <div className="footer-col">
            <h3>Get started</h3>
            <button className="footer-link" onClick={onLaunchApp}>
              Open workspace
            </button>
            <button className="footer-link" onClick={() => navigate('pricing')}>
              Plans & pricing
            </button>
            <button className="footer-link" onClick={() => navigate('security')}>
              Security & control
            </button>
          </div>
        </div>
        <p className="footer-note">
          BusinessOS records and coordinates business workflows. It does not hold
          funds or guarantee statutory tax compliance. Bank synchronisation,
          payment execution and message delivery depend on configured providers.
        </p>
      </footer>
    </div>
  )
}

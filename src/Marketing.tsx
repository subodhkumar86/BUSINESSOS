import { useState, useEffect } from 'react'

export function Marketing({
  onLaunchApp,
  initialPath = '/',
}: {
  onLaunchApp: () => void
  initialPath?: string
}) {
  const [activeTab, setActiveTab] = useState<'home' | 'features' | 'pricing' | 'security'>(() => {
    const path = initialPath.toLowerCase()
    if (path.includes('features')) return 'features'
    if (path.includes('pricing')) return 'pricing'
    if (path.includes('security')) return 'security'
    return 'home'
  })

  useEffect(() => {
    const route = activeTab === 'home' ? '/' : `/${activeTab}`
    if (window.location.pathname !== route) {
      window.history.pushState({}, '', route)
    }
  }, [activeTab])

  useEffect(() => {
    const sync = () => {
      const route=window.location.pathname.slice(1)
      setActiveTab(route==='features'||route==='pricing'||route==='security'?route:'home')
    }
    window.addEventListener('popstate',sync)
    return () => window.removeEventListener('popstate',sync)
  },[])

  const modules = [
    {
      category: 'Core Operations',
      items: [
        { name: 'Finance & Banking', icon: '🏦', desc: 'Double-entry ledger, bank reconciliation engine, automated matching, and AR/AP.' },
        { name: 'Inventory & Stock Control', icon: '▦', desc: 'Real-time stock ledger, physical cycle counts, adjustments, and reorder alerts.' },
        { name: 'Procurement & Purchasing', icon: '▤', desc: 'Purchase orders, approver separation, automated goods receipt, and vendor bills.' },
        { name: 'HR & Statutory Payroll', icon: '♙', desc: 'Employee records, gross-to-net payroll, PAYE tax & Pension statutory calculations.' },
        { name: 'Sales & CRM', icon: '↗', desc: 'Lead pipeline, deal tracking, multi-channel campaigns, and customer lifetime value.' },
        { name: 'Projects & Tasks', icon: '☑', desc: 'Milestones, budgets, resource leveling, and team task delegations.' },
      ],
    },
    {
      category: 'Logistics & Operational Breadth',
      items: [
        { name: 'Suppliers & Vendors', icon: '🤝', desc: 'Supplier performance ratings, lead-time tracking, and contract compliance.' },
        { name: 'Warehouse Management', icon: '⌂', desc: 'Multi-location inventory, stock transfers, picking, packing, and returns.' },
        { name: 'Capital Assets', icon: '📦', desc: 'Serial numbers, locations, depreciation schedules, and maintenance records.' },
        { name: 'Facility Management', icon: '🏭', desc: 'Equipment monitoring, safety inspections, work orders, and repairs.' },
        { name: 'Production & Manufacturing', icon: '⚙', desc: 'Work orders, batch scheduling, raw material tracking, and defect control.' },
        { name: 'Supply Chain Network', icon: '⇄', desc: 'Demand planning, logistics carrier visibility, and multi-warehouse supply.' },
      ],
    },
    {
      category: 'Growth & Decision Intelligence',
      items: [
        { name: 'Front Office & Visitors', icon: '📅', desc: 'Digital reception, visitor check-in, host notifications, and appointment booking.' },
        { name: 'Customer Support', icon: '🎫', desc: 'Ticketing queues, SLA countdowns, priority escalations, and CSAT metrics.' },
        { name: 'Document Management', icon: '▧', desc: 'Central repository, version control, metadata auditing, and access policies.' },
        { name: 'Workflows & Automation', icon: '⚡', desc: 'Configurable triggers, automated reminders, and scheduled cross-module tasks.' },
        { name: 'BI & AI Intelligence', icon: '✧', desc: 'Multi-horizon cash forecasting, anomaly detection, and explainable natural Q&A.' },
        { name: 'Tax Management', icon: '%', desc: 'Nigerian VAT (7.5%), WHT, PAYE tax filing schedules, and audit compliance.' },
        { name: 'Compliance & Risk', icon: '✓', desc: 'Risk register, policy adherence, corrective actions, and immutable audit logs.' },
        { name: 'Platform Admin', icon: '🛡', desc: 'Super admin console, tenant isolation, plan packaging, and adapter governance.' },
      ],
    },
  ]

  const pricingPlans = [
    {
      name: 'Starter',
      price: 'NGN 45,000',
      period: 'per month',
      badge: 'Early Stage',
      desc: 'Essential operational foundation for emerging businesses needing tight finance and stock control.',
      features: [
        'Core Finance, Invoices & Expenses',
        'Sales Pipeline & CRM Leads',
        'Inventory Tracking & Reorder Alerts',
        'Document Vault & Activity Logging',
        'Role-based Access for 5 Team Seats',
        'Single Warehouse & Standard Dashboard',
      ],
      cta: 'Start with Starter',
      popular: false,
    },
    {
      name: 'Business',
      price: 'NGN 120,000',
      period: 'per month',
      badge: 'Most Popular',
      desc: 'Complete operating system for growing companies needing HR, procurement, and multi-location operations.',
      features: [
        'Everything in Starter, plus:',
        'HR & Statutory Payroll (PAYE & Pension)',
        'Purchase Orders & Receiving Invariants',
        'Multi-location Warehouse Management',
        'Projects, Tasks & Milestone Budgeting',
        'Customer Support & Front Office Logs',
        'Up to 25 Team Seats & Advanced CSV Reports',
      ],
      cta: 'Start with Business',
      popular: true,
    },
    {
      name: 'Business Pro',
      price: 'NGN 280,000',
      period: 'per month',
      badge: 'High Velocity',
      desc: 'Engineered for scaling enterprises requiring automated workflows, multi-branch, and AI intelligence.',
      features: [
        'Everything in Business, plus:',
        'Multi-branch Scoping & Aggregation',
        'AI Cash Flow & Demand Forecasting',
        'Operational Anomaly Detection Engine',
        'Capital Assets & Facility Work Orders',
        'Production Batch Scheduling & Quality',
        'Up to 100 Team Seats & Priority Adapters',
      ],
      cta: 'Start Business Pro',
      popular: false,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      period: 'tailored annual contract',
      badge: 'Corporate',
      desc: 'Mission-critical resilience, dedicated infrastructure, custom integrations, and SLA guarantees.',
      features: [
        'Unlimited Seats & Custom Business Units',
        'SSO (SAML 2.0 / Okta / Azure AD)',
        'Custom Bank & ERP API Connectors',
        'Dedicated Account Manager & 99.9% SLA',
        'Audit Compliance & Custom Retention Rules',
        'Private Cloud / Multi-region Deployment',
      ],
      cta: 'Contact Sales',
      popular: false,
    },
  ]

  return (
    <div className="marketing-container">
      {/* Top Navbar */}
      <header className="marketing-nav">
        <div className="nav-brand" onClick={() => setActiveTab('home')}>
          <span className="brand-logo">B</span>
          <strong>BusinessOS</strong>
          <span className="platform-tag">Enterprise SaaS</span>
        </div>

        <nav className="nav-links">
          <button
            type="button"
            className={activeTab === 'home' ? 'active' : ''}
            onClick={() => setActiveTab('home')}
          >
            Overview
          </button>
          <button
            type="button"
            className={activeTab === 'features' ? 'active' : ''}
            onClick={() => setActiveTab('features')}
          >
            Features (20 Modules)
          </button>
          <button
            type="button"
            className={activeTab === 'pricing' ? 'active' : ''}
            onClick={() => setActiveTab('pricing')}
          >
            Pricing & Plans
          </button>
          <button
            type="button"
            className={activeTab === 'security' ? 'active' : ''}
            onClick={() => setActiveTab('security')}
          >
            Security & Trust
          </button>
        </nav>

        <div className="nav-actions">
          <button className="primary launch-btn" onClick={onLaunchApp}>
            Launch Workspace →
          </button>
        </div>
      </header>

      {/* Main Content Areas */}
      {activeTab === 'home' && (
        <>
          <section className="hero-section">
            <div className="hero-pill">
              <span>★ Version 1.0 Live</span> · <span>Nigeria First · Multi-Country Architecture</span>
            </div>
            <h1 className="hero-title">
              The Unified Operating System for <span className="highlight">Modern Business</span>
            </h1>
            <p className="hero-subtitle">
              Centralise day-to-day operations, double-entry financial truth, workforce payroll, and AI decision
              intelligence in one high-integrity workspace. No duplicate data entry.
            </p>
            <div className="hero-cta-group">
              <button className="primary cta-large" onClick={onLaunchApp}>
                Enter Business Workspace ↗
              </button>
              <button className="secondary cta-large" onClick={() => setActiveTab('features')}>
                Explore 20 Modules ↓
              </button>
            </div>

            <div className="trust-strip">
              <div className="trust-item">
                <b>PostgreSQL RLS</b>
                <small>Hardware-enforced tenant isolation</small>
              </div>
              <div className="trust-item">
                <b>Append-Only Audit</b>
                <small>Cryptographically guarded journals</small>
              </div>
              <div className="trust-item">
                <b>Explainable AI</b>
                <small>Fact-backed telemetry, zero hallucinations</small>
              </div>
              <div className="trust-item">
                <b>Double-Entry Core</b>
                <small>Balanced ledger across AR, AP & stock</small>
              </div>
            </div>
          </section>

          {/* Quick Pillars */}
          <section className="pillars-grid">
            <div className="pillar-card">
              <span className="pillar-icon">₦</span>
              <h3>Finance & Bank Feeds</h3>
              <p>
                Capture invoices, record expenses, match bank statement feeds with a live reconciliation engine, and
                view balance sheets that tie to every ledger posting.
              </p>
            </div>
            <div className="pillar-card">
              <span className="pillar-icon">▦</span>
              <h3>Stock & Procurement Invariants</h3>
              <p>
                Purchase order approvals automatically increment inventory and post Accounts Payable journals. Stock
                adjustments and physical counts preserve immutable movement audit trails.
              </p>
            </div>
            <div className="pillar-card">
              <span className="pillar-icon">♙</span>
              <h3>HR & Statutory Payroll</h3>
              <p>
                Manage employee rosters, calculate statutory pension and PAYE tax deductions, generate idempotent
                payment batches, and release individual payslips.
              </p>
            </div>
            <div className="pillar-card">
              <span className="pillar-icon">✧</span>
              <h3>AI Decision Intelligence</h3>
              <p>
                Run 30-day cash flow projections, detect inventory stockout anomalies, simulate receivables collection
                scenarios, and query business health in natural language with source lineage.
              </p>
            </div>
          </section>
        </>
      )}

      {activeTab === 'features' && (
        <section className="features-page">
          <div className="page-header">
            <span className="badge purple">FUNCTIONAL ARCHITECTURE</span>
            <h2>Complete 20-Module Business Suite</h2>
            <p>
              Designed around a single shared operational data model: one business event propagates across finance,
              inventory, workforce, and analytics without redundant data entry.
            </p>
          </div>

          <div className="modules-container">
            {modules.map((category) => (
              <div key={category.category} className="module-group">
                <h3 className="group-title">{category.category}</h3>
                <div className="module-cards-grid">
                  {category.items.map((mod) => (
                    <div key={mod.name} className="module-card">
                      <div className="module-card-header">
                        <span className="module-icon">{mod.icon}</span>
                        <h4>{mod.name}</h4>
                      </div>
                      <p>{mod.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'pricing' && (
        <section className="pricing-page">
          <div className="page-header">
            <span className="badge">MONETISATION & PACKAGING</span>
            <h2>Simple, Predictable Enterprise Pricing</h2>
            <p>
              Start with the core operational foundation and unlock advanced automation, multi-branch, and AI
              intelligence as your business expands.
            </p>
          </div>

          <div className="pricing-grid">
            {pricingPlans.map((plan) => (
              <div key={plan.name} className={`pricing-card ${plan.popular ? 'featured' : ''}`}>
                {plan.popular && <div className="popular-badge">Recommended</div>}
                <div className="plan-badge">{plan.badge}</div>
                <h3>{plan.name}</h3>
                <div className="price-tag">
                  <strong>{plan.price}</strong>
                  <span>{plan.period}</span>
                </div>
                <p className="plan-desc">{plan.desc}</p>
                <button
                  className={plan.popular ? 'primary' : 'secondary'}
                  onClick={onLaunchApp}
                >
                  {plan.cta}
                </button>
                <div className="plan-features">
                  <b>Included Capabilities:</b>
                  <ul>
                    {plan.features.map((feat) => (
                      <li key={feat}>✓ {feat}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'security' && (
        <section className="security-page">
          <div className="page-header">
            <span className="badge green">TRUST & COMPLIANCE</span>
            <h2>Enterprise-Grade Security Architecture</h2>
            <p>
              BusinessOS is built from the ground up on immutable ledger invariants, least-privilege role separation,
              and strict data isolation.
            </p>
          </div>

          <div className="security-grid">
            <div className="security-card">
              <span className="sec-icon">🛡</span>
              <h3>PostgreSQL Row-Level Security (RLS)</h3>
              <p>
                Every table enforces hardware-level <code>FORCE ROW LEVEL SECURITY</code>. Tenant boundaries are checked
                at the database engine layer; cross-tenant data leaks are physically impossible even under code faults.
              </p>
            </div>

            <div className="security-card">
              <span className="sec-icon">📜</span>
              <h3>Append-Only Immutable Audit Trails</h3>
              <p>
                Financial journals and audit trails use database triggers that reject <code>UPDATE</code> and{' '}
                <code>DELETE</code> statements. Historical records cannot be altered or purged after posting.
              </p>
            </div>

            <div className="security-card">
              <span className="sec-icon">🔑</span>
              <h3>Redis Session Tokenization & CSRF</h3>
              <p>
                Hashed opaque session keys in Redis with 8-hour expiry, strict HttpOnly/SameSite cookies, origin
                validation, and single-use CSRF tokens on every state mutation.
              </p>
            </div>

            <div className="security-card">
              <span className="sec-icon">👥</span>
              <h3>Strict 9-Role RBAC Matrix</h3>
              <p>
                Granular role enforcement: Super Admin, Owner, Finance Admin, HR Admin, Operations Manager, Sales User,
                Department Manager, Employee, and Auditor (with immutable read-only assurance).
              </p>
            </div>

            <div className="security-card">
              <span className="sec-icon">⚡</span>
              <h3>Idempotent Execution & Retries</h3>
              <p>
                Every financial disbursement, stock movement, and webhook transaction requires a unique UUID{' '}
                <code>Idempotency-Key</code> to guarantee zero duplicate postings during network retries.
              </p>
            </div>

            <div className="security-card">
              <span className="sec-icon">🔍</span>
              <h3>Fact-Grounded Explainable AI</h3>
              <p>
                AI answers never synthesize facts. Every analytical metric and forecast exposes full mathematical
                lineage and cites explicit source journals from your workspace ledger.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="marketing-footer">
        <div>
          <strong>BusinessOS</strong> — The Enterprise Business Management Platform
          <p style={{ margin: '4px 0 0', color: '#858697', fontSize: '13px' }}>
            PRD Specification Version 1.0 · Designed for scale across Nigeria and global multi-branch operations.
          </p>
        </div>
        <div>
          <button className="primary" onClick={onLaunchApp}>
            Access Workspace ↗
          </button>
        </div>
      </footer>
    </div>
  )
}

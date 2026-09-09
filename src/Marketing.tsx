import { useEffect, useState } from 'react'
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
export function Marketing({
  onLaunchApp,
  initialPath = '/',
}: {
  onLaunchApp: () => void
  initialPath?: string
}) {
  const [page, setPage] = useState<Page>(() => pageFor(initialPath))
  useEffect(() => {
    const sync = () => setPage(pageFor(location.pathname))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])
  function navigate(next: Page) {
    history.pushState({}, '', next === 'home' ? '/' : '/' + next)
    setPage(next)
  }
  return (
    <div className="marketing-container">
      <header className="marketing-nav">
        <button
          className="nav-brand"
          onClick={() => navigate('home')}
          aria-label="BusinessOS home"
        >
          <span className="brand-logo">B</span>
          <strong>BusinessOS</strong>
        </button>
        <nav className="nav-links" aria-label="Main navigation">
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
        <button className="primary" onClick={onLaunchApp}>
          Open workspace
        </button>
      </header>
      <main>
        {page === 'home' && (
          <>
            <section className="hero-section">
              <div className="hero-pill">BusinessOS · Nigeria first</div>
              <h1 className="hero-title">
                Run the business{' '}
                <span className="highlight">from one place.</span>
              </h1>
              <p className="hero-subtitle">
                Connect finance, inventory, people and customer operations in a
                shared workspace.
              </p>
              <div className="hero-cta-group">
                <button className="primary cta-large" onClick={onLaunchApp}>
                  Open workspace
                </button>
                <button
                  className="secondary cta-large"
                  onClick={() => navigate('features')}
                >
                  Explore features
                </button>
              </div>
            </section>
            <section className="pillars-grid">
              {features.slice(0, 4).map(([title, description]) => (
                <article className="pillar-card" key={title}>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </section>
          </>
        )}
        {page === 'features' && (
          <section className="features-page">
            <div className="page-header">
              <h1>Business management modules</h1>
              <p>
                Capture operational records, review financial effects and trace
                decisions to their sources.
              </p>
            </div>
            <div className="module-cards-grid">
              {features.map(([title, description]) => (
                <article className="module-card" key={title}>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </div>
            <p>
              Bank synchronisation, payment execution and message delivery
              depend on configured providers. Workflow rules currently support
              manual review; automatic execution is not available.
            </p>
          </section>
        )}
        {page === 'pricing' && (
          <section className="pricing-page">
            <div className="page-header">
              <h1>Plans for different business needs</h1>
              <p>
                Plan structure follows the BusinessOS product specification.
                Pricing and availability are configured by the platform
                administrator; your workspace shows its assigned plan and
                enabled features.
              </p>
            </div>
            <div className="pricing-grid">
              {plans.map(([name, description]) => (
                <article className="pricing-card" key={name}>
                  <h2>{name}</h2>
                  <p>{description}</p>
                  <p>Pricing on configuration</p>
                </article>
              ))}
            </div>
            <p>
              Additional bank feeds, storage, AI analysis, messaging and API
              capacity form the planned add-on offering.
            </p>
            <button className="primary" onClick={onLaunchApp}>
              View your workspace plan
            </button>
          </section>
        )}
        {page === 'security' && (
          <section className="security-page">
            <div className="page-header">
              <h1>Security and control</h1>
              <p>
                Access controls and audit records support accountable business
                operations.
              </p>
            </div>
            <div className="security-grid">
              {[
                [
                  'Tenant isolation',
                  'Tenant-scoped access checks and database row-level security separate business records.',
                ],
                [
                  'Roles and permissions',
                  'Permissions control access to finance, HR and operational workflows. Auditors have read-only access.',
                ],
                [
                  'Financial audit trails',
                  'Posted journals and audit events retain the source and actor for supported financial workflows.',
                ],
                [
                  'Decision support',
                  'Analysis uses permitted workspace data. Forecasts require review of their assumptions and available history before decisions are made.',
                ],
              ].map(([title, description]) => (
                <article className="security-card" key={title}>
                  <h2>{title}</h2>
                  <p>{description}</p>
                </article>
              ))}
            </div>
            <p>
              BusinessOS records and coordinates business workflows. It does not
              hold funds or guarantee statutory tax compliance.
            </p>
          </section>
        )}
      </main>
      <footer className="marketing-footer">
        <strong>BusinessOS</strong>
        <span>Finance, people and operations in one workspace.</span>
      </footer>
    </div>
  )
}

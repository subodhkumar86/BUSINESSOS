import { useState, useEffect, useRef } from 'react'
import { NavIcon } from './NavIcon'
import { canPerformAction, type UserRole, type CreateCollection, type State } from './types'
import { globalSearch } from '../server/search'

export interface CommandItem {
  id: string
  title: string
  category: 'Workspaces' | 'Quick Actions' | 'Records' | 'System'
  subtitle?: string
  icon?: string
  keywords?: string[]
  onSelect: () => void
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
  onNavigate: (page: string) => void
  onOpenCreateModal: (collection: CreateCollection) => void
  onToggleTheme: () => void
  isDark: boolean
  effectiveRole: UserRole
  canViewPage: (id: string, role: UserRole) => boolean
  pages: [string, string, string, string][]
  onAskAi: () => void
  state: State
  onRecordSelect: (page: string, name: string) => void
  onExportCsv: () => void
}

export function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onOpenCreateModal,
  onToggleTheme,
  isDark,
  effectiveRole,
  canViewPage,
  pages,
  onAskAi,
  onExportCsv,
  state,
  onRecordSelect,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isOpen) {
      const previous = document.activeElement as HTMLElement | null
      const timer = setTimeout(() => {
        setQuery('')
        setSelectedIndex(0)
        inputRef.current?.focus()
      }, 0)
      return () => { clearTimeout(timer); if (document.activeElement === document.body) previous?.focus() }
    }
  }, [isOpen])

  // Build commands
  const allCommands: CommandItem[] = []

  // Quick action items
  allCommands.push(
    {
      id: 'action-invoice',
      title: 'New Invoice',
      subtitle: 'Bill customer & create receivable',
      category: 'Quick Actions',
      keywords: ['invoice', 'bill', 'ar', 'receivable', 'money', 'payment'],
      icon: 'finance',
      onSelect: () => {
        onClose()
        onOpenCreateModal('invoices')
      },
    },
    {
      id: 'action-expense',
      title: 'Record Expense',
      subtitle: 'Log operational spending & vendor payout',
      category: 'Quick Actions',
      keywords: ['expense', 'spend', 'payment', 'cost'],
      icon: 'finance',
      onSelect: () => {
        onClose()
        onOpenCreateModal('expenses')
      },
    },
    {
      id: 'action-lead',
      title: 'Create Sales Opportunity',
      subtitle: 'Add new prospect to CRM pipeline',
      category: 'Quick Actions',
      keywords: ['lead', 'crm', 'deal', 'sales', 'opportunity', 'client'],
      icon: 'crm',
      onSelect: () => {
        onClose()
        onOpenCreateModal('leads')
      },
    },
    {
      id: 'action-product',
      title: 'Add Inventory Product',
      subtitle: 'Register new SKU with reorder minimums',
      category: 'Quick Actions',
      keywords: ['product', 'item', 'stock', 'inventory', 'sku'],
      icon: 'inventory',
      onSelect: () => {
        onClose()
        onOpenCreateModal('products')
      },
    },
    {
      id: 'action-order',
      title: 'Create Purchase Order',
      subtitle: 'Procure goods from registered suppliers',
      category: 'Quick Actions',
      keywords: ['po', 'purchase', 'order', 'procurement', 'vendor'],
      icon: 'procurement',
      onSelect: () => {
        onClose()
        onOpenCreateModal('orders')
      },
    },
    {
      id: 'action-employee',
      title: 'Onboard Employee',
      subtitle: 'Add team member & gross salary band',
      category: 'Quick Actions',
      keywords: ['employee', 'staff', 'hr', 'worker', 'hire', 'payroll'],
      icon: 'hr',
      onSelect: () => {
        onClose()
        onOpenCreateModal('employees')
      },
    },
    {
      id: 'action-ai',
      title: 'Ask AI Intelligence',
      subtitle: 'Query business metrics, burn rate, and runway',
      category: 'Quick Actions',
      keywords: ['ai', 'intelligence', 'forecast', 'ask', 'query', 'insights'],
      icon: 'ai',
      onSelect: () => {
        onClose()
        onAskAi()
      },
    },
    {
      id: 'action-export',
      title: 'Export Workspace CSV',
      subtitle: 'Download complete state ledger report',
      category: 'Quick Actions',
      keywords: ['export', 'csv', 'download', 'report', 'data'],
      icon: 'documents',
      onSelect: () => {
        onClose()
        onExportCsv()
      },
    },
  )

  // Module workspace items
  pages.forEach(([id, title, , cat]) => {
    if (canViewPage(id, effectiveRole)) {
      allCommands.push({
        id: `page-${id}`,
        title,
        subtitle: `${cat} Module`,
        category: 'Workspaces',
        keywords: [id, title.toLowerCase(), cat.toLowerCase()],
        icon: id,
        onSelect: () => {
          onClose()
          onNavigate(id)
        },
      })
    }
  })

  // System items
  allCommands.push({
    id: 'toggle-theme',
    title: isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme',
    subtitle: `Current theme: ${isDark ? 'Dark' : 'Light'} mode`,
    category: 'System',
    keywords: ['theme', 'dark', 'light', 'mode', 'color', 'appearance'],
    onSelect: () => {
      onToggleTheme()
      onClose()
    },
  })

  const createCommands: Record<string, CreateCollection> = {
    'action-invoice': 'invoices', 'action-expense': 'expenses',
    'action-lead': 'leads', 'action-product': 'products',
    'action-order': 'orders', 'action-employee': 'employees',
  }
  const permittedCommands = allCommands.filter(command => {
    const collection = createCommands[command.id]
    if (collection) return canPerformAction(effectiveRole, { type: 'create', collection })
    if (command.id === 'action-ai') return canViewPage('ai', effectiveRole)
    if (command.id === 'action-export') return canViewPage('finance', effectiveRole)
    return true
  })
  const destinations: Record<string, string> = { product: 'inventory', invoice: 'finance', lead: 'crm', employee: 'hr', project: 'projects', task: 'projects' }
  for (const record of globalSearch(state, query)) {
    const page = destinations[record.kind]
    if (!canViewPage(page, effectiveRole)) continue
    permittedCommands.push({ id: 'record-' + record.kind + '-' + record.id,
      title: record.name, subtitle: record.kind + ' / ' + record.id,
      category: 'Records', icon: page, onSelect: () => { onClose(); onRecordSelect(page, record.name) } })
  }
  const categories = ['Quick Actions', 'Records', 'Workspaces', 'System'] as const
  permittedCommands.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category))
  // Filter items
  const cleanQ = query.trim().toLowerCase()
  const filteredCommands = cleanQ
    ? permittedCommands.filter((cmd) => {
        if (cmd.title.toLowerCase().includes(cleanQ)) return true
        if (cmd.subtitle?.toLowerCase().includes(cleanQ)) return true
        if (cmd.keywords?.some((k) => k.includes(cleanQ))) return true
        return false
      })
    : permittedCommands

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : Math.max(0, filteredCommands.length - 1)))
      } else if (e.key === 'Enter' && document.activeElement === inputRef.current) {
        e.preventDefault()
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].onSelect()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, filteredCommands, selectedIndex, onClose])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector('[data-selected="true"]')
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (!isOpen) return null

  // Group commands by category

  return (
    <div className="cmd-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const targets = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input,button'))
      const first = targets[0], last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-search-wrap">
          <svg className="cmd-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search commands and records"
            aria-expanded="true"
            aria-controls="command-results"
            aria-autocomplete="list"
            aria-activedescendant={filteredCommands[selectedIndex] ? `command-${filteredCommands[selectedIndex].id}` : undefined}
            className="cmd-input"
            placeholder="Type a command, search modules, or jump to..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
          />
          <button type="button" className="cmd-kbd-esc" aria-label="Close command palette" onClick={onClose}>ESC</button>
        </div>

        <div className="cmd-list" ref={listRef} role="listbox" id="command-results" aria-label="Search results">
          {filteredCommands.length === 0 ? (
            <div className="cmd-empty">
              <svg className="cmd-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
                <line x1="8" y1="11" x2="14" y2="11" />
              </svg>
              <p>No results found for &ldquo;{query}&rdquo;</p>
              <small>Try searching for invoices, crm, stock, or switch theme</small>
            </div>
          ) : (
            categories.map((cat) => {
              const items = filteredCommands.filter((cmd) => cmd.category === cat)
              if (items.length === 0) return null

              return (
                <div key={cat} className="cmd-group">
                  <div className="cmd-group-label">{cat}</div>
                  {items.map((cmd) => {
                    const globalIdx = filteredCommands.indexOf(cmd)
                    const isSelected = globalIdx === selectedIndex
                    return (
                      <div
                        key={cmd.id}
                        id={`command-${cmd.id}`}
                        role="option"
                        aria-selected={isSelected}
                        data-selected={isSelected}
                        className={`cmd-item ${isSelected ? 'is-selected' : ''}`}
                        onClick={cmd.onSelect}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                      >
                        <div className="cmd-item-icon">
                          {cmd.icon ? <NavIcon name={cmd.icon} /> : <span>⚡</span>}
                        </div>
                        <div className="cmd-item-content">
                          <span className="cmd-item-title">{cmd.title}</span>
                          {cmd.subtitle && <span className="cmd-item-subtitle">{cmd.subtitle}</span>}
                        </div>
                        {isSelected && (
                          <span className="cmd-item-enter">
                            <span>Select</span>
                            <kbd>↵</kbd>
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        <div className="cmd-footer">
          <div className="cmd-footer-keys">
            <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
            <span><kbd>↵</kbd> Open</span>
            <span><kbd>ESC</kbd> Close</span>
          </div>
          <div className="cmd-footer-brand">
            <span>{filteredCommands.length} results / BusinessOS</span>
          </div>
        </div>
      </div>
    </div>
  )
}

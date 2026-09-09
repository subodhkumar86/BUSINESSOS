import type { ReactNode } from 'react'

const icons: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  finance: <><path d="M7 4h8M8 20h8M12 4v16M8 8h6a2 2 0 0 1 0 4h-4a2 2 0 0 0 0 4h6"/></>,
  banking: <><path d="M3 9 12 4l9 5M5 10v7m4-7v7m6-7v7m4-7v7M3 20h18"/></>,
  inventory: <><path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10"/></>,
  crm: <><path d="M4 20 20 4M8 4h12v12M5 9a4 4 0 1 0 0 6"/></>,
  procurement: <><path d="M5 4h11l3 3v13H5zM8 12h8M8 16h6M15 4v4h4"/></>,
  suppliers: <><path d="M8 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm14 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0ZM8 12h8M5 15v5m14-5v5M2 20h6m8 0h6"/></>,
  warehouse: <><path d="m3 10 9-6 9 6v10H3V10Zm5 10v-6h8v6"/></>,
  projects: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/></>,
  hr: <><circle cx="12" cy="8" r="3"/><path d="M5 20c.7-3.5 3-5 7-5s6.3 1.5 7 5"/></>,
  assets: <><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/></>,
  facilities: <><path d="M4 21V5h11v16M15 10h5v11M2 21h20M8 9h3m-3 4h3m-3 4h3"/></>,
  production: <><circle cx="12" cy="12" r="3"/><path d="M19 12h2M3 12h2m14-5 1.5-1.5M3.5 18.5 5 17m7-14V1m0 22v-2m7 0 1.5 1.5M3.5 5.5 5 7"/></>,
  frontoffice: <><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4m8-4v4M7 11h10M8 15h3"/></>,
  support: <><path d="M20 11.5a8 8 0 0 0-16 0c0 4.4 3.6 8 8 8 1.2 0 2.3-.3 3.3-.7L20 20l-1.1-3.1c.7-1.5 1.1-3.3 1.1-5.4Z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></>,
  documents: <><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h5"/></>,
  automation: <><path d="m13 2-9 12h7l-1 8 9-12h-7l1-8Z"/></>,
  workspace: <><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></>,
  tax: <><path d="M6 3h12v18H6zM9 8h6M9 12h2m2 0h2M9 16h6"/></>,
  supply: <><path d="M4 7h11l-2-2m2 2-2 2M20 17H9l2-2m-2 2 2 2"/></>,
  compliance: <><path d="M12 3 20 6v5c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2 2 4-4"/></>,
  billing: <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h5M8 16h4"/></>,
  ai: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></>,
  admin: <><path d="M12 3 20 6v5c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-3Z"/><path d="M12 9v4m0 3h.01"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.2 2.2-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.1v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.2-2.2.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H5v-3h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 2.2-2.2.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V4h3.1v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.2 2.2-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2v3h-.2a1.7 1.7 0 0 0-1.5 1Z"/></>,
}

export function NavIcon({ name }: { name: string }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name] || icons.dashboard}</svg>
}

import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import '../src/index.css'

// oxlint-disable-next-line react/only-export-components -- Next.js metadata export.
export const metadata: Metadata = {
  title: 'BusinessOS | Integrated Enterprise & Operations Platform',
  description:
    'Unified business management, finance, workforce and decision intelligence.',
  icons: { icon: '/favicon.svg' },
}
// oxlint-disable-next-line react/only-export-components -- Next.js viewport export.
export const viewport: Viewport = { themeColor: '#0f172a' }

const themeScript = `try { var t = localStorage.getItem('businessos-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.setAttribute('data-theme', t); document.documentElement.classList.toggle('dark', t === 'dark'); } catch (e) {}`

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}

import { useState, useEffect } from 'react'

export type Theme = 'light' | 'dark'

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const saved = localStorage.getItem('businessos-theme')
  if (saved === 'dark' || saved === 'light') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  localStorage.setItem('businessos-theme', theme)
  window.dispatchEvent(new CustomEvent('businessos:theme-change', { detail: theme }))
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const handler = (e: Event) => {
      const nextTheme = (e as CustomEvent<Theme>).detail
      if (nextTheme && nextTheme !== theme) {
        setThemeState(nextTheme)
      }
    }
    window.addEventListener('businessos:theme-change', handler)
    return () => window.removeEventListener('businessos:theme-change', handler)
  }, [theme])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setThemeState(next)
    applyTheme(next)
  }

  return { theme, toggleTheme, isDark: theme === 'dark' }
}

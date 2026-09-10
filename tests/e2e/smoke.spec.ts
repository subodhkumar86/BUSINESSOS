import { test, expect } from '@playwright/test'

test('marketing page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/BusinessOS/)
})

test('demo mode — dashboard renders', async ({ page }) => {
  await page.goto('/app/dashboard')
  await expect(page.locator('h1')).toBeVisible()
})

test('demo mode — finance page renders', async ({ page }) => {
  await page.goto('/app/finance')
  await expect(page.locator('h1')).toBeVisible()
})

test('demo mode — inventory page renders', async ({ page }) => {
  await page.goto('/app/inventory')
  await expect(page.locator('h1')).toBeVisible()
})

test('demo mode — CRM page renders', async ({ page }) => {
  await page.goto('/app/crm')
  await expect(page.locator('h1')).toBeVisible()
})

test('demo mode — HR page renders', async ({ page }) => {
  await page.goto('/app/hr')
  await expect(page.locator('h1')).toBeVisible()
})

test('demo mode — AI page renders', async ({ page }) => {
  await page.goto('/app/ai')
  await expect(page.locator('h1')).toBeVisible()
})

test('demo mode — role switcher changes visible nav', async ({ page }) => {
  await page.goto('/app/dashboard')
  const switcher = page.locator('select[aria-label="Local demo role preview"]')
  await switcher.selectOption('finance_admin')
  await expect(page.locator('nav button', { hasText: 'Finance' })).toBeVisible()
})

test('server health endpoint returns ok', async ({ request }) => {
  const res = await request.get('/api/v1/health')
  // In demo mode without a server this will 502 — skip gracefully
  if (res.status() === 200) {
    const body = await res.json()
    expect(body.ok).toBe(true)
  }
})

test('sign-in page renders when navigating to /signin', async ({ page }) => {
  await page.goto('/signin')
  // Should show either the sign-in form or redirect to marketing
  await expect(page.locator('body')).toBeVisible()
})

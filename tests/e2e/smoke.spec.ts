import { test, expect } from '@playwright/test'

test('purchase order approval and receipt persist without a repeat receipt action', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.locator('nav').getByRole('button', { name: 'Purchasing & POs', exact: true }).click()
  await page.getByRole('button', { name: '+ Create purchase order', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Supplier', { exact: true }).fill('Browser QA supplier')
  await dialog.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ index: 0 })
  await dialog.getByLabel('Quantity', { exact: true }).fill('3')
  await dialog.getByRole('button', { name: 'Save record' }).click()
  await expect(dialog).toHaveCount(0)
  const order = page.getByRole('row').filter({ hasText: 'Browser QA supplier' })
  await expect(order).toContainText('Pending')
  await expect(order.getByRole('button', { name: 'Receive goods' })).toHaveCount(0)
  await order.getByRole('button', { name: 'Approve PO' }).click()
  await expect(order).toContainText('Approved')
  await order.getByRole('button', { name: 'Receive goods' }).click()
  await expect(order).toContainText('Received')
  await expect(order.getByRole('button')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.locator('nav').getByRole('button', { name: 'Purchasing & POs', exact: true }).click()
  await expect(order).toHaveCount(1)
  await expect(order).toContainText('Received')
})

test('stock adjustment validates quantity and records movement evidence', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.locator('nav').getByRole('button', { name: 'Inventory & Stock' }).click()
  const stock = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Stock control', exact: true }) })
  await stock.getByRole('combobox', { name: 'Product', exact: true }).selectOption({ index: 1 })
  const expected = stock.locator('.stock-preview span').filter({ hasText: 'Expected stock' }).locator('b')
  const before = Number(await expected.textContent())
  await stock.getByLabel('Quantity change').fill(String(-before - 1))
  await stock.getByLabel('Reason', { exact: true }).fill('Browser QA stock correction')
  await expect(stock.getByRole('button', { name: 'Post adjustment' })).toBeDisabled()
  await stock.getByLabel('Quantity change').fill('2')
  await expect(stock.locator('.stock-preview')).toContainText(String(before + 2))
  await stock.getByRole('button', { name: 'Post adjustment' }).click()
  await expect(expected).toHaveText(String(before + 2))
  await expect(stock.getByLabel('Quantity change')).toHaveValue('')
  const movement = page.getByRole('row').filter({ hasText: 'Browser QA stock correction' })
  await expect(movement).toHaveCount(1)
  await expect(movement).toContainText('+2')
  await page.reload()
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.locator('nav').getByRole('button', { name: 'Inventory & Stock' }).click()
  await expect(movement).toHaveCount(1)
})

test('demo invoice saves, collects once and survives reload', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.locator('nav').getByRole('button', { name: 'Finance & AR/AP', exact: true }).click()
  await page.getByRole('button', { name: '+ Create invoice', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Customer', { exact: true }).fill('Browser QA customer')
  await dialog.getByLabel('Amount', { exact: true }).fill('1250')
  await dialog.getByRole('button', { name: 'Save record' }).click()
  await expect(dialog).toHaveCount(0)
  const invoice = page.getByRole('row').filter({ hasText: 'Browser QA customer' })
  await expect(invoice).toContainText('Unpaid')
  await invoice.getByRole('button', { name: 'Record collection' }).click()
  await expect(invoice).toContainText('Paid')
  await expect(invoice.getByRole('button', { name: 'Record collection' })).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.locator('nav').getByRole('button', { name: 'Finance & AR/AP', exact: true }).click()
  await expect(invoice).toHaveCount(1)
  await expect(invoice).toContainText('Paid')
})

test('mobile core modules keep content inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  for (const name of ['Overview', 'Finance & AR/AP', 'Inventory & Stock', 'Customer Support', 'Suppliers & Vendors']) {
    await page.locator('nav').getByRole('button', { name, exact: name !== 'Inventory & Stock' }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, name + ' overflows horizontally').toBeLessThanOrEqual(1)
    const nav = await page.locator('aside').boundingBox()
    const main = await page.locator('#main-content').boundingBox()
    expect(nav!.y + nav!.height, name + ' navigation overlaps main content').toBeLessThanOrEqual(main!.y)
  }
})

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sign in to continue.' }),
  }))
})

test('public navigation and sign-in entry', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/BusinessOS/)
  for (const name of ['Features', 'Pricing', 'Security', 'Overview']) {
    await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Open workspace' }).first().click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
})

test('all owner demo modules render without runtime errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  const modules = ['Overview', 'Finance & AR/AP', 'Banking & Feeds', 'Inventory & Stock',
    'Sales & CRM', 'Purchasing & POs', 'Suppliers & Vendors', 'Warehouse Management',
    'Projects & Tasks', 'HR & Payroll', 'Assets & Depreciation', 'Facility Management',
    'Production & Quality', 'Front Office & Visitors', 'Customer Support', 'Documents & Media',
    'Workflows & Automation', 'Virtual Workspace', 'Tax Management', 'Supply Chain',
    'Compliance & Risk', 'Billing & Plans', 'Approvals & Branches', 'Budget Management',
    'Quotations & RFQ', 'BI & AI Intelligence', 'Settings & Security']
  for (const name of modules) {
    await page.locator('nav').getByRole('button', { name, exact: name !== 'Inventory & Stock' }).click()
    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }
  expect(errors).toEqual([])
})

test('demo role preview restricts navigation', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Explore browser demo' }).click()
  await page.getByLabel('Local demo role preview').selectOption('finance_admin')
  await expect(page.locator('nav').getByRole('button', { name: 'Finance & AR/AP', exact: true })).toBeVisible()
  await expect(page.locator('nav').getByRole('button', { name: 'HR & Payroll', exact: true })).toHaveCount(0)
})

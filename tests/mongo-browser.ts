import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function verifyLiveBrowser() {
  const baseURL = 'http://127.0.0.1:3318'
  if (
    !process.env.PLAYWRIGHT_BROWSERS_PATH &&
    existsSync(resolve('.cache/playwright'))
  )
    process.env.PLAYWRIGHT_BROWSERS_PATH = resolve('.cache/playwright')
  const { chromium, expect: playwrightExpect } =
    await import('@playwright/test')
  const expect = playwrightExpect.configure({ timeout: 30000 })
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '-p',
      '3318',
      '--hostname',
      '127.0.0.1',
    ],
    {
      env: {
        ...process.env,
        MONGODB_URI: process.env.DATABASE_URL,
        NODE_ENV: 'development',
        APP_ORIGIN: baseURL,
        COOKIE_SECURE: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
        BUSINESSOS_BROWSER_TEST: 'live',
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  let browser
  let debugPage: import('@playwright/test').Page | undefined
  try {
    let ready = false
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null)
        throw Error(
          'The live browser test server exited before becoming ready.',
        )
      try {
        if (
          (
            await fetch(baseURL + '/api/v1/health', {
              signal: AbortSignal.timeout(5000),
            })
          ).ok
        ) {
          ready = true
          break
        }
      } catch {
        /* Wait for the test server. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    assert.equal(ready, true, 'Live browser test server did not become ready.')
    browser = await chromium.launch({ headless: true, timeout: 20000 })
    const page = await browser.newPage({ baseURL })
    debugPage = page
    page.setDefaultTimeout(30000)
    const errors: string[] = [],
      failedAPI: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (response.url().includes('/api/v1/') && response.status() >= 500)
        failedAPI.push(
          response.status() + ' ' + new URL(response.url()).pathname,
        )
    })
    await page.goto('/login')
    await page.getByLabel('Email', { exact: true }).fill('browser@example.test')
    await page
      .getByLabel('Password', { exact: true })
      .fill('TestBusinessOS!2026')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(
      page.locator('nav').getByRole('button', { name: 'Inventory & Stock' }),
    ).toBeVisible()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Inventory & Stock' })
      .click()
    await page
      .getByRole('button', { name: '+ Add product', exact: true })
      .click()
    const dialog = page.getByRole('dialog')
    await dialog
      .getByLabel('Product name', { exact: true })
      .fill('Live browser widget')
    await dialog.getByLabel('SKU', { exact: true }).fill('LIVE-UI-1')
    await dialog.getByLabel('Opening quantity', { exact: true }).fill('10')
    await dialog.getByLabel('Unit cost', { exact: true }).fill('25')
    await dialog.getByLabel('Reorder threshold', { exact: true }).fill('20')
    await dialog.getByRole('button', { name: 'Save record' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(
      page.getByRole('row').filter({ hasText: 'LIVE-UI-1' }).first(),
    ).toBeVisible()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Workflows & Automation', exact: true })
      .click()
    await page
      .getByRole('button', { name: 'Enable stock automation', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Run stock review now', exact: true }),
    ).toBeEnabled()
    const [stockRun] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            '/api/v1/automation/stock-review/run' &&
          response.request().method() === 'POST',
      ),
      page
        .getByRole('button', { name: 'Run stock review now', exact: true })
        .click(),
    ])
    assert.equal(stockRun.status(), 201, await stockRun.text())
    await expect(
      page.getByRole('status').filter({ hasText: 'Created 1 review tasks' }),
    ).toContainText('Created 1 review tasks')
    await page
      .getByLabel('Stock review schedule', { exact: true })
      .selectOption('hourly')
    await page
      .getByRole('button', { name: 'Save stock schedule', exact: true })
      .click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Schedule saved.' }),
    ).toBeVisible()
    await page.reload()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Workflows & Automation', exact: true })
      .click()
    await expect(
      page.getByLabel('Stock review schedule', { exact: true }),
    ).toHaveValue('hourly')
    await page
      .getByLabel('Stock review schedule', { exact: true })
      .selectOption('off')
    await page
      .getByRole('button', { name: 'Save stock schedule', exact: true })
      .click()
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'Background schedule disabled.' }),
    ).toBeVisible()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Projects & Tasks', exact: true })
      .click()
    await expect(
      page.getByText('Review low stock: LIVE-UI-1 — Live browser widget', {
        exact: true,
      }),
    ).toBeVisible()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Finance & AR/AP', exact: true })
      .click()
    await page
      .getByRole('button', { name: '+ Create invoice', exact: true })
      .click()
    await dialog
      .getByLabel('Customer', { exact: true })
      .fill('Live browser customer')
    await dialog.getByLabel('Amount', { exact: true }).fill('1250')
    await dialog.getByRole('button', { name: 'Save record' }).click()
    const invoice = page
      .getByRole('row')
      .filter({ hasText: 'Live browser customer' })
    const [collection] = await Promise.all([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/actions' &&
          response.request().method() === 'POST',
      ),
      invoice.getByRole('button', { name: 'Record collection' }).click(),
    ])
    assert.equal(collection.status(), 200, await collection.text())
    await expect(invoice).toContainText('Paid')
    await page.reload()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Finance & AR/AP', exact: true })
      .click()
    await expect(invoice).toContainText('Paid')
    await page
      .locator('nav')
      .getByRole('button', { name: 'Documents & Media', exact: true })
      .click()
    await page.locator('input[type=file][name=file]').setInputFiles({
      name: 'live-upload.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(64 * 1024, 'x'),
    })
    await page.getByLabel('Folder Category').selectOption('Finance')
    await page
      .getByRole('button', { name: '+ Upload Document', exact: true })
      .click()
    await expect(
      page.getByRole('row').filter({ hasText: 'live-upload.txt' }),
    ).toBeVisible()
    for (const name of [
      'Overview',
      'Banking & Feeds',
      'Sales & CRM',
      'Purchasing & POs',
      'Suppliers & Vendors',
      'Warehouse Management',
      'Projects & Tasks',
      'HR & Payroll',
      'Assets & Depreciation',
      'Facility Management',
      'Production & Quality',
      'Front Office & Visitors',
      'Customer Support',
      'Virtual Workspace',
      'Tax Management',
      'Supply Chain',
      'Compliance & Risk',
      'Billing & Plans',
      'Approvals & Branches',
      'Budget Management',
      'Quotations & RFQ',
      'BI & AI Intelligence',
      'Settings & Security',
    ]) {
      await page
        .locator('nav')
        .getByRole('button', { name, exact: true })
        .click()
      await expect(page.locator('#main-content')).toBeVisible()
      await expect(
        page.locator('nav').getByRole('button', { name, exact: true }),
      ).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    }
    await page
      .locator('nav')
      .getByRole('button', { name: 'Approvals & Branches', exact: true })
      .click()
    await page.getByLabel('Branch name', { exact: true }).fill('Browser branch')
    await page.getByLabel('Code', { exact: true }).fill('UI-BRANCH')
    await page.getByRole('button', { name: 'Add branch', exact: true }).click()
    await expect(
      page.getByRole('row').filter({ hasText: 'UI-BRANCH' }),
    ).toBeVisible()
    await page
      .getByLabel('Chain name', { exact: true })
      .fill('Browser approval chain')
    await page.getByRole('button', { name: 'Add chain', exact: true }).click()
    await page
      .getByRole('button', { name: 'Edit Browser approval chain', exact: true })
      .click()
    await page
      .getByLabel('Minimum approval amount', { exact: true })
      .fill('250')
    await page.getByLabel('Active approval chain', { exact: true }).uncheck()
    await page
      .getByRole('button', { name: 'Save approval chain', exact: true })
      .click()
    await expect(
      page.getByRole('row').filter({ hasText: 'Browser approval chain' }),
    ).toContainText('Paused')
    await page
      .getByRole('button', { name: 'Record cash scenario', exact: true })
      .click()
    await expect(
      page.getByRole('row').filter({ hasText: 'Source version' }),
    ).toContainText('cash')
    await page
      .getByRole('button', { name: 'Create backup', exact: true })
      .click()
    await expect(
      page.getByText('Workspace backup saved.', { exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Refresh saved backups', exact: true })
      .click()
    await expect(
      page.getByRole('link', { name: /^Download manual-/ }),
    ).toBeVisible()
    await page.reload()
    await expect(
      page.getByRole('row').filter({ hasText: 'UI-BRANCH' }),
    ).toBeVisible()
    await expect(
      page.getByRole('row').filter({ hasText: 'Browser approval chain' }),
    ).toContainText('Paused')
    await expect(
      page.getByRole('link', { name: /^Download manual-/ }),
    ).toBeVisible()
    await page
      .locator('nav')
      .getByRole('button', { name: 'Settings & Security', exact: true })
      .click()
    const connectors = page
      .getByRole('heading', { name: 'Tenant provider connectors' })
      .locator('..')
    await connectors
      .getByLabel('Provider', { exact: true })
      .fill('Browser provider')
    await connectors
      .getByLabel('Sender / account ID', { exact: true })
      .fill('browser@example.test')
    await connectors
      .getByRole('button', { name: 'Save connector', exact: true })
      .click()
    await connectors
      .getByRole('button', { name: 'Edit Browser provider', exact: true })
      .click()
    await connectors
      .getByLabel('Status', { exact: true })
      .selectOption('disabled')
    await connectors
      .getByRole('button', { name: 'Save connector changes', exact: true })
      .click()
    await expect(
      connectors.getByRole('row').filter({ hasText: 'Browser provider' }),
    ).toContainText('disabled')
    await page
      .locator('nav')
      .getByRole('button', { name: 'Production & Quality', exact: true })
      .click()
    await page.getByLabel('Batch number', { exact: true }).fill('BROWSER-BATCH')
    await page
      .getByLabel('Product name', { exact: true })
      .fill('Browser tracking batch')
    await page.getByLabel('Planned quantity', { exact: true }).fill('2')
    await page
      .getByRole('button', { name: 'Create record', exact: true })
      .click()
    await expect(
      page.getByRole('row').filter({ hasText: 'BROWSER-BATCH' }),
    ).toBeVisible()
    const upi = await browser.newPage({ baseURL })
    await upi.goto('/login')
    await upi.getByLabel('Email', { exact: true }).fill('upi@example.test')
    await upi
      .getByLabel('Password', { exact: true })
      .fill('TestBusinessOS!2026')
    await upi.getByRole('button', { name: 'Sign in', exact: true }).click()
    await upi
      .locator('nav')
      .getByRole('button', { name: 'Finance & AR/AP', exact: true })
      .click()
    await upi.getByLabel('Merchant UPI ID').fill('verifiedmerchant@bank')
    await upi.getByLabel('Payee name', { exact: true }).fill('Browser merchant')
    await upi
      .getByRole('button', { name: 'Save UPI details', exact: true })
      .click()
    await expect(upi.getByRole('status')).toContainText(
      'Merchant UPI details saved',
    )
    await upi
      .getByRole('button', { name: '+ Create invoice', exact: true })
      .click()
    const upiDialog = upi.getByRole('dialog')
    await upiDialog
      .getByLabel('Customer', { exact: true })
      .fill('UPI browser customer')
    await upiDialog.getByLabel('Amount', { exact: true }).fill('250.75')
    await upiDialog.getByRole('button', { name: 'Save record' }).click()
    await expect(upiDialog).toHaveCount(0)
    await upi
      .getByRole('button', {
        name: 'Generate unpaid invoice links',
        exact: true,
      })
      .click()
    const upiLink = upi.getByLabel('UPI link for UPI browser customer', {
      exact: true,
    })
    await expect(upiLink).toBeVisible()
    const paymentUrl = new URL(await upiLink.inputValue())
    assert.equal(paymentUrl.searchParams.get('am'), '250.75')
    assert.equal(paymentUrl.searchParams.get('pa'), 'verifiedmerchant@bank')
    await expect(
      upi.getByRole('row').filter({ hasText: 'UPI browser customer' }),
    ).toContainText('Unpaid')
    const receiptForm = upi.getByRole('form', {
      name: 'Verify UPI receipt for UPI browser customer',
      exact: true,
    })
    await receiptForm
      .getByLabel('Bank UPI reference / UTR')
      .fill('BROWSERUPI123456')
    await receiptForm
      .getByLabel('Receipt date and time')
      .fill('2026-01-01T10:00')
    await receiptForm.getByRole('checkbox').check()
    const [recordedReceipt] = await Promise.all([
      upi.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            '/api/v1/payments/upi/receipts' &&
          response.request().method() === 'POST',
      ),
      receiptForm
        .getByRole('button', {
          name: 'Record verified UPI receipt',
          exact: true,
        })
        .click(),
    ])
    assert.equal(recordedReceipt.status(), 201, await recordedReceipt.text())
    await expect(
      upi.getByRole('row').filter({ hasText: 'UPI browser customer' }),
    ).toContainText('Paid')
    await expect(
      upi.getByRole('row').filter({ hasText: 'BROWSERUPI123456' }),
    ).toBeVisible()
    await upi.reload()
    await upi
      .locator('nav')
      .getByRole('button', { name: 'Finance & AR/AP', exact: true })
      .click()
    await expect(
      upi.getByRole('row').filter({ hasText: 'BROWSERUPI123456' }),
    ).toBeVisible()
    await upi
      .locator('nav')
      .getByRole('button', { name: 'Banking & Feeds', exact: true })
      .click()
    await expect(upi.getByLabel('Account currency')).toHaveValue('INR')
    await expect(upi.getByLabel('Provider', { exact: true })).toHaveValue(
      'manual',
    )
    await upi
      .getByPlaceholder('Account name (e.g. Zenith Corporate)')
      .fill('UPI settlement account')
    await upi.getByPlaceholder('Account number / IBAN').fill('UPI-BROWSER-001')
    const [bankAccount] = await Promise.all([
      upi.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/banks/accounts' &&
          response.request().method() === 'POST',
      ),
      upi
        .getByRole('button', { name: '+ Add manual account', exact: true })
        .click(),
    ])
    assert.equal(bankAccount.status(), 201, await bankAccount.text())
    await expect(
      upi.getByText('UPI settlement account', { exact: true }).first(),
    ).toBeVisible()
    await upi.close()
    const staff = await browser.newPage({ baseURL })
    const denied: string[] = []
    staff.on('response', (response) => {
      if (response.url().includes('/api/v1/') && response.status() === 403)
        denied.push(new URL(response.url()).pathname)
    })
    await staff.goto('/login')
    await staff.getByLabel('Email', { exact: true }).fill('linked@example.test')
    await staff
      .getByLabel('Password', { exact: true })
      .fill('TestBusinessOS!2026')
    await staff.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(
      staff
        .locator('nav')
        .getByRole('button', { name: 'HR & Payroll', exact: true }),
    ).toBeVisible()
    await Promise.all([
      staff.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/workflows/leave' &&
          response.status() === 200,
      ),
      staff.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/workflows/goals' &&
          response.status() === 200,
      ),
      staff
        .locator('nav')
        .getByRole('button', { name: 'HR & Payroll', exact: true })
        .click(),
    ])
    await expect(
      staff.getByRole('heading', { name: 'My employee record', exact: true }),
    ).toBeVisible()
    await expect(
      staff.getByRole('heading', {
        name: 'Performance reviews and rewards',
        exact: true,
      }),
    ).toHaveCount(0)
    await expect(
      staff.getByRole('button', { name: '+ Prepare payroll', exact: true }),
    ).toHaveCount(0)
    await staff
      .locator('nav')
      .getByRole('button', { name: 'Settings & Security', exact: true })
      .click()
    await expect(
      staff.getByRole('button', { name: 'Set up MFA', exact: true }),
    ).toBeVisible()
    assert.deepEqual(denied, [])
    await staff.close()
    assert.deepEqual(errors, [])
    assert.deepEqual(failedAPI, [])
  } catch (error) {
    if (debugPage && !debugPage.isClosed()) {
      mkdirSync('test-results', { recursive: true })
      await debugPage
        .screenshot({
          path: 'test-results/live-browser-failure.png',
          fullPage: true,
        })
        .catch(() => {})
      writeFileSync(
        'test-results/live-browser-failure.txt',
        await debugPage
          .locator('body')
          .innerText()
          .catch(() => 'Page unavailable'),
      )
    }
    console.error(
      'Live browser verification failed:',
      error instanceof Error ? error.message : 'Unknown error',
    )
    throw error
  } finally {
    await browser?.close()
    if (process.platform === 'win32' && child.pid && child.exitCode === null) {
      await new Promise<void>((resolve) => {
        const stop = spawn(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true, stdio: 'ignore' },
        )
        stop.on('exit', () => resolve())
        stop.on('error', () => {
          child.kill()
          resolve()
        })
      })
    } else child.kill()
  }
}

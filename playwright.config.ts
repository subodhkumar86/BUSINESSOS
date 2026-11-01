import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          'node node_modules/next/dist/bin/next dev --webpack -p 5178 --hostname 127.0.0.1',
        timeout: 120000,
        url: 'http://127.0.0.1:5178/login',
        reuseExistingServer: !process.env.CI,
      },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5178',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // E2E_BASE_URL opts into a separately managed frontend.
})

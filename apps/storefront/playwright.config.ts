import { defineConfig } from '@playwright/test'

const PORT = Number(process.env['STOREFRONT_E2E_PORT'] ?? 5184)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    headless: true,
  },
  webServer: {
    command: `pnpm preview --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 30_000,
    cwd: '.',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/admin/auth': 'http://localhost:3000',
      '/admin/tenants': 'http://localhost:3000',
      '/admin/orders': 'http://localhost:3000',
      '/admin/payments': 'http://localhost:3000',
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    // playwright e2e 由 `pnpm test:e2e` 单独跑，不被 vitest 拾取
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
  },
})

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
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/auth': 'http://localhost:3000',
      '/products': 'http://localhost:3000',
      '/orders': 'http://localhost:3000',
      '/store': 'http://localhost:3000',
    },
  },
  test: {
    globals: false,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}'],
  },
})

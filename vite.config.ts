import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Docker Desktop may reserve port 3001 on Windows. Keep the local proxy
// configurable so the frontend can use the documented fallback API port.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3002'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget } },
  },
})

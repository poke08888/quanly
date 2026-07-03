import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev: proxy /api → the read-API (8791) so the browser sees one origin (cookies + no CORS).
// Prod: the API serves the built assets, so /api is already same-origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8791', changeOrigin: true },
    },
  },
})

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// En mode serveur (npm run dev:api), /api est relayé vers l'API locale : pas de CORS à configurer.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } } },
})

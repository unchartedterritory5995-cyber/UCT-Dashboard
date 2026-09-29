// LOCAL-ONLY dev config for app/econ-harness.html?src=api. Not used by any
// build or deploy (`vite build` reads vite.config.js).
//
// Proxies ONLY /api/econ/* to the router-only econ server
// (src/econHarness/econ_local_server.py) on 127.0.0.1:$ECON_HARNESS_API_PORT and
// injects `Authorization: Bearer $ECON_HARNESS_PUSH_SECRET` -- the push-secret
// door the REAL `require_bars_access` accepts -- so the harness exercises the real
// entitlement gate without a member session. The secret is a per-run throwaway
// from the environment; it is never written to a file. Every other /api path is
// left unproxied (the harness never asks for one).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const PORT = Number(process.env.ECON_HARNESS_API_PORT || 8791)
const SECRET = process.env.ECON_HARNESS_PUSH_SECRET || ''

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/econ': {
        target: `http://127.0.0.1:${PORT}`,
        changeOrigin: false,
        headers: SECRET ? { Authorization: `Bearer ${SECRET}` } : {},
      },
    },
  },
})

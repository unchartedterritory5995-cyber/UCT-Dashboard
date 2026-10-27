// Dev-only Vite config for the Trade Exchange News synthetic end-to-end run
// (tools/txn_local_e2e.py). It is vite.config.js with ONE change: `/api` is
// proxied to the local e2e web process (TXN_E2E_WEB_PORT) instead of :8000,
// which another session may own. Never used by `vite build`.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.js'

const port = process.env.TXN_E2E_WEB_PORT
if (!port) throw new Error('TXN_E2E_WEB_PORT is required')

export default mergeConfig(base, defineConfig({
  server: { proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } } },
}))

/** DEV-ONLY: the economic UI acceptance harness (econ-ui-harness.html).
 *
 * The app's own vite config with ONE change: `/api` goes to the LOCAL acceptance
 * server (app/src/econHarness/econ_ui_local_server.py) on 127.0.0.1 — never
 * `localhost` (IPv6-first on Windows) and never production.
 *
 *   cd app && ECON_UI_API=http://127.0.0.1:8792 npx vite --config vite.config.econ-ui.mjs --host 127.0.0.1 --port 5231
 */
import base from './vite.config.js'

const target = process.env.ECON_UI_API || 'http://127.0.0.1:8792'

export default {
  ...base,
  server: { ...(base.server || {}), proxy: { '/api': { target, changeOrigin: true } } },
}

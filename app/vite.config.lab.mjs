/** DEV-ONLY: the Study workbench (lab.html), one feature at a time on the firm's own chart component.
 *
 *   cd app && npx vite --config vite.config.lab.mjs --host 127.0.0.1 --port 5232 --strictPort
 *
 * `/api` goes to the LOCAL sandbox backend (tools/local_backend_sandbox.py on 8077); `/labdata` to the
 * workbench's static data (the pod's own bars, dumped read-only). Never production.
 */
import base from './vite.config.js'

const api = process.env.LAB_API || 'http://127.0.0.1:8077'
const lab = process.env.LAB_STATIC || 'http://127.0.0.1:8793'

export default {
  ...base,
  server: {
    ...(base.server || {}),
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/labdata': { target: lab, changeOrigin: true, rewrite: (p) => p.replace(/^\/labdata/, '/data') },
    },
  },
}

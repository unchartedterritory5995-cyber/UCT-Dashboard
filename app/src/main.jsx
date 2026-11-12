// ⛔ FIRST: starts /api/auth/me (and the member's preferences) as the entry bundle runs (lib/bootFetch.js).
import './lib/bootFetchStart'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { installErrorBeacon } from './lib/errorBeacon'
import { installLayoutShiftDebug } from './lib/clsDebug'
import { legacyRegistrations } from './utils/webPush'

// Wave 6 (controller wiring, lane F's beacon): window error / unhandledrejection
// / pagehide listeners, installed BEFORE the first render so a crash during
// mount is reported too. Scrubbed client-side; POSTs to /api/client-errors.
installErrorBeacon()
// Debug only, off by default: a layout-shift logger behind localStorage `uct.debug.layoutShift` = 1 (lib/clsDebug.js).
installLayoutShiftDebug()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Real-user speed measurement (desktop speed plan 10.1): loaded only after the page's own load event, so
// it is never part of first-open bytes. One anonymous report per page load (lib/perfBeacon.js).
if (import.meta.env.PROD) {
  const startBeacon = () => setTimeout(() => { import('./lib/perfBeacon').then((m) => m.startPerfBeacon()).catch(() => {}) }, 0)
  if (document.readyState === 'complete') startBeacon()
  else window.addEventListener('load', startBeacon, { once: true })
}

// We no longer register a service worker — the previous SW used cache-first
// for static assets, making bundle updates invisible until users manually
// cleared site data. Browser HTTP cache + Cache-Control headers handle this
// correctly without an SW.
//
// We DO still fetch /sw.js (now a kill switch) so any browser that has the
// old SW registered receives the update and triggers self-uninstall.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.getRegistrations()
    .then((regs) => {
      // ⛔ BRK-04: the push worker (/push-sw.js, scope /push/) is NOT the
      // legacy caching worker. Counting it here would re-register the kill
      // switch on every page load for every member who enabled push.
      if (legacyRegistrations(regs).length > 0) {
        // Existing SW found — fetch the new (kill-switch) sw.js so the
        // browser updates the registration. The kill switch's activate
        // handler then deletes caches and unregisters itself.
        navigator.serviceWorker.register('/sw.js').catch(() => {})
      }
      // If no SW is registered, do nothing — clean install for new users.
    })
    .catch(() => {})
}

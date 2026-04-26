import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

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
      if (regs.length > 0) {
        // Existing SW found — fetch the new (kill-switch) sw.js so the
        // browser updates the registration. The kill switch's activate
        // handler then deletes caches and unregisters itself.
        navigator.serviceWorker.register('/sw.js').catch(() => {})
      }
      // If no SW is registered, do nothing — clean install for new users.
    })
    .catch(() => {})
}

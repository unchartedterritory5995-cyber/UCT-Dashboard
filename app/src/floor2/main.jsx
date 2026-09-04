import React from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider } from '../context/AuthContext'
import Floor2 from './Floor2'
import './styles.css'
import './standalone.css'

// Standalone entry (floor2.html) — mounts ONLY the redesign for design work. It
// now talks to the real /api/community/floor backend (auth + paid-gated), so it
// needs AuthProvider; run it via `vite --config app/vite.floor2.config.mjs`
// (:5200, proxies /api → :8011) and sign in, not the bare 5199 mock server.
createRoot(document.getElementById('floor2-root')).render(
  <React.StrictMode>
    <AuthProvider>
      <Floor2 />
    </AuthProvider>
  </React.StrictMode>,
)

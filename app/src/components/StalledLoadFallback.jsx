/**
 * StalledLoadFallback — the route-level Suspense fallback (App.jsx).
 *
 * Renders BrandSplash exactly as the plain fallback did. The reason this
 * component exists: every page is React.lazy, and a lazy import that REJECTS
 * reaches RouteErrorBoundary correctly — but one that NEVER SETTLES (observed
 * in the 2026-08-22 503-storm repro: the server accepted the connection and
 * the chunk simply never arrived) leaves the Suspense fallback on screen
 * forever. React.lazy caches its promise, so a remount or key-bump can NOT
 * retry a hung import — the only real recovery is a document reload.
 *
 * So: after STALL_MS of CONTINUOUS mounting, swap the splash for a compact
 * recovery panel (reload + a full-navigation escape to /dashboard —
 * client-side nav cannot fix a hung chunk). The timer lives HERE, in the
 * fallback itself, because Suspense unmounts the fallback the moment the
 * route resolves — that unmount is what makes the timer correct: a route
 * that loads in 300ms never starts counting toward anything.
 *
 * Deliberately NO new animation (reduced-motion safe by construction);
 * BrandSplash handles its own motion preference. Panel styling mirrors
 * AppErrorFallback.jsx — the repo's existing owner of the
 * reload / back-to-dashboard recovery idiom.
 */
import { useEffect, useState } from 'react'
import BrandSplash from './BrandSplash'

export const STALL_MS = 20000

export default function StalledLoadFallback({ label = 'Loading page', stallMs = STALL_MS }) {
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setStalled(true), stallMs)
    return () => clearTimeout(t)
  }, [stallMs])

  if (!stalled) return <BrandSplash label={label} />

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0e0f0d',
        color: '#e5e1d3',
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px', letterSpacing: '0.5px' }}>
        This page is taking too long to load.
      </h1>
      <p style={{ fontSize: '13px', color: '#a8a290', margin: '0 0 24px', maxWidth: '440px' }}>
        The connection may have dropped mid-load. Reloading usually fixes it.
      </p>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#c9a84c',
            color: '#0e0f0d',
            border: 'none',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Reload
        </button>
        {/* Full document navigation ON PURPOSE (not a router <Link>): the hung
            promise is cached inside React.lazy, so only a fresh document gets
            a fresh import. Same idiom as AppErrorFallback's goHome. */}
        <button
          onClick={() => { window.location.href = '/dashboard' }}
          style={{
            background: 'transparent',
            color: '#e5e1d3',
            border: '1px solid #3a3a36',
            padding: '10px 20px',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.3px',
          }}
        >
          Back to dashboard
        </button>
      </div>
    </div>
  )
}

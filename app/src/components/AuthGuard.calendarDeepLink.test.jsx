// app/src/components/AuthGuard.calendarDeepLink.test.jsx
//
// §13 free-tier deep-link decision (owner call, 2026-08-05). A shared link
// like /calendar?earnings=NVDA used to silently drop the ?earnings param and
// bounce a free member to bare /morning-wire — no mention of the symbol, no
// path back. The fix: a BLOCKED user hitting /calendar with a valid
// ?earnings=SYM param is routed to that symbol's existing paywall teaser
// (/research/:sym) instead. Everything else about the paywall is unchanged —
// Calendar itself stays paid, paid/admin users are untouched, and a param
// that doesn't look like a real ticker falls back to today's plain bounce.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import AuthGuard from './AuthGuard'
import ResearchPage from '../pages/research/ResearchPage'

// Global fetch stub — AuthGuard fires a real fetch('/api/maintenance') in a
// useEffect on every render; ResearchPage's hooks (via useRatings, left
// un-mocked below) fire their own SWR fetches too. Neither needs live data
// for these assertions, just a promise that resolves instead of rejecting
// against an unparsable relative URL in the test environment.
vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
))

// Control auth centrally, like ResearchPage.test.jsx / ResearchPage's own
// suite — every consumer in the tree (AuthGuard AND ResearchPage) reads the
// same mocked module, so there's exactly one source of truth per test.
const auth = { user: { role: 'user', email_verified: true }, isPaid: false, loading: false }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

// Real useResearchOverview hits /api/ticker-meta, /api/fundamentals, etc.
// via SWR AND registers into the shared live-price poller singleton
// (hooks/livePriceStore.js) — module-global state with its own setInterval
// that would keep ticking across tests. None of that is needed to prove the
// teaser renders for the routed symbol: stub the hook to do only the one
// thing this test cares about (deriving `sym` from the route param), mirror
// of the real hook's own derivation.
vi.mock('../pages/research/hooks/useResearchOverview', () => ({
  default: (rawSym) => ({
    sym: (rawSym || '').toUpperCase().trim(),
    meta: {}, stats: {}, analyst: {}, ai: {}, live: {},
  }),
}))

function CurrentUrl() {
  const loc = useLocation()
  return <div data-testid="url">{loc.pathname + loc.search}</div>
}

// Mirrors the real nesting in App.jsx: AuthGuard wraps the protected routes
// as a layout route rendering <Outlet/>; children match /morning-wire,
// /calendar, /research/:sym exactly as shipped.
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AuthGuard />}>
          <Route path="/morning-wire" element={<div data-testid="morning-wire">Morning Wire</div>} />
          <Route path="/calendar" element={<CurrentUrl />} />
          <Route path="/research/:sym" element={<ResearchPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('AuthGuard — /calendar?earnings= deep link (free tier)', () => {
  // AuthGuard gates its routing decision behind an async /api/maintenance
  // check (BrandSplash "Signing you in" renders until that effect settles),
  // so every assertion below waits via findBy* rather than asserting
  // synchronously right after render.

  it('free user with ?earnings=NVDA reaches the NVDA paywall teaser, not a bare bounce', async () => {
    auth.isPaid = false
    renderAt('/calendar?earnings=NVDA')
    expect(await screen.findByText(/Unlock NVDA Research/i)).toBeInTheDocument()
    expect(screen.queryByTestId('morning-wire')).not.toBeInTheDocument()
  })

  it('free user with lowercase ?earnings=nvda still resolves (case-insensitive, matches calendar\'s own param handling)', async () => {
    auth.isPaid = false
    renderAt('/calendar?earnings=nvda')
    expect(await screen.findByText(/Unlock NVDA Research/i)).toBeInTheDocument()
  })

  it('free user with NO param keeps today\'s behaviour — plain bounce to /morning-wire', async () => {
    auth.isPaid = false
    renderAt('/calendar')
    expect(await screen.findByTestId('morning-wire')).toBeInTheDocument()
  })

  it('paid user hitting /calendar?earnings=NVDA is completely unaffected — stays on /calendar with the param intact', async () => {
    auth.isPaid = true
    renderAt('/calendar?earnings=NVDA')
    expect(await screen.findByTestId('url')).toHaveTextContent('/calendar?earnings=NVDA')
  })

  it('admin hitting /calendar?earnings=NVDA is completely unaffected — stays on /calendar', async () => {
    auth.isPaid = true
    auth.user = { role: 'admin', email_verified: true }
    renderAt('/calendar?earnings=NVDA')
    expect(await screen.findByTestId('url')).toHaveTextContent('/calendar?earnings=NVDA')
    auth.user = { role: 'user', email_verified: true } // restore for later tests
  })

  it('a path-traversal-shaped param degrades safely — no navigation into /research/.., falls back to /morning-wire', async () => {
    auth.isPaid = false
    renderAt('/calendar?earnings=' + encodeURIComponent('../settings'))
    expect(await screen.findByTestId('morning-wire')).toBeInTheDocument()
    expect(screen.queryByText(/Unlock/i)).not.toBeInTheDocument()
  })

  it('a markup-shaped garbage param degrades safely — falls back to /morning-wire', async () => {
    auth.isPaid = false
    renderAt('/calendar?earnings=' + encodeURIComponent('<script>alert(1)</script>'))
    expect(await screen.findByTestId('morning-wire')).toBeInTheDocument()
  })

  it('a numeric (non-ticker-shaped) param degrades safely — falls back to /morning-wire', async () => {
    auth.isPaid = false
    renderAt('/calendar?earnings=12345')
    expect(await screen.findByTestId('morning-wire')).toBeInTheDocument()
  })
})

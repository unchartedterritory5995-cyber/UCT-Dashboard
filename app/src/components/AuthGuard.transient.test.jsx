// app/src/components/AuthGuard.transient.test.jsx
//
// R2 (2026-08-22 stress repro): a transient 5xx on session validation used to
// read as "logged out" — AuthContext committed user=null and this guard
// bounced the member to /login mid-blip. Now AuthContext raises
// `authTransient` instead of committing a logged-out state, and the guard:
//   - renders the SAME splash the loading state uses (never Navigate),
//   - schedules a one-shot auto-retry pair (~4s, ~10s) via retryAuth,
//   - Navigates normally only when a retry comes back definitive (401).
//
// Harness mirrors AuthGuard.calendarDeepLink.test.jsx: auth is controlled
// centrally through a mutable object behind a module mock, and the guard's
// fire-and-forget fetch('/api/maintenance') gets a resolving global stub.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import AuthGuard from './AuthGuard'

vi.stubGlobal('fetch', vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
))

// Mutable, reset per test. authTransient/retryAuth are the R2 additions —
// the calendarDeepLink suite omits them, which doubles as proof the guard
// tolerates consumers/mocks that don't provide them.
const auth = { user: null, isPaid: false, loading: false, authTransient: false, retryAuth: vi.fn() }
vi.mock('../context/AuthContext', () => ({
  useAuth: () => auth,
  AuthProvider: ({ children }) => children,
}))

function guardTree(path) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div data-testid="login">Login</div>} />
        <Route element={<AuthGuard />}>
          <Route path="/dashboard" element={<div data-testid="page">Dashboard</div>} />
          <Route path="/morning-wire" element={<div data-testid="morning-wire">Wire</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

/** Flush the maintenance fetch chain (fetch → json → then → catch → finally —
 *  all stub-resolved microtasks, no timers involved). */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  auth.user = null
  auth.isPaid = false
  auth.loading = false
  auth.authTransient = false
  auth.retryAuth = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AuthGuard — transient session-check failure (authTransient)', () => {
  it('503 on initial load (no user, authTransient) → the retrying splash, NOT the /login bounce', async () => {
    auth.authTransient = true
    render(guardTree('/dashboard'))
    await settle()
    // Past the maintenance gate now: without the transient branch this exact
    // state (user=null, loading=false) would have rendered <Navigate to="/login">.
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('login')).not.toBeInTheDocument()
    expect(screen.queryByTestId('page')).not.toBeInTheDocument()
  })

  it('definitive logged-out (authTransient false) still Navigates to /login — unchanged', async () => {
    auth.authTransient = false
    render(guardTree('/dashboard'))
    expect(await screen.findByTestId('login')).toBeInTheDocument()
  })

  it('a logged-in user is never shown the retrying splash, even if the flag lingers', async () => {
    auth.user = { role: 'user', email_verified: true }
    auth.isPaid = true
    auth.authTransient = true // stale flag must lose to a real user
    render(guardTree('/dashboard'))
    expect(await screen.findByTestId('page')).toBeInTheDocument()
  })

  it('auto-retry: retryAuth fires at ~4s and ~10s, one-shot — and never again after', async () => {
    vi.useFakeTimers()
    auth.authTransient = true
    render(guardTree('/dashboard'))
    await settle()
    expect(auth.retryAuth).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(4000) })
    expect(auth.retryAuth).toHaveBeenCalledTimes(1)

    act(() => { vi.advanceTimersByTime(6000) })
    expect(auth.retryAuth).toHaveBeenCalledTimes(2)

    // One-shot: no third retry, ever — the splash holds instead.
    act(() => { vi.advanceTimersByTime(120000) })
    expect(auth.retryAuth).toHaveBeenCalledTimes(2)
  })

  it('retries that keep 5xx-ing keep the splash — NEVER a bounce to /login', async () => {
    vi.useFakeTimers()
    auth.authTransient = true // stays true: AuthContext re-flags on each 5xx
    render(guardTree('/dashboard'))
    await settle()
    act(() => { vi.advanceTimersByTime(60000) })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('login')).not.toBeInTheDocument()
  })

  it('a retry that comes back 401 → normal Navigate on the next render', async () => {
    auth.authTransient = true
    const { rerender } = render(guardTree('/dashboard'))
    await settle()
    expect(screen.queryByTestId('login')).not.toBeInTheDocument()

    // AuthContext's definitive 401 path: user stays null, flag clears.
    auth.authTransient = false
    rerender(guardTree('/dashboard'))
    expect(await screen.findByTestId('login')).toBeInTheDocument()
  })
})

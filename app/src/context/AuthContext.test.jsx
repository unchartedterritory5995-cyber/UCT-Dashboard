// app/src/context/AuthContext.test.jsx
//
// R2 (2026-08-22 stress repro): fetchUser must distinguish three cases —
// (1) ok: unchanged; (2) DEFINITIVE rejection (401/403, and every other 4xx):
// logged out, transient flag cleared; (3) TRANSIENT failure (>=500 or the
// fetch threw): with a user already in state the user + plan state stay
// UNTOUCHED (a blip must not log anyone out); with no user yet (initial
// load) `authTransient` is flagged instead of committing
// user=null-as-logged-out. Uses the REAL AuthProvider with a stubbed fetch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { registerTickers, __resetForTest as resetLivePriceStore } from '../hooks/livePriceStore'

const ME = {
  user: { id: 1, email: 'member@uct.dev', role: 'user', email_verified: true },
  plan: 'pro',
  subscription: { status: 'active' },
  trial: null,
  billing: { annual_available: true },
}

const okRes = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(data) })
const errRes = (code) => ({ ok: false, status: code, json: () => Promise.resolve({}) })

function Probe() {
  const { user, plan, loading, authTransient, retryAuth } = useAuth()
  return (
    <div>
      <div data-testid="user">{user ? user.email : 'none'}</div>
      <div data-testid="plan">{plan}</div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="transient">{String(authTransient)}</div>
      <button onClick={() => retryAuth()}>retry</button>
    </div>
  )
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

let fetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetLivePriceStore()
})

describe('AuthContext fetchUser — transient vs definitive session-check failures', () => {
  it('503 on the INITIAL load → authTransient true, no user committed as logged-out', async () => {
    fetchMock.mockResolvedValue(errRes(503))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('transient')).toHaveTextContent('true')
  })

  it('network throw on the INITIAL load → same transient path as a 5xx', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('transient')).toHaveTextContent('true')
  })

  it('401 on the INITIAL load → definitive: user null, authTransient false (unchanged behavior)', async () => {
    fetchMock.mockResolvedValue(errRes(401))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('transient')).toHaveTextContent('false')
  })

  it('422 (4xx other than 401/403) stays DEFINITIVE — today\'s behavior, not transient', async () => {
    fetchMock.mockResolvedValue(errRes(422))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('transient')).toHaveTextContent('false')
  })

  it('503 on a REFETCH with a logged-in user → user and plan state PRESERVED', async () => {
    fetchMock.mockResolvedValueOnce(okRes(ME))
    renderProvider()
    // ⚰️ BOTH READS INSIDE THE WAIT — this was a flake. `user` and `plan` are
    // written by different updates, so waiting on one and then reading the other
    // synchronously could land between them: React 19 flushes passive effects in
    // a separate Scheduler task while RTL's `waitFor` drains with one
    // `setTimeout(…, 0)`. Same shape as the `AiSearchWidget` and `BreadthCharts`
    // flakes fixed alongside it, and no weaker — both values are still demanded.
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev')
      expect(screen.getByTestId('plan')).toHaveTextContent('pro')
    })

    fetchMock.mockResolvedValueOnce(errRes(503))
    await act(async () => { fireEvent.click(screen.getByText('retry')) })

    // The blip must not have logged anyone out or downgraded the plan.
    // ⚰️ AND `transient` BELONGS IN THE WAIT TOO. The fix above moved `user` and
    // `plan` inside a `waitFor` and left this third read synchronous — so the
    // same race survived on the one value the test is named for, and it failed
    // once in a six-shard gate on 2026-09-13 (green 3/3 alone and again in a
    // re-run of its own shard). `authTransient` is written by its own update,
    // which React 19 can flush after `act` resolves. All three are still
    // demanded; only the sampling moment changes.
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev')
      expect(screen.getByTestId('plan')).toHaveTextContent('pro')
      expect(screen.getByTestId('transient')).toHaveTextContent('false')
    })
  })

  it('network throw on a REFETCH with a logged-in user → user PRESERVED too', async () => {
    fetchMock.mockResolvedValueOnce(okRes(ME))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev'))

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => { fireEvent.click(screen.getByText('retry')) })

    expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev')
    expect(screen.getByTestId('plan')).toHaveTextContent('pro')
  })

  it('a retry after a transient start that comes back 401 clears the flag and logs out', async () => {
    fetchMock.mockResolvedValueOnce(errRes(503))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('transient')).toHaveTextContent('true'))

    fetchMock.mockResolvedValueOnce(errRes(401))
    await act(async () => { fireEvent.click(screen.getByText('retry')) })

    expect(screen.getByTestId('user')).toHaveTextContent('none')
    expect(screen.getByTestId('transient')).toHaveTextContent('false')
  })

  it('a retry after a transient start that SUCCEEDS clears the flag and signs the user in', async () => {
    fetchMock.mockResolvedValueOnce(errRes(503))
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('transient')).toHaveTextContent('true'))

    fetchMock.mockResolvedValueOnce(okRes(ME))
    await act(async () => { fireEvent.click(screen.getByText('retry')) })

    expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev')
    expect(screen.getByTestId('plan')).toHaveTextContent('pro')
    expect(screen.getByTestId('transient')).toHaveTextContent('false')
  })
})

// OI-17 follow-up: /api/live-prices started requiring a session on 2026-09-23.
// Before this wiring, a session expiring mid-poll produced a 401 that
// livePriceStore treated exactly like a network blip — the store never asked
// AuthContext to re-check, so the member sat on a frozen last-good price with
// no visible signal and no forced re-login. This proves the real, cross-module
// path: a 401 on the live-price poll -> AuthContext.fetchUser() re-runs ->
// a genuine 401 from /api/auth/me logs the member out (AuthGuard then redirects).
describe('AuthContext <-> livePriceStore — a 401 on the price poll forces a definitive re-check', () => {
  it('logs the member out when the re-check confirms the session is really gone', async () => {
    let meCalls = 0
    fetchMock.mockImplementation((url) => {
      const u = String(url)
      if (u.includes('/api/auth/me')) {
        meCalls += 1
        // First call (mount) is a normal logged-in session; the SECOND call is
        // the re-check fired by livePriceStore's 401 — simulating the session
        // having genuinely expired in between.
        return Promise.resolve(meCalls === 1 ? okRes(ME) : errRes(401))
      }
      if (u.includes('/api/live-prices')) return Promise.resolve(errRes(401))
      return Promise.resolve(errRes(404))
    })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev'))

    const unregister = registerTickers(['AAPL'])
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('none'))
    expect(meCalls).toBeGreaterThanOrEqual(2)
    unregister()
  })

  it('does NOT log the member out on an ordinary transient failure of the price poll', async () => {
    fetchMock.mockImplementation((url) => {
      const u = String(url)
      if (u.includes('/api/auth/me')) return Promise.resolve(okRes(ME))
      if (u.includes('/api/live-prices')) return Promise.resolve(errRes(503))
      return Promise.resolve(errRes(404))
    })
    renderProvider()
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev'))

    const unregister = registerTickers(['AAPL'])
    // Give the price poll a chance to run; it must never trigger a re-check.
    await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() })
    expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev')
    unregister()
  })
})

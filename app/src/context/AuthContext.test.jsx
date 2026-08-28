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
    expect(screen.getByTestId('user')).toHaveTextContent('member@uct.dev')
    expect(screen.getByTestId('plan')).toHaveTextContent('pro')
    expect(screen.getByTestId('transient')).toHaveTextContent('false')
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

// ⛔⛔ ANOTHER TAB CAN CHANGE WHO THIS TAB IS (final review of 5db8284c62, F4).
//
// One session cookie per browser: tab 2 signs in as B while tab 1 still believes it is A, and every
// request tab 1 sends carries B's cookie — so its preference writes and held merges land in B's
// account. AuthProvider now re-checks /api/auth/me on a `storage` ping (written by every sign-in /
// sign-out in another tab) and when the tab becomes visible again (throttled), and commits the
// answer through setUser, which re-publishes the preferences member.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth, AUTH_PING_KEY, AUTH_RECHECK_MIN_MS } from './AuthContext'
import { prefsUser, __resetPrefsSessionForTests } from '../lib/prefsSession'
import { __resetForTest as resetLivePriceStore } from '../hooks/livePriceStore'

const me = (id) => ({ user: { id, email: `${id}@uct.dev`, role: 'user', email_verified: true }, plan: 'pro', subscription: { status: 'active' }, trial: null, billing: {} })
const okRes = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(data) })

let current
let meCalls
function Probe() {
  const { user } = useAuth()
  return <div data-testid="user">{user ? user.id : 'none'}</div>
}

beforeEach(() => {
  __resetPrefsSessionForTests()
  resetLivePriceStore?.()
  current = 'a'
  meCalls = 0
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/auth/me')) { meCalls += 1; return okRes(me(current)) }
    return okRes({})
  })
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

async function boot() {
  render(<AuthProvider><Probe /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a'))
  await waitFor(() => expect(prefsUser()).toBe('a'))
}

describe('cross-tab sign-in is noticed', () => {
  it('the SAME member on the ping: one identity GET, and the user object is not replaced', async () => {
    await boot()
    const before = meCalls
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: AUTH_PING_KEY, newValue: 'y' })) })
    await waitFor(() => expect(meCalls).toBe(before + 1))
    await new Promise((r) => setTimeout(r, 20))
    expect(meCalls).toBe(before + 1)
    expect(prefsUser()).toBe('a')
  })

  it('a storage ping from another tab re-checks /me; a different member is committed and re-published', async () => {
    await boot()
    current = 'b'                                    // tab 2 signed in as B (cookie is B's now)
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: AUTH_PING_KEY, newValue: 'x' }))
    })
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('b'))
    await waitFor(() => expect(prefsUser()).toBe('b'))
  })

  it('an unrelated storage key does not re-check', async () => {
    await boot()
    const before = meCalls
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'something-else', newValue: 'x' })) })
    expect(meCalls).toBe(before)
  })

  it('becoming visible re-checks, at most once per AUTH_RECHECK_MIN_MS', async () => {
    await boot()
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    current = 'b'
    const before = meCalls
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('b'))
    const afterFirst = meCalls                       // the identity check, then fetchUser's commit
    expect(afterFirst).toBeGreaterThan(before)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(meCalls, 'a second visibility event inside the window re-checked again').toBe(afterFirst)
    expect(AUTH_RECHECK_MIN_MS).toBe(30000)
    vis.mockRestore()
  })

  it('a sign-in here writes the ping the OTHER tabs listen for', async () => {
    await boot()
    const set = vi.spyOn(Storage.prototype, 'setItem')
    let auth
    function Grab() { auth = useAuth(); return null }
    render(<AuthProvider><Grab /></AuthProvider>)
    await waitFor(() => expect(auth?.user?.id).toBe('a'))
    global.fetch = vi.fn(async () => okRes({ user: { id: 'c' }, plan: 'pro', trial: null, billing: {} }))
    await act(async () => { await auth.login('c@uct.dev', 'pw') })
    expect(set.mock.calls.some(([k]) => k === AUTH_PING_KEY)).toBe(true)
    set.mockRestore()
  })
})

// Recovery after a wake or a network return (lib/recovery.js, desktop plan 6.4) is installed by
// AuthProvider for every member, and its FIRST step is this provider's identity re-check.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { AuthProvider, useAuth } from './AuthContext'
import { __resetPrefsSessionForTests } from '../lib/prefsSession'
import { __resetForTest as resetLivePriceStore } from '../hooks/livePriceStore'
import { __resetAppRecoveryForTests, appRecovery } from '../lib/recovery'

const me = (id) => ({ user: { id, email: `${id}@uct.dev`, role: 'user', email_verified: true }, plan: 'pro', subscription: { status: 'active' }, trial: null, billing: {} })
let meStatus
let meCalls
function Probe() {
  const { user } = useAuth()
  return <div data-testid="user">{user ? user.id : 'none'}</div>
}

beforeEach(() => {
  __resetPrefsSessionForTests()
  __resetAppRecoveryForTests()
  resetLivePriceStore?.()
  meStatus = 200
  meCalls = 0
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/auth/me')) {
      meCalls += 1
      return meStatus === 200 ? { ok: true, status: 200, json: () => Promise.resolve(me('a')) } : { ok: false, status: meStatus, json: () => Promise.resolve({}) }
    }
    return { ok: true, status: 200, json: () => Promise.resolve({}) }
  })
})
afterEach(() => { vi.restoreAllMocks() })

async function boot() {
  render(<AuthProvider><Probe /></AuthProvider>)
  await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('a'))
}

describe('AuthProvider installs recovery', () => {
  it('the network coming back re-checks sign-in', async () => {
    await boot()
    const before = meCalls
    // The coordinator installs once its lazy chunk loads: keep announcing until it answers.
    await waitFor(async () => {
      await act(async () => { window.dispatchEvent(new Event('online')) })
      expect(meCalls).toBeGreaterThan(before)
    })
    await waitFor(() => expect(appRecovery().getState()).toBe('idle'))
  })

  it('a session that died while the machine slept signs the member out on recovery', async () => {
    await boot()
    meStatus = 401
    await waitFor(async () => {
      await act(async () => { window.dispatchEvent(new Event('online')) })
      expect(screen.getByTestId('user').textContent).toBe('none')
    })
  })
})

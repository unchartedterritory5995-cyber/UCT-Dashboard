// ⭐ THE MAINTENANCE CHECK LEAVES WITH THE PAGE (chart speed, 2026-11-26).
//
// Measured on production (ecc0bb94, /charts, FRED-LOAD cold run #2, ms from navigationStart): the sign-in
// check (/api/auth/me, started at boot by lib/bootFetch.js) answered at 392, but the shell waited for
// /api/maintenance, which AuthGuard only asked from its mount effect: issued at 325, it sat behind ~200 chunk
// requests and left the browser at 579, answering at 672. AuthGuard holds the splash until it answers, so
// the shell (and every request the chart makes) started ~280 ms after the sign-in check was already in.
//
// Now a browser that was signed in last time asks it at boot beside /me (`bootFetch.js`), and AuthGuard's
// first ask takes that answer. Same answer, same rules: a failed boot check is "no answer", as a failed
// check always was; an old one is never used.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const auth = { user: { role: 'user', email_verified: true }, isPaid: true, loading: false, authTransient: false, retryAuth: vi.fn() }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth, AuthProvider: ({ children }) => children }))

let AuthGuard
let boot
beforeEach(async () => {
  vi.resetModules()
  boot = await import('../lib/bootFetch')
  AuthGuard = (await import('./AuthGuard')).default
})
afterEach(() => { vi.unstubAllGlobals(); boot.__resetBootFetchForTests() })

const signedInStorage = () => ({ getItem: (k) => (k === boot.SIGNED_IN_HINT ? '1' : null), setItem() {}, removeItem() {} })
const json = (body) => ({ ok: true, json: () => Promise.resolve(body) })

function App() {
  return (
    <MemoryRouter initialEntries={['/charts']}>
      <Routes>
        <Route element={<AuthGuard />}>
          <Route path="/charts" element={<div data-testid="page">charts</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve() })

describe('AuthGuard takes the boot maintenance answer', () => {
  it('the boot check is started with the page, and the guard asks nothing itself', async () => {
    const bootFetch = vi.fn((u) => Promise.resolve(u === boot.MAINTENANCE_URL ? json({ maintenance: false }) : json({})))
    boot.startBootFetches({ fetchImpl: bootFetch, storage: signedInStorage() })
    const late = vi.fn(() => Promise.resolve(json({ maintenance: false })))
    vi.stubGlobal('fetch', late)
    render(<App />)
    await flush()
    expect(bootFetch.mock.calls.map((c) => c[0])).toContain(boot.MAINTENANCE_URL)
    expect(late.mock.calls.filter((c) => String(c[0]).includes('/api/maintenance'))).toEqual([])
    expect(screen.getByTestId('page')).toBeTruthy()
  })

  it('a boot answer of maintenance=true still blocks a member', async () => {
    boot.startBootFetches({ fetchImpl: (u) => Promise.resolve(u === boot.MAINTENANCE_URL ? json({ maintenance: true }) : json({})), storage: signedInStorage() })
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ maintenance: false }))))
    render(<App />)
    await flush()
    expect(screen.queryByText(/back shortly/i)).toBeTruthy()
    expect(screen.queryByTestId('page')).toBeNull()
  })

  it('a failed boot check is "no answer", exactly as a failed check: the page is not held', async () => {
    boot.startBootFetches({ fetchImpl: (u) => (u === boot.MAINTENANCE_URL ? Promise.reject(new Error('net')) : Promise.resolve(json({}))), storage: signedInStorage() })
    const late = vi.fn(() => Promise.resolve(json({ maintenance: false })))
    vi.stubGlobal('fetch', late)
    render(<App />)
    await flush()
    expect(screen.getByTestId('page')).toBeTruthy()
    expect(late.mock.calls.filter((c) => String(c[0]).includes('/api/maintenance'))).toEqual([])
  })

  it('with no boot check (signed out last time) the guard asks, as before', async () => {
    boot.startBootFetches({ fetchImpl: () => Promise.resolve(json({})), storage: { getItem: () => null, setItem() {}, removeItem() {} } })
    const late = vi.fn(() => Promise.resolve(json({ maintenance: false })))
    vi.stubGlobal('fetch', late)
    render(<App />)
    await flush()
    expect(late.mock.calls.filter((c) => String(c[0]).includes('/api/maintenance')).length).toBe(1)
    expect(screen.getByTestId('page')).toBeTruthy()
  })
})

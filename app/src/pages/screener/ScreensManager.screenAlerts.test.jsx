// app/src/pages/screener/ScreensManager.screenAlerts.test.jsx
//
// ─── 🔴 THE PRODUCER FOR ROUTES THAT HAD NONE ────────────────────────────────
//
// GET/POST /api/screener/alerts and DELETE /api/screener/alerts/{def_hash} have
// shipped behind require_paid over a complete service and a prod-armed nightly
// job, with tests on the backend. Nothing in the app called them: a grep for
// "api/screener/alerts" across app/src returned NOTHING. A member could write a
// screener, save it and run it, and had no way to be told when a name entered
// it — the repo's own "built, tested, green and unreachable" shape, with the
// unreachable half on the far side of the wire.
//
// ⛔ useScreenAlerts IS NOT MOCKED HERE. Only fetch is. Mocking the hook would
// leave exactly the seam that was missing — component to hook to route —
// untested, which is the defect this file exists to close.

import { SWRConfig } from 'swr'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const create = vi.fn(); const update = vi.fn(); const remove = vi.fn()
vi.mock('./hooks/useSavedScreens', () => ({
  default: () => ({ saved: [], starters: [], error: null, create, update, remove }),
}))
const META = vi.hoisted(() => ({ meta: { filters: [] }, isLoading: false }))
vi.mock('./hooks/useScreenerMeta', () => ({
  default: () => META, META_KEY: '/api/screener/meta',
}))

const ROW = Object.freeze({
  def_id: 'u_breakout', version: 2, rev: 1, ast_hash: 'sha256:aaa',
  scannable: true, scan_refusal: null,
  definition: {
    compute: { kind: 'ast', fn: 'sha256:aaa', ast: { type: 'op' }, source: 'close > open' },
    meta: { name: 'Breakout base' },
  },
})
const defsState = { rows: [ROW], error: null, isLoading: false, refresh: vi.fn() }
vi.mock('../../hooks/useUserDefinitions', () => ({
  useUserDefinitions: () => defsState,
  deleteUserDefinition: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../../components/chart/builder/BuilderSheet', () => ({
  default: () => <div data-testid="builder-sheet-mock" />,
}))
vi.mock('../../components/screener/ScanResults', () => ({
  default: () => <div data-testid="scan-results-mock" />,
}))

import ScreensManager from './ScreensManager'

const H = vi.hoisted(() => ({ calls: [], subs: [], postOk: true }))

function stubFetch() {
  H.calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const u = String(url)
    H.calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null })
    if (u === '/api/screener/alerts' && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ subscriptions: H.subs }) }
    }
    if (u === '/api/screener/alerts' && method === 'POST') {
      if (!H.postOk) {
        return { ok: false, status: 400, json: async () => ({ detail: 'mode must be one of' }) }
      }
      return { ok: true, status: 200, json: async () => ({ def_hash: 'sha256:aaa', mode: 'both' }) }
    }
    if (u.startsWith('/api/screener/alerts/') && method === 'DELETE') {
      return { ok: true, status: 200, json: async () => ({ removed: 1 }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

beforeEach(() => { H.subs = []; H.postOk = true; stubFetch() })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const mount = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <ScreensManager currentSpec={{}} onApply={vi.fn()} onUseScan={vi.fn()} />
  </SWRConfig>,
)
const openMenu = () => fireEvent.click(screen.getByText('Screens ▾'))
const bell = () => screen.getByTestId('screen-alert-u_breakout')
const of = (method) => H.calls.filter((c) => c.method === method
  && c.url.startsWith('/api/screener/alerts'))
const SUBBED = { def_hash: 'sha256:aaa', def_id: 'u_breakout', name: 'Breakout base', mode: 'both' }

describe('🔴 a saved screen can be alerted on', () => {
  it('⭐ the control exists on the row, and starts unpressed', async () => {
    mount(); openMenu()
    const b = await screen.findByTestId('screen-alert-u_breakout', {}, { timeout: 5000 })
    expect(b).toBeInTheDocument()
    expect(b.getAttribute('aria-pressed')).toBe('false')
    // ⚠️ THE COPY SAYS OVERNIGHT because the diff is nightly by construction —
    // the route runs once off a 03:00 snapshot. Promising a live watch here
    // would be this page inventing a liveness the service does not have.
    expect(b.getAttribute('aria-label')).toMatch(/overnight/i)
  })

  it('⭐⭐ clicking it SUBSCRIBES, keyed on ast_hash', async () => {
    mount(); openMenu()
    fireEvent.click(await screen.findByTestId('screen-alert-u_breakout', {}, { timeout: 5000 }))
    await waitFor(() => expect(of('POST').length).toBe(1))
    const posted = of('POST')[0].body
    // ⛔⛔ THE HASH, NOT THE ID. The service keys subscriptions on def_hash, and
    // a screen's hash does not move while its tree does not — so a rename or a
    // re-save keeps the alert. Sending def_id would look identical in this
    // test's shape and quietly lose the subscription on every edit.
    expect(posted.def_hash).toBe('sha256:aaa')
    expect(posted.def_id).toBe('u_breakout')
    expect(posted.mode).toBe('both')
    expect(String(posted.name).length).toBeGreaterThan(0)
  })

  it('⭐ an EXISTING subscription shows as pressed', async () => {
    H.subs = [SUBBED]
    mount(); openMenu()
    await screen.findByTestId('screen-alert-u_breakout', {}, { timeout: 5000 })
    await waitFor(() => expect(bell().getAttribute('aria-pressed')).toBe('true'))
  })

  it('⭐⭐ clicking a subscribed row UNSUBSCRIBES on the same hash', async () => {
    H.subs = [SUBBED]
    mount(); openMenu()
    await screen.findByTestId('screen-alert-u_breakout', {}, { timeout: 5000 })
    await waitFor(() => expect(bell().getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(bell())
    await waitFor(() => expect(of('DELETE').length).toBe(1))
    expect(of('DELETE')[0].url).toContain(encodeURIComponent('sha256:aaa'))
    expect(of('POST').length, 'a subscribed row must not re-subscribe').toBe(0)
  })

  it('⛔⛔ a refusal is SHOWN, in the store own words', async () => {
    // ⭐ THE CONTRACT deleteUserDefinition AND useSavedScreens.remove SET: a
    // caller handed nothing can only stay silent or invent a sentence. The hook
    // returns the store detail, and this asserts it reaches the page — a bell
    // that silently did nothing is the worst of the three outcomes.
    H.postOk = false
    mount(); openMenu()
    fireEvent.click(await screen.findByTestId('screen-alert-u_breakout', {}, { timeout: 5000 }))
    const err = await screen.findByTestId('screens-manager-error--alert')
    expect(err).toHaveAttribute('role', 'alert')
    expect(err.textContent).toContain('mode must be one of')
    expect(bell().getAttribute('aria-pressed'), 'it must not look subscribed after a refusal')
      .toBe('false')
  })
})

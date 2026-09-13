/**
 * R-13 — THE `Scans` ACTION OPENS THE MEMBER'S OWN SAVED-SCREEN PICKER.
 *
 * ⛔ NOTHING ON THE DOOR'S PATH IS MOCKED. `ScreensManager` is the REAL component here — it is
 * the thing that owns the picker, and every other screener suite in this repo stubs it. A test
 * that stood a probe in its place would prove the probe was called and nothing about whether a
 * member ever sees a menu, which is the exact shape of the Phase 2 seam failure `contracts.js`
 * records ("every prop across an unowned seam was wrong, and both unit suites stayed green").
 *
 * Only the picker's DATA is stubbed — the three SWR-backed hooks behind it answer empty, through
 * one `swr` mock — because what is on the menu is not what this file measures. Its chrome (the
 * "Screens ▾" trigger, the popover, the section headers) is rendered by the real file.
 *
 * ⛔ AND THE ACTION IS DRIVEN THROUGH THE REAL REGISTRATION. The config comes off `HubProvider`'s
 * `activeModeConfig`, so the fan under test is the one `HubRoot` would dispatch — not one this
 * file built.
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX and a filter matching nothing exits 0.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => {
    executedCount += 1
    return fn(...args)
  })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

const { META, scanState } = vi.hoisted(() => ({
  META: {
    categories: [],
    filters: [],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'price', 'chg_pct_1d'] }],
  },
  scanState: { current: null },
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, i) => ({
      index: i, key: i, start: i * 30, size: 30,
    })),
    getTotalSize: () => count * 30,
    scrollToIndex: () => {},
  }),
}))

// ⚠️ `META_KEY` IS RE-EXPORTED BY THE MOCK. `useUserDefinitions` — which the REAL
// `ScreensManager` imports — reads it from this module, so a mock that only supplied the default
// export would break the very component this file refuses to stub.
vi.mock('../../pages/screener/hooks/useScreenerMeta', () => ({
  default: () => ({ meta: META, isLoading: false }),
  META_KEY: '/api/screener/meta',
}))
vi.mock('../../pages/screener/hooks/useScreenerScan', () => ({ default: () => scanState.current }))
vi.mock('../../components/screener/StructureProvenance', () => ({ default: () => null }))
vi.mock('../../pages/charts/review/ReviewChartsButton', () => ({ default: () => null }))
vi.mock('../../utils/prefetchBars', () => ({ prefetchBars: () => {} }))
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false }),
}))
vi.mock('../../components/TickerPopup', () => ({
  default: ({ children }) => <span>{children}</span>,
}))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../components/PatternFeedbackChip', () => ({ default: () => null }))
vi.mock('../../context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: null }),
}))
// The picker's three stores (saved screens, user definitions, screen alerts) are all `useSWR`
// callers. Answering `null` once is what makes them all report "nothing saved yet" — the picker
// itself is untouched.
vi.mock('swr', () => ({
  default: () => ({ data: null, isLoading: false, error: null, mutate: () => {} }),
  mutate: () => {},
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: () => {}, alerts: [], deleteAlert: () => {} }),
}))

import ScannerShell, { openScansPicker } from '../../pages/screener/shell/ScannerShell'
import { encodeSpec, SPEC_PARAM } from '../../pages/screener/shell/specUrl'
import { AuthContext } from '../../context/AuthContext'
import { HubProvider, useHub } from '../HubContext'
import { modesById } from '../registry'
import { _reset as resetCursors } from '../useHubCursor'
import { SCAN_MODE_ID, buildScanFan } from './screenerSection'

const ROWS = [
  { ticker: 'AAA', company: 'Alpha', price: 300, chg_pct_1d: 1 },
  { ticker: 'BBB', company: 'Beta', price: 200, chg_pct_1d: 2 },
]

let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}
const cfg = () => {
  if (!registered) throw new Error('no hub config registered — the page never called useHubMode')
  return registered
}
/** The action as `HubRoot` would find it. */
const scansAction = () => cfg().fan.find((a) => a.id === 'scan.scans')

const tree = () => (
  <AuthContext.Provider value={{ user: null }}>
    <MemoryRouter initialEntries={['/screener']}>
      <HubProvider>
        <ScannerShell />
        <ConfigProbe />
      </HubProvider>
    </MemoryRouter>
  </AuthContext.Provider>
)

function openScreener() {
  scanState.current = {
    result: { rows: ROWS, total: ROWS.length, page: 1, view_columns: ['ticker', 'price', 'chg_pct_1d'] },
    isLoading: false,
    error: null,
  }
  const s = encodeSpec({ filters: {}, sort: { key: 'price', dir: 'desc' }, view: 'overview', columns: null })
  window.history.replaceState({}, '', `/screener?${SPEC_PARAM}=${s}`)
  return render(tree())
}

/** The picker's own popover, as the DOM has it. `role="menu"` is `ScreensManager`'s word. */
const menu = () => document.querySelector('[role="menu"]')
/** The trigger a MEMBER taps. Found the way a member finds it — by its accessible name. */
const memberTrigger = () => screen.getByRole('button', { name: /screens/i })

const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const realMatchMedia = window.matchMedia
const realCSS = globalThis.CSS
const HUB_VIEWPORT_QUERY = '(max-width: 1023px) and (pointer: coarse)'

beforeEach(() => {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = { width: 800, height: 900, addEventListener() {}, removeEventListener() {} }
  window.matchMedia = (q) => ({
    matches: q === HUB_VIEWPORT_QUERY,
    media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
  resetCursors()
  registered = null
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})
afterEach(() => {
  cleanup()
  window.history.replaceState({}, '', '/')
  if (realVisualViewport) Object.defineProperty(window, 'visualViewport', realVisualViewport)
  else delete window.visualViewport
  window.matchMedia = realMatchMedia
  globalThis.CSS = realCSS
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the Scans action', () => {
  it('ships, because the page supplied a seam — and the registry declared it', () => {
    openScreener()
    // Non-vacuity in both directions: the registry really declares this id, and the section
    // really shipped it. Either half alone would pass with the other one broken.
    expect(modesById[SCAN_MODE_ID].fan.some((a) => a.id === 'scan.scans')).toBe(true)
    expect(scansAction(), 'the fan shipped no scan.scans — there is nothing to run').toBeTruthy()
    expect(typeof scansAction().run).toBe('function')
  })

  it('⛔ is ABSENT — not a dead bubble — when no seam is supplied', () => {
    // The other half of the registry's "an unwired action is absent, never present-and-inert".
    // `buildScanFan` with no page behind it is exactly that case.
    expect(buildScanFan({ symbol: 'AAA' }).some((a) => a.id === 'scan.scans')).toBe(false)
  })

  it('opens the REAL picker — the menu is on screen after it runs', () => {
    openScreener()
    // The seam's anchor exists at all (diagnostic control: without it every case below fails
    // for a reason that reads like the action is broken).
    expect(document.querySelector('[data-hub-scans-door]')).toBeTruthy()
    expect(menu(), 'the picker was already open before the action ran').toBeNull()

    act(() => { scansAction().run({}) })

    expect(menu(), 'the Scans action ran and no picker opened').toBeTruthy()
    // …and it is the REAL saved-screen picker, not any menu that happens to be on the page.
    expect(screen.getByText(/my screens/i)).toBeTruthy()
    expect(screen.getByText(/my scans/i)).toBeTruthy()
  })

  it('⛔ opens the MEMBER’S door — one picker, not a second copy mounted by the hub', () => {
    openScreener()
    act(() => { scansAction().run({}) })
    expect(menu()).toBeTruthy()
    // If the hub had mounted its own picker, the member's own trigger would open a SECOND menu
    // beside it. Instead it toggles the one that is already up — proof they are one control
    // over one piece of state.
    act(() => { memberTrigger().click() })
    expect(document.querySelectorAll('[role="menu"]').length).toBe(0)
  })

  it('⛔ OPENS; it never toggles — running it twice leaves the picker up', () => {
    // The hub's own press reaches the document as a `mousedown` first, which the picker's
    // outside-click handler acts on, and the ordering of compatibility mouse events after a
    // touch is not ours to rely on. A toggle here would shut the menu the member just asked for.
    openScreener()
    act(() => { scansAction().run({}) })
    act(() => { scansAction().run({}) })
    expect(menu(), 'the second run closed the picker instead of leaving it open').toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the seam itself — it refuses rather than guesses', () => {
  it('answers false when there is no root and when the root holds no trigger', () => {
    expect(openScansPicker(null)).toBe(false)
    expect(openScansPicker(undefined)).toBe(false)
    expect(openScansPicker({})).toBe(false)
    const bare = document.createElement('div')
    expect(openScansPicker(bare)).toBe(false)
  })

  it('reports an already-open picker as open without touching the trigger', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    let clicks = 0
    button.addEventListener('click', () => { clicks += 1 })
    const already = document.createElement('div')
    already.setAttribute('role', 'menu')
    root.append(button, already)
    expect(openScansPicker(root)).toBe(true)
    expect(clicks, 'it clicked the trigger on an already-open picker — that closes it').toBe(0)
  })
})

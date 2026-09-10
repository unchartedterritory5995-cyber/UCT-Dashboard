/**
 * R-15 — THE SCREENER CURSOR IS VISIBLE, ON ALL THREE RENDERERS, AND IT IS REVEALED.
 *
 * ⛔ ASSERTED BY THE RENDERED ATTRIBUTE, NEVER BY THE INDEX. `useHubCursor`'s own suite already
 * proves `itemProps(i)` RETURNS `{'data-hub-cursor':'active'}`; that is a claim about a hook, and
 * it stayed green for the whole period in which no row on this page carried the attribute. What a
 * member can see is a DOM node with the attribute on it, so that is what every case here reads —
 * the same ruling CLAUDE.md records for toasts ("assert user-facing feedback by RENDERED TEXT,
 * never by state"), applied to a highlight.
 *
 * ⛔ THE VIRTUALIZER MOCK HAS A REAL WINDOW, and that is the load-bearing part. A mock that
 * returns every row cannot fail the case this file exists for: both results renderers keep ~20
 * rows in the DOM, so a cursor that walks past the window is not merely unpainted — its row does
 * not exist. A fixture that cannot distinguish "painted off-screen" from "painted on-screen" is
 * not a rail (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`), so `scrollToIndex` here
 * MOVES the window, exactly as a real virtualizer does.
 *
 * ⛔ THE PAGE IS MOUNTED AND THE CONFIG COMES FROM THE REAL `HubProvider`. The seam this file
 * measures is a JOIN — the section computes an index, the shell hands it to a renderer, the
 * renderer spreads it onto a row — and Phase 2's whole failure was two halves each testing its
 * own idea of the seam (`contracts.js` header). Only `@tanstack/react-virtual` is faked, one
 * level BELOW the components, so their own `itemProps` spread still has to happen.
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX, and a filter matching nothing exits 0 and
// reads as a PASS. These counters catch a `-t` typo or a stray `.only`/`.skip`.
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

const { META, scanState, PRICES, vwin, scrollToIndexSpy } = vi.hoisted(() => ({
  META: {
    categories: [],
    filters: [],
    views: [
      { key: 'overview', label: 'Overview', columns: ['ticker', 'price', 'chg_pct_1d'] },
      { key: 'charts', label: 'Charts', columns: ['ticker'] },
    ],
  },
  scanState: { current: null },
  PRICES: {},
  /** The virtualizer's window: `size` rows starting at `start`. */
  vwin: { start: 0, size: 8 },
  scrollToIndexSpy: vi.fn(),
}))

// ── the library boundary, NOT the component (see the header) ────────────────
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from(
      { length: Math.max(0, Math.min(vwin.size, count - vwin.start)) },
      (_, i) => ({ index: vwin.start + i, key: vwin.start + i, start: (vwin.start + i) * 30, size: 30 }),
    ),
    getTotalSize: () => count * 30,
    // A real `scrollToIndex` brings the row into the window; so does this one, or the reveal
    // half of R-15 would be unfalsifiable here.
    scrollToIndex: (i, opts) => {
      scrollToIndexSpy(i, opts)
      vwin.start = Math.max(0, Math.min(i, Math.max(count - vwin.size, 0)))
    },
  }),
}))

// ── the page's outside world ────────────────────────────────────────────────
vi.mock('../../pages/screener/hooks/useScreenerMeta', () => ({
  default: () => ({ meta: META, isLoading: false }),
}))
vi.mock('../../pages/screener/hooks/useScreenerScan', () => ({ default: () => scanState.current }))
vi.mock('../../pages/screener/ScreensManager', () => ({ default: () => null }))
vi.mock('../../components/screener/StructureProvenance', () => ({ default: () => null }))
vi.mock('../../pages/charts/review/ReviewChartsButton', () => ({ default: () => null }))
vi.mock('../../utils/prefetchBars', () => ({ prefetchBars: () => {} }))
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: PRICES, isStreaming: false }),
}))
// The charts view mounts one `StockChart` per card. Faked at the component boundary: the claim
// under test is which CARD carries the attribute, and a real lightweight-chart in jsdom would
// only add a canvas nothing here reads.
vi.mock('../../components/StockChart', () => ({ default: () => null }))
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
vi.mock('swr', () => ({
  default: () => ({ data: null, isLoading: false, error: null, mutate: () => {} }),
  mutate: () => {},
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: () => {}, alerts: [], deleteAlert: () => {} }),
}))

import ScannerShell from '../../pages/screener/shell/ScannerShell'
import { encodeSpec, SPEC_PARAM } from '../../pages/screener/shell/specUrl'
import { AuthContext } from '../../context/AuthContext'
import { HubProvider, useHub } from '../HubContext'
import { _reset as resetCursors } from '../useHubCursor'

// ── fixtures ───────────────────────────────────────────────────────────────
const ROWS = (n) => Array.from({ length: n }, (_, i) => ({
  ticker: `T${String(i).padStart(2, '0')}`, company: `Co ${i}`, price: 100 - i, chg_pct_1d: 1,
}))

const answer = (rows) => ({
  result: { rows, total: rows.length, page: 1, view_columns: ['ticker', 'price', 'chg_pct_1d'] },
  isLoading: false,
  error: null,
})

let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}
const cfg = () => {
  if (!registered) throw new Error('no hub config registered — the page never called useHubMode')
  return registered
}

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

function openScreener({ rows = ROWS(3), view = 'overview' } = {}) {
  scanState.current = answer(rows)
  const s = encodeSpec({ filters: {}, sort: { key: 'price', dir: 'desc' }, view, columns: null })
  window.history.replaceState({}, '', `/screener?${SPEC_PARAM}=${s}`)
  return render(tree())
}

/** Every node the page has marked as the cursor, in DOM order. */
const painted = () => [...document.querySelectorAll('[data-hub-cursor="active"]')]

/** The ticker the painted node is about — read off its own text, not off the store. */
const paintedTicker = () => {
  const nodes = painted()
  expect(nodes.length, 'expected exactly one painted row').toBe(1)
  return nodes[0].textContent.match(/T\d\d/)?.[0] ?? null
}

// ── environment: the phone the hub actually ships on ────────────────────────
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const realMatchMedia = window.matchMedia
const realCSS = globalThis.CSS
const HUB_VIEWPORT_QUERY = '(max-width: 1023px) and (pointer: coarse)'
const PHONE_QUERY = '(max-width: 640px)'

/** ⛔ PER-QUERY, never a blanket `matches: true` — `ScannerShell` also asks `useIsPhone()`, and a
 *  matchMedia that says yes to everything silently swaps which renderer is under test. */
function stubEnvironment({ phone = false } = {}) {
  globalThis.CSS = { supports: () => true }
  window.visualViewport = { width: 800, height: 900, addEventListener() {}, removeEventListener() {} }
  window.matchMedia = (q) => ({
    matches: q === HUB_VIEWPORT_QUERY || (phone && q === PHONE_QUERY),
    media: q,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })
}

beforeEach(() => {
  stubEnvironment()
  resetCursors()
  registered = null
  vwin.start = 0
  vwin.size = 8
  scrollToIndexSpy.mockClear()
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
describe('the desktop grid — VirtualResults', () => {
  it('marks the cursor row, and exactly one of them, from first paint', () => {
    openScreener()
    // Non-vacuity: the grid really rendered rows for the attribute to land on.
    expect(screen.getAllByRole('row').length).toBeGreaterThan(3)
    expect(paintedTicker()).toBe('T00')
  })

  it('the mark MOVES with the cursor — tap forward, double-tap back', () => {
    openScreener()
    act(() => { cfg().onTap() })
    expect(paintedTicker()).toBe('T01')
    act(() => { cfg().onTap() })
    expect(paintedTicker()).toBe('T02')
    act(() => { cfg().onDoubleTap() })
    expect(paintedTicker()).toBe('T01')
  })

  it('the marked row is the one the chip is naming — one selection, not two', () => {
    openScreener()
    act(() => { cfg().onTap() })
    expect(paintedTicker()).toBe(cfg().readout({}))
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the phone cards — ResultCards', () => {
  it('marks the cursor card, and it moves', () => {
    stubEnvironment({ phone: true })
    openScreener()
    // Non-vacuity + a control that this really is the OTHER renderer: the card list has no
    // ARIA grid rows at all, which is how a mis-stubbed matchMedia would be caught here.
    expect(screen.queryAllByRole('row').length).toBe(0)
    expect(screen.getByText('Co 0')).toBeTruthy()
    expect(paintedTicker()).toBe('T00')
    act(() => { cfg().onTap() })
    expect(paintedTicker()).toBe('T01')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('⛔ the reveal — a mark outside the virtual window is a mark nobody can see', () => {
  it('walks the cursor past the end of the window and the row is STILL marked on screen', () => {
    // The case the whole file exists for. Two rows in the DOM at a time, twelve in the list:
    // without a reveal the cursor leaves the window on the third tap and NOTHING is painted
    // anywhere, while the chip keeps naming a ticker.
    vwin.size = 2
    openScreener({ rows: ROWS(12) })
    expect(paintedTicker()).toBe('T00')
    for (let i = 0; i < 5; i++) act(() => { cfg().onTap() })
    expect(cfg().readout({})).toBe('T05')
    expect(painted().length, 'the cursor walked out of the virtual window unrevealed').toBe(1)
    expect(paintedTicker()).toBe('T05')
  })

  it('reveals the row the cursor LANDED on, never the one it left', () => {
    openScreener({ rows: ROWS(12) })
    scrollToIndexSpy.mockClear()
    act(() => { cfg().onTap() })
    expect(scrollToIndexSpy).toHaveBeenLastCalledWith(1, { align: 'auto' })
    act(() => { cfg().onDoubleTap() })
    expect(scrollToIndexSpy).toHaveBeenLastCalledWith(0, { align: 'auto' })
  })

  it('clamps at both ends rather than asking for a row that is not there', () => {
    openScreener({ rows: ROWS(2) })
    act(() => { cfg().onDoubleTap() })           // already at the top
    expect(scrollToIndexSpy).toHaveBeenLastCalledWith(0, { align: 'auto' })
    act(() => { cfg().onTap() })
    act(() => { cfg().onTap() })                 // already at the bottom
    expect(scrollToIndexSpy).toHaveBeenLastCalledWith(1, { align: 'auto' })
  })

  it('an empty result asks for no reveal at all', () => {
    openScreener({ rows: [] })
    scrollToIndexSpy.mockClear()
    act(() => { cfg().onTap() })
    act(() => { cfg().onDoubleTap() })
    expect(scrollToIndexSpy).not.toHaveBeenCalled()
    expect(painted()).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the charts gallery — the third renderer, painted imperatively', () => {
  const card = (t) => document.querySelector(`[data-testid="gallery-card-${t}"]`)

  it('marks the cursor’s CARD, and moves the mark on a tap', () => {
    openScreener({ rows: ROWS(4), view: 'charts' })
    // Non-vacuity: the gallery really is what rendered — cards exist and grid rows do not.
    expect(card('T00')).toBeTruthy()
    expect(screen.queryAllByRole('row').length).toBe(0)

    expect(card('T00').getAttribute('data-hub-cursor')).toBe('active')
    act(() => { cfg().onTap() })
    expect(card('T01').getAttribute('data-hub-cursor')).toBe('active')
    // ⛔ AND THE OLD ONE IS CLEARED. `paintCursor` writes outside React, so a stale attribute
    // would never be reconciled away — two marked cards is the failure mode that looks fine
    // one tap at a time.
    expect(card('T00').getAttribute('data-hub-cursor')).toBeNull()
    expect(painted().length).toBe(1)
  })
})

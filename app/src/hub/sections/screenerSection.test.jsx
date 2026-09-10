/**
 * Phase 3 §3.3 — the Screener section, driven through the REAL page.
 *
 * ⛔ WHY THIS MOUNTS `ScannerShell` INSTEAD OF A STAND-IN.
 * Phase 2 shipped a hub whose every prop was wrong while both unit suites stayed green, because
 * each half tested its own idea of the seam and neither tested the join (`contracts.js` header).
 * The two claims this section lives or dies on are both joins:
 *
 *   1. the cursor walks `displayRows` — the array AS RENDERED, after the live re-sort — and NOT
 *      `rows`. A harness holding its own array could not tell those apart, because in a harness
 *      they are the same object;
 *   2. `scrollTo` reaches the results renderer's `scrollToIndex`. That seam has existed since
 *      Phase 1 with NOTHING consuming it, so a test that stubs the renderer proves only that the
 *      stub was called.
 *
 * So the page is mounted, the config is taken from the REAL `HubProvider` registration, and
 * `@tanstack/react-virtual` is faked at the LIBRARY boundary — one level below `VirtualResults`
 * — so the component's own `useImperativeHandle` still runs and the ref still has to land.
 *
 * ⚠️ `app/src/hub/PlanTradeSheet.jsx` (the 3.4 Journal integrator's) does not exist on this
 * branch. It is deliberately NOT imported and NOT mocked: Vite resolves static and dynamic
 * imports alike at build time, so a mock of a path that is not there would fail resolution
 * rather than stand in for it. The hand-off is asserted as a PROPS OBJECT instead, which is what
 * the gate actually asks for ("carries symbol + optional lastPrice and nothing else").
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention — mirrors breadthSection.test.jsx / useJoystick.test.js): `vitest -t`
// is a REGEX, and a filter matching nothing exits 0 and reads as a PASS. These counters catch a
// `-t` typo or a stray `.only`/`.skip` that would report a partial run as a full one.
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

const { META, scanState, PRICES, scrollToIndexSpy, alertSpy } = vi.hoisted(() => ({
  META: {
    categories: [{ key: 'descriptive', label: 'Descriptive' }],
    filters: [],
    views: [{ key: 'overview', label: 'Overview', columns: ['ticker', 'price', 'chg_pct_1d'] }],
  },
  // The scan hook's answer, mutable so a RE-FETCH can be simulated the way the page sees one.
  scanState: { current: null },
  // ⭐ A live overlay that DISAGREES with the snapshot prices, so turning the live re-sort on
  // produces a DIFFERENT order. A fixture where both orders coincide cannot tell them apart
  // (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
  PRICES: { AAA: { price: 3 }, BBB: { price: 200 }, CCC: { price: 50 } },
  scrollToIndexSpy: vi.fn(),
  alertSpy: vi.fn(),
}))

// ── the library boundary, NOT the component. See the header. ────────────────
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: Math.min(count, 8) }, (_, i) => ({
      index: i, key: i, start: i * 30, size: 30,
    })),
    getTotalSize: () => count * 30,
    scrollToIndex: scrollToIndexSpy,
  }),
}))

// ── the page's outside world ────────────────────────────────────────────────
vi.mock('../../pages/screener/hooks/useScreenerMeta', () => ({
  default: () => ({ meta: META, isLoading: false }),
}))
vi.mock('../../pages/screener/hooks/useScreenerScan', () => ({
  default: () => scanState.current,
}))
vi.mock('../../pages/screener/ScreensManager', () => ({ default: () => null }))
vi.mock('../../components/screener/StructureProvenance', () => ({ default: () => null }))
vi.mock('../../pages/charts/review/ReviewChartsButton', () => ({ default: () => null }))
vi.mock('../../utils/prefetchBars', () => ({ prefetchBars: () => {} }))
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: PRICES, isStreaming: true }),
}))
vi.mock('../../components/TickerPopup', () => ({
  default: ({ children }) => <span>{children}</span>,
}))
vi.mock('../../components/TickerActions', () => ({
  default: () => null,
  useTickerActions: () => ({ longPressProps: () => ({}), menu: null, closeMenu: () => {} }),
}))
vi.mock('../../components/PatternFeedbackChip', () => ({ default: () => null }))
// ⭐ PARTIAL: the REAL `AuthContext` object survives, because `ScreenerActionsBridge` reads it
// with `useContext` to decide whether an `AuthProvider` is present at all. Only `useAuth` — the
// hook that THROWS outside a provider — is stubbed, so the bridge's guard is exercised rather
// than mocked away.
vi.mock('../../context/AuthContext', async (importOriginal) => ({
  ...(await importOriginal()),
  useAuth: () => ({ user: null }),
}))
vi.mock('swr', () => ({
  default: () => ({ data: null, isLoading: false, error: null, mutate: () => {} }),
  mutate: () => {},
  useSWRConfig: () => ({ mutate: () => {} }),
}))
// The alert path is the app's real one; only the network call at the end is stubbed, so the
// section still has to hand it (sym, price, direction) in that order.
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: alertSpy, alerts: [], deleteAlert: () => {} }),
}))

import ScannerShell from '../../pages/screener/shell/ScannerShell'
import { encodeSpec, SPEC_PARAM } from '../../pages/screener/shell/specUrl'
import { AuthContext } from '../../context/AuthContext'
import { HubProvider, useHub } from '../HubContext'
import { validateSectionConfig, validateListAdapter, validateChipReadout } from '../contracts'
import { modesById } from '../registry'
import useHubCursor, { _reset as resetCursors } from '../useHubCursor'
import {
  LIST_ID, SCAN_MODE_ID, identityKey, tickerOf, activeScanName, chipLabel,
  planTradeProps, alertConfirmPayload, buildScanFan, createScreenerSection,
} from './screenerSection'

// ── fixtures ───────────────────────────────────────────────────────────────
/** Snapshot order: AAA, BBB, CCC (descending `price` as the SERVER returned it). */
const PAGE_1 = [
  { ticker: 'AAA', company: 'Alpha', price: 300, chg_pct_1d: 1 },
  { ticker: 'BBB', company: 'Beta', price: 200, chg_pct_1d: 2 },
  { ticker: 'CCC', company: 'Gamma', price: 100, chg_pct_1d: 3 },
]
/** A different scan entirely — no ticker in common, which is what must reset the cursor. */
const OTHER = [
  { ticker: 'XXX', company: 'Xigma', price: 30, chg_pct_1d: 1 },
  { ticker: 'YYY', company: 'Ypsilon', price: 20, chg_pct_1d: 2 },
]

const answer = (rows, total = rows.length) => ({
  result: { rows, total, page: 1, view_columns: ['ticker', 'price', 'chg_pct_1d'] },
  isLoading: false,
  error: null,
})

// ── harness ────────────────────────────────────────────────────────────────
let registered = null
let hubSymbol = null
function ConfigProbe() {
  const hub = useHub()
  registered = hub.activeModeConfig
  hubSymbol = hub.symbol
  return null
}

/** The config the page ACTUALLY registered with the provider — re-read after every render. */
const cfg = () => {
  if (!registered) throw new Error('no hub config registered — the page never called useHubMode')
  return registered
}

/** The ctx `HubRoot` builds and passes first to every callback. */
const ctx = () => ({ mode: 'scan', symbol: hubSymbol, timeframe: null, chartRef: { current: null } })

/**
 * Open the screener with a working spec in the URL, through the app's OWN codec — never a
 * hand-written query string. `useScreenSpec` decodes exactly this on mount.
 */
function openScreener({ rows = PAGE_1, total, scanLabel = null } = {}) {
  scanState.current = answer(rows, total ?? rows.length)
  const filters = scanLabel
    ? { scan: { op: 'in', value: 'defhash1', label: scanLabel } }
    : {}
  const s = encodeSpec({ filters, sort: { key: 'price', dir: 'desc' }, view: 'overview', columns: null })
  window.history.replaceState({}, '', `/screener?${SPEC_PARAM}=${s}`)
  return render(tree())
}

/** The real providers the shell mounts under: auth (so the actions bridge arms) and the hub. */
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

/** The tickers the REAL results grid is showing, top to bottom. */
const renderedTickers = () => screen.getAllByRole('row')
  .map((r) => r.textContent.match(/^[A-Z]{2,5}/)?.[0])
  .filter(Boolean)

/**
 * ⭐ THE HUB'S OWN MOUNT FLOOR, STUBBED — because the section's Flag/Alert bridge is armed by
 * `useHubEligible()` and nothing else. jsdom fails that floor by construction (no
 * `backdrop-filter`, no `visualViewport`), which is exactly what keeps this change invisible to
 * the shell's own bare-render suites; here we make the environment look like the phone the hub
 * actually ships on, so the arming path is tested rather than assumed.
 *
 * ⛔ PER-QUERY, never a blanket `matches: true`. `ScannerShell` also asks `useIsPhone()`; a
 * matchMedia that says yes to everything would swap the desktop grid for the phone cards and
 * silently move this whole file onto a different renderer.
 */
const realVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport')
const realMatchMedia = window.matchMedia
const realCSS = globalThis.CSS
const HUB_VIEWPORT_QUERY = '(max-width: 1023px) and (pointer: coarse)'

function stubHubCapableEnvironment() {
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
}

beforeEach(() => {
  stubHubCapableEnvironment()
  resetCursors()
  registered = null
  hubSymbol = null
  scrollToIndexSpy.mockClear()
  alertSpy.mockClear()
  try { localStorage.clear() } catch { /* jsdom always has it */ }
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
describe('the bindings, read off the real page', () => {
  it('registers a config the contract accepts, over the scan mode', () => {
    openScreener()
    expect(cfg().id).toBe(SCAN_MODE_ID)
    // ⛔ The registry entry must be SPREAD IN: `HubRoot` calls `fanFor(activeModeConfig)`, whose
    // last line is `mode.fan.filter(...)` unguarded. A bare HubSectionConfig throws there.
    expect(Array.isArray(cfg().fan)).toBe(true)
    expect(cfg().color).toBe(modesById[SCAN_MODE_ID].color)
    expect(() => validateSectionConfig(cfg(), 'screener')).not.toThrow()
    expect(() => validateListAdapter(cfg().listAdapter, 'screener')).not.toThrow()
    expect(() => validateChipReadout(cfg().readout(ctx()), 'screener')).not.toThrow()
  })

  it('the cursor walks the list id the REGISTRY names, not a typed one', () => {
    expect(LIST_ID).toBe(modesById[SCAN_MODE_ID].cursor.listId)
  })

  it('identityKey is r => r.ticker, explicitly', () => {
    openScreener()
    expect(cfg().listAdapter.identityKey).toBe(identityKey)
    expect(cfg().listAdapter.identityKey(PAGE_1[0])).toBe('AAA')
    // No screener row carries `sym` or `symbol` — the field the deleted default probed for.
    for (const row of PAGE_1) {
      expect(row.sym).toBeUndefined()
      expect(row.symbol).toBeUndefined()
    }
  })

  it('⛔ registering a list WITHOUT a key throws — there is no positional fallback', () => {
    function Bad() {
      useHubCursor('scan-bad', PAGE_1, {})
      return null
    }
    expect(() => render(<Bad />)).toThrow(/requires an explicit opts\.key/)
  })

  it('⛔ the adapter holds displayRows — the LIVE-RESORTED order, not `rows`', () => {
    openScreener()
    // Snapshot order first: price desc, as the server returned it.
    expect(renderedTickers()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(cfg().listAdapter.items.map(tickerOf)).toEqual(['AAA', 'BBB', 'CCC'])

    // Turn on the live re-sort. The overlay disagrees with the snapshot, so the ORDER CHANGES.
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Re-sort loaded rows live/ })) })

    expect(renderedTickers()).toEqual(['BBB', 'CCC', 'AAA'])
    // The whole point: the adapter follows the screen, not the fetch.
    expect(cfg().listAdapter.items.map(tickerOf)).toEqual(renderedTickers())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the cursor — reset vs follow', () => {
  it('a RE-SORT with the same tickers FOLLOWS the selected ticker', () => {
    openScreener()
    act(() => { cfg().onTap() })   // AAA -> BBB
    expect(cfg().readout(ctx())).toBe('BBB')

    act(() => { fireEvent.click(screen.getByRole('button', { name: /Re-sort loaded rows live/ })) })

    // BBB moved from index 1 to index 0. The member never asked to go home.
    expect(renderedTickers()).toEqual(['BBB', 'CCC', 'AAA'])
    expect(cfg().readout(ctx())).toBe('BBB')
    expect(cfg().label).toBe('Screener · 1/3')
  })

  it('a RE-FETCH returning different tickers RESETS the cursor to the first row', () => {
    const { rerender } = openScreener()
    act(() => { cfg().onTap() })
    act(() => { cfg().onTap() })
    expect(cfg().readout(ctx())).toBe('CCC')

    // The page's own re-fetch path: a page-1 result replaces `rows` wholesale.
    scanState.current = answer(OTHER)
    act(() => { rerender(tree()) })

    expect(renderedTickers()).toEqual(['XXX', 'YYY'])
    expect(cfg().readout(ctx())).toBe('XXX')
    expect(cfg().label).toBe('Screener · 1/2')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the reveal — the scrollToIndex seam nothing consumed until now', () => {
  it('the ref lands on the RESULTS renderer, so the adapter can reach scrollToIndex', () => {
    openScreener()
    // `VirtualResults` exposes `scrollToIndex` through its own `useImperativeHandle`; this is
    // the real component's handle, reached through the real `ref` prop.
    expect(typeof cfg().listAdapter.scrollTo).toBe('function')
    act(() => { cfg().listAdapter.scrollTo(2) })
    expect(scrollToIndexSpy).toHaveBeenCalledWith(2, { align: 'auto' })
  })

  it('committing a scrub reveals the row the cursor LANDED on', () => {
    openScreener()
    act(() => { cfg().onScrub(ctx(), { delta: 1, axis: 'y' }) })
    expect(cfg().readout(ctx())).toBe('CCC')
    scrollToIndexSpy.mockClear()
    act(() => { cfg().onScrubCommit(ctx()) })
    expect(scrollToIndexSpy).toHaveBeenCalledWith(2, { align: 'auto' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the chip', () => {
  it('⛔ denominates by the LOADED length, never by `total`', () => {
    // 3 rows in hand out of 3,745 server matches — the exact shape the plan calls out.
    openScreener({ rows: PAGE_1, total: 3745 })
    expect(cfg().label).toBe('Screener · 1/3')
    expect(cfg().label).not.toMatch(/3745|3,745/)
  })

  it('names the active scan when the screen carries one', () => {
    openScreener({ scanLabel: 'Powerplay' })
    expect(cfg().label).toBe('Powerplay · 1/3')
  })

  it('falls back to "Screener" when no scan filter is applied', () => {
    expect(activeScanName(undefined)).toBeNull()
    expect(activeScanName({ scan: { op: 'in', value: 'h' } })).toBeNull()
    expect(activeScanName({ scan: { label: '  Powerplay  ' } })).toBe('Powerplay')
    expect(chipLabel({ scanName: null, index: 2, count: 41 })).toBe('Screener · 3/41')
    expect(chipLabel({ scanName: 'Powerplay', index: 0, count: 41 })).toBe('Powerplay · 1/41')
    expect(chipLabel({ scanName: null, index: -1, count: 0 })).toBe('Screener · no results')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the fan', () => {
  const fanById = () => Object.fromEntries(cfg().fan.map((a) => [a.id, a]))

  it('Chart it carries the symbol through the charts page\'s OWN deep link', () => {
    openScreener()
    expect(fanById()['scan.chartIt'].to).toBe('/charts?sym=AAA')
    act(() => { cfg().onTap() })
    expect(fanById()['scan.chartIt'].to).toBe('/charts?sym=BBB')
  })

  it('Why? opens /ai-search prefilled with the ticker', () => {
    openScreener()
    const to = fanById()['scan.why'].to
    expect(to.startsWith('/ai-search?q=')).toBe(true)
    expect(decodeURIComponent(to.slice('/ai-search?q='.length))).toContain('AAA')
  })

  it('⛔ Scans is ABSENT, not a dead bubble — ScreensManager exposes no open seam', () => {
    openScreener()
    expect(modesById[SCAN_MODE_ID].fan.some((a) => a.id === 'scan.scans')).toBe(true)
    expect(cfg().fan.some((a) => a.id === 'scan.scans')).toBe(false)
  })

  it('keeps Voice and Home, and every id it ships is one the REGISTRY declared', () => {
    openScreener()
    const registryIds = new Set(modesById[SCAN_MODE_ID].fan.map((a) => a.id))
    for (const a of cfg().fan) expect(registryIds.has(a.id)).toBe(true)
    expect(cfg().fan.some((a) => a.id === 'scan.voice')).toBe(true)
    expect(cfg().fan.some((a) => a.kind === 'home')).toBe(true)
  })

  it('an unknown registry action is DROPPED rather than shipped inert', () => {
    const fan = buildScanFan({ symbol: 'AAA' })
    expect(fan.some((a) => a.id === 'scan.scans')).toBe(false)
    // Every action the section DOES ship is either navigable or carries a handler.
    for (const a of fan) {
      const wired = a.kind === 'navigate' || a.kind === 'home'
        || a.id.endsWith('.voice') || typeof a.run === 'function'
        || typeof a.confirmPayload === 'function'
      expect(wired, `${a.id} is present but unwired`).toBe(true)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Flag — asserted by RENDERED TEXT, never by state', () => {
  const flagAction = () => cfg().fan.find((a) => a.id === 'scan.flag')

  it('says "Flagged AAA", then "Unflagged AAA" on the way back', () => {
    openScreener()
    act(() => { flagAction().run(ctx()) })
    expect(screen.getByText('Flagged AAA')).toBeTruthy()

    act(() => { flagAction().run(ctx()) })
    expect(screen.getByText('Unflagged AAA')).toBeTruthy()
  })

  it('names the ticker under the cursor, not the first row', () => {
    openScreener()
    act(() => { cfg().onTap() })
    act(() => { flagAction().run(ctx()) })
    expect(screen.getByText('Flagged BBB')).toBeTruthy()
  })

  it('⛔ is INERT where the hub cannot render — the bridge is armed by the mount floor', () => {
    // The non-vacuity control for the gate (`lesson_gate_that_cannot_fail`). Put the environment
    // back to a plain desktop jsdom — no backdrop-filter, no visualViewport — and the bridge
    // must not mount: no `/api/watchlist-alerts` poll, no flagged sync, and Flag no-ops rather
    // than throwing. This is the state EVERY other screener suite renders in, which is why they
    // are unaffected by this section.
    globalThis.CSS = undefined
    delete window.visualViewport
    openScreener()
    expect(() => act(() => { flagAction().run(ctx()) })).not.toThrow()
    expect(screen.queryByText('Flagged AAA')).toBeNull()
    expect(localStorage.getItem('uct_flagged')).toBeNull()
  })

  it('really writes the flag — the toast is not the only thing that happened', () => {
    openScreener()
    act(() => { flagAction().run(ctx()) })
    expect(JSON.parse(localStorage.getItem('uct_flagged'))).toContain('AAA')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the shared symbol', () => {
  it('⛔ is written to the hub, or every requires:["symbol"] action renders DISABLED', () => {
    openScreener()
    expect(hubSymbol).toBe('AAA')
    act(() => { cfg().onTap() })
    expect(hubSymbol).toBe('BBB')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Plan trade — the hand-off carries symbol + optional lastPrice and NOTHING else', () => {
  it('is exactly {symbol, lastPrice} when the stream has a price', () => {
    const props = planTradeProps({ symbol: 'NVDA', lastPrice: 123.45 })
    expect(props).toEqual({ symbol: 'NVDA', lastPrice: 123.45 })
    expect(Object.keys(props).sort()).toEqual(['lastPrice', 'symbol'])
  })

  it('is exactly {symbol} when it does not — blank means blank', () => {
    for (const lastPrice of [undefined, null, 0, -1, Number.NaN]) {
      const props = planTradeProps({ symbol: 'NVDA', lastPrice })
      expect(props).toEqual({ symbol: 'NVDA' })
      expect(Object.keys(props)).toEqual(['symbol'])
    }
  })

  it('never fabricates entry / stop / size — the Screener cannot supply them', () => {
    const props = planTradeProps({ symbol: 'NVDA', lastPrice: 10 })
    for (const forbidden of ['entry', 'stop', 'size', 'rValue', 'side']) {
      expect(props).not.toHaveProperty(forbidden)
    }
  })

  it('opens the REAL sheet on the STREAM price, with stop and size honestly blank', () => {
    // ⛔ NOTHING ON THIS PATH IS MOCKED — the Journal integrator's own `hub/PlanTradeSheet.jsx`
    // is rendered, because the claim under test is a JOIN: that the Screener door hands it a
    // symbol and a last price and NOT a fabricated entry/stop/size. A probe standing in for the
    // sheet would prove only that the probe was called.
    openScreener()
    // AAA: snapshot price 300, STREAM price 3. `entry` must seed from the live one.
    const planTrade = cfg().fan.find((a) => a.id === 'scan.planTrade')
    act(() => { planTrade.run(ctx()) })

    expect(screen.getByTestId('hub-plan-symbol').textContent).toBe('AAA')
    expect(screen.getByTestId('hub-plan-entry').value).toBe('3')
    // ⛔⛔ BLANK MEANS BLANK: the Screener cannot supply a stop or a size, so neither is
    // invented and "Save plan" stays disabled until the member fills them in.
    expect(screen.getByTestId('hub-plan-stop').value).toBe('')
    expect(screen.getByTestId('hub-plan-size').value).toBe('')
    expect(screen.getByTestId('hub-plan-save')).toBeDisabled()
    expect(screen.getByTestId('hub-plan-r').textContent).toContain('—')
  })

  it('a row with NO stream price opens the sheet with entry blank and Save disabled', () => {
    // The third A5 case, and the one that is not a happy path: the test that stops a future
    // "helpful" default from inventing a level.
    openScreener({ rows: [{ ticker: 'ZZZ', company: 'Zeta', price: 42, chg_pct_1d: 0 }] })
    act(() => { cfg().fan.find((a) => a.id === 'scan.planTrade').run(ctx()) })
    expect(screen.getByTestId('hub-plan-symbol').textContent).toBe('ZZZ')
    // ⛔ NOT 42. `row.price` is the 03:00 snapshot; only the stream may seed `entry`.
    expect(screen.getByTestId('hub-plan-entry').value).toBe('')
    expect(screen.getByTestId('hub-plan-save')).toBeDisabled()
  })

  it('refuses to build a hand-off with no symbol', () => {
    expect(planTradeProps({ symbol: null })).toBeNull()
    expect(planTradeProps({ symbol: '   ' })).toBeNull()
    expect(planTradeProps()).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('Alert — a confirm payload the sheet accepts, or nothing at all', () => {
  it('builds a payload validateConfirmPayload accepts, defaulting to the shown price', () => {
    const payload = alertConfirmPayload({ symbol: 'AAA', reference: 12.345, createAlert: alertSpy })
    expect(payload.fields).toEqual([{ name: 'price', type: 'number', value: 12.35, min: 0.01, step: 0.01 }])
    expect(payload.title).toContain('AAA')
    payload.onConfirm({ price: 20 })
    expect(alertSpy).toHaveBeenCalledWith('AAA', 20, 'above')
    payload.onConfirm({ price: 5 })
    expect(alertSpy).toHaveBeenLastCalledWith('AAA', 5, 'below')
  })

  it('is null when no price is known — never a sheet built around a fabricated level', () => {
    expect(alertConfirmPayload({ symbol: 'AAA', reference: null, createAlert: alertSpy })).toBeNull()
    expect(alertConfirmPayload({ symbol: 'AAA', reference: 0, createAlert: alertSpy })).toBeNull()
    expect(alertConfirmPayload({ symbol: '', reference: 10, createAlert: alertSpy })).toBeNull()
  })

  it('takes its reference from the LIVE overlay when there is one', () => {
    openScreener()
    // AAA renders at the stream price 3, not the snapshot 300.
    const payload = cfg().fan.find((a) => a.id === 'scan.alert').confirmPayload(ctx())
    expect(payload.fields[0].value).toBe(3)
  })

  it('firing it creates the alert through the app’s own path, at the price on screen', () => {
    openScreener()
    act(() => { cfg().fan.find((a) => a.id === 'scan.alert').run(ctx()) })
    expect(alertSpy).toHaveBeenCalledWith('AAA', 3, 'above')
  })

  it('creates NOTHING when no price is known — never an alert at a fabricated level', () => {
    openScreener({ rows: [{ ticker: 'ZZZ', company: 'Zeta', chg_pct_1d: 0 }] })
    act(() => { cfg().fan.find((a) => a.id === 'scan.alert').run(ctx()) })
    expect(alertSpy).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('the scrub — a STEP, accumulated', () => {
  const harness = ({ count = 41, index = 0, hasMore = false, loadMore = () => {} } = {}) => {
    const rows = Array.from({ length: count }, (_, i) => ({ ticker: `T${i}`, price: 1 }))
    const calls = { scrubTo: [], scrollTo: [], next: 0, prev: 0 }
    const scrubRef = { current: null }
    const make = (at) => createScreenerSection({
      rows,
      scanName: null,
      index: at,
      count,
      symbol: rows[at]?.ticker ?? null,
      streamPrice: null,
      shownPrice: null,
      next: () => { calls.next += 1 },
      prev: () => { calls.prev += 1 },
      scrubTo: (d) => calls.scrubTo.push(d),
      scrollTo: (i) => calls.scrollTo.push(i),
      hasMore,
      loadMore,
      onFlag: () => {},
      onPlanTrade: () => {},
      createAlert: () => {},
      scrubRef,
    })
    return { rows, calls, scrubRef, make, cfgAt: make(index) }
  }

  it('⛔ accumulates: `delta` is a per-move STEP, not an absolute position', () => {
    // `useJoystick` emits `(thisMove - lastMove) / travelPx`. Passing it straight through would
    // pin the cursor to the same place on every drag; three 0.1 steps must reach 0.3.
    const h = harness()
    const c = h.cfgAt
    c.onScrub({}, { delta: 0.1, axis: 'y' })
    c.onScrub({}, { delta: 0.1, axis: 'y' })
    c.onScrub({}, { delta: 0.1, axis: 'y' })
    expect(h.calls.scrubTo.map((n) => Number(n.toFixed(4)))).toEqual([0.1, 0.2, 0.3])
  })

  it('ignores the occasional off-axis move an unsteady thumb produces', () => {
    const h = harness()
    h.cfgAt.onScrub({}, { delta: 0.5, axis: 'x' })
    expect(h.calls.scrubTo).toEqual([])
  })

  it('ignores a payload that is not a scrub, and never reads the FIRST argument', () => {
    const h = harness()
    h.cfgAt.onScrub({ delta: 0.5, axis: 'y' })            // the deleted R-05 shim's shape
    h.cfgAt.onScrub({}, null)
    h.cfgAt.onScrub({}, { delta: Number.NaN, axis: 'y' })
    expect(h.calls.scrubTo).toEqual([])
  })

  it('clamps at both ends instead of wrapping', () => {
    const h = harness()
    h.cfgAt.onScrub({}, { delta: 5, axis: 'y' })
    h.cfgAt.onScrub({}, { delta: -9, axis: 'y' })
    expect(h.calls.scrubTo).toEqual([1, 0])
  })

  it('seeds from the row already selected, so a drag starts where the member is', () => {
    const h = harness({ index: 20, count: 41 })
    h.cfgAt.onScrub({}, { delta: 0, axis: 'y' })
    expect(h.calls.scrubTo[0]).toBeCloseTo(0.5, 5)
  })

  it('commit reveals the landed row and clears the accumulator', () => {
    const h = harness()
    h.cfgAt.onScrub({}, { delta: 0.5, axis: 'y' })
    h.cfgAt.onScrubCommit({})
    expect(h.calls.scrollTo).toEqual([20])
    expect(h.scrubRef.current).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('tap and the page boundary', () => {
  const build = ({ index, count, hasMore, loadMore }) => createScreenerSection({
    rows: Array.from({ length: count }, (_, i) => ({ ticker: `T${i}` })),
    scanName: null, index, count,
    symbol: null, streamPrice: null, shownPrice: null,
    next: () => {}, prev: () => {}, scrubTo: () => {}, scrollTo: () => {},
    hasMore, loadMore,
    onFlag: () => {}, onPlanTrade: () => {}, createAlert: () => {},
    scrubRef: { current: null },
  })

  it('asks for the next page as the cursor reaches the tail of the loaded rows', () => {
    const loadMore = vi.fn()
    build({ index: 98, count: 100, hasMore: true, loadMore }).onTap()
    expect(loadMore).toHaveBeenCalledTimes(1)
  })

  it('does not ask mid-list, and never when the server has nothing more', () => {
    const loadMore = vi.fn()
    build({ index: 10, count: 100, hasMore: true, loadMore }).onTap()
    build({ index: 99, count: 100, hasMore: false, loadMore }).onTap()
    expect(loadMore).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
describe('readout — the chip narrates the ticker under the cursor', () => {
  it('is the ticker, and stays a valid ChipReadout when the list is empty', () => {
    openScreener()
    expect(cfg().readout(ctx())).toBe('AAA')
    act(() => { cfg().onTap() })
    expect(cfg().readout(ctx())).toBe('BBB')

    const empty = createScreenerSection({
      rows: [], scanName: null, index: -1, count: 0,
      symbol: null, streamPrice: null, shownPrice: null,
      next: () => {}, prev: () => {}, scrubTo: () => {}, scrollTo: () => {},
      hasMore: false, loadMore: () => {},
      onFlag: () => {}, onPlanTrade: () => {}, createAlert: () => {},
      scrubRef: { current: null },
    })
    expect(() => validateChipReadout(empty.readout({}), 'empty screener')).not.toThrow()
  })
})

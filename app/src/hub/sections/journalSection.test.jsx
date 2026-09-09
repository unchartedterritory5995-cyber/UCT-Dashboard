/**
 * Phase 3 §3.4 — the Journal section, driven through the REAL `OpenPositionsTab`.
 *
 * ⛔ WHY THIS MOUNTS THE PAGE INSTEAD OF A STAND-IN.
 * Phase 2 shipped a hub whose every prop was wrong while both unit suites stayed green, because
 * each half tested its own idea of the seam and neither tested the join (`contracts.js` header).
 * A harness that rendered its own rows would reproduce that exactly: `journalSection.js` could be
 * perfect and the carriers could be missing, and this file would not notice. So the page is
 * mounted, the config is taken from the REAL `HubProvider` registration, the cursor's order is
 * read off the REAL rendered rows, and the write is asserted at the REAL `fetch`.
 *
 * The load-bearing tests:
 *   * `the PUT body is {stopPrice} and NOTHING else` — `_UPDATABLE_FIELDS` accepts ten keys
 *     including `symbol`, so a stray key can retag the position to another ticker while every
 *     assertion about the stop still passes.
 *   * `the cursor walks the RENDERED order` — the array the tab holds is deliberately in a
 *     different order from the rows on screen.
 *   * `an option row publishes NO position` — its id is a strategy id and the PUT would 404.
 */
import { describe, it as vitestIt, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { render, screen, act, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// ⛔ RAIL (house convention): `vitest -t` is a REGEX, and a filter matching nothing exits 0 and
// reads as a PASS. These counters catch a `-t` typo or a stray `.only`/`.skip`.
let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

// ── the page's outside world, stubbed at the door ──────────────────────────
// ⛔ MOCK ONLY WHAT THE TAB ACTUALLY IMPORTS (this file's own house rule, see
// OpenPositionsTab.view.test.jsx): a mock of a module nobody imports intercepts nothing and can
// never fail for the reason it was written. `HoldingsList` and `PositionsTable` are deliberately
// NOT mocked — they carry the three `data-hub-pos` lines this wave adds, and mocking them would
// delete the only thing the cursor reads.
const data = vi.hoisted(() => ({
  positions: [], strategies: [], prices: {}, isStreaming: false,
}))

vi.mock('../../pages/journal-2-0/hooks/useJ2Positions', () => ({
  default: () => ({
    positions: data.positions, isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../../pages/journal-2-0/hooks/useJ2OptionStrategies', () => ({
  default: () => ({
    strategies: data.strategies, isLoading: false, error: null, refresh: vi.fn(),
  }),
}))
vi.mock('../../pages/journal-2-0/hooks/useJ2OptionMarks', () => ({
  default: () => ({ marks: null }),
}))
vi.mock('../../pages/journal-2-0/hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: { id: 'a1', name: 'Test' }, accounts: [] }),
}))
vi.mock('../../pages/journal-2-0/hooks/useJ2Nudges', () => ({ default: () => ({ nudges: null }) }))
vi.mock('../../pages/journal-2-0/hooks/useBrokerWarming', () => ({
  default: () => ({ warming: false, broker: null }),
}))
vi.mock('../../pages/journal-2-0/hooks/useHoldingsSparklines', () => ({
  default: () => ({ closes: {} }),
}))
vi.mock('../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: data.prices, isStreaming: data.isStreaming }),
}))
vi.mock('../../pages/journal-2-0/components/BrokerAccountHero', () => ({ default: () => null }))
vi.mock('../../pages/journal-2-0/components/BrokerReviewNudge', () => ({ default: () => null }))
vi.mock('../../pages/journal-2-0/components/NudgesBanner', () => ({ default: () => null }))
vi.mock('../../pages/journal-2-0/components/PortfolioAttentionBanner', () => ({ default: () => null }))
vi.mock('../../pages/journal-2-0/components/broker/BrokerEquityCurve', () => ({ default: () => null }))
vi.mock('../../pages/journal-2-0/components/trust/SyncTrustCenter', () => ({ default: () => null }))
vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
// `PositionsTable` renders a `TickerPopup`, which reaches `useFlagged` and `useTickerTags` ->
// `useAuth`, and that THROWS outside an `AuthProvider`. Stubbed at the door rather than wrapping
// the harness in the whole auth stack: this suite is about the cursor and the write.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user' } }),
}))
vi.mock('../../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))

import OpenPositionsTab from '../../pages/journal-2-0/tabs/OpenPositionsTab'
import { HubProvider, useHub } from '../HubContext'
import { validateSectionConfig } from '../contracts'
import { modesById } from '../registry'
import { _reset as resetCursor } from '../useHubCursor'
import {
  LIST_ID, STOP_TICK, SCRUB_TICKS_PER_TRAVEL, HUB_ROW_ATTR,
  buildCursorItems, candidateStopFor, clampStopToSide, defaultJ2Client, formatScrubReadout,
  normalisePositionKey, positionRequiredActionIds, restChipText, sideFlipRefusal, stopPatchFor,
  surfaceOf,
} from './journalSection'

// ── fixtures ───────────────────────────────────────────────────────────────
// ⭐ THE ARRAY ORDER IS DELIBERATELY NOT THE RENDERED ORDER. `HoldingsList` sorts by market
// value descending, so AAPL (100 x 177.50 = 17,750) renders ABOVE MSFT (20 x 405 = 8,100) while
// the array hands them over the other way round. A cursor reading the array would pass every
// "it moves" test and still step through rows that are not visually adjacent.
const AAPL = {
  id: 'aaa-1', symbol: 'AAPL', side: 'Long', shares: 100,
  entryPrice: 178.10, stopPrice: 176.00, entryDate: '2026-06-01',
}
const MSFT = {
  id: 'bbb-2', symbol: 'MSFT', side: 'Long', shares: 20,
  entryPrice: 400, stopPrice: 390, entryDate: '2026-06-02',
}
const NVDA_CALL = {
  id: 'sss-3', underlying: 'NVDA', strategyType: 'long_call', netEntry: 500,
  entryDate: '2026-06-03', brokerCurrentValue: 600,
  legs: [{ qty: 1, strike: 110, expiration: '2026-10-16', entryPrice: 5 }],
}

let registered = null
function ConfigProbe() {
  registered = useHub().activeModeConfig
  return null
}

/** Everything the hub context is holding — the half HubRoot's `requires` rule reads. */
let hubCtx = null
function ContextProbe() {
  hubCtx = useHub()
  return null
}

const cfg = () => {
  if (!registered) throw new Error('no hub config registered — the tab never called useHubMode')
  return registered
}

/** The context object HubRoot builds. The section ignores it; it is passed for fidelity. */
const CTX = Object.freeze({ mode: 'journal' })

function openTab({ view = 'list', settings = {} } = {}) {
  localStorage.setItem('uct.j2.openPositions.view', view)
  return render(
    <MemoryRouter initialEntries={['/journal/trades']}>
      <HubProvider>
        <OpenPositionsTab settings={settings} />
        <ConfigProbe />
        <ContextProbe />
      </HubProvider>
    </MemoryRouter>,
  )
}

/** The rendered carriers, in document order — the same read the section makes. */
const carrierKeys = () => Array.from(document.querySelectorAll(`[${HUB_ROW_ATTR}]`))
  .map((n) => n.getAttribute(HUB_ROW_ATTR))

const cursorNodeKey = () => document.querySelector('[data-hub-cursor="active"]')
  ?.getAttribute(HUB_ROW_ATTR)

// ⚠️ ONE `act()` PER GESTURE, never a loop inside one: React batches inside an act block, so n
// taps in a single one would all read the SAME pre-render config and land exactly one step.
const tap = (n = 1) => { for (let i = 0; i < n; i += 1) act(() => { cfg().onTap() }) }
const doubleTap = (n = 1) => { for (let i = 0; i < n; i += 1) act(() => { cfg().onDoubleTap() }) }

// ⛔ CONTEXT FIRST — `HubRoot.jsx` calls `onScrub(ctx, scrub)`. `contractArity.test.js` derives
// that from the runtime call site; this harness matches it rather than restating it.
const scrub = (delta, axis = 'y') => act(() => { cfg().onScrub(CTX, { delta, axis }) })
const release = () => act(() => { cfg().onScrubCommit(CTX) })

/** Move the stop by `ticks` in ONE drag step. Up (a raise) is a NEGATIVE screen delta. */
const dragTicks = (ticks) => scrub(-ticks / SCRUB_TICKS_PER_TRAVEL)

let fetchMock
beforeEach(() => {
  registered = null
  hubCtx = null
  data.positions = [MSFT, AAPL]
  data.strategies = []
  data.prices = { AAPL: { price: 177.5, change_pct: -0.3 }, MSFT: { price: 405, change_pct: 1.2 } }
  data.isStreaming = true
  localStorage.clear()
  resetCursor()
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

/** Only the calls this feature makes — SWR and friends share the same stub. */
const stopPuts = () => fetchMock.mock.calls.filter(
  ([url, init]) => String(url).includes('/api/j2/positions/') && init?.method === 'PUT',
)

// ─────────────────────────────────────────────────────────────────────────────
describe('the contract', () => {
  it('the tab registers a config that passes validateSectionConfig', () => {
    openTab()
    expect(() => validateSectionConfig(cfg(), 'journalSection')).not.toThrow()
  })

  it('⛔ the registry mode is spread in, so the chip and fanFor survive', () => {
    // A BARE `HubSectionConfig` — exactly the shape contracts.js documents — blanks the chip and
    // throws inside `fanFor` (`mode.fan.filter`). `validateSectionConfig` cannot catch it.
    openTab()
    expect(cfg().id).toBe('journal')
    expect(cfg().label).toBe(modesById.journal.label)
    expect(cfg().color).toBe(modesById.journal.color)
    expect(Array.isArray(cfg().fan)).toBe(true)
    expect(cfg().fan.map((a) => a.id)).toEqual(modesById.journal.fan.map((a) => a.id))
  })

  it('the list adapter reports the rendered items, an identity key and a scrollTo', () => {
    openTab()
    const adapter = cfg().listAdapter
    expect(Array.isArray(adapter.items)).toBe(true)
    expect(typeof adapter.identityKey).toBe('function')
    expect(typeof adapter.scrollTo).toBe('function')
    expect(LIST_ID).toBe(modesById.journal.cursor.listId)
  })
})

describe('the cursor', () => {
  it('⛔ walks the RENDERED order, not the array the tab holds', () => {
    openTab({ view: 'list' })
    expect(data.positions.map((p) => p.symbol)).toEqual(['MSFT', 'AAPL'])
    expect(carrierKeys()).toEqual(['e-aaa-1', 'e-bbb-2'])
    expect(cfg().listAdapter.items.map((i) => i.symbol)).toEqual(['AAPL', 'MSFT'])
  })

  it('normalises BOTH surfaces to the bare position id and states which surface it was', () => {
    openTab({ view: 'list' })
    expect(cfg().listAdapter.items.map((i) => [i.id, i.surface]))
      .toEqual([['aaa-1', 'list'], ['bbb-2', 'list']])

    cleanup()
    resetCursor()
    openTab({ view: 'table' })
    expect(cfg().listAdapter.items.map((i) => [i.id, i.surface]))
      .toEqual([['aaa-1', 'table'], ['bbb-2', 'table']])
  })

  it('tap advances, double-tap retreats, and both CLAMP rather than wrap', () => {
    openTab()
    expect(cursorNodeKey()).toBe('e-aaa-1')
    tap()
    expect(cursorNodeKey()).toBe('e-bbb-2')
    tap(5)                              // clamps at the last row
    expect(cursorNodeKey()).toBe('e-bbb-2')
    doubleTap(5)                        // clamps at the first
    expect(cursorNodeKey()).toBe('e-aaa-1')
  })

  it('paints data-hub-cursor on exactly one carrier at a time', () => {
    openTab()
    expect(document.querySelectorAll('[data-hub-cursor="active"]').length).toBe(1)
    tap()
    expect(document.querySelectorAll('[data-hub-cursor="active"]').length).toBe(1)
  })
})

describe('the scrub — 0.01 steps, clamped so it never crosses entry', () => {
  it('drag UP raises the stop; the readout tracks every step at 2dp', () => {
    openTab()
    dragTicks(20)
    expect(cfg().readout(CTX)).toBe('stop 176.20 → -0.9R')
    dragTicks(10)
    expect(cfg().readout(CTX)).toBe('stop 176.30 → -0.9R')
  })

  it('drag DOWN lowers it — the sign is inverted because screen y grows downward', () => {
    openTab()
    dragTicks(-50)
    expect(cfg().readout(CTX)).toBe('stop 175.50 → -1.2R')
  })

  it('⛔ a Long stop clamps ONE TICK below the entry, however far the member drags', () => {
    openTab()
    dragTicks(5000)
    expect(cfg().readout(CTX)).toBe('stop 178.09 → -0.0R')
  })

  it('at rest the readout is the position’s own stop', () => {
    openTab()
    expect(cfg().readout(CTX)).toBe('stop 176.00 → -1.0R')
  })

  it('a horizontal move is ignored — the engine reports the dominant axis per move', () => {
    openTab()
    scrub(-0.4, 'x')
    expect(cfg().readout(CTX)).toBe('stop 176.00 → -1.0R')
  })

  it('⛔ the R — case: a position with no risk basis narrates the stop and refuses to invent R', () => {
    // `rAtStop` returns null when the original stop is missing. `Number(null)` is 0 and 0 is
    // finite, so a naive gate would read a MISSING stop as "a stop at zero" and print a number.
    // The real-world shape: a BROKER placeholder stop (`stop_price` is NOT NULL, so imports
    // seed it with the entry). There IS a number to narrate, and there is no risk basis behind
    // it, so R is genuinely unknowable — `initialRisk` is zero.
    data.positions = [{ ...AAPL, source: 'broker', stopPrice: 178.10 }]
    data.prices = { AAPL: { price: 177.5 } }
    openTab()
    expect(cfg().readout(CTX)).toBe('stop 178.10 · R —')
  })
})

describe('the write — the sheet is the only thing that writes', () => {
  it('a release WITHOUT confirm sends nothing', async () => {
    openTab()
    dragTicks(20)
    release()
    expect(await screen.findByTestId('hub-stop-primary')).toHaveTextContent('Set stop 176.20')
    expect(stopPuts()).toHaveLength(0)
    fireEvent.click(screen.getByTestId('hub-stop-cancel'))
    expect(stopPuts()).toHaveLength(0)
  })

  it('a release that never moved opens nothing at all', () => {
    openTab()
    release()
    expect(screen.queryByTestId('hub-stop-primary')).toBeNull()
  })

  it('⛔⛔ confirm issues EXACTLY ONE PUT, to the uuid from the row key, body {stopPrice} and NOTHING else', async () => {
    openTab()
    dragTicks(20)
    release()
    fireEvent.click(await screen.findByTestId('hub-stop-primary'))
    await waitFor(() => expect(stopPuts()).toHaveLength(1))

    const [url, init] = stopPuts()[0]
    // The bare uuid — the list surface's key was `e-aaa-1`.
    expect(url).toBe('/api/j2/positions/aaa-1')
    expect(init.method).toBe('PUT')
    // ⛔ THE EXACT JSON. `_UPDATABLE_FIELDS` accepts ten keys including `symbol`, so a stray key
    // could retag the position to another ticker and every stop assertion would still pass.
    expect(init.body).toBe('{"stopPrice":176.2}')
    expect(JSON.parse(init.body)).toEqual({ stopPrice: 176.2 })
    expect(Object.keys(JSON.parse(init.body))).toEqual(['stopPrice'])
  })

  it('a success toast says what happened, in words the member can read', async () => {
    openTab()
    dragTicks(20)
    release()
    fireEvent.click(await screen.findByTestId('hub-stop-primary'))
    expect(await screen.findByText('Stop on AAPL set to 176.20')).toBeInTheDocument()
  })

  it('a failure toast carries the SERVER’s message, not a generic apology', async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes('/api/j2/positions/') && init?.method === 'PUT') {
        return { ok: false, status: 400, json: async () => ({ detail: 'stop must be below entry for a Long' }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    openTab()
    dragTicks(20)
    release()
    fireEvent.click(await screen.findByTestId('hub-stop-primary'))
    expect(await screen.findByText("Couldn't set the stop: stop must be below entry for a Long"))
      .toBeInTheDocument()
  })
})

describe('⛔ an OPTION row carries a STRATEGY id — every position action is disabled there', () => {
  beforeEach(() => { data.strategies = [NVDA_CALL] })

  it('the cursor may land on it, and the chip reads the row’s own label', () => {
    openTab({ view: 'table' })
    // Table sort is symbol ascending: AAPL, MSFT, then the option row's built label.
    expect(cfg().listAdapter.items.map((i) => i.kind)).toEqual(['position', 'position', 'strategy'])
    tap(2)
    expect(cfg().readout(CTX)).toBe('NVDA')
  })

  it('it publishes NO selectedPosition, which is what disables every requires:"position" bubble', () => {
    openTab({ view: 'table' })
    tap(2)
    // HubRoot's own rule: `have = { position: !!selectedPosition }`, and an action whose
    // `requires` is unmet renders DISABLED. This is the half the section owns.
    expect(hubCtx.selectedPosition).toBeNull()
    expect(hubCtx.symbol).toBe('NVDA')
    expect(positionRequiredActionIds().length).toBeGreaterThan(0)
  })

  it('an EQUITY row publishes the position, and its id is the one the PUT targets', async () => {
    openTab({ view: 'table' })
    expect(hubCtx.selectedPosition.id).toBe('aaa-1')
    dragTicks(20)
    release()
    fireEvent.click(await screen.findByTestId('hub-stop-primary'))
    await waitFor(() => expect(stopPuts()).toHaveLength(1))
    expect(stopPuts()[0][0]).toBe('/api/j2/positions/aaa-1')
  })

  it('a scrub on an option row proposes nothing and opens nothing', () => {
    openTab({ view: 'table' })
    tap(2)
    dragTicks(20)
    release()
    expect(screen.queryByTestId('hub-stop-primary')).toBeNull()
    expect(stopPuts()).toHaveLength(0)
  })
})

describe('the fan — attached now, reachable when the Director flips PREVIEW_MODES', () => {
  it('Move stop opens the sheet with the CURRENT stop prefilled — the non-gesture path', async () => {
    openTab()
    act(() => { cfg().fan.find((a) => a.id === 'journal.moveStop').run() })
    expect(await screen.findByTestId('hub-stop-primary')).toHaveTextContent('Set stop 176.00')
  })

  it('Breakeven seeds the SAME sheet with the entry, clamped one tick inside it', async () => {
    openTab()
    act(() => { cfg().fan.find((a) => a.id === 'journal.breakeven').run() })
    // One PUT path, one sheet — never a second way to write a stop.
    expect(await screen.findByTestId('hub-stop-primary')).toHaveTextContent('Set stop 178.09')
  })

  it('Close hands the position to the tab’s own close modal — no new write path', async () => {
    openTab()
    act(() => { cfg().fan.find((a) => a.id === 'journal.close').run() })
    expect(await screen.findByText(/Close AAPL/i)).toBeInTheDocument()
  })

  it('Close is flickable:false and every write action requires a position', () => {
    const close = modesById.journal.fan.find((a) => a.id === 'journal.close')
    expect(close.flickable).toBe(false)
    expect(positionRequiredActionIds()).toEqual(['journal.moveStop', 'journal.breakeven', 'journal.close'])
  })

  it('the Journal’s Plan-trade door opens the sheet PREFILLED from the selected position', async () => {
    openTab()
    act(() => { cfg().fan.find((a) => a.id === 'journal.addTrade').run() })
    expect(await screen.findByTestId('hub-plan-entry')).toHaveValue(178.1)
    expect(screen.getByTestId('hub-plan-stop')).toHaveValue(176)
    expect(screen.getByTestId('hub-plan-size')).toHaveValue(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('the pure halves, in isolation', () => {
  it('normalisePositionKey and surfaceOf read one string two ways', () => {
    expect(normalisePositionKey('e-abc')).toBe('abc')
    expect(normalisePositionKey('abc')).toBe('abc')
    expect(normalisePositionKey(null)).toBe('')
    expect(surfaceOf('e-abc')).toBe('list')
    expect(surfaceOf('abc')).toBe('table')
  })

  it('the tick is one cent at three price magnitudes (D-31, a stated simplification)', () => {
    const one = (current, entry) => candidateStopFor({
      current, entry, side: 'Long', delta: -1 / SCRUB_TICKS_PER_TRAVEL,
    })
    expect(one(0.30, 10)).toBe(0.31)
    expect(one(178.10, 200)).toBe(178.11)
    expect(one(4000, 5000)).toBe(4000.01)
    expect(STOP_TICK).toBe(0.01)
  })

  it('⛔ clampStopToSide never returns zero or a side-flipping stop', () => {
    // `stopPrice: 0` is an undocumented stop-REMOVAL path the backend's own side check skips
    // (R-08). The gesture and the steppers both go through here, so neither can reach it.
    expect(clampStopToSide({ stop: -5, entry: 100, side: 'Long' })).toBe(0.01)
    expect(clampStopToSide({ stop: 0, entry: 100, side: 'Long' })).toBe(0.01)
    expect(clampStopToSide({ stop: 120, entry: 100, side: 'Long' })).toBe(99.99)
    expect(clampStopToSide({ stop: 80, entry: 100, side: 'Short' })).toBe(100.01)
  })

  it('sideFlipRefusal answers in plain English both directions and stays silent otherwise', () => {
    expect(sideFlipRefusal({ stop: 181.40, entry: 178.10, side: 'Long' }))
      .toMatch(/^A stop at 181\.40 is above your entry of 178\.10\./)
    expect(sideFlipRefusal({ stop: 174.90, entry: 178.10, side: 'Short' }))
      .toMatch(/^A stop at 174\.90 is below your entry of 178\.10\./)
    expect(sideFlipRefusal({ stop: 176, entry: 178.10, side: 'Long' })).toBeNull()
  })

  it('stopPatchFor is the whole body, rounded to 2dp', () => {
    expect(stopPatchFor(176.20000000000002)).toEqual({ stopPrice: 176.2 })
    expect(Object.keys(stopPatchFor(1))).toEqual(['stopPrice'])
  })

  it('defaultJ2Client sends that body and nothing else', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
    await defaultJ2Client.setStop('aaa-1', 176.2, fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/j2/positions/aaa-1')
    expect(fetchImpl.mock.calls[0][1].body).toBe('{"stopPrice":176.2}')
  })

  it('formatScrubReadout and restChipText render an em dash rather than a fabricated R', () => {
    expect(formatScrubReadout({ stop: 178.1, r: 1.6 })).toBe('stop 178.10 → 1.6R')
    expect(formatScrubReadout({ stop: 178.1, r: null })).toBe('stop 178.10 · R —')
    expect(restChipText({ symbol: 'AAPL', r: 0.4, stop: 178.1 })).toBe('AAPL · +0.4R · stop 178.10')
    expect(restChipText({ symbol: 'AAPL', r: null, stop: null })).toBe('AAPL · — · stop —')
  })

  it('buildCursorItems drops a row that matches neither a position nor a strategy', () => {
    const rows = [
      { key: 'e-aaa-1', id: 'aaa-1', surface: 'list' },
      { key: 'ghost', id: 'ghost', surface: 'table' },
    ]
    expect(buildCursorItems(rows, [AAPL], []).map((i) => i.id)).toEqual(['aaa-1'])
  })
})

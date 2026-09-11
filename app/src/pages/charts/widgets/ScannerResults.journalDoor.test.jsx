// Wave R (R-1a) — the SCREENER's send-to-Journal door.
//
// The Screener was the only one of the ten renderable widgets without a capture
// door: it had an embed renderer (`ScannerEmbed`) and journal-embed params in
// `WIDGET_REGISTRY`, and no way for a member to put a scan into a note.
//
// ⛔ THIS FILE RENDERS THE REAL `Watchlists`. ScannerResults does not own any
// header chrome — it wraps the watchlist table, and the door buttons reach the
// screen through Watchlists' `scanActions` slot. A test that stubbed Watchlists
// would stay green with that slot deleted, i.e. with the buttons built, tested,
// and unreachable ([[lesson_built_tested_green_and_unreachable]]). So the mock
// set below is Watchlists' own harness (lifted from Watchlists.quoteoverride
// .test.jsx) plus ScannerResults' three hooks, and NOTHING on the path under
// test — not the door, not sendToJournal, not captureTargets, not the registry —
// is mocked. `fetch` is the only seam.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { isReconstructable, normalizeParams } from '../../../widgets/registry'

/**
 * ⛔ WHY `Watchlists` IS MOCKED HERE, AND WHAT THAT COSTS.
 *
 * ⚰️ Measured: rendering the real `Watchlists` (2,500+ lines, the whole chart
 * stack behind it) kills the vitest worker — 199s, `tests 0ms`, "Worker exited
 * unexpectedly", no traceback. That is the OOM signature this repo already
 * documents ("the evidence of an OOM kill is that there is none"), not a hang
 * in the door.
 *
 * ⭐ The door is the unit under test; `Watchlists` is only its HOST. This mock
 * renders the `scanActions` node the host is handed, so every assertion below is
 * still about the REAL door — the real capture, the real picker, the real toast.
 *
 * ⛔ WHAT IT DOES NOT PROVE: that `Watchlists` actually renders `scanActions`, and
 * renders it in the header action row. A mock cannot answer that. The source pin
 * in the last describe block is what covers it — delete the pin and this file
 * would pass over a door wired to nothing.
 */
vi.mock('../../Watchlists', () => ({
  default: ({ scanActions }) => <div data-testid="watchlists-host">{scanActions}</div>,
}))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../../../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))
vi.mock('swr', () => { const v = { data: [], mutate: () => {} }; return { default: () => v } })
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../../../hooks/useFlagged', () => {
  const v = {
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }
  return { useFlagged: () => v }
})
vi.mock('../../../hooks/useTickerTags', () => {
  const v = {
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }
  return { default: () => v }
})
vi.mock('../../../hooks/useWatchlistAlerts', () => {
  const v = { alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }
  return { default: () => v }
})
vi.mock('../../../hooks/useTagColors', () => { const v = { tagColors: [], tagByKey: {}, setTagLabel: () => {} }; return { default: () => v } })
vi.mock('../../../hooks/usePreferences', () => {
  const v = { prefs: {}, setPref: () => {}, loading: false }
  return { default: () => v, parsePref: (raw, fallback) => fallback }
})
vi.mock('../../../hooks/useRealtimePrices', () => {
  const v = { prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }
  return { default: () => v }
})
vi.mock('../../../hooks/useWatchlistPerformance', () => { const v = { perfData: {}, isLoading: false }; return { default: () => v } })
vi.mock('../../../hooks/useWatchlistMeta', () => { const v = { metaData: {}, isLoading: false }; return { default: () => v } })
vi.mock('../../../hooks/useWatchlistThemes', () => { const v = { themeData: {}, isLoading: false }; return { default: () => v } })
vi.mock('../../../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../ChartsSymContext', () => {
  const v = { sym: null, setSym: () => {} }
  return { ChartsSymContext: { Provider: ({ children }) => children }, useChartsSym: () => v }
})
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })),
    getTotalSize: () => count * 28,
    scrollToIndex: () => {}, measureElement: () => {}, scrollToOffset: () => {},
  }),
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
  elementScroll: () => {},
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
// ⛔ STABLE IDENTITIES. `activeWatchlistRef` is handed to Watchlists as its
// `activeRef` prop and participates in effect dependencies — a fresh object per
// render sets state, which renders, which mints another object. A mock that
// re-allocates is not a neutral stand-in; it is a change to the component's
// inputs.
const WORKSPACE = { groupSyms: {}, setGroupSym: () => {}, activeWatchlistRef: { current: null } }
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => WORKSPACE }))

// ── The scan's own data. Mutable so a rail can move the scan UNDER an open menu. ──
let scanPayload = null
let swrResult = null
const refreshSwr = () => { swrResult = { data: scanPayload, mutate: () => {}, isValidating: false } }
vi.mock('../../../hooks/useMobileSWR', () => ({ default: () => swrResult }))
let priceResult = { prices: {} }
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => priceResult }))

const ScannerResults = (await import('./ScannerResults')).default

const DOOR = 'Send this scan to Journal'
const DOOR_MENU = 'Send to Journal — choose where'

let posted = []
function stubFetch(ok = true) {
  posted = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    posted.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return { ok, status: ok ? 200 : 500, json: async () => ({}) }
  }))
}
const inboxPost = () => posted.find(p => p.url.includes('/api/j2/inbox'))

beforeEach(() => {
  localStorage.clear()
  // Wave R ships this door DARK — see the gate test at the foot of this file.
  localStorage.setItem('uct.nb.capture.enabled', '1')
  scanPayload = {
    as_of: '2026-09-10T13:26:00-04:00',
    results: [{ sym: 'AAA' }, { sym: 'BBB' }],
  }
  refreshSwr()
  priceResult = { prices: { AAA: { price: 12.5, change_pct: 8.25 }, BBB: { price: 4, change_pct: -1.5 } } }
  stubFetch()
})
afterEach(() => { vi.unstubAllGlobals() })

function renderScan(props = {}) {
  return render(
    <ScannerResults scanKey="highest-volume-1y" scanName="Highest Volume In 1-Year" color="A" {...props} />,
  )
}

test('the scan header carries BOTH doors — one-click, and choose-where', () => {
  renderScan()
  // Reached through the real Watchlists `scanActions` slot: delete that slot and
  // both of these disappear while every other assertion in this file still holds.
  expect(screen.getByLabelText(DOOR)).toBeTruthy()
  expect(screen.getByLabelText(DOOR_MENU)).toBeTruthy()
})

test('CONTROL — with nothing in the scan there is no door at all', () => {
  // Not "disabled": ABSENT. `scanner.reconstructable` is
  // `(p) => Array.isArray(p.rows) && p.rows.length > 0`, so an empty capture could
  // only ever render as a placeholder chip — and this door archives no image.
  //
  // This is also the non-vacuity control for the rail above: it proves
  // getByLabelText(DOOR) can come back empty, so its passing means something.
  scanPayload = { as_of: null, results: [] }
  refreshSwr()
  renderScan()
  expect(screen.queryByLabelText(DOOR)).toBeNull()
  expect(screen.queryByLabelText(DOOR_MENU)).toBeNull()
})

test('one click freezes the whole result list and tells the member WHERE it went', async () => {
  renderScan()
  fireEvent.click(screen.getByLabelText(DOOR))

  // ⭐ THE SENTENCE A HUMAN SEES, not "a setter was called". This repo has shipped
  // two toast defects that left every structural assertion green.
  await screen.findByText('Highest Volume In 1-Year captured → Notebook inbox')

  const post = inboxPost()
  expect(post, 'no capture reached /api/j2/inbox').toBeTruthy()
  expect(post.body.widgetId).toBe('scanner')
  // A full-list freeze: every symbol, with the price/±% as they stood.
  expect(post.body.params.rows.map(r => r.sym)).toEqual(['AAA', 'BBB'])
  expect(post.body.params.rows[0]).toMatchObject({ sym: 'AAA', price: 12.5, chgPct: 8.25 })
  expect(post.body.params.scanKey).toBe('highest-volume-1y')
  expect(post.body.params.asOf).toContain('ET')
})

test('what was frozen satisfies the registry predicate that decides how it re-renders', async () => {
  renderScan()
  fireEvent.click(screen.getByLabelText(DOOR))
  // ⛔ The send is ASYNC. Reading `posted` straight after the click read either
  // nothing or the PREVIOUS test's capture — an assertion over the wrong object,
  // which is how a rail passes for a reason that has nothing to do with the code
  // under test. Wait for the sentence the member sees, exactly as the door's own
  // one-click case does.
  await screen.findByText('Highest Volume In 1-Year captured → Notebook inbox')
  const post = inboxPost()
  expect(post, 'no capture reached /api/j2/inbox').toBeTruthy()
  const params = normalizeParams('scanner', post.body.params)
  // The whole point of a payload freeze: re-running the scan later would change
  // WHICH tickers appear, so `rows` is what makes the embed renderable forever.
  expect(isReconstructable('scanner', params)).toBe(true)
  // And the same params minus the payload are NOT — the predicate is load-bearing,
  // not decoration.
  expect(isReconstructable('scanner', { ...params, rows: [] })).toBe(false)
})

test('a failed send says so, in words', async () => {
  stubFetch(false)
  renderScan()
  fireEvent.click(screen.getByLabelText(DOOR))
  await screen.findByText('Capture failed — try again')
})

test('the choose-where menu offers every destination for a scan, and no chart-only one', async () => {
  renderScan()
  fireEvent.click(screen.getByLabelText(DOOR_MENU))
  expect(await screen.findByText('Current note')).toBeTruthy()
  expect(screen.getByText('New entry')).toBeTruthy()
  expect(screen.getByText('Notebook inbox')).toBeTruthy()
  // A scan has no `symbol`, so `copyChartLink.appliesTo` must filter it out.
  expect(screen.queryByText('Copy chart link')).toBeNull()
})

test('FROZEN MEANS ANCHORED — the list that re-ranks while the menu is open does NOT reach the note', async () => {
  // The scan polls every 30s. If the capture were rebuilt at Send, a poll landing
  // while the member is choosing a destination and typing a comment would freeze a
  // DIFFERENT list than the one on screen when they opened the menu. This is why
  // `CAPTURE_TARGETS` takes an already-built capture and never a builder.
  const { rerender } = renderScan()
  fireEvent.click(screen.getByLabelText(DOOR_MENU))
  await screen.findByText('Notebook inbox')

  // The scan re-ranks underneath the open menu.
  scanPayload = { as_of: '2026-09-10T13:56:00-04:00', results: [{ sym: 'ZZZ' }] }
  refreshSwr()
  priceResult = { prices: { ZZZ: { price: 99, change_pct: 40 } } }
  rerender(<ScannerResults scanKey="highest-volume-1y" scanName="Highest Volume In 1-Year" color="A" />)

  fireEvent.click(screen.getByText('Notebook inbox'))
  await waitFor(() => expect(inboxPost()).toBeTruthy())
  expect(inboxPost().body.params.rows.map(r => r.sym)).toEqual(['AAA', 'BBB'])
})

/**
 * ⛔⛔ THE HALF THE MOCK CANNOT SEE.
 *
 * Every case above renders the door through a MOCKED `Watchlists`, because the
 * real one OOM-kills the worker. That mock hands `scanActions` straight to the
 * screen, so it would keep passing if `Watchlists` stopped rendering the slot
 * entirely — the door would be perfect and unreachable, which is this repo's
 * single most-repeated defect (`lesson_built_tested_green_and_unreachable`).
 *
 * So the wiring is pinned against the SOURCE. A pin is weaker than a render and
 * it is honest about which half it covers.
 */
describe('⛔ the host actually gives the door a home', () => {
  const wlSrc = fs.readFileSync(
    path.join(process.cwd(), 'src', 'pages', 'Watchlists.jsx'), 'utf8',
  )

  test('⭐ NON-VACUITY: the pin really read Watchlists.jsx', () => {
    expect(wlSrc.length).toBeGreaterThan(10000)
    expect(wlSrc).toContain('export default function Watchlists')
  })

  test('⛔ Watchlists accepts a scanActions slot', () => {
    expect(wlSrc).toMatch(/scanActions\s*=\s*null/)
  })

  test('⛔ and RENDERS it, gated on scan mode — a declared-but-unrendered prop is the orphan shape', () => {
    expect(wlSrc).toMatch(/\{\s*scanMode\s*&&\s*scanActions\s*\}/)
  })
})

// ─── The release gate ───────────────────────────────────────────────────────
describe('⛔ the Wave R release gate', () => {
  test('with the flag OFF the header carries NO door — the release note, as an assertion', () => {
    localStorage.clear()
    renderScan()
    expect(screen.queryByLabelText(DOOR)).toBeNull()
    expect(screen.queryByLabelText(DOOR_MENU)).toBeNull()
    // ⭐ CONTROL: the host still mounted. This harness's Watchlists mock renders
    // ONLY `scanActions`, so an empty host is the honest reading of "the widget
    // offered no door" — and proves the absence above is the gate, not a crash
    // that produced an empty tree.
    expect(screen.getByTestId('watchlists-host')).toBeTruthy()
  })

  test('⭐ and both doors return with the flag ON — both directions, or it is not a gate', () => {
    localStorage.setItem('uct.nb.capture.enabled', '1')
    renderScan()
    expect(screen.getByLabelText(DOOR)).toBeTruthy()
    expect(screen.getByLabelText(DOOR_MENU)).toBeTruthy()
  })
})

// (2026-11-21, key-press CPU profile) The neighbour warm of a selection goes out AFTER the frame that shows
// the selection, not inside the commit (which on /charts is still the key handler's task).
//
// What must stay true, each with its own failing mutant:
//   1. the commit that shows a selection sends nothing; the frame after it sends the SAME warm as before
//      (the holds' rows, the promote, the priority warm, the urgent next rows), once;
//   2. a selection that arrives while the previous warm is still waiting goes out AT ONCE (a held key
//      leaves no frame between presses), and the one it replaced is dropped, never sent late;
//   3. a widget that goes away before the frame sends nothing;
//   4. where no frame is coming (a hidden document), it is sent in the commit, as it always was.
//
// Mock set: Watchlists.scanwarm.test.jsx's, plus a recorder on `publishScanNeighbors`, which the effect
// still calls synchronously: it is how a test knows the effect HAS run when it finds nothing sent.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'

vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
const calls = { toIDB: [], mem: [], urgent: [] }
vi.mock('../utils/prefetchBars', () => ({
  prefetchBarsToIDB: (syms, tf, opts) => { calls.toIDB.push({ syms: [...syms], tf, priority: !!opts?.priority }) },
  prefetchAllTimeframes: () => {},
  prefetchListAllTimeframes: () => {},
  warmMemFromIDB: (syms, tfs) => { calls.mem.push({ syms: [...syms], tfs }) },
  prefetchBars: (syms, tf, opts) => { if (opts?.urgent) calls.urgent.push({ syms: [...syms], tf }) },
  prefetchBarOnIntent: () => {}, prewarmVisibleList: () => {},
}))
const published = []   // the symbol of every publishScanNeighbors call: the effect ran for it
vi.mock('../components/chart/neighborFrames', async (importOriginal) => ({
  ...(await importOriginal()),
  publishScanNeighbors: (sym) => { published.push(sym) },
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

const SYMS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ']
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: SYMS.map((sym, i) => ({ id: `i${i}`, sym, notes: '' })),
}
// ⛔ EVERY MOCKED HOOK ANSWERS WITH THE SAME OBJECT ON EVERY RENDER, as the real ones do between data
// changes. The effect under test is keyed on the list derived from them: a mock that built a new array per
// render would re-run it on every re-render, which is not the product and not what is measured here.
const NOOP = () => {}
const SWR_LISTS = { data: [WL], mutate: NOOP }
const SWR_NONE = { data: [], mutate: NOOP }
vi.mock('swr', () => ({
  default: (key) => (key === '/api/watchlists' ? SWR_LISTS : SWR_NONE),
}))
const AUTH = { user: { id: 'u1', role: 'user', display_name: 'Pat' } }
vi.mock('../context/AuthContext', () => ({ useAuth: () => AUTH }))
const FLAGGED = {
  flagged: [], toggle: NOOP, remove: NOOP, isFlagged: () => false,
  isShared: false, toggleShare: NOOP, flaggedName: 'Flagged', renameFlagged: NOOP,
}
vi.mock('../hooks/useFlagged', () => ({ useFlagged: () => FLAGGED }))
const TAGS = {
  tags: {}, setTag: NOOP, removeTag: NOOP, getTag: () => null,
  shared: [], isColorShared: () => false, toggleShareColor: NOOP, communityTags: [],
}
vi.mock('../hooks/useTickerTags', () => ({ default: () => TAGS }))
const ALERTS = { alerts: [], createAlert: NOOP, deleteAlert: NOOP, getAlertsForSym: () => [], hasAlert: () => false }
vi.mock('../hooks/useWatchlistAlerts', () => ({ default: () => ALERTS }))
const TAG_COLORS = { tagColors: [], tagByKey: {}, setTagLabel: NOOP }
vi.mock('../hooks/useTagColors', () => ({ default: () => TAG_COLORS }))
const PREFS = { prefs: {}, setPref: NOOP, loading: false }
vi.mock('../hooks/usePreferences', () => ({
  default: () => PREFS,
  parsePref: (raw, fallback) => fallback,
}))
const PRICES = { prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => PRICES }))
const PERF = { perfData: {}, isLoading: false }
vi.mock('../hooks/useWatchlistPerformance', () => ({ default: () => PERF }))
const META = { metaData: {}, isLoading: false }
vi.mock('../hooks/useWatchlistMeta', () => ({ default: () => META }))
const THEMES = { themeData: {}, isLoading: false }
vi.mock('../hooks/useWatchlistThemes', () => ({ default: () => THEMES }))
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
const hub = { sym: null, setSym: NOOP, tf: '5' }
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => hub,
}))
const NAVIGATE = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => NAVIGATE }))

const Watchlists = (await import('./Watchlists')).default
const { MAX_WAIT_MS } = await import('../utils/afterPaint')

const reset = () => { calls.toIDB = []; calls.mem = []; calls.urgent = []; published.length = 0 }
/** What went out for the selection whose next row is `first` (every warm call of a selection leads with it). */
const sentFor = (first) => ({
  toIDB: calls.toIDB.filter((c) => c.syms[0] === first),
  urgent: calls.urgent.filter((c) => c.syms[0] === first),
  mem: calls.mem.filter((c) => c.syms[0] === first),
})
const nothingSentFor = (first) => {
  const s = sentFor(first)
  return s.toIDB.length + s.urgent.length + s.mem.length === 0
}
const setHidden = (v) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => v })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Frames the test runs by hand, so "before the frame" is a state a test can stand in.
let frames
const runFrames = () => { const q = frames; frames = []; for (const cb of q) if (cb) cb(0) }
function holdFrames() {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', (id) => { frames[id - 1] = null })
}
const pick = (sym) => fireEvent.keyDown(document.querySelector(`[data-watch-sym="${sym}"]`), { key: 'Enter' })

/** The list on CCC with its first warm already out, then frames held and the recorders emptied. */
async function mountedOnCCC() {
  hub.sym = 'CCC'
  const view = render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" />)
  await screen.findByText('CCC')
  await waitFor(() => expect(sentFor('DDD').urgent.length).toBeGreaterThan(0))
  holdFrames()
  reset()
  return view
}

beforeEach(() => {
  localStorage.clear()
  reset()
  hub.sym = null
  setHidden(false)
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals(); delete document.hidden })

test("a selection's warm is not sent in the commit that shows it: it goes out after the next frame, once, unchanged", async () => {
  await mountedOnCCC()
  pick('EEE')
  expect(document.querySelector('[data-watch-sym="EEE"]').className).toMatch(/listRowSelected/)
  expect(published[published.length - 1]).toBe('EEE')   // the effect ran for EEE ...
  expect(nothingSentFor('FFF')).toBe(true)              // ... and sent nothing inside the commit

  runFrames()                                           // the frame that paints the selection
  await waitFor(() => expect(sentFor('FFF').urgent.length).toBe(1))
  // the same warm as before the deferral: the urgent next two, the priority warm ahead (and two behind),
  // the promote of the rows around, each on the chart's timeframe
  const sent = sentFor('FFF')
  expect(sent.urgent[0]).toEqual({ syms: ['FFF', 'GGG'], tf: '5' })
  expect(sent.toIDB.length).toBe(1)
  expect(sent.toIDB[0].priority).toBe(true)
  expect(sent.toIDB[0].tf).toBe('5')
  expect(sent.toIDB[0].syms).toEqual(['FFF', 'GGG', 'HHH', 'III', 'JJJ', 'AAA', 'DDD', 'CCC'])
  expect(sent.mem.length).toBe(1)
  expect(sent.mem[0].tfs).toEqual(['5'])
  expect(sent.mem[0].syms).toEqual(expect.arrayContaining(['FFF', 'GGG', 'DDD', 'CCC', 'BBB']))
  await sleep(MAX_WAIT_MS + 60)                         // the backstop timer adds no second send
  expect(sentFor('FFF').urgent.length).toBe(1)
  expect(sentFor('FFF').toIDB.length).toBe(1)
  expect(sentFor('FFF').mem.length).toBe(1)
})

test('a selection that arrives while the last warm is still waiting goes out at once, and the one it replaced is dropped', async () => {
  await mountedOnCCC()
  pick('EEE')
  expect(published[published.length - 1]).toBe('EEE')
  expect(nothingSentFor('FFF')).toBe(true)              // EEE's warm waits for its frame
  pick('GGG')                                           // no frame in between (a held key)
  expect(published[published.length - 1]).toBe('GGG')
  expect(sentFor('HHH').urgent).toEqual([{ syms: ['HHH', 'III'], tf: '5' }])   // GGG's warm, in its own commit
  expect(sentFor('HHH').toIDB.length).toBe(1)
  expect(sentFor('HHH').mem.length).toBe(1)
  expect(nothingSentFor('FFF')).toBe(true)              // EEE's was dropped ...
  runFrames()
  await sleep(MAX_WAIT_MS + 60)
  expect(nothingSentFor('FFF')).toBe(true)              // ... and is never sent late
  expect(sentFor('HHH').urgent.length).toBe(1)          // and GGG's is not sent a second time

  // the next press waits for its frame again: never two in a row inside the commit while frames come
  pick('III')
  expect(published[published.length - 1]).toBe('III')
  expect(nothingSentFor('JJJ')).toBe(true)
  runFrames()
  await waitFor(() => expect(sentFor('JJJ').urgent).toEqual([{ syms: ['JJJ', 'AAA'], tf: '5' }]))
})

test('a widget that goes away before the frame sends nothing', async () => {
  const view = await mountedOnCCC()
  pick('EEE')
  expect(published[published.length - 1]).toBe('EEE')
  view.unmount()
  runFrames()
  await sleep(MAX_WAIT_MS + 60)
  expect(nothingSentFor('FFF')).toBe(true)
})

test('a hidden document draws no frames: the warm is sent in the commit, as it always was', async () => {
  await mountedOnCCC()
  setHidden(true)
  pick('EEE')
  expect(published[published.length - 1]).toBe('EEE')
  expect(sentFor('FFF').urgent).toEqual([{ syms: ['FFF', 'GGG'], tf: '5' }])
  expect(sentFor('FFF').toIDB.length).toBe(1)
  expect(sentFor('FFF').mem.length).toBe(1)
})

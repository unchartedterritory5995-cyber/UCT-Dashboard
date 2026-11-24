// ⭐ (2026-11-23, review of #2624 section 2d) THE LINKED CHART'S SERVER COLUMNS DECIDE ENTER TOO.
// Enter shows a typed ticker in the key task only when EVERY linked chart can: its rows in, and the server columns its
// panes draw landed (useSymbolHandoff decisionGateFor: 'columns'). The typed intent's device reads ready the BARS on
// every linked timeframe; the typed warm told the columns lane only about the typing chart's own timeframe. Here the
// linked 30-minute chart draws an RS pane (a real server-column ask at '30'), and `columnsReadyFor` is REAL:
//   only the typing timeframe told (before this change)  -> Enter takes the round; the 30m chart's record says 'columns'
//   the linked timeframe told too (the typed warm now)   -> Enter shows BOTH charts in its own render
// What the warm tells, and when (never for a prefix), is prefetch.typedCompanions.test.js; that ChartPane hands it the
// host's linked timeframes is ChartPane.typedIntentHost.test.jsx. And a tester's device diagnostics record, per chart,
// the gate that refused the decision: the record's `gate` (null = it could show it; else the gate; 'unasked').
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))
// the bars: keyed by symbol, as in typedIntentPrime.test.jsx (a copy lands a few ms after its device read)
const st = { bySym: new Map() }
const of = (sym) => st.bySym.get(String(sym)) || { device: false, displayable: false, held: false }
const LAND_MS = 3
const deviceWarm = vi.fn((sym) => new Promise((resolve) => setTimeout(() => {
  st.bySym.set(String(sym), { device: true, displayable: true, held: true }); resolve(true)
}, LAND_MS)))
vi.mock('../../../data/barStore/prefetch', () => ({
  peekDisplayable: (sym) => of(sym).displayable,
  lakePending: () => false,
  deepPending: () => true,
  holdsBars: (sym) => of(sym).held,
  devicePaints: (sym) => of(sym).device,
  deviceVerdict: (sym) => ({ paints: of(sym).device, reason: of(sym).device ? 'paints' : 'none', held: of(sym).device ? 'device' : 'none' }),
  deviceWarm: (...a) => deviceWarm(...a),
  deviceHold: () => null,
  watch: () => () => {},
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
  heldRows: () => 0,
  askForDisplay: () => Promise.resolve(null),
}))
vi.mock('../../../utils/prefetchBars', async (orig) => ({ ...(await orig()), prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../../../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => true }))
vi.mock('../../../data/deviceStore/source', () => ({ deviceSource: () => null }))

let useSymbolHandoff, G, primeTypedIntent, SC, SW, tellSymbolWarmers, diag
const scope = { board: 1 }
const never = () => new Promise(() => {})
const asksOf = (url) => JSON.parse(new URL(url, 'http://x').searchParams.get('asks'))
const wire = (v) => ({ times: [20260102, 20260105], columns: { rsLine: [v, v + 1] }, payload: { state: 'ok' } })

async function load() {
  vi.resetModules()
  localStorage.setItem('uct.deviceStore.diag', '1')                   // a tester's diagnostics (the `gate` record)
  SC = await import('../../../components/chart/engine/serverCompute')
  SW = await import('../../../components/chart/engine/serverWarm')
  tellSymbolWarmers = (await import('../../../utils/prefetchBars')).tellSymbolWarmers
  diag = await import('../../../data/deviceStore/diag')
  useSymbolHandoff = (await import('../../../hooks/useSymbolHandoff')).default
  G = await import('../../../hooks/handoffGroups')
  primeTypedIntent = (await import('./typedIntentPrime')).primeTypedIntent
  const { getDefinition } = await import('../../../components/chart/engine/nativeRegistry')
  SC.clearServerColumns()
  SC.__setServerBatchFetcherForTests((url) => Promise.resolve({ results: asksOf(url).map(() => ({ status: 200, envelope: wire(1) })) }))
  SW.__resetServerWarm({ painted: true })
  SW.armServerWarm()
  // the linked 30-minute chart draws an RS pane: a server-column ask at '30' (nothing asks at 'D')
  SC.serverColumnsFor(getDefinition('rsLine'), [1, 2].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })), { benchmark: 'SPY' }, { sym: 'SPY', tf: '30', fetcher: never })
  diag.clearDeviceDiag()
}

beforeEach(async () => {
  vi.useFakeTimers()
  st.bySym.clear()
  deviceWarm.mockClear()
  try { localStorage.removeItem('uct.indwarm.off'); localStorage.removeItem('uct.rslane.tfs'); localStorage.setItem('barspack.version', 'x') } catch { /* */ }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this suite') }))
  await load()
})
afterEach(() => {
  try { SC.__setServerBatchFetcherForTests(null); SC.clearServerColumns(); SW.__resetServerWarm() } catch { /* */ }
  localStorage.removeItem('uct.deviceStore.diag')
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function linkedPair() {
  return renderHook(({ s }) => [
    useSymbolHandoff(s, 'D', { group: 'charts:A', scope, showExtended: false }),
    useSymbolHandoff(s, '30', { group: 'charts:A', scope, showExtended: true }),
  ], { initialProps: { s: 'AAA' } })
}
function enter(h, sym) {
  let decided
  act(() => { decided = G.beginGroupSwitch(scope, 'charts:A', sym); h.rerender({ s: sym }) })
  return decided
}
/** The typed text settles on `sym`: the linked group's device reads (the prime) and the typed warm's columns tell, at
 *  the timeframes given (the typing chart's own: 'D'; with this change, every linked one). */
async function typedIntent(sym, toldTfs) {
  primeTypedIntent(scope, 'A', sym)
  for (const tf of toldTfs) tellSymbolWarmers([sym], tf, { priority: true })
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
}
const recordOf = (tf) => diag.deviceDiagLog().filter((r) => r.sym === 'BBB' && r.tf === tf).at(-1) || null

describe('the linked chart\'s columns: told before Enter, or the group takes the round', () => {
  it('NON-VACUITY: the 30-minute chart really draws a server column, and BBB\'s has not landed', () => {
    expect(SC.liveAsks('30').length).toBe(1)
    expect(SC.liveAsks('D').length).toBe(0)
    expect(SC.columnsReadyFor('BBB', '30')).toBe(false)
    expect(SC.columnsReadyFor('BBB', 'D')).toBe(true)
  })

  it('only the typing chart\'s timeframe told: the bars are in, the 30m columns are not, Enter takes the round; its record says columns', async () => {
    const h = linkedPair()
    await typedIntent('BBB', ['D'])
    expect(of('BBB').device).toBe(true)                                 // the prime did its part
    expect(SC.columnsReadyFor('BBB', '30')).toBe(false)
    expect(enter(h, 'BBB')).toBe(false)
    expect(h.result.current).toEqual(['AAA', 'AAA'])
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })   // the round lands it
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(recordOf('30')?.gate).toBe('columns')                        // the member and the gate that refused
    expect(recordOf('D')?.gate).toBe(null)                              // the daily chart could have shown it
  })

  it('the linked timeframe told too: its columns land before Enter, and Enter shows BOTH charts in its own render', async () => {
    const h = linkedPair()
    await typedIntent('BBB', ['D', '30'])
    expect(SC.columnsReadyFor('BBB', '30')).toBe(true)
    expect(enter(h, 'BBB')).toBe(true)
    expect(h.result.current).toEqual(['BBB', 'BBB'])
    expect(recordOf('30')?.gate).toBe(null)
    expect(recordOf('D')?.gate).toBe(null)
  })
})

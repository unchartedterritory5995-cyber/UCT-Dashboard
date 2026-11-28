// ⭐⭐ THE 2026-11-28 COLD-COVERAGE RUN (production, fresh never-viewed tickers, typed Enter), two switch defects:
//
//  (1) 4h + 2h zoomed out: a SHORT first page and then the jump on 6 of 6 presses. A custom intraday timeframe resamples
//      its native base (60m for 4h and 2h) and the switch passed every custom code straight through ('now'), so it
//      painted whatever 60m rows were held (287 4h bars under a ~790-bar view) and the lake's depth then rebuilt it.
//      Now the switch asks the base the native questions, with the view's need in base rows (routeView).
//  (2) W + M: the previous chart held ~4 s (the hang guard) on 4 of 6 presses. A monthly view asks 600 months, more than
//      most listings have, so the daily hold waits for the deep history's join to say "nothing more is coming"; it asked
//      that only at the prepare's report and the DAILY_HOLD_MAX_MS bound (~400 ms), and the monthly history (a cold
//      origin build) settled later, so only the hang guard ended the wait. The watcher now asks it on every wake.
import { renderHook, act, render } from '@testing-library/react'
import { Activity } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: false, device: false }
const prepareMock = vi.fn(() => new Promise(() => {}))
const heldRows = vi.fn((sym, tf, opts = {}) => (opts.answered && !st.answered ? 0 : st.rows))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => st.displayable,
  lakePending: () => st.lake,
  deepPending: () => st.deep,
  holdsBars: () => st.held,
  devicePaints: () => st.device,
  heldRows: (...a) => heldRows(...a),
  prepareForDisplay: (...a) => prepareMock(...a),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true,
  whenColumnsReady: () => Promise.resolve(true),
  warmColumnsFor: () => {},
}))
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => false }))

import useSymbolHandoff, { COVER_ROWS, VIEW_LOOKBACK_ROWS, routeView } from './useSymbolHandoff'
import { noteMemberView } from '../components/chart/paintLog'
import { baseBarsFor } from '../components/chart/timeframes'
import { setFlipProbe } from '../components/chart/flipReady'
import { BoardVisibilityContext, createBoardVisibility } from '../components/chart/boardVisibility'

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: false, device: false })
  prepareMock.mockClear(); heldRows.mockClear()
})
afterEach(() => { vi.useRealTimers() })

const flip = (tf, member = null) => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf, { member }), { initialProps: { s: 'AAA' } })
  act(() => { h.rerender({ s: 'BBB' }) })
  return h
}
const zoomedOut = (span = 791) => { const m = {}; noteMemberView(m, span); return m }

describe('(1) a custom intraday timeframe is decided on its native base, in base rows', () => {
  it('routeView: 4h and 2h map to the 60m key with the need in 60m rows; native and D/W/M-based codes are unchanged', () => {
    expect(routeView('240', 1191)).toEqual({ tf: '60', need: baseBarsFor('240', 1191) })
    expect(routeView('120', 1191)).toEqual({ tf: '60', need: baseBarsFor('120', 1191) })
    expect(routeView('45', 600)).toEqual({ tf: '15', need: baseBarsFor('45', 600) })
    expect(routeView('60', 600)).toEqual({ tf: '60', need: 600 })
    expect(routeView('2D', 600)).toEqual({ tf: '2D', need: 600 })
  })

  it('4h zoomed out, the 60m first page held (~1,000 rows) and the lake still due: the previous chart stays (no short page)', () => {
    st.rows = 1000; st.answered = true
    const { result } = flip('240', zoomedOut())
    expect(result.current).toBe('AAA')
    expect(prepareMock).toHaveBeenCalled()
    expect(prepareMock.mock.calls[0][1]).toBe('60')                  // the base key is prepared
    expect(heldRows.mock.calls.some((c) => c[1] === '60')).toBe(true) // and counted
  })

  it('...and shows the moment the base rows cover the 4h view (the lake joined)', async () => {
    st.rows = 1000; st.answered = true
    const { result } = flip('240', zoomedOut())
    expect(result.current).toBe('AAA')
    st.rows = baseBarsFor('240', 791 + VIEW_LOOKBACK_ROWS)
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    expect(result.current).toBe('BBB')
  })

  it('control: base rows that already cover the 4h view show at once', () => {
    st.rows = baseBarsFor('240', 791 + VIEW_LOOKBACK_ROWS); st.answered = true
    expect(flip('240', zoomedOut()).result.current).toBe('BBB')
  })

  it('control: a young listing (the lake settled, the server answered, short of the view) shows what there is', () => {
    st.rows = 300; st.answered = true; st.lake = false
    expect(flip('120', zoomedOut()).result.current).toBe('BBB')
  })
})

describe('(2) the daily hold ends when nothing more is coming, not at the hang guard', () => {
  it('M, a 145-month listing (short of the 600-month view): the deep join settling after the bound shows it at once', async () => {
    st.rows = 145; st.answered = true; st.deep = true
    const { result } = flip('M')
    expect(result.current).toBe('AAA')                                // the deep history is still due: hold
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })  // past DEEP_JOIN_WAIT_MS and DAILY_HOLD_MAX_MS
    expect(result.current).toBe('AAA')
    st.deep = false                                                   // the monthly history's join settles (adds nothing)
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('BBB')                                // ~1 s, not the 4 s hang guard
  })

  it('W zoomed out wider than the whole history: the same exit', async () => {
    st.rows = 629; st.answered = true; st.deep = true
    const { result } = flip('W', zoomedOut(791))
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(result.current).toBe('AAA')
    st.deep = false
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('BBB')
  })

  it("control: the join settled but this life's answer is not held yet: still waits (more is coming)", async () => {
    st.rows = 145; st.answered = false; st.deep = true
    const { result } = flip('M')
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    st.deep = false
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('AAA')
  })

  it('control: while the deep history is still due, a short set never shows before the hang guard', async () => {
    st.rows = 145; st.answered = true; st.deep = true
    const { result } = flip('M')
    await act(async () => { await vi.advanceTimersByTimeAsync(3800) })
    expect(result.current).toBe('AAA')
    expect(COVER_ROWS).toBeGreaterThan(145)
  })
})

// ⭐⭐ (2026-11-28, COV-def-wm-arrows: presses 0-2 and 7-8 never moved the W+M board) A PRESS THAT MOVES THE LIST MOVES EVERY
// LINKED CHART. The double buffer decides on the symbol the handoff releases, so a W/M daily hold that outlived the 3.2 s
// between presses was superseded by the next one and nothing ever showed, though the shadow already held FNB whole (no
// double-buffer decision was logged for any of the five presses). A row the shadow can flip to is now released at once.
describe('(3) a press to the row the double buffer can flip to is never held', () => {
  it('W, short of the view and the deep history still due (a daily hold), but the shadow can flip to it: shown at once', () => {
    st.rows = 145; st.answered = true; st.deep = true
    const member = {}
    setFlipProbe(member, (s) => s === 'BBB')
    const { result } = flip('W', member)
    expect(result.current).toBe('BBB')
    setFlipProbe(member, null)
  })

  it('control: the shadow cannot flip to it (another row, short, unreported): the daily hold holds as before', async () => {
    st.rows = 145; st.answered = true; st.deep = true
    const member = {}
    setFlipProbe(member, (s) => s === 'CCC')
    const { result } = flip('W', member)
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(result.current).toBe('AAA')
    setFlipProbe(member, null)
  })

  it('control: a probe that throws is a "no", never a crash and never a release', async () => {
    st.rows = 145; st.answered = true; st.deep = true
    const member = {}
    setFlipProbe(member, () => { throw new Error('pane mid-unmount') })
    const { result } = flip('M', member)
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    expect(result.current).toBe('AAA')
    setFlipProbe(member, null)
  })
})

// ⭐⭐ (2026-11-28, cloud sweep 46113707532, COV-zo-wm-arrows: LONE_CHART 12 of 12, the W+M board zoomed out never moved) A
// PRESS NEVER RESTARTS THE HANG GUARD OF A BOARD THAT HAS NOT MOVED. Zoomed out, a W/M view needs ~4,400 rows, more than
// most listings have, so the daily hold ends only when the deep history's join settles; the edge history answered in
// 5-22 s (app time, p50 11.3 s in that lane), and every arrow press (3.23 s apart) superseded the hold before its 4 s hang
// guard, which each new press started again. Both charts showed NXE (header and candles) for all 12 presses while the
// list moved through 12 rows. The guard now counts from the OLDEST request this chart has left unshown.
describe('(4) a run of presses that each outlive their hold never freezes the chart past the hang guard', () => {
  const press = (h, s) => act(() => { h.rerender({ s }) })
  const run = (tf, member = null) => renderHook(({ s }) => useSymbolHandoff(s, tf, { member }), { initialProps: { s: 'AAA' } })

  it('W zoomed out, the deep history never settling, a press every 3.2 s: the newest row shows 4 s after the first press', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999))
    press(h, 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(h.result.current).toBe('AAA')
    press(h, 'CCC')
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })  // 4.1 s after BBB, 0.9 s after CCC
    expect(h.result.current).toBe('CCC')                                // the newest, never the row it left
  })

  it('M (the sibling): the same', async () => {
    st.rows = 411; st.answered = true; st.deep = true
    const h = run('M', zoomedOut(3999))
    press(h, 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    press(h, 'CCC')
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(h.result.current).toBe('CCC')
  })

  it('intraday (the prepare route): the same bound', async () => {
    st.displayable = false
    const h = run('15')
    press(h, 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    expect(h.result.current).toBe('AAA')
    press(h, 'CCC')
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(h.result.current).toBe('CCC')
  })

  it('control: one press still holds for the whole hang guard (nothing earlier was left unshown)', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999))
    press(h, 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(3900) })
    expect(h.result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(h.result.current).toBe('BBB')
  })

  it('control: a row that was SHOWN ends the run; the next press holds its own full guard', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999))
    press(h, 'BBB')
    st.deep = false                                                   // BBB's join settles: shown
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(h.result.current).toBe('BBB')
    st.deep = true
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    press(h, 'CCC')
    await act(async () => { await vi.advanceTimersByTimeAsync(3800) })
    expect(h.result.current).toBe('BBB')                              // CCC's own guard: 4 s from CCC
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(h.result.current).toBe('CCC')
  })

  it('control: going back to the row on screen ends the run too', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999))
    press(h, 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    press(h, 'AAA')                                                   // back to the chart on screen
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    press(h, 'CCC')
    await act(async () => { await vi.advanceTimersByTimeAsync(3800) })
    expect(h.result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(h.result.current).toBe('CCC')
  })
})

// ⭐⭐ (review of #3009, Finding 1 MEDIUM) THE CLOCK OF (4) IS NEVER CARRIED INTO A ROW THAT A BURST ONLY PASSED THROUGH. With
// the settle rule on (/charts: debounceMs 90) a held arrow runs its first row and DEFERS every repeat (the key cadence is
// under QUIET_MS / BURST_SETTLE_MS), each replaced before it ran. Nothing reset the clock, so a key held past the hang
// guard released onto a row forced at 0 ms (hangIn() = 0): a loading chart, then the fill. A request left without ever
// running ends the run; so does an <Activity> hide (the keep-alive board), whose cleanups are not a newer request.
// (Finding 2, accepted as designed: a timeframe change of a symbol still unshown keeps the clock.)
describe('(5) the hang guard clock and a held key, a keep-alive hide, a timeframe change', () => {
  const SETTLE = { debounceMs: 90, isWarm: () => false }
  const run = (tf, member = null, settle = SETTLE) => renderHook(({ s, t }) => useSymbolHandoff(s, t ?? tf, { member, settle }), { initialProps: { s: 'AAA' } })
  const press = (h, s, t) => act(() => { h.rerender({ s, t }) })

  it('a key held 5 s (a repeat every 33 ms) and released: the released row keeps its own full guard, never 0 ms', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999))
    press(h, 'BBB')                                                  // the first row runs (quiet before it)
    for (let i = 0; i < 150; i++) {                                  // 5 s of repeats, each deferred and replaced
      await act(async () => { await vi.advanceTimersByTimeAsync(33) })
      press(h, `R${i}`)
    }
    press(h, 'ZZZ')                                                  // released here
    await act(async () => { await vi.advanceTimersByTimeAsync(120 + 3700) })   // the settle, then most of a guard
    expect(h.result.current).toBe('AAA')                             // never forced at 0 ms
    await act(async () => { await vi.advanceTimersByTimeAsync(400) })
    expect(h.result.current).toBe('ZZZ')
  })

  it('control: without the settle rule the same presses still show within the guard of the first (section 4)', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999), null)
    press(h, 'BBB')
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    press(h, 'CCC')
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })
    expect(h.result.current).toBe('CCC')
  })

  it('a timeframe change of a symbol still unshown keeps the clock (accepted as designed)', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const h = run('W', zoomedOut(3999), null)
    press(h, 'BBB', 'W')
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    press(h, 'BBB', 'M')
    await act(async () => { await vi.advanceTimersByTimeAsync(900) })   // 4.1 s after the first request
    expect(h.result.current).toBe('BBB')
  })

  it('a keep-alive <Activity> hide ends the run: shown again, the request gets a full guard, not 0 ms', async () => {
    st.rows = 600; st.answered = true; st.deep = true
    const vis = createBoardVisibility()
    const member = zoomedOut(3999)
    let out = null
    const Probe = ({ s }) => { out = useSymbolHandoff(s, 'W', { member }); return null }
    const Host = ({ s, mode }) => <BoardVisibilityContext.Provider value={vis}><Activity mode={mode}><Probe s={s} /></Activity></BoardVisibilityContext.Provider>
    const r = render(<Host s="AAA" mode="visible" />)
    act(() => { r.rerender(<Host s="BBB" mode="visible" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => { vis.state = 'hidden'; r.rerender(<Host s="BBB" mode="hidden" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    act(() => { vis.state = 'visible'; r.rerender(<Host s="BBB" mode="visible" />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(out).toBe('AAA')                                          // not forced at the show
    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })
    expect(out).toBe('BBB')
    r.unmount()
  })
})

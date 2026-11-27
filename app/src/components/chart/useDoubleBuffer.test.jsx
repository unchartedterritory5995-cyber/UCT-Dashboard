// The double-buffered next row, the widget's two layers (chart/useDoubleBuffer.js, 2026-11-27; review of #2922):
//   H1 after the front shows a symbol, the hidden layer is set (in idle time) to the row ahead
//   H2 THE FLIP: a press to that row, the shadow's chart having REPORTED it, swaps the layers' roles (no layer's symbol
//      changes), the handles follow (the shown one visible, the other hidden), the paint is recorded as a 'flip'
//   H3 STALE REFUSED (F3): the store's bars for the row moved on since the shadow's chart reported -> the normal switch;
//      once the shadow's chart reports the new bars (its current feed re-rendered it), a press flips
//   H4 FALLBACK: a press to any other row is the normal switch of the front, exactly as before
//   H5 a widget the board cannot give a shadow (its budget taken) never flips
//   H6 (F2) the board hidden: the shown layer is hidden through the nesting, the widget gives its shadow back and drops
//      the hidden pane; the board shown again: the shadow comes back. The budget is the board SLOT's.
//   H7 (F1) the views: a zoomed front refuses the flip; the shadow mirrors the front's span in idle time, then a press flips
//   H8 (F5) focus inside the old front moves to the new front at the flip
//   H9 (F6) no flip while a replay cutoff is set
//   H10 (live dry run) right after a flip, and at mount, the hidden pane takes the row ahead with no idle time
//   H11 each decision is logged with the time since the hidden pane was set and since its chart reported
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('./barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../../utils/afterPaint', () => ({ afterPaint: (fn) => { fn(); return () => false } }))
const painted = vi.hoisted(() => [])
vi.mock('./paintLog', async (orig) => ({ ...(await orig()), recordPaint: (...a) => { painted.push(a) } }))
// the rows the store holds for the shadow's row, counted in the view's session (0: uncountable, the check stands aside)
const held = vi.hoisted(() => ({ rows: 0 }))
vi.mock('../../data/barStore/prefetch', async (orig) => ({ ...(await orig()), heldRows: () => held.rows }))

const { useDoubleBuffer, __setDoubleBufferBarsSourceForTests } = await import('./useDoubleBuffer')
const { chartKeyFor } = await import('./useBarSnapshotBars')
const { createBoardVisibility } = await import('./boardVisibility')
const db = await import('./doubleBuffer')
const nf = await import('./neighborFrames')

const SYMS = ['AAA', 'BBB', 'CCC']
const keyOf = (sym) => chartKeyFor({ sym, resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
const bars = {}
const fresh = (sym) => { bars[sym] = Object.freeze([sym, Math.random()]); return bars[sym] }
const settings = { look: 1 }
let scope
const member = { m: 1 }
const idle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(400) }) }
// each layer's pane: its date-nav meta (a frame at the right edge) and a restoreView that writes it, a focus spy
const meta = (fromRight = 160, toRight = -5) => ({ frame: { fromRight, toRight, locked: false }, activeRange: null, priceAuto: true, replay: { on: false } })
let panes
let els
const base = () => ({ eligible: true, sym: 'AAA', settings, replay: false, scope, member, parentVis: null, panes: () => panes, layerEls: () => els })
function mount(over = {}) {
  return renderHook((p) => useDoubleBuffer(p), { initialProps: { ...base(), ...over } })
}
// a layer's chart commits a pass of `sym` (StockChart's report through LayerPaintContext)
const report = (result, i, sym) => act(() => { result.current.reporters[i]({ sym, tf: 'D', ext: false, bars: bars[sym] }) })

beforeEach(() => {
  held.rows = 0
  vi.useFakeTimers()
  vi.stubGlobal('requestIdleCallback', undefined)
  painted.length = 0
  scope = {}
  for (const s of SYMS) fresh(s)
  const byKey = new Map(SYMS.map((s) => [keyOf(s), s]))
  __setDoubleBufferBarsSourceForTests((k) => (byKey.has(k) ? bars[byKey.get(k)] : null))
  panes = [0, 1].map(() => {
    const p = { m: meta(), focus: vi.fn() }
    p.getDateMeta = () => p.m
    p.viewDo = (op, f) => { if (op === 'restoreView') p.m = { ...p.m, frame: { fromRight: f.fromRight, toRight: f.toRight, locked: false } } }
    return p
  })
  els = [document.createElement('div'), document.createElement('div')]
  for (const e of els) { e.appendChild(document.createElement('button')); document.body.appendChild(e) }
  nf.__setNeighborFramesForTests(true); nf.__resetScanForTests()
  db.__resetDoubleBufferStatsForTests()
  nf.publishScanNeighbors('AAA', ['BBB', 'CCC'], [])
  nf.publishScanNeighbors('BBB', ['CCC'], ['AAA'])
})
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); nf.__setNeighborFramesForTests(null); __setDoubleBufferBarsSourceForTests(null)
  for (const e of els) e.remove()
})

/** Mounted on AAA, both charts reported, the shadow on BBB. */
async function ready(over = {}) {
  const h = mount(over)
  report(h.result, 0, 'AAA')
  await idle()
  report(h.result, 1, 'BBB')
  return h
}
const press = (h, sym, over = {}) => h.rerender({ ...base(), ...over, sym })

describe('useDoubleBuffer', () => {
  it('H1 the hidden layer takes the row ahead once the front has drawn, with no idle time (the first press flips)', async () => {
    const { result } = mount()
    expect(result.current.syms).toEqual(['AAA', null])    // (LOW-2) the mount's retarget waits for the front's first pass…
    report(result, 0, 'AAA')
    expect(result.current.syms).toEqual(['AAA', 'BBB'])   // …then the frame (afterPaint is immediate here; no timer has run)
    expect(result.current.front).toBe(0)
    expect(result.current.syms).toEqual(['AAA', 'BBB'])
    expect(result.current.handles[0].state).toBe('visible')
    expect(result.current.handles[1].state).toBe('hidden')
  })

  it('H2 a press to the reported row FLIPS: roles swap, no layer changes symbol, handles follow, the paint is recorded', async () => {
    const h = await ready()
    const handles = h.result.current.handles
    press(h, 'BBB')
    expect(h.result.current.front).toBe(1)
    expect(h.result.current.syms[1]).toBe('BBB')           // the flip changed no layer's symbol (the retarget then moves layer 0: H10)
    expect(handles[1].state).toBe('visible')
    expect(handles[0].state).toBe('hidden')
    expect(db.doubleBufferStats().flips).toBe(1)
    expect(painted.some((a) => a[0] === 'BBB' && a[3] === 'flip' && a[4] === member && a[2] > 0)).toBe(true)
    await idle()
    expect(h.result.current.syms).toEqual(['CCC', 'BBB'])   // the old front takes the next row ahead
  })

  // ⭐⭐ (2026-11-27, review of #2934: a typed cold ticker flipped to a shadow painted from a short page, then the deep
  // history's join rescaled both charts) a shadow whose rows do not cover the view is not flippable: the normal switch
  it('H12 a shadow short of the view (its rows < viewNeed) is refused: the normal switch', async () => {
    const { COVER_ROWS } = await import('../../data/barStore/coverRows')
    held.rows = COVER_ROWS - 1
    const h = await ready()
    press(h, 'BBB')
    expect(h.result.current.front).toBe(0)                  // the front switched, no flip
    expect(db.doubleBufferStats().flips).toBe(0)
  })

  it('H12b control: a shadow whose rows cover the view flips', async () => {
    const { COVER_ROWS } = await import('../../data/barStore/coverRows')
    held.rows = COVER_ROWS
    const h = await ready()
    press(h, 'BBB')
    expect(h.result.current.front).toBe(1)
    expect(db.doubleBufferStats().flips).toBe(1)
  })

  it('H2b no report from the shadow yet (its chart has not committed the row): the normal switch', async () => {
    const h = mount()
    report(h.result, 0, 'AAA')
    await idle()
    press(h, 'BBB')
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().why['shadow-unreported']).toBe(1)   // on the row, its chart has not committed it yet
  })

  it('H10 right after a flip the old front takes the next row ahead, with no idle time', async () => {
    const h = await ready()
    press(h, 'BBB')
    expect(h.result.current.front).toBe(1)
    expect(h.result.current.syms).toEqual(['CCC', 'BBB'])   // no timer advanced since the press
  })

  it('H11 each decision is logged with how long the hidden pane had been on its row and since its chart reported', async () => {
    const h = await ready()
    press(h, 'BBB')
    const last = db.doubleBufferStats().log.at(-1)
    expect(last).toMatchObject({ sym: 'BBB', why: 'flip' })
    expect(typeof last.sinceSet).toBe('number')
    expect(typeof last.sinceReport).toBe('number')
    expect(last.sinceSet).toBeGreaterThanOrEqual(0)
  })

  it('H3 the store moved on since the shadow reported: refused; the shadow reports the new bars: a press flips', async () => {
    const h = await ready()
    fresh('BBB')                                         // the row's new base snapshot
    press(h, 'BBB')
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().why.stale).toBe(1)
    press(h, 'AAA')                                      // back (the front switches back to AAA)
    await idle()
    report(h.result, 0, 'AAA')
    report(h.result, 1, 'BBB')                           // the shadow's chart re-rendered on its current feed
    press(h, 'BBB')
    expect(h.result.current.front).toBe(1)
  })

  it('H4 a press to another row is the normal switch of the front', async () => {
    const h = await ready()
    press(h, 'CCC')
    expect(h.result.current.front).toBe(0)
    expect(h.result.current.syms[0]).toBe('CCC')
    expect(db.doubleBufferStats().why['shadow-other-row']).toBe(1)   // the shadow holds another row
    expect(painted.some((a) => a[3] === 'flip')).toBe(false)
  })

  it('H5 the board\'s budget taken: no shadow, no flip', async () => {
    db.acquireShadow(scope, {}); db.acquireShadow(scope, {})
    const h = mount()
    report(h.result, 0, 'AAA')
    await idle()
    expect(h.result.current.syms[1]).toBe(null)
    press(h, 'BBB')
    expect(h.result.current.front).toBe(0)
  })

  it('H6 (F2) a hidden board gives its shadow back and drops the hidden pane; shown again, the shadow returns; the budget is the slot\'s', async () => {
    const board = createBoardVisibility({ layer: true })
    const other = createBoardVisibility({ layer: true })
    db.acquireShadow(other, {}); db.acquireShadow(other, {})   // another board slot's budget is full: not this one's
    const h = mount({ parentVis: board })
    report(h.result, 0, 'AAA')
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
    expect(db.shadowsHeld(board)).toBe(1)
    act(() => { board.set('hidden') })
    expect(h.result.current.handles[h.result.current.front].state).toBe('hidden')   // nested: the board hides it
    expect(db.shadowsHeld(board)).toBe(0)
    expect(h.result.current.syms[1]).toBe('BBB')          // (N1) not in the hide's commit…
    await idle()
    expect(h.result.current.syms[1]).toBe(null)            // …in idle time
    act(() => { board.set('visible') })
    await idle()
    expect(db.shadowsHeld(board)).toBe(1)
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
  })

  it("H6b (delta 2, D2-1) a show before the hide's idle drop keeps the shadow pane", async () => {
    const board = createBoardVisibility({ layer: true })
    const h = mount({ parentVis: board })
    report(h.result, 0, 'AAA')
    await idle()
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])
    act(() => { board.set('hidden') })             // committed: the shadow given back, its idle drop scheduled
    // shown again, and the idle drop fires BEFORE the show's transition commits (inside one act: React waits for its end)
    act(() => { board.set('visible'); vi.advanceTimersByTime(80) })
    expect(h.result.current.syms).toEqual(['AAA', 'BBB'])  // the pane was kept
    expect(db.shadowsHeld(board)).toBe(1)
  })

  it('H7 (F1) a zoomed front refuses the flip; the shadow mirrors the zoom in idle time; then a press flips', async () => {
    const h = await ready()
    await idle()                                         // (whatever mirror the shadow's report scheduled has run)
    panes[0].m = meta(80, -5)                            // the member zoomed in on the front
    press(h, 'BBB')
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().why['view-zoom']).toBe(1)
    press(h, 'AAA')
    await idle()
    report(h.result, 0, 'AAA')
    report(h.result, 1, 'BBB')
    act(() => { h.result.current.viewChanged(0) })      // the front's range moved
    await idle()
    expect(panes[1].m.frame).toEqual({ fromRight: 80, toRight: -5, locked: false })
    press(h, 'BBB')
    expect(h.result.current.front).toBe(1)
  })

  it('H8 (F5) focus inside the old front moves into the new front', async () => {
    const h = await ready()
    els[0].querySelector('button').focus()
    expect(document.activeElement).toBe(els[0].querySelector('button'))
    press(h, 'BBB')
    expect(h.result.current.front).toBe(1)
    expect(panes[1].focus).toHaveBeenCalledTimes(1)
    expect(panes[0].focus).not.toHaveBeenCalled()
  })

  it('H8b focus elsewhere stays where it is', async () => {
    const h = await ready()
    press(h, 'BBB')
    expect(panes[1].focus).not.toHaveBeenCalled()
  })

  it('H9 (F6) no flip while a replay cutoff is set', async () => {
    const h = await ready({ replay: true })
    press(h, 'BBB', { replay: true })
    expect(h.result.current.front).toBe(0)
    expect(db.doubleBufferStats().why.replay).toBe(1)
  })
})

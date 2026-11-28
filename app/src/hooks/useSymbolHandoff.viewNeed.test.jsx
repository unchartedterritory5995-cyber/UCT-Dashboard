// ⭐⭐ NEVER A SHORT FIRST PAINT (2026-11-27, owner on production: "I type a random stock and it loads a small portion of
// the candles right away and then shortly after it loads the rest. That jumpiness is horrible."). A new symbol's first
// paint must already hold the rows the member's view will draw: its logical width (the right margin included, written by
// the chart painting under the member: chart/paintLog noteMemberView) plus the averages' lookback, never fewer than
// COVER_ROWS (useSymbolHandoff viewNeed). The device's copy of a never-opened ticker (~300 newest 5m rows) painted at once
// whatever the view (`devicePaints`), and the answer and the lake's depth then filled the screen in. Now a copy short of
// the view waits for the rows that cover it (the prepare), unless nothing more is coming (the lake settled and the server
// answered: a young listing paints what there is).
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
const st = { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: false, device: true }
let resolvePrepare = null
const prepareMock = vi.fn(() => new Promise((r) => { resolvePrepare = r }))
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
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => true }))

import useSymbolHandoff, { COVER_ROWS, VIEW_LOOKBACK_ROWS, viewNeed } from './useSymbolHandoff'
import { noteMemberView } from '../components/chart/paintLog'

beforeEach(() => {
  vi.useFakeTimers()
  Object.assign(st, { displayable: true, lake: true, deep: true, held: true, rows: 0, answered: false, device: true })
  prepareMock.mockClear(); heldRows.mockClear(); resolvePrepare = null
})
afterEach(() => { vi.useRealTimers() })

const flip = (tf, member = null) => {
  const h = renderHook(({ s }) => useSymbolHandoff(s, tf, { member }), { initialProps: { s: 'AAA' } })
  act(() => { h.rerender({ s: 'BBB' }) })
  return h
}

describe('a first paint holds the rows the view will draw', () => {
  it("viewNeed: COVER_ROWS for a view not known yet; the member's logical width plus the lookback for a wider one", () => {
    expect(viewNeed(null)).toBe(COVER_ROWS)
    const m = {}
    expect(viewNeed(m)).toBe(COVER_ROWS)
    noteMemberView(m, 120)                                         // a default-ish view: COVER_ROWS still
    expect(viewNeed(m)).toBe(COVER_ROWS)
    noteMemberView(m, 425.1)                                       // zoomed out (the owner's 1m chart)
    expect(viewNeed(m)).toBe(Math.ceil(425.1) + VIEW_LOOKBACK_ROWS)
  })

  // ⭐ (the BL repro; the #2934 mutant M2 survived without this) THE DAILY HALF: the device's daily copy (~350 rows)
  // painted at once whatever the view, then the deep history rescaled the chart. Short of the view while the deep
  // history is still due, the daily switch holds; a copy that covers the view paints at once.
  it('DAILY: a current device copy short of the view holds while the deep history is due', () => {
    st.rows = 350
    const { result } = flip('D')
    expect(result.current).toBe('AAA')
  })

  it('DAILY control: a current device copy that covers the view paints at once', () => {
    st.rows = COVER_ROWS
    const { result } = flip('D')
    expect(result.current).toBe('BBB')
  })

  it("a CURRENT device copy SHORT of the view (~300 rows) does not paint at once: the switch prepares and waits", async () => {
    st.rows = 300
    const { result } = flip('5')
    expect(result.current).toBe('AAA')                             // the outgoing chart stays whole
    expect(prepareMock).toHaveBeenCalled()
  })

  it('...and commits the moment the held rows cover the view (the answer landed), before the prepare reports', async () => {
    st.rows = 300
    const { result } = flip('5')
    expect(result.current).toBe('AAA')
    st.rows = 1152; st.answered = true                             // the server's first page
    await act(async () => { await vi.advanceTimersByTimeAsync(30) })
    expect(result.current).toBe('BBB')
  })

  it("a zoomed-out view (425 bars across): COVER_ROWS rows are short of it and wait; rows covering it paint at once", async () => {
    const m = {}
    noteMemberView(m, 425)
    st.rows = COVER_ROWS
    expect(flip('1', m).result.current).toBe('AAA')
    st.rows = 425 + VIEW_LOOKBACK_ROWS
    expect(flip('1', m).result.current).toBe('BBB')
  })

  // B9 (2026-11-28, CRAI on a zoomed-out 15m board): the prepare is told the view's need, so a local copy short of it
  // (the device's ~300 rows) asks the server instead of reporting 'current' on rows the handoff then refuses
  it("the prepare is handed the view's need (the rows it must cover)", async () => {
    const m = {}
    noteMemberView(m, 425)
    st.rows = 300
    flip('15', m)
    expect(prepareMock).toHaveBeenCalled()
    expect(prepareMock.mock.calls[0][2]).toMatchObject({ need: 425 + VIEW_LOOKBACK_ROWS })
  })

  it('short, and nothing more is coming (the lake settled, the server answered): a young listing paints what there is', async () => {
    st.rows = 120; st.lake = false; st.answered = true
    expect(flip('5').result.current).toBe('BBB')
  })

  it('control: short with the lake settled but NO answer of this life yet still waits (more is coming)', async () => {
    st.rows = 120; st.lake = false; st.answered = false
    expect(flip('5').result.current).toBe('AAA')
  })

  it('the prepare reporting while still short does NOT commit (never a short page); the hang guard still ends the wait', async () => {
    st.rows = 300
    const { result } = flip('5')
    expect(result.current).toBe('AAA')
    await act(async () => { resolvePrepare('current'); await vi.advanceTimersByTimeAsync(5) })
    expect(result.current).toBe('AAA')
    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })    // HANDOFF_HANG_MS: never a member stuck on A
    expect(result.current).toBe('BBB')
  })
})

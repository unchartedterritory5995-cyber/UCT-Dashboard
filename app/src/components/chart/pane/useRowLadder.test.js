// The one-row header ladder's fit (2026-11-19): a symbol switch keeps the level it has and the re-fit from the
// full row waits until the content rests, so a scan never pays ~10 synchronous re-renders per switch. A wider
// pane still re-fits at once; a clipped row still steps up before paint. jsdom lays nothing out, so `isClipped`
// is a fake: the row "needs" a level and clips below it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useState } from 'react'
import useRowLadder, { REFIT_REST_MS } from './useRowLadder'

let need = 0                 // the level at which the row stops clipping
let renders = 0
let reads = 0                // isClipped calls: each is a forced layout on the real header
function useHarness(props) {
  renders++
  const [level, setLevel] = useState(0)
  useRowLadder({ on: true, max: 9, level, setLevel, isClipped: () => { reads++; return level < need }, ...props })
  return level
}

beforeEach(() => { vi.useFakeTimers(); need = 0; renders = 0; reads = 0 })
afterEach(() => { vi.useRealTimers() })

describe('useRowLadder', () => {
  it('climbs before paint until the row fits', () => {
    need = 3
    const { result } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL' } })
    expect(result.current).toBe(3)
  })

  it('a NEW SYMBOL keeps the level it has: no synchronous re-climb', () => {
    need = 3
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL' } })
    expect(result.current).toBe(3)
    renders = 0
    rerender({ width: 800, content: 'MSFT' })
    expect(result.current).toBe(3)
    expect(renders).toBe(1)                       // one render for the switch itself, no ladder steps
  })

  it('...and re-fits from the full row once the content has rested', () => {
    need = 3
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL' } })
    rerender({ width: 800, content: 'MSFT' })
    need = 1                                       // MSFT's header is shorter: it can show more
    act(() => { vi.advanceTimersByTime(REFIT_REST_MS - 10) })
    expect(result.current).toBe(3)               // a scan passing through never re-fits
    act(() => { vi.advanceTimersByTime(20) })
    expect(result.current).toBe(1)
  })

  it('a switch that keeps changing (a scan) never re-fits', () => {
    need = 2
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'A0' } })
    need = 0
    for (let i = 1; i < 10; i++) { rerender({ width: 800, content: `A${i}` }); act(() => { vi.advanceTimersByTime(800) }) }
    expect(result.current).toBe(2)
  })

  it('a new symbol whose header is LONGER still steps up before paint', () => {
    need = 2
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL' } })
    need = 4
    rerender({ width: 800, content: 'GOOGL' })
    expect(result.current).toBe(4)
  })

  it('a WIDER pane re-fits from the full row at once', () => {
    need = 3
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 600, content: 'AAPL' } })
    need = 1
    rerender({ width: 900, content: 'AAPL' })
    expect(result.current).toBe(1)
  })

  it('a NARROWER pane keeps the steps taken', () => {
    need = 2
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 900, content: 'AAPL' } })
    need = 0
    rerender({ width: 700, content: 'AAPL' })
    expect(result.current).toBe(2)
  })

  // ⚡ (2026-11-26) the rested re-fit walks DOWN from the level it has: the same level as a climb from 0, in two renders
  // when the fit is unchanged (it reset to 0 and re-climbed: one render and one forced layout per level)
  it('the rested re-fit with an unchanged fit takes two renders and two layout reads, not one per level', () => {
    need = 8
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL' } })
    expect(result.current).toBe(8)
    rerender({ width: 800, content: 'MSFT' })
    renders = 0
    reads = 0
    act(() => { vi.advanceTimersByTime(REFIT_REST_MS + 10) })
    expect(result.current).toBe(8)
    expect(renders, 'level 7 (clips), back to level 8').toBe(2)
    expect(reads, 'one read per render').toBe(2)
  })

  it('the rested re-fit lands where a climb from the full row lands, for every level it starts on and every fit', () => {
    for (let from = 0; from <= 9; from++) {
      for (let fit = 0; fit <= from; fit++) {
        need = from
        const { result, rerender, unmount } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'A' } })
        expect(result.current).toBe(from)
        need = fit                                                     // the rested content needs this level
        rerender({ width: 800, content: 'B' })
        act(() => { vi.advanceTimersByTime(REFIT_REST_MS + 10) })
        expect(result.current, `from ${from}, fit ${fit}`).toBe(fit)
        unmount()
      }
    }
  })

  it('a switch during the walk down ends it: the new content is fitted by the climb, never left clipped', () => {
    need = 5
    const { result, rerender } = renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL' } })
    rerender({ width: 800, content: 'MSFT' })
    need = 2
    act(() => { vi.advanceTimersByTime(REFIT_REST_MS + 10) })
    expect(result.current).toBe(2)
    need = 6                                                           // a longer header arrives
    rerender({ width: 800, content: 'GOOGL' })
    expect(result.current).toBe(6)
  })
})

// ⚡ (2026-11-26, the board switch) A REMOUNTED PANE STARTS AT ITS LAST FIT. A board switch mounts every chart pane anew,
// and each climbed its header ladder from the full row: one render of the pane (and StockChart under it) plus one
// forced layout per level (4.7 ms of a two-chart board switch, production build). A pane that has fitted at this width
// before now starts at that level and checks it the way the rested re-fit does: one step down (clipped there: back up
// one, done). The levels that fit are a run from the fitted level up, so it lands where the climb from 0 lands.
describe('useRowLadder: a remounted pane starts at its last fit', () => {
  const mount = (props) => renderHook((p) => useHarness(p), { initialProps: { width: 800, content: 'AAPL', ...props } })

  it('S1 (red first) a pane that fitted at this width before lands on that level with 3 layout reads, not one per level', () => {
    need = 6
    const settled = []
    const { result } = mount({ startLevelFor: (w) => (w === 800 ? 6 : 0), onSettled: (l) => settled.push(l) })
    expect(result.current).toBe(6)
    expect(reads, `${reads} layout reads to land on the level it fitted at`).toBeLessThanOrEqual(3)
    expect(settled.at(-1)).toBe(6)
  })

  it('S2 a remembered level that is now too HIGH (the header got shorter) walks down to the level the climb finds', () => {
    need = 2
    const { result } = mount({ startLevelFor: () => 6 })
    expect(result.current).toBe(2)
  })

  it('S3 a remembered level that is now too LOW (the header got longer) climbs on to the level the climb finds', () => {
    need = 5
    const { result } = mount({ startLevelFor: () => 2 })
    expect(result.current).toBe(5)
  })

  it('S4 the settled level is reported (what the next mount starts from), and a pane with nothing remembered climbs from 0', () => {
    need = 4
    const settled = []
    const { result } = mount({ startLevelFor: () => 0, onSettled: (l) => settled.push(l) })
    expect(result.current).toBe(4)
    expect(settled.at(-1)).toBe(4)
    expect(reads).toBe(5)                                        // 0..4: the climb, as before
  })

  it('S5 a remembered level at a DIFFERENT width is not used: the climb from 0', () => {
    need = 3
    const { result } = mount({ width: 640, startLevelFor: (w) => (w === 800 ? 6 : 0) })
    expect(result.current).toBe(3)
    expect(reads).toBe(4)
  })
})

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
function useHarness(props) {
  renders++
  const [level, setLevel] = useState(0)
  useRowLadder({ on: true, max: 9, level, setLevel, isClipped: () => level < need, ...props })
  return level
}

beforeEach(() => { vi.useFakeTimers(); need = 0; renders = 0 })
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
})

// ── The atomic symbol handoff ───────────────────────────────────────────────
//
// The contract, in one line: the member never sees an incoherent chart. Not
// B's header over A's candles, not B's header over a blank canvas, not B's
// header over hours-stale B candles. Either A is fully A, or B is fully B.

import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const memState = new Map()
vi.mock('../utils/barsMemCache', () => ({
  memPeek: (sym, tf) => memState.get(`${sym}_${tf}`) ?? null,
}))
const idbState = new Map()
const idbGetMock = vi.fn(async (sym, tf) => idbState.get(`${sym}_${tf}`))
vi.mock('../utils/barsIDB', () => ({ idbGet: (...a) => idbGetMock(...a) }))
const prefetchMock = vi.fn()
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: (...a) => prefetchMock(...a) }))

import useSymbolHandoff, { peekDisplayable } from './useSymbolHandoff'

// Mid-session Wednesday, so there IS a frontier to be behind.
const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const unix = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).getTime() / 1000)
}
const series = (tSec) => [{ t: tSec - 300, c: 1 }, { t: tSec, c: 1 }]
const CURRENT = () => series(unix('15:50'))
const STALE = () => series(unix('10:00'))

beforeEach(() => {
  memState.clear(); idbState.clear()
  idbGetMock.mockClear(); prefetchMock.mockClear()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

describe('fast path — a warm neighbour must cost nothing', () => {
  it('commits IMMEDIATELY when B is already current in mem', () => {
    memState.set('B_5', CURRENT())
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    expect(result.current).toBe('A')
    act(() => { rerender({ s: 'B' }) })
    // Same tick — no scheduling round-trip, no poll, no prepare.
    expect(result.current).toBe('B')
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it('peekDisplayable is synchronous and rejects a stale mem series', () => {
    memState.set('X_5', STALE())
    expect(peekDisplayable('X', '5')).toBe(false)
    memState.set('Y_5', CURRENT())
    expect(peekDisplayable('Y', '5')).toBe(true)
  })
})

describe('slow path — A stays whole while B prepares', () => {
  it('⛔ keeps displaying A when B is HOURS BEHIND, and kicks a prepare', () => {
    memState.set('B_5', STALE())
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    // The whole point: identity has NOT moved to B, so nothing incoherent shows.
    expect(result.current).toBe('A')
    expect(prefetchMock).toHaveBeenCalledWith(['B'], '5', { priority: true, immediate: true })
  })

  it('commits B once the repair lands', async () => {
    memState.set('B_5', STALE())
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')
    // The warmer repairs the cache…
    memState.set('B_5', CURRENT())
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('B')
  })

  it('keeps displaying A for a COLD B until its data arrives', async () => {
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('A')
    idbState.set('B_5', { bars: CURRENT() })
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('B')
  })

  it('⛔⛔ a DEADLINE commits anyway — a dead ticker must not silently pin A', async () => {
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'DEAD' }) })
    expect(result.current).toBe('A')
    await act(async () => { await vi.advanceTimersByTimeAsync(700) })
    // Refusing the click forever would be a worse bug than the blank frame.
    expect(result.current).toBe('DEAD')
  })
})

describe('rapid scanning — latest request wins, cancelled prepares never land', () => {
  it('⛔⛔ a slow B can NEVER commit after C was requested', async () => {
    memState.set('B_5', STALE())
    memState.set('C_5', STALE())
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    act(() => { rerender({ s: 'C' }) })
    // B's data arrives LATE — after the user has already moved on.
    memState.set('B_5', CURRENT())
    await act(async () => { await vi.advanceTimersByTimeAsync(120) })
    // A wrong-symbol frame would be exactly "B" here.
    expect(result.current).not.toBe('B')
    expect(result.current).toBe('A')
    memState.set('C_5', CURRENT())
    await act(async () => { await vi.advanceTimersByTimeAsync(60) })
    expect(result.current).toBe('C')
  })

  it('A→B→C→D with everything warm lands on D and never shows an unrequested symbol', () => {
    for (const s of ['B', 'C', 'D']) memState.set(`${s}_5`, CURRENT())
    const seen = []
    const { result, rerender } = renderHook(
      ({ s }) => { const d = useSymbolHandoff(s, '5'); seen.push(d); return d },
      { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }); rerender({ s: 'C' }); rerender({ s: 'D' }) })
    expect(result.current).toBe('D')
    for (const s of seen) expect(['A', 'B', 'C', 'D']).toContain(s)
  })

  it('returning to the symbol already displayed is a no-op', () => {
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'A' }) })
    expect(result.current).toBe('A')
    expect(prefetchMock).not.toHaveBeenCalled()
  })
})

describe('scope — what the handoff must NOT hold back', () => {
  it('first mount never lags: there is no previous chart to protect', () => {
    const { result } = renderHook(() => useSymbolHandoff('AAPL', '5'))
    expect(result.current).toBe('AAPL')
  })

  it('DAILY commits immediately — the frontier maths is intraday-only', () => {
    memState.set('B_D', [{ t: '2026-09-16', c: 1 }])
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, 'D'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
  })

  it('a CUSTOM timeframe (2m) is passed straight through — deferred architecture', () => {
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '2'), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
    expect(prefetchMock).not.toHaveBeenCalled()
  })

  it('enabled:false is a complete bypass', () => {
    memState.set('B_5', STALE())
    const { result, rerender } = renderHook(
      ({ s }) => useSymbolHandoff(s, '5', { enabled: false }), { initialProps: { s: 'A' } })
    act(() => { rerender({ s: 'B' }) })
    expect(result.current).toBe('B')
  })
})

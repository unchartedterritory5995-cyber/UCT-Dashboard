// The warmers never send a pseudo-ticker down the bars lane (2026-11-15: 123 `$IDX:` requests per
// nav click-through, each a 503 "warming" the client retried). Pinned at the rule and at the wire.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isBarsSymbol } from './barsSymbol'

describe('isBarsSymbol', () => {
  it('real tickers are bars symbols, including dotted and lower-case ones', () => {
    for (const s of ['SPY', 'BRK.B', 'brk.b', 'NVDA', 'A', 'RDS-A']) expect(isBarsSymbol(s)).toBe(true)
  })
  it('pseudo-tickers and non-strings are not', () => {
    for (const s of ['$IDX:SOLAR', '$idx:solar', ' $IDX:AI', '$X', '', '   ', null, undefined, 0, {}]) expect(isBarsSymbol(s)).toBe(false)
  })
})

describe('the warmers ask the bars lane for real symbols only', () => {
  let calls
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    calls = []
    localStorage.setItem('barspack.version', 'test')
    globalThis.fetch = vi.fn(async (url) => {
      calls.push(String(url))
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ bars: [] }) }
    })
  })
  afterEach(() => { vi.useRealTimers(); localStorage.removeItem('barspack.version') })

  const barsCalls = () => calls.filter((u) => u.includes('/api/bars/'))
  const settle = async () => { for (let i = 0; i < 6; i++) await vi.advanceTimersByTimeAsync(1500) }

  it('every list and single-symbol warmer skips `$IDX:` and still warms the real one beside it', async () => {
    const P = await import('./prefetchBars')
    const LIST = ['$IDX:SOLAR', 'REALA', '$idx:biotech']
    P.prefetchBars(LIST, 'D')
    P.prefetchBars(LIST, '5', { urgent: true })
    P.prefetchBarsToIDB(LIST, 'D', { immediate: true })
    P.prefetchListAllTimeframes(LIST)
    P.prefetchGridWarm(LIST)
    P.warmMemFromIDB(LIST)
    P.prewarmVisibleList(LIST, { chartTf: 'D' })
    P.prefetchBar('$IDX:SOLAR', 'D')
    P.prefetchAllTimeframes('$IDX:SOLAR')
    P.warmTypedSymbol('$IDX:SOLAR', 'D')
    P.prefetchReplayTimeframes('$IDX:SOLAR', '2026-11-13')
    await settle()
    const asked = barsCalls()
    expect(asked.filter((u) => /%24|\$/.test(u))).toEqual([])
    // the control: the same calls DID reach the lane for the real symbol
    expect(asked.some((u) => u.includes('/api/bars/REALA'))).toBe(true)
  })

  it('control: a real single symbol is asked for', async () => {
    const P = await import('./prefetchBars')
    P.prefetchBar('REALB', 'D')
    await settle()
    expect(barsCalls().some((u) => u.includes('/api/bars/REALB'))).toBe(true)
  })
})

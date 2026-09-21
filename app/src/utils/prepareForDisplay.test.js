// ── "Is there a chart to show for B, and how do I know?" ────────────────────
//
// ⛔⛔ THE BLIND TIMER THIS EXISTS TO REPLACE. The handoff used to commit the new
// symbol after a flat 600ms whatever its data looked like — so a symbol that had
// not prepared got committed anyway, StockChart received it with no bars, the
// empty-bars teardown fired, and the member got B's header over a black canvas.
// A timeout was standing in for a result. These rails pin the four outcomes that
// replaced it, and in particular the one that is neither "current" nor "stale".

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const preloadMock = vi.fn()
vi.mock('swr', () => ({ preload: (...a) => preloadMock(...a) }))

const idbState = { entry: undefined, put: vi.fn(async () => {}) }
vi.mock('./barsIDB', () => ({
  idbGet: vi.fn(async () => idbState.entry),
  idbPut: (...a) => idbState.put(...a),
  mergeDelta: (a, b) => [...a, ...b],
}))
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

import { prepareForDisplay, _noteWarmResult } from './prefetchBars'
import { memClear } from './barsMemCache'

const NOW = new Date('2026-09-16T15:55:00-04:00').getTime()
const unix = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return Math.floor(new Date(`2026-09-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`).getTime() / 1000)
}
const barsEnding = (t, n = 20) =>
  Array.from({ length: n }, (_, i) => ({ t: t - (n - 1 - i) * 300, o: 1, h: 2, l: 0, c: 1, v: 9 }))

beforeEach(() => {
  memClear()
  preloadMock.mockReset()
  idbState.entry = undefined
  idbState.put.mockClear()
  try { localStorage.clear(); localStorage.setItem('barspack.version', '2026-09-01') } catch { /* ignore */ }
  _noteWarmResult({ bars: [{ t: 1 }] })   // clear any 503 backoff from a prior test
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

describe('prepareForDisplay — an OUTCOME, never a stopwatch', () => {
  it('a cache already at the frontier is "current" with no request at all', async () => {
    idbState.entry = { bars: barsEnding(unix('15:50')), lastT: unix('15:50') }
    await expect(prepareForDisplay('MU', '5')).resolves.toBe('current')
    expect(preloadMock).not.toHaveBeenCalled()
  })

  it('an hours-behind cache is repaired via since= and becomes "current"', async () => {
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    preloadMock.mockResolvedValue({ bars: barsEnding(unix('15:50'), 4), delta: true })
    await expect(prepareForDisplay('MU', '5')).resolves.toBe('current')
    expect(preloadMock.mock.calls[0][0]).toContain('since=')
    expect(idbState.put).toHaveBeenCalled()
  })

  it('⭐⭐ AUTHORITATIVE: we asked, the server has NOTHING newer', async () => {
    // A halted or thinly-traded symbol. Its cache is not behind the market — it
    // IS the market for that symbol. Waiting for a bar that will never print
    // would pin the previous chart forever; calling it stale would be wrong
    // about the data. This is the third answer that neither word covers.
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    preloadMock.mockResolvedValue({ bars: [], delta: true })
    await expect(prepareForDisplay('HALT', '5')).resolves.toBe('authoritative')
  })

  it('a cold symbol that fetches a current window is "current"', async () => {
    idbState.entry = undefined
    preloadMock.mockResolvedValue({ bars: barsEnding(unix('15:50')) })
    await expect(prepareForDisplay('NEW', '5')).resolves.toBe('current')
    expect(preloadMock.mock.calls[0][0]).not.toContain('since=')
  })

  it('⛔ a symbol with NO bars anywhere is "nodata" — never silently "current"', async () => {
    idbState.entry = undefined
    preloadMock.mockResolvedValue({ bars: [] })
    await expect(prepareForDisplay('DEAD', '5')).resolves.toBe('nodata')
    expect(idbState.put).not.toHaveBeenCalled()
  })

  it('a failed request is "error", not a silent success', async () => {
    idbState.entry = undefined
    preloadMock.mockRejectedValue(new Error('network'))
    await expect(prepareForDisplay('X', '5')).resolves.toBe('error')
  })

  it('a missing symbol or timeframe is "error", not a crash', async () => {
    await expect(prepareForDisplay('', '5')).resolves.toBe('error')
    await expect(prepareForDisplay('X', '')).resolves.toBe('error')
  })

  it('DAILY resolves "current" off a fetch without intraday frontier maths', async () => {
    idbState.entry = undefined
    preloadMock.mockResolvedValue({ bars: [{ t: '2026-09-16', o: 1, h: 2, l: 0, c: 1, v: 9 }] })
    await expect(prepareForDisplay('MU', 'D')).resolves.toBe('current')
  })

  it('every native intraday timeframe reports "current" after a repair', async () => {
    // ⚠️ THE REPAIRED TAIL MUST REACH *THAT* TIMEFRAME'S FRONTIER. A first draft
    // handed every tf a tail ending 15:50 and 1m correctly answered
    // "authoritative" — at 15:55 the 1m frontier is 15:54, so 15:50 is four
    // buckets short. The fixture was wrong, not the code; a per-tf frontier is
    // the whole reason staleness is counted in buckets rather than seconds.
    for (const tf of ['1', '15', '30', '60']) {
      idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
      preloadMock.mockReset()
      preloadMock.mockResolvedValue({ bars: barsEnding(unix('15:54'), 3), delta: true })
      await expect(prepareForDisplay(`T${tf}`, tf)).resolves.toBe('current')
    }
  })

  it('⛔ …and a tail that does NOT reach the frontier stays "authoritative"', async () => {
    // The converse of the fixture bug above, pinned so it cannot silently
    // become "current": on 1m a 15:50 tail at 15:55 is four buckets short.
    idbState.entry = { bars: barsEnding(unix('10:00')), lastT: unix('10:00') }
    preloadMock.mockResolvedValue({ bars: barsEnding(unix('15:50'), 3), delta: true })
    await expect(prepareForDisplay('SLOW', '1')).resolves.toBe('authoritative')
  })
})

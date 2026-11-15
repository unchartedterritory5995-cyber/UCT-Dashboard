// ── A SHORT stored intraday series is not "already warm" (2026-11-15) ────────────────────────────
// Measured on production (hourly charts, Nasdaq 100, 40 charts at 0.7 s): 34 of 40 first drew with
// fewer than 200 bars, so a 200-bar average landed 233 ms (median) to 649 ms after the candles. The
// intraday pack seeds a short series for every name; the warmers counted any CURRENT series as warm,
// so the rows ahead were never deepened. Rules (prefetchBars `_shortIntraday`):
//   1. a stored intraday series shorter than half the chart's first-paint window gets the FULL
//      window from every warmer (durable list warm, urgent rows-ahead, hover intent), current or not;
//   2. CONTROLS: a deep series keeps the old answers (current: nothing; behind: `since=`), and the
//      rule is intraday-only (a short weekly series is left alone);
//   3. once per key: a full answer that is still short is all the server holds, so the next warm
//      asks nothing (current) or only the tail (behind), until SHORT_FULL_TTL_MS (6 h) has passed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const idb = vi.hoisted(() => ({ entries: new Map() }))
vi.mock('./barsIDB', async (orig) => {
  const real = await orig()
  return {
    ...real,
    idbGet: vi.fn(async (sym, tf) => idb.entries.get(`${sym}_${tf}`) ?? null),
    idbPut: vi.fn(async (sym, tf, bars) => { idb.entries.set(`${sym}_${tf}`, { bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() }) }),
    idbPutMonotonic: vi.fn(async (sym, tf, bars, opts) => {
      const key = `${sym}_${tf}`
      const next = real.mergeMonotonic(idb.entries.get(key)?.bars ?? null, bars, opts)
      if (!next?.length) return null
      idb.entries.set(key, { bars: next, lastT: next[next.length - 1].t, savedAt: Date.now() })
      return next
    }),
  }
})
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const { prefetchBarsToIDB, prefetchBars, prefetchBarOnIntent, _resetRepairCooldown, setPrefetchShowExtended } = await import('./prefetchBars')
const { memPeek, memClear, memPut } = await import('./barsMemCache')
const { firstPaintBarsFor } = await import('./barsBackfill')

// Tue 2026-09-15 (EDT, UTC-4)
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 15, h + 4, m) / 1000)
const at = (h, m) => { vi.setSystemTime(et(h, m) * 1000) }
const bar = (t) => ({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 })
const bars5 = (fromH, fromM, toH, toM) => {
  const out = []
  for (let t = et(fromH, fromM); t <= et(toH, toM); t += 300) out.push(bar(t))
  return out
}
/** `bars` with `n` older rows ahead of it (days earlier); the tail is unchanged. */
const deep = (bars, n = 700) => [...Array.from({ length: n }, (_, i) => bar(bars[0].t - 5 * 86400 + i * 60)), ...bars]
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
const WINDOW_5 = firstPaintBarsFor('5', false)        // what the chart asks for on an RTH 5-minute view
const SHORT = () => bars5(9, 30, 13, 15)               // today only: 46 bars, current at 13:17
const BEHIND_SHORT = () => bars5(9, 30, 10, 0)         // 7 bars, three hours behind at 13:17

let urls
/** The server: a full ask gets `history.slice(-n)`; a `since=` ask gets the rows after it. */
function serve(sym, history = deep(SHORT(), 1200)) {
  vi.stubGlobal('fetch', vi.fn(async (u) => {
    const s = String(u)
    urls.push(s)
    const n = Number((s.match(/[?&]bars=(\d+)/) || [])[1] || 0)
    const since = (s.match(/[?&]since=(\d+)/) || [])[1]
    const body = since
      ? { ticker: sym, tf: '5', delta: true, bars: history.filter(b => b.t > Number(since)) }
      : { ticker: sym, tf: '5', bars: history.slice(-n) }
    return { ok: true, status: 200, json: async () => body }
  }))
}
const store = (sym, bars, tf = '5') => idb.entries.set(`${sym}_${tf}`, { bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() })
const isFull = (u) => !/[?&]since=/.test(u) && Number(u.match(/[?&]bars=(\d+)/)[1]) === WINDOW_5

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  idb.entries.clear(); memClear(); _resetRepairCooldown()
  urls = []
  try { localStorage.setItem('barspack.version', '2026-09-14') } catch { /* */ }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPrefetchShowExtended(false) })

describe('the durable list warm', () => {
  it('a short CURRENT store gets the full window (it used to be skipped as warm)', async () => {
    at(13, 17); store('SHC', SHORT()); serve('SHC')
    expect(SHORT().length).toBeLessThan(WINDOW_5 / 2)                // the case this is about
    prefetchBarsToIDB(['SHC'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    expect(isFull(urls[0])).toBe(true)
    expect(idb.entries.get('SHC_5').bars.length).toBeGreaterThanOrEqual(WINDOW_5 / 2)
  })
  it('CONTROL: a deep current store is still skipped (no request)', async () => {
    at(13, 17); store('DPC', deep(SHORT())); serve('DPC')
    prefetchBarsToIDB(['DPC'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(0)
  })
  it('a short BEHIND store gets the full window, not a since= tail', async () => {
    at(13, 17); store('SHB', BEHIND_SHORT()); serve('SHB')
    prefetchBarsToIDB(['SHB'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    expect(isFull(urls[0])).toBe(true)
  })
  it('CONTROL: a deep behind store is repaired with since=', async () => {
    at(13, 17); store('DPB', deep(BEHIND_SHORT())); serve('DPB')
    prefetchBarsToIDB(['DPB'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/[?&]since=/)
  })
  it('the line is half the window: one bar under it is short, at it is not', async () => {
    at(13, 17)
    const half = Math.ceil(WINDOW_5 / 2)
    store('HLF', deep(SHORT(), half - SHORT().length)); store('HLU', deep(SHORT(), half - 1 - SHORT().length))
    expect(idb.entries.get('HLF_5').bars.length).toBe(half)
    serve('HLF')
    prefetchBarsToIDB(['HLF', 'HLU'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/api/bars/HLU?')
  })
  it('CONTROL: intraday only, a short weekly store is left alone', async () => {
    at(13, 17)
    store('WKS', [bar(et(9, 30) - 14 * 86400), bar(et(9, 30) - 7 * 86400), bar(et(9, 30))], 'W')
    serve('WKS')
    prefetchBarsToIDB(['WKS'], 'W', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(0)
  })
})

describe('once per key: a full answer that is still short is all there is', () => {
  const thin = () => bars5(9, 30, 13, 15).slice(-50)                    // the server's whole history
  it('the next warm asks nothing; another symbol still asks', async () => {
    at(13, 17); store('THN', SHORT()); serve('THN', thin())
    prefetchBarsToIDB(['THN'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    expect(idb.entries.get('THN_5').bars.length).toBeLessThan(WINDOW_5 / 2)   // still short
    prefetchBarsToIDB(['THN'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    store('THO', SHORT()); serve('THO', thin())
    prefetchBarsToIDB(['THO'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(2)
  })
  it('a full answer from the urgent warm counts for the list warm', async () => {
    // (A second URGENT ask inside 30 s never reaches the rule: the queue's `_seen` window drops it.)
    at(13, 17); store('THU', SHORT()); serve('THU', thin())
    prefetchBars(['THU'], '5', { urgent: true }); await new Promise(r => setTimeout(r, 300)); await flush(60)
    expect(urls).toHaveLength(1)
    prefetchBarsToIDB(['THU'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
  })
  it('a full answer from the hover intent counts for the list warm', async () => {
    at(13, 17); store('THI', SHORT()); serve('THI', thin())
    prefetchBarOnIntent('THI', '5', { delay: 0 }); await flush(80)
    expect(urls).toHaveLength(1)
    prefetchBarsToIDB(['THI'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
  })
  it('within 6 h a behind store gets only its tail; after 6 h the full window again', async () => {
    at(13, 17); store('TTL', SHORT()); serve('TTL', thin())
    prefetchBarsToIDB(['TTL'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(1)
    at(19, 0)                                                            // 5 h 43 min later, behind
    prefetchBarsToIDB(['TTL'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(2)
    expect(urls[1]).toMatch(/[?&]since=/)
    vi.setSystemTime(et(19, 0) * 1000 + 3600 * 1000)                     // 6 h 43 min after the full answer
    prefetchBarsToIDB(['TTL'], '5', { priority: true, immediate: true }); await flush()
    expect(urls).toHaveLength(3)
    expect(isFull(urls[2])).toBe(true)
  })
})

describe('the urgent rows-ahead warm and the hover intent', () => {
  // The urgent queue starts on an idle kick (jsdom: setTimeout 800 ms).
  const settle = async () => { await new Promise(r => setTimeout(r, 1000)); await flush(60) }
  it('urgent: a short current store is fetched on the chart key and lands deep in mem', async () => {
    at(13, 17); store('URS', SHORT()); serve('URS')
    prefetchBars(['URS'], '5', { urgent: true }); await settle()
    expect(urls).toHaveLength(1)
    expect(isFull(urls[0])).toBe(true)
    expect(urls[0]).not.toMatch(/warm=1/)
    expect(memPeek('URS', '5').length).toBeGreaterThanOrEqual(WINDOW_5 / 2)
  })
  it('CONTROL urgent: a deep current store is promoted to mem, no request', async () => {
    at(13, 17); store('URD', deep(SHORT())); serve('URD')
    prefetchBars(['URD'], '5', { urgent: true }); await settle()
    expect(urls).toHaveLength(0)
    expect(memPeek('URD', '5')?.length).toBe(deep(SHORT()).length)
  })
  it('urgent: a short copy in memory is not "usable" (no store): the window is fetched', async () => {
    at(13, 17); memPut('UMS', '5', SHORT()); serve('UMS')
    prefetchBars(['UMS'], '5', { urgent: true }); await settle()
    expect(urls).toHaveLength(1)
    expect(isFull(urls[0])).toBe(true)
  })
  it('CONTROL urgent: a deep current copy in memory is usable, no request', async () => {
    at(13, 17); memPut('UMD', '5', deep(SHORT())); serve('UMD')
    prefetchBars(['UMD'], '5', { urgent: true }); await settle()
    expect(urls).toHaveLength(0)
  })
  it('intent: a short current store is fetched, a deep one is promoted', async () => {
    at(13, 17); store('INS', SHORT()); store('IND', deep(SHORT())); serve('INS')
    prefetchBarOnIntent('INS', '5', { delay: 0 })
    prefetchBarOnIntent('IND', '5', { delay: 0 })
    await flush(80)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('/api/bars/INS?')
    expect(memPeek('IND', '5')?.length).toBe(deep(SHORT()).length)
  })
})

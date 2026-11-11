// W-L (2026-11-11) — watchlist scan lag rails. The warmers must answer the chart's OWN
// paint question (session included) and must land what they fetch where the chart reads.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const idb = vi.hoisted(() => ({ entries: new Map(), puts: [] }))
vi.mock('./barsIDB', async (orig) => {
  const real = await orig()
  return {
    ...real,
    idbGet: vi.fn(async (sym, tf) => idb.entries.get(`${sym}_${tf}`) ?? null),
    idbPut: vi.fn(async (sym, tf, bars) => { idb.puts.push(`${sym}_${tf}`); idb.entries.set(`${sym}_${tf}`, { bars, lastT: bars[bars.length - 1].t, savedAt: Date.now() }) }),
  }
})
vi.mock('../hooks/useTickerMeta', () => ({ prefetchTickerMeta: vi.fn() }))

const { warmMemFromIDB, prefetchBarsToIDB, prefetchAllTimeframes, setPrefetchShowExtended, _resetRepairCooldown } = await import('./prefetchBars')
const { memPeek, memClear } = await import('./barsMemCache')

// Tue 2026-09-15 (EDT, UTC-4)
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 15, h + 4, m) / 1000)
const bars5 = (fromH, fromM, toH, toM) => {
  const out = []
  for (let t = et(fromH, fromM); t <= et(toH, toM); t += 300) out.push({ t, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 })
  return out
}
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)) }
const at = (h, m) => { vi.setSystemTime(et(h, m) * 1000) }

let urls
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  idb.entries.clear(); idb.puts.length = 0; memClear(); _resetRepairCooldown()
  urls = []
  try { localStorage.setItem('barspack.version', '2026-09-14') } catch { /* */ }
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setPrefetchShowExtended(false) })

const stubFetch = (sym, rows, extra = {}) => vi.stubGlobal('fetch', vi.fn(async (u) => {
  urls.push(String(u))
  return { ok: true, status: 200, json: async () => ({ ticker: sym, tf: '5', bars: rows, ...extra }) }
}))

describe('extended-hours view: the warmers ask the chart\'s session question', () => {
  it('pre-market, a 2h-old ETH tail is NOT promoted to mem (the ETH chart refuses it)', async () => {
    at(9, 0)
    setPrefetchShowExtended(true)
    idb.entries.set('AAA_5', { bars: bars5(4, 0, 7, 0), lastT: et(7, 0), savedAt: Date.now() })
    warmMemFromIDB(['AAA'], ['5'])
    await flush()
    // Before: RTH frontier is null pre-market → "current" → promoted → chart refused it.
    expect(memPeek('AAA', '5')).toBeNull()
  })
  it('pre-market, the durable warm REPAIRS that tail with since= and lands it in mem', async () => {
    at(9, 0)
    setPrefetchShowExtended(true)
    idb.entries.set('BBB_5', { bars: bars5(4, 0, 7, 0), lastT: et(7, 0), savedAt: Date.now() })
    stubFetch('BBB', bars5(7, 5, 8, 55), { delta: true })
    prefetchBarsToIDB(['BBB'], '5', { priority: true, immediate: true })
    await flush()
    // Before: classified 'fresh' for RTH → "already warm" → no request at all.
    expect(urls.length).toBe(1)
    expect(urls[0]).toMatch(/[?&]since=/)
    expect(urls[0]).toMatch(/[?&]session=eth/)
    expect(memPeek('BBB', '5')?.at(-1)?.t).toBe(et(8, 55))
  })
  it('RTH view keeps its own rule: pre-market there is nothing to be stale against', async () => {
    at(9, 0)
    idb.entries.set('CCC_5', { bars: bars5(4, 0, 7, 0), lastT: et(7, 0), savedAt: Date.now() })
    warmMemFromIDB(['CCC'], ['5'])
    await flush()
    expect(memPeek('CCC', '5')?.length).toBeGreaterThan(0)
  })
})

describe('regular-hours view: judged on the tail it actually DRAWS', () => {
  const extBars = () => [...bars5(9, 30, 15, 55).map(b => ({ ...b, t: b.t - 86400 })), ...bars5(4, 0, 7, 20)]
  it('09:38, a cache ending in 07:20 pre-market (RTH tail = yesterday 15:55) is repaired, not called current', async () => {
    at(9, 38)
    const bars = extBars()
    idb.entries.set('EEE_5', { bars, lastT: et(7, 20), savedAt: Date.now() })
    stubFetch('EEE', bars5(7, 25, 9, 35), { delta: true })
    prefetchBarsToIDB(['EEE'], '5', { priority: true, immediate: true })
    await flush()
    // Before: the raw 07:20 tail is "1 bucket behind" 09:30 → current → no request, and
    // the chart drew yesterday's close as today's regular session until its own repair.
    expect(urls.length).toBe(1)
    expect(urls[0]).toMatch(/[?&]since=/)
    expect(memPeek('EEE', '5')?.at(-1)?.t).toBe(et(9, 35))
  })
  it('…and is not promoted to mem as a first frame', async () => {
    at(9, 38)
    idb.entries.set('FFF_5', { bars: extBars(), lastT: et(7, 20), savedAt: Date.now() })
    warmMemFromIDB(['FFF'], ['5'])
    await flush()
    expect(memPeek('FFF', '5')).toBeNull()
  })
})

describe('prefetchAllTimeframes lands its answers where the chart reads', () => {
  it('a selected ticker\'s other timeframes reach mem + IDB (not a dropped warm=1 preload)', async () => {
    at(13, 17)
    stubFetch('DDD', bars5(9, 30, 13, 15))
    prefetchAllTimeframes('DDD')
    // The durable queue is idle-deferred; jsdom has no requestIdleCallback → setTimeout(1000).
    await new Promise(r => setTimeout(r, 1100)); await flush(80)
    expect(urls.some(u => /\/api\/bars\/DDD\?tf=5&/.test(u))).toBe(true)
    // Before: eight `&warm=1` fetches whose answers were dropped — nothing in mem/IDB.
    expect(idb.puts).toContain('DDD_5')
    expect(memPeek('DDD', '5')?.length).toBeGreaterThan(0)
  })
})

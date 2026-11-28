// A chart at a past date reads the history LAKE, not the origin (zero-network plan PR 1.1, 2026-11-28; owner: charts "in
// 2006"). An intraday chart anchored at a date reads the WINDOW key (`@to=`, chart/viewWindow); its one read asked the
// origin's /api/bars?to= (95-130 ms server-cold, a store miss a vendor replay of seconds) although the lake at the edge holds
// the same bars. Rails:
//   W1  a window inside the lake sends NO /api/bars, and lands as the window's one answer (answered, REST_FULL, 'lake');
//   W2  a window past the lake's newest session asks the origin (`to=`), as do a lake miss, a lake error and a seam that
//       disagrees with bars the page holds;
//   W3  the lake's window equals the origin's `to=` answer (newest N bars at or before 23:59:59 ET of the date), bar for
//       bar, on 20 fixture symbols (timeframes, piece edges, DST, weekends and holidays, a late listing, a short history);
//   W4  no second full draw: the window's bars change ONCE, and nothing (no lake join, no scroll-back, no poll) follows;
//   W5  an abort of one read never rejects another reader of the same index.
// Synthetic prices only. The harness is switchInvariants' `net()`: createNetwork with a mock request and manual timers.
import { describe, it, expect, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
import { createHistoryFeed, windowEndOf } from './historyFeed'
import { keyOf } from './types'
import { viewWindowOfDate } from '../../components/chart/viewWindow'
import { etMidnightEpoch } from '../historyLake/adjust'
import { rng } from './__fixtures__/seededSeries'
import { inExtendedSession } from './extendedSession'

// ── a synthetic market: bars, lake pieces, the origin's `to=` rule ─────────────────────────────────────────────────────
const isoAdd = (iso, days) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay()
/** Bars of `tf` minutes for every weekday from `from` to `to` (ISO, inclusive) but `holidays`, 04:00-20:00 ET. */
function makeSeries(seed, tf, from, to, { holidays = [], startPx = 50 } = {}) {
  const r = rng(seed)
  const out = []
  let px = startPx
  for (let d = from; d <= to; d = isoAdd(d, 1)) {
    if (weekday(d) === 0 || weekday(d) === 6 || holidays.includes(d)) continue
    const m0 = etMidnightEpoch(d)
    for (let t = m0 + 4 * 3600; t < m0 + 20 * 3600; t += tf * 60) {
      if (!inExtendedSession(t)) continue   // a half day's 17:00-20:00 (the origin and the store refuse it: extendedSession.js)
      const o = px
      px = Math.max(1, Math.round((px + r.float(-0.3, 0.3)) * 100) / 100)
      out.push({ t, o, h: Math.max(o, px) + 0.05, l: Math.min(o, px) - 0.05, c: px, v: r.int(1, 5000) })
    }
  }
  return out
}
/** The lake's piece of a bar: a month of 1m, a quarter of 5m, a year of 15/30/60m (historyLake/source.js). */
function periodOf(tf, t) {
  const d = new Date((t - 5 * 3600) * 1000).toISOString()   // (an ET-ish calendar is enough to cut pieces)
  const y = d.slice(0, 4), m = Number(d.slice(5, 7))
  if (tf === 1) return `${y}-${String(m).padStart(2, '0')}`
  if (tf === 5) return `${y}-Q${Math.ceil(m / 3)}`
  return y
}
/** A fake history source over `market` ({ SYM: { tf: rows } }): loadIndex / loadBars as historyLake/source.js answers them
 *  (whole pieces overlapping [from, to], oldest first; null for an unknown symbol). Counts its reads. */
function fakeSource(market, { through = Infinity, fail = null } = {}) {
  const pieces = {}   // sym -> tf -> period -> rows
  for (const [sym, byTf] of Object.entries(market)) {
    pieces[sym] = {}
    for (const [tf, rows] of Object.entries(byTf)) {
      const by = (pieces[sym][tf] = {})
      for (const b of rows) if (b.t <= through) (by[periodOf(Number(tf), b.t)] ||= []).push(b)
    }
  }
  const index = (sym) => {
    if (!pieces[sym]) return null
    const series = {}
    for (const [tf, by] of Object.entries(pieces[sym])) {
      series[tf] = {}
      for (const [period, rows] of Object.entries(by)) series[tf][period] = { first: rows[0].t, last: rows.at(-1).t, bars: rows.length, crc: 1, off: 0, bytes: 10 }
    }
    return { symbol: sym, series, splits: [] }
  }
  const src = {
    reads: 0,
    loadIndex: vi.fn(async (sym) => { if (fail) throw fail; return index(sym) }),
    loadBars: vi.fn(async (sym, tf, { from, to }) => {
      src.reads++
      const by = pieces[sym]?.[String(tf)]
      if (!by) return null
      const rows = Object.values(by).filter((rs) => rs.at(-1).t >= from && rs[0].t <= to).flat().sort((a, b) => a.t - b.t)
      const col = (k) => Float64Array.from(rows, (b) => b[k])
      return { t: col('t'), o: col('o'), h: col('h'), l: col('l'), c: col('c'), v: col('v'), n: col('v') }
    }),
  }
  return src
}
/** THE ORIGIN'S `to=` RULE (api/services/bars_fetch `_get_bars_to_response` + bars_sqlite.get_bars_before): the newest
 *  `bars` rows with t <= 23:59:59 America/New_York of the `to` date, oldest first. */
function originTo(rows, toIso, bars) {
  const cutoff = etMidnightEpoch(isoAdd(toIso, 1)) - 1
  const at = rows.filter((b) => b.t <= cutoff)
  return at.slice(Math.max(0, at.length - bars))
}
const parseUrl = (url) => { const u = new URL(url, 'http://x'); return { sym: decodeURIComponent(u.pathname.split('/').pop()), tf: u.searchParams.get('tf'), bars: Number(u.searchParams.get('bars')), to: u.searchParams.get('to') } }
/** A mock /api/bars over `market` (the origin), recording every URL. */
function originOf(market) {
  const urls = []
  const request = vi.fn(async (url) => {
    urls.push(url)
    const q = parseUrl(url)
    const rows = market[q.sym]?.[q.tf] ?? []
    return { ticker: q.sym, tf: q.tf, bars: q.to ? originTo(rows, q.to, q.bars) : rows.slice(-q.bars) }
  })
  return { request, urls }
}

function net({ request, history = null }) {
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }), frame: (fn) => fn() })
  const timers = []
  const network = createNetwork({
    registry, request, history, idle: (fn) => { fn(); return () => {} },
    setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h },
    clearTimer: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1) },
    isHidden: () => false, onVisible: () => () => {},
  })
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((res) => setTimeout(res, 0)) }
  const run = async () => { const t = timers.shift(); t?.fn(); await flush() }
  return { registry, network, run, timers, flush }
}
const ohlcv = (rows) => rows.map(({ t, o, h, l, c, v }) => ({ t, o, h, l, c, v }))
const winKey = (sym, tf, iso, session = 'rth') => keyOf({ sym, tf, session, window: viewWindowOfDate(iso, tf) })

// one market for W1/W2/W4: 5m bars 2006-01-02 .. 2006-03-31, the lake holding them through 03-30
const M = { ABC: { 5: makeSeries(7, 5, '2006-01-02', '2006-03-31') } }
const LAKE_THROUGH = etMidnightEpoch('2006-03-31') - 1

describe('W1 — a window inside the lake sends no /api/bars', () => {
  it('lands as the window\'s one answer, from the lake, equal to the origin\'s', async () => {
    const origin = originOf(M)
    const source = fakeSource(M, { through: LAKE_THROUGH })
    const { registry, network, run } = net({ request: origin.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    network.start(K)
    await run()
    expect(origin.urls, 'no /api/bars for a window the lake holds').toEqual([])
    expect(source.reads).toBe(1)
    expect(network.answered(K)).toBe(true)
    expect(network.filling(K)).toBe(false)
    expect(network.windowSource(K)).toBe('lake')
    const s = registry.peek(K)
    expect(s.restSeen).toBe(true)
    const want = originTo(M.ABC[5], '2006-02-15', s.bars.length)
    expect(s.bars.length).toBeGreaterThan(100)
    expect(ohlcv(s.bars)).toEqual(want)
    expect(s.bars.at(-1).t).toBeLessThanOrEqual(windowEndOf(viewWindowOfDate('2006-02-15', '5').to))
    // and the store's facade says the read asks the lake (PR 1.2's date warm keys on it)
    expect(network.lakeCarriesWindow(K)).toBe(true)
    expect(network.lakeCarries(K), 'a window is never deepened by the lake (read once, whole)').toBe(false)
  })

  it('a warm (fetchOnce, &warm=1) of a window inside the lake sends nothing to the origin either', async () => {
    const origin = originOf(M)
    const { network } = net({ request: origin.request, history: createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) }) })
    const K = winKey('ABC', '5', '2006-03-10')
    const res = await network.fetchOnce(K, { priority: 'background', depth: 4000, warm: true })
    expect(res.ok).toBe(true)
    expect(origin.urls).toEqual([])
  })
})

describe('W2 — the origin answers what the lake cannot', () => {
  it('a window past the lake\'s newest session asks the origin, with its `to=`', async () => {
    const origin = originOf(M)
    const { network, run } = net({ request: origin.request, history: createHistoryFeed({ source: fakeSource(M, { through: etMidnightEpoch('2006-03-20') - 1 }) }) })
    const K = winKey('ABC', '5', '2006-03-24')   // the lake ends Fri 03-17
    network.start(K)
    await run()
    expect(origin.urls.length).toBe(1)
    expect(origin.urls[0]).toMatch(/[?&]to=2006-03-24(?:&|$)/)
    expect(network.windowSource(K)).toBe('origin')
  })

  it('the window\'s own day not yet in the lake (published a session behind) is the origin\'s', async () => {
    const origin = originOf(M)
    const { network, run } = net({ request: origin.request, history: createHistoryFeed({ source: fakeSource(M, { through: etMidnightEpoch('2006-03-30') - 1 }) }) })
    network.start(winKey('ABC', '5', '2006-03-30'))
    await run()
    expect(origin.urls.length).toBe(1)
    // ...and the day it does hold is the lake's
    const o2 = originOf(M)
    const n2 = net({ request: o2.request, history: createHistoryFeed({ source: fakeSource(M, { through: etMidnightEpoch('2006-03-30') - 1 }) }) })
    n2.network.start(winKey('ABC', '5', '2006-03-29'))
    await n2.run()
    expect(o2.urls).toEqual([])
  })

  it('a symbol the lake does not hold, and a lake that fails, ask the origin', async () => {
    const market = { ...M, NEW: { 5: makeSeries(3, 5, '2006-02-01', '2006-03-31') } }
    const origin = originOf(market)
    const { network, run } = net({ request: origin.request, history: createHistoryFeed({ source: fakeSource(M) }) })
    network.start(winKey('NEW', '5', '2006-03-01'))
    await run()
    expect(origin.urls.length).toBe(1)
    const o2 = originOf(M)
    const n2 = net({ request: o2.request, history: createHistoryFeed({ source: fakeSource(M, { fail: new Error('edge 502') }) }) })
    const K = winKey('ABC', '5', '2006-03-01')
    n2.network.start(K)
    await n2.run()
    expect(o2.urls.length).toBe(1)
    expect(n2.registry.peek(K).bars.length).toBeGreaterThan(0)
  })

  it('⛔ a seam that disagrees >2% with bars the page holds (a split the lake has not caught up with) asks the origin', async () => {
    const origin = originOf(M)
    const { registry, network, run } = net({ request: origin.request, history: createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) }) })
    // the plain key holds the newest bars on another basis (x0.5: a 2-for-1 split)
    const plain = keyOf({ sym: 'ABC', tf: '5' })
    const newest = M.ABC[5].slice(-500).map((b) => ({ ...b, o: b.o / 2, h: b.h / 2, l: b.l / 2, c: b.c / 2 }))
    registry.dispatch(plain, { type: 'rest-full', key: plain, gen: registry.getSnapshot(plain).gen, payload: { ticker: 'ABC', tf: '5', bars: newest } })
    const K = winKey('ABC', '5', '2006-03-30')
    network.start(K)
    await run()
    expect(origin.urls.length, 'the lake window shares bars with the held series and disagrees: the origin').toBe(1)
    expect(network.windowSource(K)).toBe('origin')
    // the same held series on the SAME basis: the lake answers
    const o2 = originOf(M)
    const n2 = net({ request: o2.request, history: createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) }) })
    n2.registry.dispatch(plain, { type: 'rest-full', key: plain, gen: n2.registry.getSnapshot(plain).gen, payload: { ticker: 'ABC', tf: '5', bars: M.ABC[5].slice(-500) } })
    n2.network.start(K)
    await n2.run()
    expect(o2.urls).toEqual([])
  })
})

describe('W3 — the lake\'s window equals the origin\'s `to=` answer, on 20 fixture symbols', () => {
  // [symbol, tf, series from, series to, window date, bars asked, extra]
  const CASES = [
    ['F01', 1, '2006-01-03', '2006-03-31', '2006-02-01', 1152],                // a month piece's first day
    ['F02', 1, '2006-01-03', '2006-03-31', '2006-01-31', 1152],                // ...and its last
    ['F03', 1, '2006-03-01', '2006-04-28', '2006-04-03', 4000],                // across the DST change (03-? 2006: 04-02)
    ['F04', 5, '2006-01-02', '2006-12-29', '2006-04-03', 1152],                // a quarter piece's first day
    ['F05', 5, '2006-01-02', '2006-12-29', '2006-06-30', 4000],                // ...its last, the read spans two pieces
    ['F06', 5, '2006-01-02', '2006-12-29', '2006-10-30', 2000],                // the fall DST change (2006-10-29)
    ['F07', 5, '2006-01-02', '2006-12-29', '2006-07-01', 1152],                // a Saturday: Friday's bars
    ['F08', 5, '2006-01-02', '2006-12-29', '2006-07-04', 1152, { holidays: ['2006-07-04'] }],   // a holiday
    ['F09', 15, '2004-01-02', '2007-12-31', '2006-01-03', 1152],               // a year piece's first day
    ['F10', 15, '2004-01-02', '2007-12-31', '2005-12-30', 4000],               // ...its last
    ['F11', 15, '2004-01-02', '2007-12-31', '2007-12-31', 1152],               // the lake's newest day
    ['F12', 30, '2003-09-02', '2008-12-31', '2003-09-30', 4000],               // before the depth asked: all there is
    ['F13', 30, '2003-09-02', '2008-12-31', '2008-06-16', 1152],
    ['F14', 60, '2003-09-02', '2010-12-31', '2009-03-09', 1000],               // several year pieces
    ['F15', 60, '2003-09-02', '2010-12-31', '2010-12-31', 6000],               // deep, spanning years
    ['F16', 5, '2006-05-15', '2006-12-29', '2006-05-15', 1152],                // a listing's first day
    ['F17', 5, '2006-05-15', '2006-12-29', '2006-05-22', 4000],                // a listing a week old: short history
    ['F18', 1, '2006-11-01', '2006-11-30', '2006-11-24', 1152, { holidays: ['2006-11-23'] }],   // after a holiday
    ['F19', 30, '2005-01-03', '2006-12-29', '2006-01-02', 1152, { holidays: ['2006-01-02'] }],   // a holiday at a year's start
    ['F20', 15, '2004-01-02', '2007-12-31', '2006-08-16', 1],                  // one bar
  ]
  it('has its 20 cases', () => { expect(new Set(CASES.map((c) => c[0])).size).toBe(20) })
  for (const [sym, tf, from, to, date, bars, extra = {}] of CASES) {
    it(`${sym}: ${tf}m at ${date}, ${bars} bars`, async () => {
      const market = { [sym]: { [tf]: makeSeries(Number(sym.slice(1)), tf, from, to, extra) } }
      const K = winKey(sym, String(tf), date)
      // the origin alone (no lake), then the lake
      const o1 = originOf(market)
      const viaOrigin = net({ request: o1.request })
      await viaOrigin.network.fetchOnce(K, { depth: bars, priority: 'visible' })
      expect(o1.urls.length).toBe(1)
      const asked = parseUrl(o1.urls[0]).bars
      const o2 = originOf(market)
      const src = fakeSource(market)
      const viaLake = net({ request: o2.request, history: createHistoryFeed({ source: src }) })
      await viaLake.network.fetchOnce(K, { depth: bars, priority: 'visible' })
      expect(o2.urls, 'the lake answered').toEqual([])
      const a = ohlcv(viaOrigin.registry.peek(K).bars)
      const b = ohlcv(viaLake.registry.peek(K).bars)
      expect(a.length, 'non-vacuity: the origin answered bars').toBeGreaterThan(0)
      expect(a).toEqual(originTo(market[sym][tf], date, asked))
      expect(b).toEqual(a)
      // ...in ONE read of the pieces: the piece the cutoff falls in counts only its share before it, so the older piece
      // the window needs is asked with it (a read that came up short would cost a second round trip on first paint)
      expect(src.reads, 'one lake read').toBe(1)
    })
  }
})

describe('W4 — no second full draw', () => {
  it('the window\'s bars change ONCE, and nothing follows: no lake join, no scroll-back, no poll', async () => {
    const origin = originOf(M)
    const source = fakeSource(M, { through: LAKE_THROUGH })
    const { registry, network, run, timers } = net({ request: origin.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    const seen = []
    registry.subscribe(K, () => { const s = registry.peek(K); if (seen.at(-1) !== s.bars) seen.push(s.bars) })
    network.start(K)
    await run()
    for (let i = 0; i < 5 && timers.length; i++) await run()
    expect(seen.filter((b) => b.length).length, 'one set of bars, drawn once').toBe(1)
    expect(source.reads, 'one lake read').toBe(1)
    expect(timers.filter((t) => Number.isFinite(t.ms)).length, 'no poll scheduled for a window').toBe(0)
    expect(origin.urls).toEqual([])
  })
})

describe("W5 — one reader's abort is never another's", () => {
  it('a warm aborted mid-read answers nothing; a chart reading another window of the symbol meanwhile reads the lake', async () => {
    const origin = originOf(M)
    let release
    const gate = new Promise((r) => { release = r })
    const source = fakeSource(M, { through: LAKE_THROUGH })
    const inner = source.loadIndex
    source.loadIndex = vi.fn(async (sym, o) => { await gate; return inner(sym, o) })
    const { registry, network, flush } = net({ request: origin.request, history: createHistoryFeed({ source }) })
    const K1 = winKey('ABC', '5', '2006-02-15')
    const K2 = winKey('ABC', '5', '2006-02-16')
    const ac = new AbortController()
    const warm = network.fetchOnce(K1, { priority: 'background', warm: true, signal: ac.signal })
    const chart = network.fetchOnce(K2, { priority: 'visible' })
    ac.abort()
    release()
    await flush()
    expect((await warm).aborted).toBe(true)
    expect((await chart).ok).toBe(true)
    expect(registry.peek(K2).bars.length).toBeGreaterThan(0)
    expect(registry.peek(K1)?.bars.length ?? 0, 'the aborted read landed nothing').toBe(0)
    expect(origin.urls, 'and neither fell back to the origin').toEqual([])
    // the index read is the symbol's, shared: no reader's signal ever reaches it
    expect(source.loadIndex.mock.calls.every((c) => !c[1]?.signal)).toBe(true)
  })
})

describe('W6 — a window\'s prime warms exactly the pieces its read takes', () => {
  it('the piece the cutoff falls in and the older one the read needs (a month piece\'s first day, 1m)', async () => {
    const market = { PRM: { 1: makeSeries(41, 1, '2006-01-03', '2006-03-31') } }
    const source = fakeSource(market)
    const warmed = []
    source.warmPieces = vi.fn(async (sym, series, entries) => { for (const e of entries) warmed.push(e.period) })
    const feed = createHistoryFeed({ source })
    const K = winKey('PRM', '1', '2006-02-01')
    feed.prime(K)
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    const got = await feed.windowBars(K, { bars: 1152 })
    const read = new Set(got.bars.map((b) => periodOf(1, b.t)))
    expect([...read].sort()).toEqual(['2006-01', '2006-02'])
    for (const p of read) expect(warmed, `piece ${p} warmed`).toContain(p)
  })

  it('an aborted prime asks no piece, and the same key primes again when asked again', async () => {
    const source = fakeSource(M, { through: LAKE_THROUGH })
    source.warmPieces = vi.fn(async () => {})
    const feed = createHistoryFeed({ source })
    const K = winKey('ABC', '5', '2006-02-15')
    const ac = new AbortController()
    feed.prime(K, { signal: ac.signal })
    ac.abort()
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    expect(source.warmPieces).not.toHaveBeenCalled()
    feed.prime(K)
    await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0))
    expect(source.warmPieces).toHaveBeenCalledTimes(1)
  })
})

describe('W7 — a piece whose bars sit late in its span still yields the whole window', () => {
  it('the share estimate over-counts the cut piece; the deficit is read from the older piece (exact, oldest first)', async () => {
    // February trades on the 1st and from the 21st only: its share before 02-21 is estimated ~70% of its bars, but holds 2 days
    const jan = makeSeries(71, 1, '2006-01-03', '2006-01-31')
    const feb = [...makeSeries(72, 1, '2006-02-01', '2006-02-01'), ...makeSeries(73, 1, '2006-02-21', '2006-02-28')]
    const market = { GAP: { 1: [...jan, ...feb] } }
    const source = fakeSource(market)
    const feed = createHistoryFeed({ source })
    const K = winKey('GAP', '1', '2006-02-21')
    const got = await feed.windowBars(K, { bars: 3000 })
    expect(ohlcv(got.bars)).toEqual(originTo(market.GAP[1], '2006-02-21', 3000))
    expect(got.bars.length).toBe(3000)
    expect(source.reads, 'the first read came up short: one more for the deficit').toBe(2)
  })
})

describe('W8 — a slow (cold) lake races the origin after a head start; a warm lake answers alone', () => {
  const fire = async (h, ms) => { const i = h.timers.findIndex((t) => t.ms === ms); if (i < 0) return false; const [t] = h.timers.splice(i, 1); t.fn(); await h.flush(); return true }
  function gatedLake(market, opts) {
    const source = fakeSource(market, opts)
    let open
    const gate = new Promise((r) => { open = r })
    const inner = source.loadIndex
    source.loadIndex = vi.fn(async (sym) => { await gate; return inner(sym) })
    return { source, open }
  }
  function gatedOrigin(market) {
    const o = originOf(market)
    const pend = []
    const request = vi.fn((url, opts) => new Promise((resolve, reject) => {
      o.urls.push(url)
      opts?.signal?.addEventListener?.('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
      pend.push({ url, opts, go: (extra = {}) => { const q = parseUrl(url); resolve({ ticker: q.sym, tf: q.tf, bars: originTo(market[q.sym][q.tf], q.to, q.bars), ...extra }) } })
    }))
    return { request, urls: o.urls, pend }
  }

  it('the lake silent past the head start: the origin is asked beside it; the origin first lands ONCE, the lake later changes nothing', async () => {
    const { WINDOW_LAKE_HEAD_START_MS } = await import('./network')
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    const seen = []
    h.registry.subscribe(K, () => { const b = h.registry.peek(K).bars; if (b.length && seen.at(-1) !== b) seen.push(b) })
    h.network.start(K)
    await h.run()
    expect(o.urls, 'the lake has its head start').toEqual([])
    expect(await fire(h, WINDOW_LAKE_HEAD_START_MS)).toBe(true)
    expect(o.urls.length).toBe(1)
    expect(o.urls[0]).toMatch(/[?&]to=2006-02-15(?:&|$)/)
    o.pend[0].go()
    await h.flush()
    expect(h.network.answered(K)).toBe(true)
    expect(h.network.windowSource(K)).toBe('origin')
    open()
    await h.flush()
    expect(seen.length, 'one draw: the lake answering later lands nothing').toBe(1)
    expect(WINDOW_LAKE_HEAD_START_MS).toBeLessThanOrEqual(100)
  })

  it('the lake answers after the head start but before the origin: the lake lands and the origin request is aborted', async () => {
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    await fire(h, (await import('./network')).WINDOW_LAKE_HEAD_START_MS)
    expect(o.pend.length).toBe(1)
    open()
    await h.flush()
    expect(h.network.windowSource(K)).toBe('lake')
    expect(o.pend[0].opts.signal.aborted, 'the origin request given up').toBe(true)
    expect(ohlcv(h.registry.peek(K).bars)).toEqual(originTo(M.ABC[5], '2006-02-15', h.registry.peek(K).bars.length))
  })

  it('an origin answer that is `filling` (short) waits for the lake\'s complete one', async () => {
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    await fire(h, (await import('./network')).WINDOW_LAKE_HEAD_START_MS)
    o.pend[0].go({ filling: true, bars: [] })
    await h.flush()
    expect(h.registry.peek(K)?.restSeen ?? false, 'the short answer does not land').toBe(false)
    open()
    await h.flush()
    expect(h.network.windowSource(K)).toBe('lake')
    expect(h.registry.peek(K).bars.length).toBeGreaterThan(100)
  })

  it('a warm (no chart) never races: a slow lake is waited for, the origin never asked', async () => {
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    const res = h.network.fetchOnce(K, { priority: 'background', warm: true })
    await h.flush()
    expect(h.timers.some((t) => t.ms === (0, (await import('./network')).WINDOW_LAKE_HEAD_START_MS))).toBe(false)
    open()
    expect((await res).ok).toBe(true)
    expect(o.urls).toEqual([])
  })
})

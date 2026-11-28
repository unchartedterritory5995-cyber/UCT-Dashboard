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
      const a = ohlcv(viaOrigin.registry.peek(K).bars)
      const b = ohlcv(viaLake.registry.peek(K).bars)
      expect(a.length, 'non-vacuity: the origin answered bars').toBeGreaterThan(0)
      // a whole window sends nothing to the origin; one that is all there is (short of the asked: a listing's first week,
      // the 2003-09 floor) asks it beside the lake (review of #2986, F1's mirror) and lands the lake's, the same bars
      expect(o2.urls.length, 'the lake answered').toBe(a.length >= asked ? 0 : 1)
      expect(viaLake.network.windowSource(K)).toBe('lake')
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
    const { WINDOW_LAKE_HEAD_START_MS } = await import('./network')
    const res = h.network.fetchOnce(K, { priority: 'background', warm: true })
    await h.flush()
    expect(h.timers.some((t) => t.ms === WINDOW_LAKE_HEAD_START_MS)).toBe(false)
    open()
    expect((await res).ok).toBe(true)
    expect(o.urls).toEqual([])
  })
})

describe('W9 — a warm window\'s origin fallback is a shed-able warm (review of #2986, F1)', () => {
  const PAST = { through: etMidnightEpoch('2006-03-20') - 1 }   // the lake ends Fri 03-17: 03-24 is the origin's
  it('its `filling` answer arms no repeat: a date warm never turns into ten origin asks', async () => {
    const o = originOf(M)
    const request = vi.fn(async (url) => ({ ...(await o.request(url)), filling: true }))
    const h = net({ request, history: createHistoryFeed({ source: fakeSource(M, PAST) }) })
    const K = winKey('ABC', '5', '2006-03-24')
    h.registry.acquire(K)
    await h.network.fetchOnce(K, { priority: 'background', warm: true })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toMatch(/[?&]warm=1(?:&|$)/)
    expect(h.timers.filter((t) => t.ms === 3000).length, 'no fill repeat for a warm').toBe(0)
  })
  it('a chart that starts while the warm\'s origin request is out gets its OWN non-warm request; the warm shed sets no error', async () => {
    let fail
    const pend = []
    const request = vi.fn((url) => new Promise((resolve, reject) => {
      pend.push({ url, resolve, reject })
      fail = () => reject(Object.assign(new Error('shed'), { status: 503 }))
    }))
    const h = net({ request, history: createHistoryFeed({ source: fakeSource(M, PAST) }) })
    const K = winKey('ABC', '5', '2006-03-24')
    h.registry.acquire(K)
    const warm = h.network.fetchOnce(K, { priority: 'background', warm: true })
    await h.flush()
    expect(pend.length).toBe(1)
    expect(pend[0].url).toMatch(/[?&]warm=1(?:&|$)/)
    h.network.start(K)
    await h.run()
    fail()                       // the server sheds the warm
    await warm
    await h.flush()
    expect(h.registry.peek(K)?.error ?? null, 'a shed warm is not the chart\'s error').toBe(null)
    expect(pend.length, 'the chart\'s own request').toBe(2)
    expect(pend[1].url).not.toMatch(/[?&]warm=1(?:&|$)/)
  })
  it('a non-warm ask that joins while the lake is still read makes the fallback non-warm', async () => {
    const o = originOf(M)
    const source = fakeSource(M, PAST)
    let open
    const gate = new Promise((r) => { open = r })
    const inner = source.loadIndex
    source.loadIndex = vi.fn(async (sym) => { await gate; return inner(sym) })
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-03-24')
    h.registry.acquire(K)
    const warm = h.network.fetchOnce(K, { priority: 'background', warm: true })
    const own = h.network.fetchOnce(K, { priority: 'visible' })
    open()
    await Promise.all([warm, own])
    expect(o.urls.length).toBe(1)
    expect(o.urls[0]).not.toMatch(/[?&]warm=1(?:&|$)/)
  })
})

describe('W10 — a split the lake has not caught up with shows on the DAILY bars the page holds (review of #2986)', () => {
  // the daily bars of M.ABC 5m (the origin's, on the present basis): each day's RTH range
  const dailyOf = (rows, scale = 1) => {
    const by = new Map()
    for (const b of rows) {
      const et = new Date((b.t - 5 * 3600) * 1000)
      const m = et.getUTCHours() * 60 + et.getUTCMinutes()
      if (m < 570 || m >= 960) continue
      const d = et.toISOString().slice(0, 10)
      const x = by.get(d)
      if (!x) by.set(d, { t: Date.parse(`${d}T00:00:00Z`) / 1000, o: b.o * scale, h: b.h * scale, l: b.l * scale, c: b.c * scale, v: b.v })
      else { x.h = Math.max(x.h, b.h * scale); x.l = Math.min(x.l, b.l * scale); x.c = b.c * scale }
    }
    return [...by.values()]
  }
  for (const [name, scale, viaOrigin] of [['the same basis: the lake answers', 1, 0], ['a 2-for-1 the lake has not applied: the origin answers', 0.5, 1]]) {
    it(name, async () => {
      const o = originOf(M)
      const h = net({ request: o.request, history: createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) }) })
      const D = keyOf({ sym: 'ABC', tf: 'D' })
      h.registry.dispatch(D, { type: 'rest-full', key: D, gen: h.registry.getSnapshot(D).gen, payload: { ticker: 'ABC', tf: 'D', bars: dailyOf(M.ABC[5], scale) } })
      expect(h.registry.peek(D).bars.length, 'non-vacuity: the daily bars are held').toBeGreaterThan(40)
      const K = winKey('ABC', '5', '2006-02-15')
      h.network.start(K)
      await h.run()
      expect(o.urls.length).toBe(viaOrigin)
      expect(h.network.windowSource(K)).toBe(viaOrigin ? 'origin' : 'lake')
    })
  }
})

describe('W11 — only a WHOLE answer wins the race (review of #2986, F1 blocker)', () => {
  const HS = async () => (await import('./network')).WINDOW_LAKE_HEAD_START_MS
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
    const pend = []
    const request = vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts?.signal?.addEventListener?.('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
      const q = parseUrl(url)
      pend.push({ url, opts, q, go: (shape = (b) => b, extra = {}) => resolve({ ticker: q.sym, tf: q.tf, bars: shape(originTo(market[q.sym][q.tf], q.to, q.bars)), ...extra }) })
    }))
    return { request, pend }
  }
  const draws = (h, K) => { const seen = []; h.registry.subscribe(K, () => { const b = h.registry.peek(K)?.bars; if (b?.length && seen.at(-1) !== b) seen.push(b) }); return seen }

  for (const [name, shape] of [['a short UNFLAGGED origin (738 of the asked)', (b) => b.slice(-738)], ['an EMPTY origin window', () => []]]) {
    it(`${name} does not land over the lake: the lake's whole window lands, once`, async () => {
      const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
      const o = gatedOrigin(M)
      const h = net({ request: o.request, history: createHistoryFeed({ source }) })
      const K = winKey('ABC', '5', '2006-02-15')
      const seen = draws(h, K)
      h.network.start(K)
      await h.run()
      await fire(h, await HS())
      expect(o.pend.length).toBe(1)
      const asked = o.pend[0].q.bars
      o.pend[0].go(shape)
      await h.flush()
      expect(h.registry.peek(K)?.restSeen ?? false, 'the short origin answer did not land').toBe(false)
      open()
      await h.flush()
      expect(h.network.windowSource(K)).toBe('lake')
      expect(h.registry.peek(K).bars.length).toBe(asked)
      expect(ohlcv(h.registry.peek(K).bars)).toEqual(originTo(M.ABC[5], '2006-02-15', asked))
      expect(seen.length, 'one draw').toBe(1)
    })
  }

  it('the mirror: a SHORT lake (it starts later than the origin) does not win outright; the whole origin lands', async () => {
    const late = { ABC: { 5: M.ABC[5].filter((b) => b.t >= etMidnightEpoch('2006-02-10')) } }
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: fakeSource(late, { through: LAKE_THROUGH }) }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    expect(o.pend.length, 'the short lake asked the origin at once').toBe(1)
    const asked = o.pend[0].q.bars
    o.pend[0].go()
    await h.flush()
    expect(h.network.windowSource(K)).toBe('origin')
    expect(h.registry.peek(K).bars.length).toBe(asked)
  })

  it('both short: the LONGER lands (the lake here)', async () => {
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-01-05')   // 3 sessions: shorter than any first paint
    h.network.start(K)
    await h.run()
    await fire(h, await HS())
    o.pend[0].go((b) => b.slice(-50))
    open()
    await h.flush()
    expect(h.network.windowSource(K)).toBe('lake')
    expect(h.registry.peek(K).bars.length).toBeGreaterThan(50)
  })

  it('(F3) the caller\'s abort settles at once, even while the lake\'s index read hangs', async () => {
    const { source } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    const ac = new AbortController()
    let settled = null
    h.network.fetchOnce(K, { priority: 'visible', signal: ac.signal }).then((v) => { settled = v })
    await h.flush()
    ac.abort()
    await h.flush()
    expect(settled?.aborted, 'settled without the lake or the head-start timer').toBe(true)
  })

  it('(F2) a throw in the lake\'s checks falls back to the origin, never errors the chart', async () => {
    const o = originOf(M)
    const feed = createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) })
    const history = { ...feed, windowBars: async (...a) => { const got = await feed.windowBars(...a); return got && { ...got, get newest() { throw new Error('a broken check') } } } }
    const h = net({ request: o.request, history })
    const P = keyOf({ sym: 'ABC', tf: '5' })
    h.registry.dispatch(P, { type: 'rest-full', key: P, gen: h.registry.getSnapshot(P).gen, payload: { ticker: 'ABC', tf: '5', bars: M.ABC[5].slice(-200) } })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    expect(o.urls.length).toBe(1)
    expect(h.registry.peek(K).error ?? null).toBe(null)
    expect(h.network.windowSource(K)).toBe('origin')
  })
})

describe('W12 — a split newer than the lake\'s publish (review of #2986, residual)', () => {
  const P = keyOf({ sym: 'ABC', tf: '5' })
  const holdPlain = (h, scale) => h.registry.dispatch(P, { type: 'rest-full', key: P, gen: h.registry.getSnapshot(P).gen,
    payload: { ticker: 'ABC', tf: '5', bars: M.ABC[5].slice(-300).map((b) => ({ ...b, o: b.o * scale, h: b.h * scale, l: b.l * scale, c: b.c * scale })) } })
  for (const [name, scale, via] of [['the held present key on the lake\'s basis: the lake', 1, 'lake'], ['the held present key after a 2-for-1 the lake has not applied: the origin', 0.5, 'origin']]) {
    it(name, async () => {
      const o = originOf(M)
      const h = net({ request: o.request, history: createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) }) })
      holdPlain(h, scale)
      const K = winKey('ABC', '5', '2006-02-15')   // shares no bar with the present key: only the lake's newest session can tell
      h.network.start(K)
      await h.run()
      expect(h.network.windowSource(K)).toBe(via)
    })
  }
  it('a stale split table (splits_as_of more than LAKE_SPLITS_STALE_DAYS behind the lake\'s newest bar): the origin', async () => {
    const o = originOf(M)
    const src = fakeSource(M, { through: LAKE_THROUGH })
    const inner = src.loadIndex
    src.loadIndex = vi.fn(async (sym) => ({ ...(await inner(sym)), splits_as_of: '2006-03-01' }))
    const h = net({ request: o.request, history: createHistoryFeed({ source: src }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    expect(h.network.windowSource(K)).toBe('origin')
    const src2 = fakeSource(M, { through: LAKE_THROUGH })
    const inner2 = src2.loadIndex
    src2.loadIndex = vi.fn(async (sym) => ({ ...(await inner2(sym)), splits_as_of: '2006-03-29' }))
    const h2 = net({ request: originOf(M).request, history: createHistoryFeed({ source: src2, now: () => Date.parse('2006-03-31T20:00:00Z') }) })
    h2.network.start(K)
    await h2.run()
    expect(h2.network.windowSource(K), 'a fresh table: the lake').toBe('lake')
  })
})

describe('W13 — review of #2986 round 3: a ceiling on the lake wait (F-A), a warm short lake (F-B), a stalled publish (F-C)', () => {
  const fire = async (h, ms) => { const i = h.timers.findIndex((t) => t.ms === ms); if (i < 0) return false; const [t] = h.timers.splice(i, 1); t.fn(); await h.flush(); return true }
  function stalledLake(market, opts) {
    const source = fakeSource(market, opts)
    source.loadIndex = vi.fn(() => new Promise(() => {}))   // R2 / the index read never settles
    return source
  }
  function gatedOrigin(market) {
    const pend = []
    const request = vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts?.signal?.addEventListener?.('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
      const q = parseUrl(url)
      pend.push({ url, q, go: (shape = (b) => b, extra = {}) => resolve({ ticker: q.sym, tf: q.tf, bars: shape(originTo(market[q.sym][q.tf], q.to, q.bars)), ...extra }) })
    }))
    return { request, pend }
  }
  for (const [name, extra, repeat] of [['a short unflagged origin', {}, false], ['a short FILLING origin (it keeps its repeat)', { filling: true }, true]]) {
    it(`(F-A) a lake that never answers: ${name} lands WINDOW_LAKE_MAX_WAIT_MS after it answered`, async () => {
      const { WINDOW_LAKE_HEAD_START_MS, WINDOW_LAKE_MAX_WAIT_MS, WINDOW_FILL_RETRY_S } = await import('./network')
      const o = gatedOrigin(M)
      const h = net({ request: o.request, history: createHistoryFeed({ source: stalledLake(M, { through: LAKE_THROUGH }) }) })
      const K = winKey('ABC', '5', '2006-02-15')
      h.network.start(K)
      await h.run()
      await fire(h, WINDOW_LAKE_HEAD_START_MS)
      o.pend[0].go((b) => b.slice(-738), extra)
      await h.flush()
      expect(h.registry.peek(K)?.restSeen ?? false, 'waits for the lake a while').toBe(false)
      expect(await fire(h, WINDOW_LAKE_MAX_WAIT_MS)).toBe(true)
      expect(h.registry.peek(K).bars.length, 'the origin\'s rows land').toBe(738)
      expect(h.network.windowSource(K)).toBe('origin')
      expect(h.timers.some((t) => t.ms === WINDOW_FILL_RETRY_S * 1000), 'a filling answer keeps its repeat').toBe(repeat)
    })
  }
  it('(F-B) a warm whose lake window is SHORT asks the origin on the warm lane and lands the longer', async () => {
    const late = { ABC: { 5: M.ABC[5].filter((b) => b.t >= etMidnightEpoch('2006-02-10')) } }
    const o = originOf(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: fakeSource(late, { through: LAKE_THROUGH }) }) })
    const K = winKey('ABC', '5', '2006-02-15')
    await h.network.fetchOnce(K, { priority: 'background', warm: true })
    expect(o.urls.length, 'the origin asked').toBe(1)
    expect(o.urls[0]).toMatch(/[?&]warm=1(?:&|$)/)
    const asked = parseUrl(o.urls[0]).bars
    expect(h.registry.peek(K).bars.length, 'the whole origin, not the short lake').toBe(asked)
    expect(h.network.windowSource(K)).toBe('origin')
  })
  it('(F-B) CONTROL: a warm whose lake window is whole asks nothing', async () => {
    const o = originOf(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: fakeSource(M, { through: LAKE_THROUGH }) }) })
    await h.network.fetchOnce(winKey('ABC', '5', '2006-02-15'), { priority: 'background', warm: true })
    expect(o.urls).toEqual([])
  })
  it('(F-C) publishing stopped: the newest bar and the stamp agree, but the wall clock is weeks past both: the origin', async () => {
    const mk = (nowIso) => {
      const src = fakeSource(M, { through: LAKE_THROUGH })
      const inner = src.loadIndex
      src.loadIndex = vi.fn(async (sym) => ({ ...(await inner(sym)), splits_as_of: '2006-03-30' }))
      const h = net({ request: originOf(M).request, history: createHistoryFeed({ source: src, now: () => Date.parse(nowIso) }) })
      return h
    }
    const K = winKey('ABC', '5', '2006-02-15')
    const stopped = mk('2006-05-01T15:00:00Z')
    stopped.network.start(K)
    await stopped.run()
    expect(stopped.network.windowSource(K)).toBe('origin')
    const fresh = mk('2006-03-31T20:00:00Z')
    fresh.network.start(K)
    await fresh.run()
    expect(fresh.network.windowSource(K), 'published yesterday: the lake').toBe('lake')
  })
})

describe('W14 — review of #2986 round 4: a chart joining a warm (F-E), an unknown newest session (F-F), the deepening, the ceiling on abort', () => {
  const fire = async (h, ms) => { const i = h.timers.findIndex((t) => t.ms === ms); if (i < 0) return false; const [t] = h.timers.splice(i, 1); t.fn(); await h.flush(); return true }
  const stalled = (market, opts) => { const s = fakeSource(market, opts); s.loadIndex = vi.fn(() => new Promise(() => {})); return s }
  function gatedLake(market, opts) {
    const source = fakeSource(market, opts)
    let open
    const gate = new Promise((r) => { open = r })
    const inner = source.loadIndex
    source.loadIndex = vi.fn(async (sym) => { await gate; return inner(sym) })
    return { source, open }
  }
  function gatedOrigin(market) {
    const pend = []
    const request = vi.fn((url, opts) => new Promise((resolve, reject) => {
      opts?.signal?.addEventListener?.('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
      const q = parseUrl(url)
      pend.push({ url, q, go: (shape = (b) => b, extra = {}) => resolve({ ticker: q.sym, tf: q.tf, bars: shape(originTo(market[q.sym][q.tf], q.to, q.bars)), ...extra }) })
    }))
    return { request, pend }
  }

  it('(F-E) a chart that joins a warm still reading a STALLED lake races from that moment: head start, then the origin lands', async () => {
    const { WINDOW_LAKE_HEAD_START_MS } = await import('./network')
    const o = originOf(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: stalled(M, { through: LAKE_THROUGH }) }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.fetchOnce(K, { priority: 'background', warm: true })   // the date warm / a neighbour warm
    await h.flush()
    expect(o.urls).toEqual([])
    h.network.start(K)                                               // the chart joins it
    await h.run()
    expect(h.timers.some((t) => t.ms === WINDOW_LAKE_HEAD_START_MS), 'the race\'s head start').toBe(true)
    await fire(h, WINDOW_LAKE_HEAD_START_MS)
    expect(o.urls.length).toBe(1)
    expect(o.urls[0], 'the chart never rides a shed-able warm').not.toMatch(/[?&]warm=1(?:&|$)/)
    expect(h.network.answered(K)).toBe(true)
    expect(h.network.windowSource(K)).toBe('origin')
  })

  it('(F-F) the newest session not known in time (NEWEST_SESSION_MAX_MS), the present key held after an unapplied split: the origin', async () => {
    const { NEWEST_SESSION_MAX_MS } = await import('./historyFeed')
    expect(NEWEST_SESSION_MAX_MS).toBeLessThanOrEqual(1000)
    const src = fakeSource(M, { through: LAKE_THROUGH })
    const inner = src.loadBars
    src.loadBars = vi.fn((sym, tf, q) => (q.to > etMidnightEpoch('2006-03-01') ? new Promise(() => {}) : inner(sym, tf, q)))   // the newest read stalls
    const o = originOf(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: src }) })
    const P = keyOf({ sym: 'ABC', tf: '5' })
    h.registry.dispatch(P, { type: 'rest-full', key: P, gen: h.registry.getSnapshot(P).gen,
      payload: { ticker: 'ABC', tf: '5', bars: M.ABC[5].slice(-300).map((b) => ({ ...b, o: b.o / 2, h: b.h / 2, l: b.l / 2, c: b.c / 2 })) } })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    await new Promise((r) => setTimeout(r, NEWEST_SESSION_MAX_MS + 150))
    await h.flush()
    expect(o.urls.length, 'an unchecked basis is the origin\'s').toBe(1)
    expect(h.network.windowSource(K)).toBe('origin')
  }, 10_000)

  it('the deepening: the origin landed short at the ceiling; the lake settling whole later adds ONLY older rows, once', async () => {
    const { WINDOW_LAKE_HEAD_START_MS, WINDOW_LAKE_MAX_WAIT_MS } = await import('./network')
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    await fire(h, WINDOW_LAKE_HEAD_START_MS)
    const asked = o.pend[0].q.bars
    o.pend[0].go((b) => b.slice(-738))
    await h.flush()
    await fire(h, WINDOW_LAKE_MAX_WAIT_MS)
    const first = h.registry.peek(K).bars
    expect(first.length, 'one visible draw: the origin\'s rows').toBe(738)
    open()
    await h.flush()
    expect(h.registry.peek(K).bars, 'nothing lands by itself: a zoomed-out view would see the empty left area fill').toBe(first)
    h.network.scrollBack(K)                                   // the member scrolls back
    await h.flush()
    const after = h.registry.peek(K).bars
    expect(after.length, 'the kept lake rows join on the scroll').toBe(asked)
    expect(after.at(-1).t, 'the newest bar did not move').toBe(first.at(-1).t)
    expect(after.slice(-738).map((b) => b.t)).toEqual(first.map((b) => b.t))
    expect(o.pend.length, 'in place of an origin ask (L2)').toBe(1)
  })
  it('(F-H) the entry reset (a basis change bumps its life) before the scroll: the kept lake rows land nothing', async () => {
    const { WINDOW_LAKE_HEAD_START_MS, WINDOW_LAKE_MAX_WAIT_MS } = await import('./network')
    const { source, open } = gatedLake(M, { through: LAKE_THROUGH })
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source }) })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    await fire(h, WINDOW_LAKE_HEAD_START_MS)
    const asked = o.pend[0].q.bars
    o.pend[0].go((b) => b.slice(-738))
    await h.flush()
    await fire(h, WINDOW_LAKE_MAX_WAIT_MS)
    open()
    await h.flush()
    h.registry.invalidate(K, 'adj_basis')
    h.network.scrollBack(K)
    await h.flush()
    expect(h.registry.peek(K)?.bars?.length ?? 0, "the old life's lake rows never land in the new one").not.toBe(asked)
  })
  it('(F-G) the newest-session read FAILS (an R2 error), the present key held after a split: the origin', async () => {
    const src = fakeSource(M, { through: LAKE_THROUGH })
    const inner = src.loadBars
    src.loadBars = vi.fn((sym, tf, q) => (q.to > etMidnightEpoch('2006-03-01') ? Promise.reject(Object.assign(new Error('r2 503'), { status: 503 })) : inner(sym, tf, q)))
    const o = originOf(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: src }) })
    const P = keyOf({ sym: 'ABC', tf: '5' })
    h.registry.dispatch(P, { type: 'rest-full', key: P, gen: h.registry.getSnapshot(P).gen,
      payload: { ticker: 'ABC', tf: '5', bars: M.ABC[5].slice(-300).map((b) => ({ ...b, o: b.o / 2, h: b.h / 2, l: b.l / 2, c: b.c / 2 })) } })
    const K = winKey('ABC', '5', '2006-02-15')
    h.network.start(K)
    await h.run()
    expect(o.urls.length, 'a failed check is no pass').toBe(1)
    expect(h.network.windowSource(K)).toBe('origin')
  })

  it('(LOW) the ceiling\'s timer goes with the caller\'s abort', async () => {
    const { WINDOW_LAKE_HEAD_START_MS, WINDOW_LAKE_MAX_WAIT_MS } = await import('./network')
    const o = gatedOrigin(M)
    const h = net({ request: o.request, history: createHistoryFeed({ source: stalled(M, { through: LAKE_THROUGH }) }) })
    const K = winKey('ABC', '5', '2006-02-15')
    const ac = new AbortController()
    h.network.fetchOnce(K, { priority: 'visible', signal: ac.signal })
    await h.flush()
    await fire(h, WINDOW_LAKE_HEAD_START_MS)
    o.pend[0].go((b) => b.slice(-738))
    await h.flush()
    expect(h.timers.some((t) => t.ms === WINDOW_LAKE_MAX_WAIT_MS)).toBe(true)
    ac.abort()
    await h.flush()
    expect(h.timers.some((t) => t.ms === WINDOW_LAKE_MAX_WAIT_MS), 'no timer outlives the abort').toBe(false)
  })
})

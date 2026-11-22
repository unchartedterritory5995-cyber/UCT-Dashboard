// Test-only: a seeded market simulator for the BarStore property suite. Never imported by
// product code. (P0b's rails generator, charts/p0-invariant-rails, is not merged yet; this
// uses the same mulberry32 PRNG so seeds read the same way, and should fold into it once
// both land.)
//
// One simulated session = a set of trades on the TRUE bucket grid (barTime.bucketStartUnix /
// liveBuckets.bucketEndUnix — the same owners the store uses), from which it derives every
// observation a client can receive, each stamped on ONE revision clock (ms, like P1's HLC):
//   push-bar     the bucket-to-date aggregate at each trade (rev = trade ms)
//   push-final   the bucket's final aggregate just after it ends
//   rest-full / rest-delta   the STORE as of a write instant w (P1 contract fields:
//                complete_through = end of the newest row ended by w - SEAL_LAG,
//                developing = the row containing w, series_rev = w)
// Synthetic prices only (no market data).

import { bucketStartUnix, fromChartTime, rthCloseMinuteOf } from '../../../components/chart/barTime'
import { bucketEndUnix } from '../../../components/chart/liveBuckets'
import { keyOf, dateLabelToUnix } from '../types'

export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    float: (lo, hi) => lo + next() * (hi - lo),
  }
}

/** Run fn(r, seed) for n seeds; a failure names the seed so it replays. */
export function forSeeds(n, base, fn) {
  for (let i = 0; i < n; i++) {
    const seed = base + i
    try { fn(rng(seed), seed) } catch (e) { e.message = `[seed ${seed}] ${e.message}`; throw e }
  }
}

// DST edges (2026-03-08 spring forward, 2026-11-01 fall back), both half-days, plain days.
export const DATES = Object.freeze([
  '2026-03-06', '2026-03-09', '2026-10-30', '2026-11-02', '2026-11-10', '2026-11-27', '2026-12-24',
])
export const INTRADAY = Object.freeze(['1', '5', '15', '30', '60'])
const SEAL_LAG = 5
// One revision clock; the low bits keep every observation's rev unique and typed.
const REV = { trade: 1, store: 2, final: 3 }
const rev = (ms, kind) => ms * 4 + REV[kind]

/** ET wall clock (date, minute of day) → unix seconds. */
export function etUnix(iso, minute) {
  return fromChartTime(dateLabelToUnix(iso) + minute * 60)
}

function aggregate(trades, t) {
  if (!trades.length) return null
  let o = trades[0].p, h = o, l = o, c = o, v = 0
  for (const x of trades) { if (x.p > h) h = x.p; if (x.p < l) l = x.p; c = x.p; v += x.s }
  return { t, o, h, l, c, v }
}

/**
 * Simulate one intraday session.
 * @returns {{key, tf, session, grid, buckets, nowSec, truth: Map<t, bar>, events: object[], settle: object}}
 */
export function simulateIntraday(r, { tf = r.pick(INTRADAY), session = r.pick(['rth', 'eth']), date = r.pick(DATES), sym = 'SIM', rich = false } = {}) {
  const key = keyOf({ sym, tf, session })
  const grid = tf === '60' ? (session === 'eth' ? 'clock' : 'session') : undefined
  const close = rthCloseMinuteOf(etUnix(date, 600))
  const openMin = session === 'eth' ? 240 : 570
  const closeMin = session === 'eth' ? close + 240 : close
  const start = etUnix(date, openMin), end = etUnix(date, closeMin)
  const buckets = []
  for (let t = start; t < end;) {
    const s = bucketStartUnix(t, Number(tf), { grid })
    const e = Math.min(bucketEndUnix(s, Number(tf), { grid }), end)
    buckets.push({ t: s, end: e })
    t = e
  }
  // Keep the sequence small: a window of up to ~14 buckets somewhere in the session.
  const w0 = r.int(0, Math.max(0, buckets.length - 14))
  const win = buckets.slice(w0, w0 + r.int(3, 14))
  // "now": inside the last window bucket (a developing bar) or just after it.
  const lastB = win[win.length - 1]
  const nowSec = r.chance(0.8) ? r.int(lastB.t + 1, lastB.end - 1) : lastB.end + r.int(6, 40)

  let px = r.float(20, 400)
  const tradesBy = new Map()
  const allTrades = []
  for (const b of win) {
    const list = []
    if (!r.chance(0.15)) {
      const n = r.int(1, 6)
      const span = (b.end - b.t) * 1000
      const offs = new Set()
      while (offs.size < n) offs.add(r.int(0, span - 1))
      for (const off of [...offs].sort((a, c) => a - c)) {
        const ms = b.t * 1000 + off
        if (ms >= nowSec * 1000) break
        px = Math.max(1, px * (1 + r.float(-0.004, 0.004)))
        const tr = { ms, p: Math.round(px * 100) / 100, s: r.int(1, 900), b: b.t }
        list.push(tr); allTrades.push(tr)
      }
    }
    tradesBy.set(b.t, list)
  }
  const aggAt = (b, ms) => aggregate(tradesBy.get(b.t).filter((x) => x.ms <= ms), b.t)

  const truth = new Map()
  for (const b of win) {
    if (b.end <= nowSec) { const a = aggAt(b, Infinity); if (a) truth.set(b.t, a) }
  }
  const events = []
  // push frames
  for (const tr of allTrades) {
    const b = win.find((x) => x.t === tr.b)
    const a = aggAt(b, tr.ms)
    events.push({ at: tr.ms, action: { type: 'push-bar', event: { sym, tf, bar: { ...a, t: a.t * 1000, final: false, trade_ts: tr.ms }, rev: rev(tr.ms, 'trade'), final: false, t_s: a.t } } })
  }
  for (const b of win) {
    const ms = b.end * 1000 + 200
    if (ms > nowSec * 1000) continue
    const a = aggAt(b, Infinity)
    if (!a) continue
    events.push({ at: ms, action: { type: 'push-final', event: { sym, tf, bar: { ...a, t: a.t * 1000, final: true }, rev: rev(ms, 'final'), final: true, t_s: a.t } } })
  }
  // Feed-only prints the SERVER filters out (ghost wicks, audit D5): a late straggler frame
  // for a closed bucket with a wider range, or a frame for a bucket the store has no row
  // for. The server's sealed answer must win over them in every order.
  const ghosted = new Set()
  for (const b of win) {
    const a = aggAt(b, Infinity)
    const ms = b.end * 1000 + r.int(300, 120000)
    if (ms > nowSec * 1000 || !r.chance(a ? 0.3 : 0.7)) continue
    const g = a ? { ...a, h: Math.round(a.h * 1.01 * 100) / 100 } : { t: b.t, o: px, h: px * 1.002, l: px * 0.998, c: px, v: 5 }
    ghosted.add(b.t)
    events.push({ at: ms, action: { type: 'push-bar', event: { sym, tf, bar: { ...g, t: b.t * 1000, final: false }, rev: rev(ms, 'trade'), final: false, t_s: b.t } } })
  }
  // store writes → REST answers
  const nW = r.int(1, 5)
  const writes = new Set()
  for (let i = 0; i < nW; i++) writes.add(r.int(win[0].t + 1, nowSec))
  // Before the series' first tail repair the server claims nothing (complete_through null).
  const repairAt = r.chance(0.4) ? r.int(win[0].t, nowSec) : -Infinity
  // rich: the provider REVISES (or the store DELETES) one closed bucket at `wc`. Inside the
  // sealed region that is a history change (history_rev + 1, bar-contract.md §2); before
  // the seal it is a plain revision (series_rev only).
  let corr = null
  if (rich) {
    const closed = win.filter((b) => b.end + 2 < nowSec && aggAt(b, Infinity))
    if (closed.length && r.chance(0.7)) {
      const b = r.pick(closed)
      const wc = r.int(b.end + 1, Math.max(b.end + 1, nowSec))
      const kind = r.chance(0.3) ? 'delete' : 'revise'
      const bump = kind === 'delete' || (wc >= repairAt && wc - SEAL_LAG >= b.end)
      corr = { t: b.t, wc, kind, bump }
      writes.add(wc); writes.add(Math.max(win[0].t + 1, wc - r.int(1, 60)))
      const a = aggAt(b, Infinity)
      if (kind === 'delete') truth.delete(b.t)
      else truth.set(b.t, { ...a, c: Math.round((a.l + a.h) / 2 * 100) / 100, v: a.v + 11 })
    }
  }
  const storeRow = (b, w) => {
    const a = aggAt(b, w * 1000)
    if (!a || !corr || corr.t !== b.t || w < corr.wc) return a
    if (corr.kind === 'delete') return null
    return truth.get(b.t)
  }
  const histAt = (w) => 7 + (corr && corr.bump && w >= corr.wc ? 1 : 0)
  const answer = (w, kind) => {
    const rows = []
    for (const b of win) { if (b.t > w) break; const a = storeRow(b, w); if (a) rows.push(a) }
    let C = null
    for (const x of rows) { const e = win.find((b) => b.t === x.t).end; if (e <= w - SEAL_LAG) C = e }
    if (w < repairAt) C = null
    const devB = win.find((b) => b.t <= w && w < b.end)
    const dev = devB ? rows.find((x) => x.t === devB.t) : null
    let bars = rows
    let since = null
    if (kind === 'delta' && rows.length) {
      since = rows[r.int(0, rows.length - 1)].t
      bars = rows.filter((x) => x.t >= since)
    }
    const srev = rev(w * 1000, 'store')
    return {
      type: kind === 'delta' ? 'rest-delta' : 'rest-full',
      payload: {
        bars, contract: 1, grid: tf === '60' ? (session === 'eth' ? 'eth-clock' : 'rth-tv') : 'eth-clock',
        session, cache_key: `b1:${sym}:${tf}:${tf === '60' ? (session === 'eth' ? 'eth-clock' : 'rth-tv') : 'eth-clock'}`,
        series_rev: srev, history_rev: histAt(w), verified_through: w - SEAL_LAG, sealed_through: w < repairAt ? null : w - SEAL_LAG,
        complete_through: C, developing: dev ? { ...dev, rev: srev } : null, tail_status: 'verified',
        ...(since != null ? { since } : {}),
      },
    }
  }
  for (const w of writes) {
    events.push({ at: w * 1000 + 1, action: answer(w, 'full') })
    if (r.chance(0.6)) events.push({ at: w * 1000 + 2, action: answer(w, 'delta') })
  }
  if (rich) {
    // Deeper history (scroll-back) for buckets before the window, a local (IDB) copy of an
    // early answer, fallback ticks while the stream is down, and an invalidate.
    const before = buckets.slice(Math.max(0, w0 - 2), w0)
    if (before.length) {
      const w = r.int(win[0].t + 1, nowSec)
      const old = before.map((b, i) => ({ t: b.t, o: px, h: px * 1.001, l: px * 0.999, c: px, v: 3 + i }))
      events.push({ at: w * 1000 + 3, action: { type: 'scroll-back', payload: { bars: old, series_rev: rev(w * 1000, 'store'), history_rev: histAt(w), cache_key: answer(w, 'full').payload.cache_key } } })
    }
    const w1 = Math.min(...writes)
    events.push({ at: r.int(win[0].t, nowSec) * 1000, action: { type: 'idb-hit', payload: { bars: answer(w1, 'full').payload.bars, history_rev: histAt(w1) } } })
    for (let i = r.int(0, 4); i > 0; i--) {
      const ms = r.int(win[0].t * 1000, nowSec * 1000)
      events.push({ at: ms, ctx: { streamLive: false }, action: { type: 'tick-fallback', event: { price: px * (1 + r.float(-0.003, 0.003)), ts: ms } } })
    }
    if (r.chance(0.3)) events.push({ at: r.int(win[0].t, nowSec) * 1000, action: { type: 'invalidate', reason: 'test' } })
  }
  events.sort((a, b) => a.at - b.at)
  // A late answer once every closed bucket is sealed (used for the correctness check).
  const settleW = Math.max(nowSec, lastB.end + SEAL_LAG + 1, corr ? corr.wc + 1 : 0)
  const settle = answer(settleW, 'full')
  if (settleW >= repairAt && settle.payload.complete_through == null && settle.payload.bars.length) {
    settle.payload.complete_through = win.find((b) => b.t === settle.payload.bars[settle.payload.bars.length - 1].t).end
  }
  return { key, sym, tf, session, grid, win, nowSec, truth, events, ghosted, corr, settle, aggAt }
}

/** Randomly duplicate some events (at-least-once delivery). */
export function withDuplicates(r, events, p = 0.15) {
  const out = []
  for (const e of events) { out.push(e); if (r.chance(p)) out.push(e) }
  return out
}

export function shuffled(r, arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

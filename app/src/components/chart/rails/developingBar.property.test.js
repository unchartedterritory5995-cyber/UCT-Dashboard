// P0 rail — PROPERTY / FUZZ suite for the developing ("live") intraday bar.
//
// The contract, stated in general form and checked over hundreds of SEEDED random event
// sequences (deterministic: a failure names its seed, rerun with that seed to replay):
//
//   P1  within one bucket, among AUTHORITATIVE frames, HIGH only rises and LOW only falls
//   P2  OPEN never changes after the bucket's first authoritative print (= the true open)
//   P3  VOLUME never decreases within a bucket; CLOSE is the newest-trade frame's close
//   P4  a FINAL frame replaces: the painted bar == the server's sealed bar, exactly, and
//       nothing after it (straggler, provisional tick) moves it
//   P5  a PROVISIONAL value (fallback tick) never survives the bucket's final
//   P6  no painted bar is OLDER than one already painted unless it is a `final` correction
//   P7  painted times are unique, strictly increasing and ON the bucket grid
//
// Modules under test (pure / registry logic, no React):
//   lib/liveBarMerge.js  (mergePushBar, foldPrice, reconcileWithServerTail)
//   lib/realtimeCandle.js (applyTick / applyBarClose registry)
//   lib/barsStreamManager.js (per-key ordering + throttled dispatch)
//
// Any still-open gap is pinned with `it.fails` + TODO: it flips red the day
// the gap is closed, so the TODO cannot outlive the fix.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mergePushBar, foldPrice, reconcileWithServerTail, provisionalOpen } from '../../../lib/liveBarMerge'
import * as rc from '../../../lib/realtimeCandle'
import * as bars from '../../../lib/barsStreamManager'
import { bucketStartUnix, toChartTime, fromChartTime, etOffsetSec } from '../barTime'
import { forSeeds, check } from './railSupport'

const SEEDS = 400
const TFS = ['1', '5', '15', '30', '60']
// Dates that matter: both sides of both DST changes (2025-2027), NYSE half-days, a plain day.
const DATES = [
  '2026-03-06', '2026-03-09', '2026-10-30', '2026-11-02', '2026-11-27', '2026-12-24',
  '2025-03-10', '2025-11-03', '2025-07-03', '2027-03-15', '2027-11-08', '2026-06-17',
]
const GRID = { rth: 'session', eth: 'clock' }

/** unix second of ET wall minute `min` on ISO date (weekday: no DST change inside the day). */
function etUnix(iso, min) {
  const [y, m, d] = iso.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d) / 1000 + min * 60
  return wall - etOffsetSec(wall + 18000)
}
const closeMin = (iso) => (['2026-11-27', '2026-12-24', '2025-07-03'].includes(iso) ? 780 : 960)

/** A random trade tape inside one session window: [{ms, px, sz}], strictly increasing ms. */
function tape(r, iso, session) {
  const [w0, w1] = session === 'rth' ? [570, closeMin(iso)] : [240, 1200]
  const startMin = r.int(w0, w1 - 6)
  const spanMin = Math.min(r.int(5, 300), w1 - startMin)
  let ms = etUnix(iso, startMin) * 1000 + r.int(0, 59_000)
  const end = etUnix(iso, startMin + spanMin) * 1000
  let px = r.float(5, 500)
  const out = []
  const n = r.int(30, 260)
  const meanGap = Math.max(200, (end - ms) / n)
  while (ms < end && out.length < n) {
    px = Math.max(0.5, px * (1 + r.float(-0.004, 0.004)))
    out.push({ ms, px: Math.round(px * 100) / 100, sz: r.int(1, 900) })
    ms += 1 + Math.floor(r.next() * 2 * meanGap)
  }
  return out
}

/** The server: per-bucket cumulative snapshots (frames) + a sealed final per bucket. */
function serverFrames(r, trades, tf, session) {
  const grid = GRID[session]
  const truth = new Map()   // chart time -> final bar
  const frames = []
  let cur = null
  const pEmit = r.float(0.3, 1)
  const pFinal = r.float(0.5, 1)
  const sealed = []
  for (const t of trades) {
    const start = bucketStartUnix(Math.floor(t.ms / 1000), Number(tf), { grid })
    const time = toChartTime(start)
    if (!cur || cur.time !== time) {
      if (cur) sealed.push({ ...cur })
      cur = { time, open: t.px, high: t.px, low: t.px, close: t.px, volume: 0, tradeTs: t.ms }
    }
    cur.high = Math.max(cur.high, t.px); cur.low = Math.min(cur.low, t.px)
    cur.close = t.px; cur.volume += t.sz; cur.tradeTs = t.ms
    truth.set(time, { ...cur })
    // a just-sealed previous bucket's final goes out now, or a few frames late (AM correction)
    while (sealed.length) {
      const f = sealed.shift()
      if (r.chance(pFinal)) frames.splice(Math.max(0, frames.length - (r.chance(0.3) ? r.int(0, 2) : 0)), 0, { ...f, final: true })
    }
    if (r.chance(pEmit) || frames.length === 0) frames.push({ ...cur, final: false })
  }
  if (cur && r.chance(pFinal)) frames.push({ ...cur, final: true })
  return { frames, truth }
}

/** Network: adjacent reorders + duplicates. */
function deliver(r, frames) {
  const out = frames.map((f) => ({ ...f }))
  const pSwap = r.float(0, 0.2)
  for (let i = 0; i + 1 < out.length; i++) if (r.chance(pSwap)) { const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; i++ }
  const dup = []
  for (const f of out) { dup.push(f); if (r.chance(0.04)) dup.push({ ...f }) }
  return dup
}

const onGrid = (time, tf, session) =>
  toChartTime(bucketStartUnix(fromChartTime(time), Number(tf), { grid: GRID[session] })) === time

const barEq = (a, b) => a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close && a.volume === b.volume

function scenario(r) {
  const tf = r.pick(TFS)
  const session = r.pick(['rth', 'eth'])
  const iso = r.pick(DATES)
  const trades = tape(r, iso, session)
  return { tf, session, iso, trades, ...serverFrames(r, trades, tf, session) }
}

/** The chart: a painted series + the developing bar, driven only by mergePushBar. */
function paintPush(sc, delivered, { provisional = null, r = null } = {}) {
  const { tf, session } = sc
  const series = []
  let prev = null
  let maxPainted = -Infinity
  const appliedByTime = new Map()   // time -> [frames merged into it]
  const sealedAt = new Map()        // time -> sealed bar
  for (const inc of delivered) {
    // optional fallback-writer noise between frames (P5)
    if (provisional && prev && r.chance(provisional)) {
      const ghost = Math.round(prev.close * (1 + r.float(-0.05, 0.05)) * 100) / 100
      const fp = foldPrice(prev, ghost, prev.time, tf, session)
      if (fp.kind === 'update') {
        check(!prev.final || barEq(fp.bar, prev), 'foldPrice moved a FINAL bar')
        prev = fp.bar; series[series.length - 1] = prev
      }
    }
    const before = prev ? { ...prev } : null
    const res = mergePushBar(prev, inc, { sym: 'X', final: inc.final, tradeTs: inc.tradeTs, tf, session, toChart: toChartTime })
    check(res.kind !== 'drop', () => `well-formed frame dropped at t=${inc.time}`)
    if (res.kind === 'new') {
      check(res.bar.time > maxPainted, 'P6: new bar not newer than every painted bar')
      series.push(res.bar); prev = res.bar
    } else if (res.kind === 'update') {
      check(res.bar.time === series[series.length - 1].time && res.bar.time >= maxPainted, 'P6: update not on the tail')
      series[series.length - 1] = res.bar; prev = res.bar
    } else if (res.kind === 'correct') {
      check(inc.final === true, 'P6: an older bar was repainted without being FINAL')
      const i = series.findIndex((b) => b.time === res.bar.time)
      if (i >= 0) series[i] = res.bar
      else { series.push(res.bar); series.sort((a, b) => a.time - b.time) }
    } else {
      check(res.kind === 'stale' && inc.time < prev.time && !inc.final, `unexpected ${res.kind}`)
    }
    if (res.kind === 'new' || res.kind === 'update') {
      maxPainted = Math.max(maxPainted, res.bar.time)
      if (!inc.final && !(before && before.final && before.time === inc.time)) {
        const list = appliedByTime.get(inc.time) || []
        list.push(inc); appliedByTime.set(inc.time, list)
      }
    }
    if (inc.final && res.kind !== 'stale') sealedAt.set(inc.time, sc.truth.get(inc.time))
    // ── invariants on the developing bar (same bucket as before, authoritative only) ──
    if (res.kind === 'update' && before && before.time === res.bar.time && !inc.final && !before.final && !provisional) {
      const b = res.bar
      check(b.high >= before.high, 'P1: HIGH fell within the bucket')
      check(b.low <= before.low, 'P1: LOW rose within the bucket')
      check(b.open === before.open, 'P2: OPEN changed after the first authoritative print')
      check(b.volume >= before.volume, 'P3: VOLUME decreased within the bucket')
    }
    // ── P7 on the whole painted series ──
    for (let i = 0; i < series.length; i++) {
      check(onGrid(series[i].time, tf, session), () => `P7: off-grid bar time ${series[i].time}`)
      if (i) check(series[i].time > series[i - 1].time, 'P7: duplicate / out-of-order painted time')
      const b = series[i]
      check(b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close), 'bar OHLC inconsistent')
    }
    // ── P4: every sealed bucket is painted exactly as the server sealed it ──
    for (const [t, want] of sealedAt) {
      const got = series.find((b) => b.time === t)
      check(got && barEq(got, want), () => `P4: sealed bucket ${t} not equal to the server's final`)
    }
  }
  return { series, appliedByTime, sealedAt }
}

describe('developing bar — mergePushBar over random authoritative push sequences', () => {
  it(`P1-P4, P6, P7 hold over ${SEEDS} seeded sequences (all tfs, rth+eth, DST + half-days)`, () => {
    let frames = 0
    forSeeds(SEEDS, 1000, (r) => {
      const sc = scenario(r)
      const delivered = deliver(r, sc.frames)
      frames += delivered.length
      const { series, appliedByTime, sealedAt } = paintPush(sc, delivered)
      // unsealed painted buckets: open = true open; H/L within truth; close = newest applied frame
      for (const b of series) {
        if (sealedAt.has(b.time)) continue
        const truth = sc.truth.get(b.time)
        const applied = appliedByTime.get(b.time) || []
        if (!applied.length) continue
        const newest = applied.reduce((a, f) => (f.tradeTs > a.tradeTs ? f : a))
        check(b.open === truth.open, 'P2: painted open != the bucket\'s first authoritative print')
        check(b.high <= truth.high && b.low >= truth.low, 'P1: painted range wider than any authoritative frame')
        check(b.high === Math.max(...applied.map((f) => f.high)), 'P1: painted high != max authoritative high')
        check(b.low === Math.min(...applied.map((f) => f.low)), 'P1: painted low != min authoritative low')
        check(b.close === newest.close, 'P3: painted close != newest-trade frame close')
      }
    })
    expect(frames).toBeGreaterThan(SEEDS * 20)
  })

  it(`P5: provisional (fallback) ticks never survive a bucket's final — ${SEEDS} seeds`, () => {
    forSeeds(SEEDS, 5000, (r) => {
      const sc = scenario(r)
      // every bucket ends with its final, in order (no late corrections): pure P5 check
      const inOrder = sc.frames.filter((f) => !f.final)
      const withFinals = []
      for (let i = 0; i < inOrder.length; i++) {
        withFinals.push(inOrder[i])
        const nxt = inOrder[i + 1]
        if (!nxt || nxt.time !== inOrder[i].time) withFinals.push({ ...sc.truth.get(inOrder[i].time), final: true })
      }
      const { series } = paintPush(sc, withFinals, { provisional: 0.5, r })
      for (const b of series) check(barEq(b, sc.truth.get(b.time)), 'P5: a provisional value survived the final')
    })
  })

  it('stale / straggler frames for an EARLIER bucket are never painted over the developing bar', () => {
    forSeeds(SEEDS, 9000, (r) => {
      const sc = scenario(r)
      const nonFinal = sc.frames.filter((f) => !f.final)
      const times = [...new Set(nonFinal.map((f) => f.time))]
      if (times.length < 2) return
      const late = nonFinal.find((f) => f.time === times[0])
      const prev = { ...nonFinal.filter((f) => f.time === times[1]).pop(), sym: 'X' }
      const res = mergePushBar(prev, late, { sym: 'X', tradeTs: late.tradeTs, tf: sc.tf, session: sc.session, toChart: toChartTime })
      check(res.kind === 'stale', `older non-final frame -> ${res.kind}`)
    })
  })

  it('a frame whose trade time lies outside its own bucket is dropped (no fusing across the boundary)', () => {
    forSeeds(SEEDS, 12000, (r) => {
      const sc = scenario(r)
      const f = r.pick(sc.frames)
      const startU = fromChartTime(f.time)
      const endU = bucketStartUnix(startU, Number(sc.tf), { grid: GRID[sc.session] }) === startU
        ? toChartTime(startU) : null
      check(endU != null, 'frame not on grid')
      const outside = r.chance(0.5) ? (startU - r.int(1, 600)) * 1000 : null
      if (outside == null) return
      const res = mergePushBar(null, f, { sym: 'X', tradeTs: outside, tf: sc.tf, session: sc.session, toChart: toChartTime })
      check(res.kind === 'drop', `trade before the bucket start accepted as ${res.kind}`)
    })
  })
})

describe('developing bar — provisional values must not LOCK (liveBarMerge I6-I8, PR #1100)', () => {
  // Was a KNOWN GAP (it.fails) until #1100: the bar carried no provenance. Now a
  // writer-guessed bucket is `provisional: true` (provisionalOpen) and fallback prints
  // (foldPrice) never touch `authHigh/authLow`, so these are real invariants.
  it('I6: the first authoritative push frame REPLACES a provisional open / extremes', () => {
    forSeeds(SEEDS, 20000, (r) => {
      const sc = scenario(r)
      const first = sc.frames.find((f) => !f.final)
      const ghost = Math.round(first.open * (1 + r.float(-0.05, 0.05)) * 100) / 100
      let prov = { ...provisionalOpen(first.time, ghost), volume: 0, sym: 'X' }
      for (let i = 0, n = r.int(0, 6); i < n; i++) {
        const px = Math.round(ghost * (1 + r.float(-0.05, 0.05)) * 100) / 100
        prov = foldPrice(prov, px, first.time, sc.tf, sc.session).bar
      }
      const res = mergePushBar(prov, first, { sym: 'X', tradeTs: first.tradeTs, tf: sc.tf, session: sc.session, toChart: toChartTime })
      check(res.kind === 'update', `provisional + same-bucket frame -> ${res.kind}`)
      check(res.bar.open === first.open, 'provisional open locked')
      check(res.bar.high === first.high && res.bar.low === first.low, 'provisional extremes locked')
      check(!res.bar.provisional, 'bar still provisional after an authoritative frame')
    })
  })

  it('I7: a fallback print outside the authoritative range never survives the next authoritative frame', () => {
    forSeeds(SEEDS, 20500, (r) => {
      const sc = scenario(r)
      const frames = sc.frames.filter((f) => !f.final)
      const t = frames[0].time
      const same = frames.filter((f) => f.time === t)
      if (same.length < 2) return
      let bar = mergePushBar(null, same[0], { sym: 'X', tradeTs: same[0].tradeTs, tf: sc.tf, session: sc.session, toChart: toChartTime }).bar
      const ghostHi = Math.round(sc.truth.get(t).high * (1 + r.float(0.01, 0.05)) * 100) / 100
      const ghostLo = Math.round(sc.truth.get(t).low * (1 - r.float(0.01, 0.05)) * 100) / 100
      bar = foldPrice(bar, r.chance(0.5) ? ghostHi : ghostLo, t, sc.tf, sc.session).bar
      const nxt = same[same.length - 1]
      const res = mergePushBar(bar, nxt, { sym: 'X', tradeTs: nxt.tradeTs, tf: sc.tf, session: sc.session, toChart: toChartTime })
      const authHi = Math.max(same[0].high, nxt.high), authLo = Math.min(same[0].low, nxt.low)
      check(res.bar.high === authHi && res.bar.low === authLo, 'fallback ghost extreme survived an authoritative frame')
    })
  })

  it('I8 (D5): a bucket the server PROVES sealed (a later bucket in the response) is the server bar exactly', () => {
    forSeeds(SEEDS, 21000, (r) => {
      const sc = scenario(r)
      const t0 = sc.frames[0].time
      const server = sc.truth.get(t0)
      const live = { ...server, high: Math.round(server.high * (1 + r.float(0.01, 0.05)) * 100) / 100,
        low: Math.round(server.low * (1 - r.float(0, 0.05)) * 100) / 100, volume: server.volume + r.int(0, 50),
        sym: 'X', provisional: r.chance(0.5) || undefined }
      const { bar, ahead } = reconcileWithServerTail(live, server, {
        sym: 'X', periodSec: Number(sc.tf) * 60, tf: sc.tf, session: sc.session, serverHasLater: true,
      })
      check(!ahead && barEq(bar, server), 'live ghost value survived a server-sealed bucket')
      check(!bar.provisional, 'sealed bar still provisional')
    })
  })

  // NOT a gap (by design, I8): WITHOUT proof of sealing (no later bucket, no push final) the
  // H/L union stands — the client clock is not proof (the REST tail lags the stream). The
  // window is bounded by the next poll that carries a later bucket.

  it('reconcileWithServerTail: the server open is authoritative over a provisional open (I2)', () => {
    forSeeds(SEEDS, 22000, (r) => {
      const sc = scenario(r)
      const t0 = sc.frames[0].time
      const server = sc.truth.get(t0)
      const live = { ...server, open: Math.round(server.open * (1 + r.float(-0.05, 0.05)) * 100) / 100, sym: 'X' }
      const { bar, ahead } = reconcileWithServerTail(live, server, { sym: 'X', periodSec: Number(sc.tf) * 60, tf: sc.tf, session: sc.session })
      check(!ahead && bar.open === server.open, 'provisional open survived reconcile')
      check(bar.high >= server.high && bar.low <= server.low && bar.volume >= server.volume, 'reconcile shrank the server bar')
    })
  })
})

describe('realtimeCandle registry — random tick / bar_close sequences', () => {
  beforeEach(() => rc._reset())
  afterEach(() => rc._reset())

  it(`per-minute OHLC invariants + never moves back to an older minute — ${SEEDS} seeds`, () => {
    forSeeds(SEEDS, 30000, (r) => {
      rc._reset()
      const sym = 'SYM' + r.int(0, 9)
      let ts = etUnix(r.pick(DATES), r.int(240, 1100)) + r.int(0, 59)
      let px = r.float(5, 500)
      let cum = 0
      let maxMinute = -Infinity
      const firstPx = new Map()
      let prev = null
      for (let i = 0, n = r.int(20, 200); i < n; i++) {
        const back = r.chance(0.08)
        const t = back ? ts - r.int(1, 150) : (ts += r.int(0, 25))
        px = Math.max(0.5, px * (1 + r.float(-0.003, 0.003)))
        const p = Math.round(px * 100) / 100
        const minute = Math.floor(t / 60) * 60
        if (!back && minute !== Math.floor((ts - 1) / 60) * 60) cum = 0
        cum += r.int(1, 500)
        let step
        if (r.chance(0.07)) {
          // server 1m bar_close: the D1 shape {t,c,v} or a full bar
          const full = r.chance(0.5)
          rc.applyBarClose(sym, '1', full ? { t: minute, o: p, h: p, l: p, c: p, v: cum } : { t: minute, c: p, v: cum })
          step = full ? 'close-full' : 'close'
        } else {
          rc.applyTick(sym, p, cum, t)
          step = 'tick'
        }
        const c = rc.getCandle(sym, '1')
        if (!c) continue
        check([c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0), 'registry candle has a blank O/H/L/C')
        check(c.l <= Math.min(c.o, c.c) && c.h >= Math.max(c.o, c.c), 'registry candle OHLC inconsistent')
        check(c.t >= maxMinute, 'registry moved back to an older minute')
        if (!firstPx.has(c.t)) firstPx.set(c.t, c.o)
        // Between ticks the minute only widens; a FULL bar_close is the server's sealed bar
        // and replaces (P4); the D1 {t,c,v} close only merges (never narrows).
        if (prev && prev.t === c.t && step !== 'close-full') {
          check(c.h >= prev.h && c.l <= prev.l, `registry H/L shrank within the minute (${step})`)
          check(c.o === prev.o, `registry OPEN changed within the minute (${step})`)
          if (step === 'tick') check(c.v >= prev.v, 'registry volume decreased on a tick')
        }
        maxMinute = Math.max(maxMinute, c.t)
        prev = { ...c }
      }
    })
  })
})

// ── barsStreamManager: per-key ordering and the throttled dispatch ────────────
class MockES {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; this.onopen = null; this.onerror = null; MockES.instances.push(this) }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn) }
  close() { this.closed = true }
  _open() { if (this.onopen) this.onopen() }
  _emit(type, data) { (this.listeners[type] || []).forEach((fn) => fn({ data: JSON.stringify(data) })) }
}

describe('barsStreamManager — random frame orderings', () => {
  let savedES
  beforeEach(() => { savedES = global.EventSource; MockES.instances = []; global.EventSource = MockES; bars._resetForTests() })
  afterEach(() => { bars._resetForTests(); global.EventSource = savedES })

  it(`no consumer moves backwards; the last accepted frame of every bucket is delivered — ${SEEDS} seeds`, () => {
    forSeeds(SEEDS, 40000, (r) => {
      bars._resetForTests(); MockES.instances = []
      const got = []
      bars.subscribe('AAA', '5', { onBar: (d) => got.push(d) })
      bars._flushRebuild()
      const es = MockES.instances[MockES.instances.length - 1]
      es._open()
      let t = 1_800_000_000
      let lastBarT = -Infinity
      const lastAccepted = new Map()   // t -> seq
      for (let seq = 0, n = r.int(10, 150); seq < n; seq++) {
        let ft
        if (r.chance(0.15)) ft = t - 300 * r.int(1, 3)       // straggler / late correction
        else { if (r.chance(0.3)) t += 300; ft = t }
        const final = r.chance(0.15)
        const accepted = !(ft < lastBarT && !final)
        if (accepted) { lastAccepted.set(ft, seq); if (ft > lastBarT) lastBarT = ft }
        es._emit('bar', { sym: 'AAA', tf: '5', bar: { t: ft, o: 1, h: 1, l: 1, c: 1, v: seq, final, seq } })
        if (r.chance(0.2)) bars._flushBars()
      }
      bars._flushBars()
      let maxT = -Infinity
      let lastSeq = -1
      for (const d of got) {
        check(d.bar.seq > lastSeq, 'a frame was delivered twice or out of arrival order')
        lastSeq = d.bar.seq
        if (d.bar.final !== true) check(d.bar.t >= maxT, 'a NON-final frame moved the consumer backwards')
        maxT = Math.max(maxT, d.bar.t)
      }
      const delivered = new Set(got.map((d) => d.bar.seq))
      for (const [ft, seq] of lastAccepted) check(delivered.has(seq), `bucket ${ft}: its last accepted frame was coalesced away`)
    })
  })
})

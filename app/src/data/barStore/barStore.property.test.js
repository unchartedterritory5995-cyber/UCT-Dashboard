// BarStore property suite — invariants S1–S7 + S10 of docs/architecture/barstore.md over
// hundreds of seeded sessions (DST edges, half-days, RTH/ETH, 1/5/15/30/60m, D).
// A failure names its seed: `forSeeds` rethrows "[seed N] …" and the run replays exactly.
// (S8 persist and S9 network belong to P2b's persist.js / network.js.)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reduce, initialState, bucketEnd, isSealedRow, inSealedSpan } from './reducer'
import { isLegalTransition } from './status'
import { bucketStartUnix } from '../../components/chart/barTime'
import { forSeeds, simulateIntraday, withDuplicates, shuffled, INTRADAY, DATES, etUnix } from './__fixtures__/seededSeries'
import { keyOf, dateLabelToUnix } from './types'

const N = Number(globalThis.process?.env?.BARSTORE_SEEDS || 300)

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

function check(cond, msg) { if (!cond) throw new Error(typeof msg === 'function' ? msg() : msg) }

const canon = (s) => JSON.stringify({
  bars: s.bars.map((b) => [b.t, b.o, b.h, b.l, b.c, b.v]),
  dev: s.developing && [s.developing.t, s.developing.o, s.developing.h, s.developing.l, s.developing.c, s.developing.v],
  C: s.completeThrough, V: s.verifiedThrough, R: s.seriesRev, H: s.historyRev, K: s.cacheKey,
})

function lastSealedT(s) {
  let out = null
  for (const b of s.bars) if (isSealedRow(s, b)) out = b.t
  return out
}

/** Every per-snapshot invariant (S1, S3, S10-frozen). */
function checkSnapshot(s, sim) {
  check(Object.isFrozen(s) && Object.isFrozen(s.bars), 'S10 snapshot / bars frozen')
  const tfN = Number(s.tf)
  for (let i = 0; i < s.bars.length; i++) {
    const b = s.bars[i]
    check(Object.isFrozen(b), 'S10 bar frozen')
    if (i) check(b.t > s.bars[i - 1].t, () => `S1 strictly increasing at ${i}`)
    if (sim?.grid !== undefined || !Number.isNaN(tfN)) {
      check(bucketStartUnix(b.t, tfN, { grid: sim?.grid }) === b.t, () => `S1 on grid t=${b.t}`)
    }
    check(b.l <= b.o && b.o <= b.h && b.l <= b.c && b.c <= b.h, 'bar OHLC consistent')
  }
  if (s.developing) {
    const last = s.bars[s.bars.length - 1]
    check(!last || s.developing.t > last.t, () => `S3 developing ${s.developing.t}/${s.developing.src} after closed row ${last.t}/${last.src}`)
    check(Object.isFrozen(s.developing), 'S10 developing frozen')
  }
  check(s.depth === s.bars.length, 'depth = bars.length')
}

/** Apply `events` in order from an empty store, checking step invariants (S2, S4, S10). */
function run(sim, events, { nowMs, stepClock = false } = {}) {
  let s = initialState(sim.key, { nowMs })
  for (const e of events) {
    const ctx = { nowMs: stepClock ? Math.max(e.at, 0) : nowMs, streamLive: true, ...(e.ctx || {}) }
    const prev = s
    s = reduce(s, e.action, ctx)
    checkSnapshot(s, sim)
    check(isLegalTransition(prev.status, s.status), () => `S10 illegal ${prev.status} -> ${s.status}`)
    // S2: completeThrough and the last sealed t never decrease — except across an
    // invalidate or a new history (history_rev rose: the server replaced sealed history).
    const reset = s.gen !== prev.gen || s.historyRev !== prev.historyRev
    if (!reset && prev.completeThrough != null) check(s.completeThrough >= prev.completeThrough, 'S2 completeThrough decreased')
    const a = lastSealedT(prev), b = lastSealedT(s)
    if (!reset && a != null) check(b != null && b >= a, 'S2 last sealed t decreased')
    // Never a stale history: once a history_rev is held, nothing older is ever applied.
    if (prev.historyRev != null && s.historyRev != null) check(s.historyRev >= prev.historyRev, 'history_rev went back')
    // S4: within one developing bucket H↑ L↓ open-once V↑.
    const d0 = prev.developing, d1 = s.developing
    if (d0 && d1 && d0.t === d1.t && !d0.provisional && !d0.ticked && d0.src !== 'tick' && !reset) {
      check(d1.h >= d0.h && d1.l <= d0.l, 'S4 developing range shrank')
      check(d1.o === d0.o, 'S4 developing open moved')
      check(d1.v >= d0.v, 'S4 developing volume fell')
    }
    // S10: a change ⇒ new identity with bumped revs; no change ⇒ same identity.
    if (s !== prev) check(s.baseRev > prev.baseRev || s.devRev > prev.devRev || s.status !== prev.status
      || s.source !== prev.source || s.tailStatus !== prev.tailStatus || s.needsFull !== prev.needsFull || s.gen !== prev.gen
      || s.liveGapFrom !== prev.liveGapFrom, 'S10 new identity without a change')
    // S10 idempotence: re-applying the same action is a no-op.
    if (e.action.type !== 'invalidate' && e.action.type !== 'tick-fallback') {
      check(reduce(s, e.action, ctx) === s, () => `S10 re-applying ${e.action.type} changed the snapshot`)
    }
  }
  return s
}

describe('BarStore property suite (seeded)', () => {
  it(`S1–S4, S10 over ${N} seeded intraday sessions (chronological, with duplicates)`, () => {
    forSeeds(N, 1000, (r) => {
      const sim = simulateIntraday(r)
      vi.setSystemTime(sim.nowSec * 1000)
      const s = run(sim, withDuplicates(r, sim.events), { nowMs: sim.nowSec * 1000, stepClock: true })
      // Correctness, not just consistency: every bucket whose final the store saw holds the truth.
      for (const b of s.bars) {
        const tr = sim.truth.get(b.t)
        const finalSeen = !sim.ghosted.has(b.t) && sim.events.some((e) => e.action.type === 'push-final' && e.action.event.t_s === b.t)
        if (isSealedRow(s, b)) check(tr && b.o === tr.o && b.h === tr.h && b.l === tr.l && b.c === tr.c && b.v === tr.v, () => `sealed bar ${b.t} != truth`)
        if (tr && finalSeen) {
          check(b.o === tr.o && b.h === tr.h && b.l === tr.l && b.c === tr.c && b.v === tr.v, () => `final bar ${b.t} != truth`)
        }
      }
    })
  })

  it(`S5 confluence: any order / duplication of rest-full, rest-delta, push-bar, push-final converges (${N} seeds)`, () => {
    forSeeds(N, 5000, (r, seed) => {
      const sim = simulateIntraday(r)
      const nowMs = sim.nowSec * 1000
      vi.setSystemTime(nowMs)
      const ref = run(sim, sim.events, { nowMs })
      const want = canon(ref)
      for (let k = 0; k < 3; k++) {
        const got = run(sim, withDuplicates(r, shuffled(r, sim.events), 0.25), { nowMs })
        check(canon(got) === want, () => `S5 order ${k} diverged (seed ${seed})\nwant ${want}\n got ${canon(got)}`)
      }
      // ... and a late answer that seals every closed bucket makes the store equal the truth.
      const settled = reduce(ref, sim.settle, { nowMs })
      const sealed = settled.bars.filter((b) => isSealedRow(settled, b) && bucketEnd(b.t, settled) <= sim.nowSec)
      for (const b of sealed) {
        const tr = sim.truth.get(b.t)
        check(tr && b.o === tr.o && b.h === tr.h && b.l === tr.l && b.c === tr.c && b.v === tr.v, () => `sealed ${b.t} != truth`)
      }
      // No feed-only (ghost) row survives inside the sealed span.
      for (const b of settled.bars) {
        if (inSealedSpan(settled, b.t) && bucketEnd(b.t, settled) <= sim.nowSec) check(sim.truth.has(b.t) && b.src === 'rest', () => `ghost row ${b.t} survived the seal`)
      }
      for (const [t] of sim.truth) {
        if (inSealedSpan(settled, t) && bucketEnd(t, settled) <= sim.nowSec) check(sealed.some((b) => b.t === t), () => `sealed truth bucket ${t} missing`)
      }
    })
  })

  it(`eventual convergence with corrections / deletes / stale-history races / ct=null / scroll-back / local hits / ticks / invalidate (${N} seeds)`, () => {
    forSeeds(N, 30000, (r, seed) => {
      const sim = simulateIntraday(r, { rich: true })
      const nowMs = sim.nowSec * 1000
      vi.setSystemTime(nowMs)
      const sealedCanon = (s) => JSON.stringify({
        rows: s.bars.filter((b) => inSealedSpan(s, b.t)).map((b) => [b.t, b.o, b.h, b.l, b.c, b.v, b.src]), C: s.completeThrough,
      })
      let want = null
      for (let k = 0; k < 4; k++) {
        const evs = k === 0 ? sim.events : withDuplicates(r, shuffled(r, sim.events), 0.25)
        const s = run(sim, evs, { nowMs })
        const settled = reduce(s, sim.settle, { nowMs, streamLive: true })
        checkSnapshot(settled, sim)
        const got = sealedCanon(settled)
        if (want == null) want = got
        check(got === want, () => `order ${k} diverged after the settling answer (seed ${seed})\nwant ${want}\n got ${got}`)
        for (const b of settled.bars) {
          if (!inSealedSpan(settled, b.t) || bucketEnd(b.t, settled) > sim.nowSec) continue
          const tr = sim.truth.get(b.t)
          check(tr && b.src === 'rest' && b.o === tr.o && b.h === tr.h && b.l === tr.l && b.c === tr.c && b.v === tr.v,
            () => `sealed ${b.t} != truth (corr ${JSON.stringify(sim.corr)})`)
        }
        if (sim.corr?.kind === 'delete' && inSealedSpan(settled, sim.corr.t)) {
          check(!settled.bars.some((b) => b.t === sim.corr.t), 'a deleted row resurrected')
        }
      }
    })
  })

  it(`S6 server authority over tick-fallback (${N} seeds)`, () => {
    forSeeds(N, 9000, (r) => {
      const sim = simulateIntraday(r)
      const nowMs = sim.nowSec * 1000
      vi.setSystemTime(nowMs)
      const s0 = run(sim, sim.events, { nowMs })
      // While the stream delivers, ticks are ignored outright.
      const ref = s0.developing || s0.bars[s0.bars.length - 1]
      if (!ref) return
      const tick = { type: 'tick-fallback', event: { price: ref.c * (1 + r.float(-0.01, 0.01)), ts: nowMs } }
      check(reduce(s0, tick, { nowMs, streamLive: true }) === s0, 'S6 tick applied while stream live')
      // Stream down: a tick never moves the server/push open, never touches a closed bar.
      let s = s0
      for (let i = 0; i < 5; i++) {
        const p = ref.c * (1 + r.float(-0.02, 0.02))
        const ts = r.chance(0.3) ? (ref.t - r.int(1, 600)) * 1000 : nowMs + r.int(0, 2000)
        const prev = s
        s = reduce(s, { type: 'tick-fallback', event: { price: p, ts } }, { nowMs, streamLive: false })
        checkSnapshot(s, sim)
        check(s.bars === prev.bars || s.bars.length === prev.bars.length + 1, 'S6 tick rewrote closed bars')
        for (let j = 0; j < prev.bars.length; j++) check(s.bars[j] === prev.bars[j], 'S6 tick touched a closed bar')
        if (prev.developing && s.developing && prev.developing.t === s.developing.t && prev.developing.src !== 'tick') {
          check(s.developing.o === prev.developing.o, 'S6 tick moved an authoritative open')
          check(s.developing.authHigh === prev.developing.authHigh && s.developing.authLow === prev.developing.authLow, 'S6 tick vouched an extreme (I7)')
        }
      }
      // A 100x phantom is refused (liveTickBaseline, this symbol's own baselines).
      check(reduce(s, { type: 'tick-fallback', event: { price: ref.c * 100, ts: nowMs } }, { nowMs, streamLive: false }) === s, 'S6 phantom tick accepted')
      // The next authoritative frame for a tick-opened bucket replaces its O/H/L (I6/I7).
      if (s.developing && s.developing.src === 'tick') {
        const d = s.developing
        const o = d.o * 1.001
        const frame = { type: 'push-bar', event: { bar: { t: d.t * 1000, o, h: o * 1.002, l: o * 0.998, c: o, v: 10 }, rev: 9e15 } }
        const s2 = reduce(s, frame, { nowMs, streamLive: true })
        check(s2.developing.o === o && s2.developing.h === o * 1.002 && s2.developing.l === o * 0.998, 'S6 server frame did not replace a provisional open')
        check(!s2.developing.provisional && s2.developing.src === 'push', 'S6 provisional flag survived')
      }
    })
  })

  it(`S7 never a foreign key: other symbols / series / keys never touch an entry (${N} seeds)`, () => {
    forSeeds(N, 13000, (r) => {
      const sim = simulateIntraday(r)
      const nowMs = sim.nowSec * 1000
      vi.setSystemTime(nowMs)
      const s0 = run(sim, sim.events.slice(0, Math.ceil(sim.events.length / 2)), { nowMs })
      for (const e of shuffled(r, sim.events).slice(0, 12)) {
        const a = e.action
        const foreign = [
          { ...a, key: keyOf({ sym: 'OTHER', tf: sim.tf }) },
          a.payload ? { ...a, payload: { ...a.payload, cache_key: `b1:OTHER:${sim.tf}:eth-clock` } } : { ...a, event: { ...a.event, sym: 'OTHER' } },
          a.payload ? { ...a, payload: { ...a.payload, sym: 'OTHER' } } : { ...a, event: { ...a.event, tf: sim.tf === '5' ? '15' : '5' } },
        ]
        for (const f of foreign) check(reduce(s0, f, { nowMs, streamLive: true }) === s0, () => `S7 foreign ${f.type} applied`)
      }
    })
  })
})

describe('BarStore property suite — daily', () => {
  it(`D: S1–S4, S10 + confluence over ${Math.ceil(N / 3)} seeded daily series`, () => {
    forSeeds(Math.ceil(N / 3), 20000, (r) => {
      const date = r.pick(DATES)
      const key = keyOf({ sym: 'SIM', tf: 'D' })
      // ~30 weekdays ending at `date`; today forms until 16:00 ET.
      const days = []
      for (let t = dateLabelToUnix(date); days.length < 30; t -= 86400) {
        const dow = new Date(t * 1000).getUTCDay()
        if (dow !== 0 && dow !== 6) days.unshift(t)
      }
      let px = r.float(20, 400)
      const truth = days.map((t) => {
        const o = px; const c = Math.round(px * (1 + r.float(-0.03, 0.03)) * 100) / 100; px = c
        return { t, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: r.int(1e5, 9e6) }
      })
      const nowSec = etUnix(date, 600 + r.int(0, 300))
      const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10)
      const today = truth[truth.length - 1]
      const events = []
      // Today's bar as of instant `sec` (one consistent tape for every observation).
      const asOf = (sec) => {
        const f = Math.max(0.2, Math.min(1, (sec - (nowSec - 3000)) / 3000))
        return { ...today, h: today.o + (today.h - today.o) * f, l: today.o - (today.o - today.l) * f, c: today.o + (today.c - today.o) * f, v: Math.floor(today.v * f) }
      }
      for (let i = 0; i < 4; i++) {
        const w = nowSec - r.int(0, 3000)
        const dev = asOf(w)
        events.push({ at: w * 1000, action: { type: 'rest-full', payload: {
          bars: [...truth.slice(0, -1), dev].map((b) => ({ ...b, t: iso(b.t) })),
          contract: 1, grid: 'plain', session: null, cache_key: 'b1:SIM:D:plain', series_rev: w * 4000 + 2, history_rev: 3,
          verified_through: null, complete_through: null, developing: { ...dev, t: iso(dev.t), rev: w * 4000 + 2 },
        } } })
      }
      for (let i = 0; i < 6; i++) {
        const ms = nowSec * 1000 - r.int(0, 3_000_000)
        const b = asOf(ms / 1000)
        events.push({ at: ms, action: { type: 'push-bar', event: { bar: { ...b, t: iso(today.t) }, rev: ms * 4 + 1 } } })
      }
      events.sort((a, b) => a.at - b.at)
      vi.setSystemTime(nowSec * 1000)
      const sim = { key, tf: 'D', grid: undefined }
      const nowMs = nowSec * 1000
      const runD = (evs) => {
        let s = initialState(key, { nowMs })
        for (const e of evs) {
          const prev = s
          s = reduce(s, e.action, { nowMs, streamLive: true })
          check(Object.isFrozen(s) && Object.isFrozen(s.bars), 'S10 frozen')
          for (let i = 1; i < s.bars.length; i++) check(s.bars[i].t > s.bars[i - 1].t && s.bars[i].t % 86400 === 0, 'S1 D t')
          if (s.developing) check(!s.bars.length || s.developing.t > s.bars[s.bars.length - 1].t, 'S3 D')
          check(isLegalTransition(prev.status, s.status), 'S10 D transition')
        }
        return s
      }
      const ref = runD(events)
      check(ref.developing && ref.developing.t === today.t, 'D developing is today')
      check(ref.bars.length === truth.length - 1, 'D sealed history intact')
      const want = canon(ref)
      for (let k = 0; k < 2; k++) check(canon(runD(withDuplicates(r, shuffled(r, events), 0.3))) === want, 'S5 D diverged')
      void sim
    })
  })
})

it('sanity: the generator covers every tf, both sessions, DST edges and half-days', () => {
  const seen = new Set()
  forSeeds(400, 1000, (r) => {
    const sim = simulateIntraday(r)
    seen.add(`tf${sim.tf}`); seen.add(sim.session)
  })
  for (const tf of INTRADAY) expect(seen.has(`tf${tf}`)).toBe(true)
  expect(seen.has('rth') && seen.has('eth')).toBe(true)
  expect(DATES).toEqual(expect.arrayContaining(['2026-03-09', '2026-11-02', '2026-11-27', '2026-12-24']))
})

// ⭐ S4 ACROSS A CACHE RESTORE (P3-S1 review fix 3). A forming bar restored from a cache copy
// (read at `seenAt`, the record's savedAt) meets the server's first answer for the same bucket,
// read at some other instant — fresh, or LAGGING the copy (an unverified / delta-deadline /
// stale-swr serve), with `verified_through` absent, older than the copy, or covering it.
// Invariant: the developing bar never loses an extreme or volume the copy saw (S4, checked by
// `run` on every step), its open / close are the server's, and a server answer VERIFIED through
// the copy's read time is the truth as of that answer (it saw everything the copy saw).
describe('S4 across a cache restore (seeded)', () => {
  it(`a restored forming bar never shrinks on an unverified / lagging server answer (${N} seeds)`, () => {
    forSeeds(N, 91000, (r) => {
      const tf = r.pick(INTRADAY), session = r.pick(['rth', 'eth']), date = r.pick(DATES)
      const key = keyOf({ sym: 'SIMR', tf, session })
      const grid = tf === '60' ? (session === 'eth' ? 'clock' : 'session') : undefined
      const t0 = bucketStartUnix(etUnix(date, r.int(600, 900)), Number(tf), { grid })
      const end = bucketEnd(t0, { key, tf, grid: tf === '60' ? (session === 'eth' ? 'eth-clock' : 'rth-tv') : null })
      const prior = bucketStartUnix(t0 - 1, Number(tf), { grid })
      // Trades inside the bucket; truth(τ) = the bar as of τ.
      let px = r.float(20, 400)
      const trades = []
      for (let ms = t0 * 1000 + r.int(0, 2000); ms < end * 1000 - 1000; ms += r.int(200, Math.max(400, (end - t0) * 1000 / 8))) {
        px = Math.max(1, px * (1 + r.float(-0.006, 0.006)))
        trades.push({ ms, p: Math.round(px * 100) / 100, s: r.int(1, 900) })
      }
      if (trades.length < 2) return
      const truth = (sec) => {
        const ts = trades.filter((x) => x.ms <= sec * 1000)
        if (!ts.length) return null
        return { t: t0, o: ts[0].p, h: Math.max(...ts.map((x) => x.p)), l: Math.min(...ts.map((x) => x.p)), c: ts[ts.length - 1].p, v: ts.reduce((n, x) => n + x.s, 0) }
      }
      const tradeSec = (i) => Math.ceil(trades[i].ms / 1000)
      const nowSec = Math.min(end - 1, tradeSec(trades.length - 1) + r.int(1, 30))
      const tc = tradeSec(r.int(0, trades.length - 1))            // the copy's read
      const ts = tradeSec(r.int(0, trades.length - 1))            // the server's read (may lag)
      const copy = truth(tc), srv = truth(ts)
      if (!copy || !srv) return
      const vtKind = r.pick(['none', 'old', 'read'])
      const vt = vtKind === 'none' ? null : (vtKind === 'old' ? ts - r.int(60, 3600) : ts)
      const priorRow = { t: prior, o: copy.o, h: copy.o, l: copy.o, c: copy.o, v: 1 }
      const sim = { key, grid }
      const nowMs = nowSec * 1000
      vi.setSystemTime(nowMs)
      const ck = `b1:SIMR:${tf}:${tf === '60' && session === 'rth' ? 'rth-tv' : 'eth-clock'}`
      const events = [
        { action: { type: 'idb-hit', payload: { bars: [priorRow, copy], saved_at: tc * 1000 } } },
        { action: { type: 'rest-full', payload: r.chance(0.5)
          ? { bars: [priorRow, srv], ...(vt != null ? { verified_through: vt } : {}) }
          : { contract: 1, cache_key: ck, series_rev: nowMs, history_rev: 1, complete_through: null,
            verified_through: vt, bars: [priorRow, srv], developing: { ...srv, rev: ts * 1000 } } } },
      ]
      const s = run(sim, events, { nowMs })   // S4 (H↑ L↓ open-once V↑) is checked on every step
      const d = s.developing
      check(d && d.t === t0, 'the forming bucket is developing')
      check(d.o === srv.o && d.c === srv.c, 'open / close are the server answer\'s')
      check(d.h >= copy.h && d.l <= copy.l && d.v >= copy.v, 'S4: the copy\'s extremes / volume survive')
      if (vt != null && vt >= tc) {
        check(d.h === srv.h && d.l === srv.l && d.v === srv.v, 'a verified-through-the-copy answer is the truth')
      }
    })
  })
})

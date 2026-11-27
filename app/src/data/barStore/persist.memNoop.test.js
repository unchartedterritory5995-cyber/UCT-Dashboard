// ⭐ A SAVED COPY THAT PROVABLY CHANGES NOTHING IS NOT DECODED (2026-11-25, the next-row key task).
//
// A chart's switch onto a row the list warmed subscribes to an entry that already holds the server's answer, and its first
// subscriber re-reads the saved copy in the switch's own task (index.js _start -> persist.hydrate -> hydrateMem): decoding
// the envelope (row hashes), ingesting every row (toBar, normT, the off-grid fold) and proving the basis (basisVerdict,
// _rowAtOf), ~1.3 ms a press on a two-chart board. On an answered entry a local copy can only add rows OLDER than everything
// held, so a copy holding none changes nothing. `reducer.localCopyAddsNothing` says so in one pass over the raw rows, and
// `hydrateMem` then dispatches the copy EMPTY (the registry's own bookkeeping: the entry marked used, the eviction check).
//
//   1. THE PROOF, PER CALL: over seeded answered sessions (every intraday timeframe, both sessions) and daily entries, and
//      for every kind of copy a cache can hold (the same rows, the same rows without their envelope, a re-answered tail,
//      a subset, deeper history, an off-grid row near the oldest held bar, an entry whose answer starts inside a bucket):
//      whenever the predicate says "nothing", the reducer, handed the whole decoded copy exactly as hydrateMem built it
//      before, returns the entry ITSELF. Non-vacuous both ways: the predicate says "nothing" on most copies, and some
//      copies it does not clear really do change the entry.
//   2. hydrateMem on an answered entry with a copy of its own rows: ONE dispatch, a mem hit with no rows, and the
//      snapshot is the same object (before the change: the whole copy decoded and dispatched).
//   3. ...and a copy that adds deeper history is applied exactly as before, in the same call.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { reduce, initialState, localCopyAddsNothing } from './reducer'
import { createRegistry } from './registry'
import { createPersist, toCacheRows, encodeMeta, decodeEntry } from './persist'
import { forSeeds, simulateIntraday } from './__fixtures__/seededSeries'
import { keyOf, unixToDateLabel } from './types'

afterEach(() => { vi.useRealTimers() })

const N = Number(globalThis.process?.env?.BARSTORE_SEEDS || 300)

/** A seeded session's events, run chronologically to its final state (persist.test.js `settledState`). */
function settledState(sim) {
  const nowMs = sim.nowSec * 1000
  let s = initialState(sim.key, { nowMs })
  for (const e of sim.events) s = reduce(s, e.action, { nowMs, streamLive: true, ...(e.ctx || {}) })
  return reduce(s, sim.settle, { nowMs })
}

/** What hydrateMem dispatched for a mem record before the change (the whole decoded copy). */
const wholeCopy = (key, s, entry) => ({ type: 'mem-hit', key, gen: s.gen, payload: { ...decodeEntry(key, entry), saved_at: entry.savedAt ?? null, repair_from: null } })

const firstOf = (s) => Math.min(s.restFrom ?? Infinity, s.bars[0]?.t ?? Infinity, s.developing?.t ?? Infinity)
const stepOf = (tf) => (tf === 'D' ? 86400 : Number(tf) * 60)

/** Every kind of copy a cache can hold for answered entry `s` (rows in the cache's legacy shape). */
function copiesOf(s, r) {
  const rows = toCacheRows(s)
  const meta = encodeMeta(s)
  const first = firstOf(s)
  const step = stepOf(String(s.tf))
  const t0 = rows.length ? rows[0].t : null
  const out = [
    ['same rows, with the envelope', { bars: rows, meta }],
    ['same rows, no envelope', { bars: rows }],
  ]
  if (rows.length > 1) {
    const k = Math.min(rows.length - 1, 1 + Math.floor(r() * 3))
    out.push(['the newest rows re-answered', { bars: rows.map((x, i) => (i >= rows.length - k ? { ...x, c: x.c + 0.37, v: x.v + 11 } : x)) }])
    out.push(['a subset of the held rows', { bars: rows.filter(() => r() < 0.6) }])
  }
  if (typeof t0 === 'number') {
    const older = []
    const n = 1 + Math.floor(r() * 4)
    for (let i = n; i >= 1; i--) older.push({ ...rows[0], t: t0 - i * step })
    out.push(['deeper history (older rows on the grid)', { bars: [...older, ...rows], meta }])
    out.push(['an off-grid row inside the oldest held bucket', { bars: [{ ...rows[0], t: t0 + 7 }, ...rows] }])
    out.push(['an off-grid row just before the oldest held bar', { bars: [{ ...rows[0], t: t0 - 7 }, ...rows] }])
  } else if (rows.length) {
    // daily: one older session
    const prev = unixToDateLabel(first - 3 * 86400)
    out.push(['deeper history (an older session)', { bars: [{ ...rows[0], t: prev }, ...rows] }])
  }
  return out
}

describe('a saved copy that provably changes nothing is not decoded (reducer.localCopyAddsNothing, persist.hydrateMem)', () => {
  it(`1. the proof, per call: "nothing" means the reducer returns the entry itself (${N} seeded sessions + daily)`, () => {
    let said = 0
    let notSaid = 0
    let notSaidAndChanged = 0
    const failures = []
    const judge = (label, key, s, entry, nowMs) => {
      const nothing = localCopyAddsNothing(s, entry.bars)
      const after = reduce(s, wholeCopy(key, s, entry), { nowMs })
      if (nothing) {
        said++
        if (after !== s) failures.push(`${key} ${label}: the predicate said nothing, the reducer changed the entry`)
      } else {
        notSaid++
        if (after !== s) notSaidAndChanged++
      }
    }
    forSeeds(N, 91000, (r) => {
      const sim = simulateIntraday(r, { rich: r.chance(0.5) })
      vi.setSystemTime(sim.nowSec * 1000)
      const s = settledState(sim)
      if (!s.restSeen || !s.bars.length) return
      const nowMs = sim.nowSec * 1000
      for (const [label, entry] of copiesOf(s, () => r.float(0, 1))) judge(label, sim.key, s, entry, nowMs)
      // an answer that starts inside a bucket: a row folded to that bucket's start lands before `first`
      const mid = Object.freeze({ ...s, restFrom: s.bars[0].t - 30 })
      const rows = toCacheRows(s)
      judge('an answer starting inside a bucket, an off-grid row after its start', sim.key, mid,
        { bars: [{ ...rows[0], t: s.bars[0].t - 20 }, ...rows] }, nowMs)
    })
    // daily entries
    const KD = keyOf({ sym: 'SIM', tf: 'D' })
    const nowMs = Date.UTC(2026, 10, 14, 16)
    vi.setSystemTime(nowMs)
    for (const n of [3, 40, 400]) {
      const labels = []
      for (let ms = Date.UTC(2026, 10, 13); labels.length < n; ms -= 86_400_000) {
        const wd = new Date(ms).getUTCDay()
        if (wd !== 0 && wd !== 6) labels.push(new Date(ms).toISOString().slice(0, 10))
      }
      const bars = labels.reverse().map((t, i) => ({ t, o: 50 + i * 0.01, h: 51 + i * 0.01, l: 49, c: 50.5 + i * 0.01, v: 1000 + i }))
      const s = reduce(initialState(KD, { nowMs }), { type: 'rest-full', payload: { contract: 1, grid: 'plain', complete_through: null,
        series_rev: 10, history_rev: 1, bars } }, { nowMs })
      expect(s.restSeen && s.bars.length === n, `daily ${n}`).toBe(true)
      let k = 0
      for (const [label, entry] of copiesOf(s, () => ((k++ * 0.618) % 1))) judge(label, KD, s, entry, nowMs)
    }
    expect(failures).toEqual([])
    expect(said, 'copies the predicate cleared').toBeGreaterThan(N)
    expect(notSaid, 'copies it did not clear').toBeGreaterThan(N / 2)
    expect(notSaidAndChanged, 'copies it did not clear that really change the entry').toBeGreaterThan(N / 4)
    // eslint-disable-next-line no-console
    console.log(`[mem no-op proof] cleared ${said}, not cleared ${notSaid} (of which really changing the entry ${notSaidAndChanged})`)
  })

  /** An answered entry in a registry, a persist whose mem cache holds `rec`, and every dispatch recorded. */
  function hydrateOnce(sim, recOf) {
    const nowMs = sim.nowSec * 1000
    vi.setSystemTime(nowMs)
    const registry = createRegistry({ ctx: () => ({ nowMs }) })
    for (const e of sim.events) registry.dispatch(sim.key, e.action, { streamLive: true, ...(e.ctx || {}) })
    registry.dispatch(sim.key, sim.settle)
    const before = registry.peek(sim.key)
    const rec = recOf(before)
    const persist = createPersist({ registry, device: null, io: { memPeekEntry: () => rec, memPutMonotonic: () => {}, idbGet: async () => null } })
    const seen = []
    const dispatch = registry.dispatch
    registry.dispatch = (key, action, extra) => { seen.push(action); return dispatch(key, action, extra) }
    persist.hydrateMem(sim.key)
    return { before, after: registry.peek(sim.key), seen, rec, nowMs }
  }
  const answeredSims = () => {
    const out = []
    forSeeds(60, 93000, (r) => {
      const sim = simulateIntraday(r, { rich: r.chance(0.5) })
      vi.setSystemTime(sim.nowSec * 1000)
      const s = settledState(sim)
      if (s.restSeen && s.bars.length > 1) out.push(sim)
    })
    return out
  }

  it('2. hydrateMem, an answered entry and a copy of its own rows: one EMPTY mem hit, the same snapshot object', () => {
    const sims = answeredSims()
    expect(sims.length).toBeGreaterThan(20)
    for (const sim of sims) {
      const { before, after, seen } = hydrateOnce(sim, (s) => ({ bars: toCacheRows(s), meta: encodeMeta(s), savedAt: 1 }))
      expect(seen.map((a) => `${a.type}:${a.payload?.bars?.length}`), sim.key).toEqual(['mem-hit:0'])
      expect(after, sim.key).toBe(before)
    }
  })

  it('3. ...and a copy holding deeper history is decoded and applied exactly as before, in the same call', () => {
    let deepened = 0
    for (const sim of answeredSims()) {
      const { before, after, seen, rec, nowMs } = hydrateOnce(sim, (s) => {
        const rows = toCacheRows(s)
        const step = stepOf(String(s.tf))
        return { bars: [{ ...rows[0], t: rows[0].t - 2 * step }, { ...rows[0], t: rows[0].t - step }, ...rows], meta: encodeMeta(s), savedAt: 1 }
      })
      expect(seen.length, sim.key).toBe(1)
      expect(seen[0].payload.bars, sim.key).toBe(rec.bars)
      const expected = reduce(before, wholeCopy(sim.key, before, rec), { nowMs, depthCap: undefined })
      expect(JSON.stringify(after.bars), sim.key).toBe(JSON.stringify(expected.bars))
      if (after !== before) deepened++
    }
    expect(deepened, 'copies that really deepened the entry').toBeGreaterThan(5)
  })
})

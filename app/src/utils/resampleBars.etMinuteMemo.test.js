// app/src/utils/resampleBars.etMinuteMemo.test.js
//
// ─── THE SESSION KEY READS ET WALL TIME FROM ONE MEMO, NOT A NEW FORMATTER PER ROW (2026-11-26) ───────────────────────
//
// Measured on production's build (#2801's A/B, master's dist): a 4h regular board's symbol switch spent 784-950 ms of
// its KEY TASK in `resampleBars._aggregate`, and as much again a second later. The session key called `_etHM` once per
// base row, and `_etHM` built a NEW `Intl.DateTimeFormat` on every call. It now reads barTime's ET offset, memoised per
// UTC day (`etOffsetSec`). These rails hold the new reading to the OLD one, byte for byte (the old reading is copied
// below as the reference), and hold the cost to a handful of Intl reads per DAY:
//   E1 both 2025 and 2026 DST transitions (every minute of the day before, the day itself and the day after,
//      midnight included): every custom intraday spec's resample identical, both anchors (09:30 and 04:00)
//   E2 the half days (13:00 close) and the session edges (03:59, 04:00, 09:29, 09:30, 15:59, 16:00, 19:59, 20:00,
//      20:01) on many days: identical, through `resampleForSpec` (the regular view's row filter included)
//   E3 random instants across 2018-2032 (arbitrary seconds): every row's bucket key identical, every spec
//   E4 the cost: a 30-day resample constructs NO formatter and makes at most two Intl reads per day (the reference,
//      the control, constructs one per row)
import { describe, it, expect } from 'vitest'
import { resampleIntradaySession, resampleForSpec, bucketKeyOf } from './resampleBars'
import { resampleSpec } from '../components/chart/timeframes'
import { isRthBar } from '../components/chart/barTime'

// ── THE OLD READING, verbatim (2026-07-17 .. 2026-11-26): the reference ────────────────────────────────────────────
function refEtHM(tSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(tSec * 1000))
  const h = +parts.find(p => p.type === 'hour').value
  const m = +parts.find(p => p.type === 'minute').value
  return h * 60 + m
}
const isUnixT = t => t !== '' && !Number.isNaN(new Date(t * 1000).getTime())
// the identity cases read the reference through a memo (its answer per instant never changes); the cost case does not
const _refMemo = new Map()
const refEtHMMemo = (t) => { let v = _refMemo.get(t); if (v === undefined) { v = refEtHM(t); _refMemo.set(t, v) } return v }
const refSessionKey = (B, A, read = refEtHMMemo) => (t) => {
  const minsSinceOpen = read(t) - A
  const off = ((minsSinceOpen % B) + B) % B
  return t - off * 60
}
function refAggregate(rawBars, keyFn, isValidT) {
  const bars = rawBars.filter(b => b && b.t != null && isValidT(b.t))
  const sorted = bars.every((b, i) => i === 0 || b.t >= bars[i - 1].t)
    ? bars
    : [...bars].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
  const buckets = new Map()
  for (const b of sorted) {
    const key = keyFn(b.t)
    const cur = buckets.get(key)
    if (!cur) buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += (b.v || 0) }
  }
  return [...buckets.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
}
const refResample = (bars, B, A, read) => refAggregate(bars, refSessionKey(B, A, read), isUnixT)
const refRegularRows = (bars) => bars.filter((b) => !b || b.t == null || !isUnixT(b.t) || isRthBar(Number(b.t)))

const MINUTES = [2, 45, 65, 120, 180, 195, 240]
const ANCHORS = [570, 240]
const CODES = ['2', '45', '65', '120', '180', '195', '240']
const rowsAt = (ts) => ts.map((t, i) => ({ t, o: 100 + (i % 37), h: 101 + (i % 41), l: 99 - (i % 29), c: 100 + (i % 13), v: 1 + (i % 7) }))
const utcMidnight = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000
/** Every minute from 00:00 UTC of `iso` minus a day to 00:00 UTC two days later (three UTC days, all ET hours). */
const threeDays = (iso) => Array.from({ length: 3 * 1440 }, (_, i) => utcMidnight(iso) - 86400 + i * 60)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

describe('the session key reads ET wall time from one memo: identical to the old reading, at a cost per day', () => {
  it.each([['2025-03-09'], ['2025-11-02'], ['2026-03-08'], ['2026-11-01']])(
    'E1 the DST transition of %s: every spec, both anchors, every minute of three days, identical', (iso) => {
      const rows = rowsAt(threeDays(iso))
      for (const B of MINUTES) {
        for (const A of ANCHORS) {
          const got = resampleIntradaySession(rows, B, { anchorMin: A })
          const want = refResample(rows, B, A)
          expect(got.length, `${iso} ${B}m @${A}`).toBe(want.length)
          expect(same(got, want), `${iso} ${B}m @${A}`).toBe(true)
        }
      }
    }, 60000)

  it('E2 half days and the session edges, through resampleForSpec (regular filter included): identical', () => {
    const halfDays = ['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24']
    const ts = []
    for (const iso of halfDays) for (let m = 0; m < 1440; m += 1) ts.push(utcMidnight(iso) + 5 * 3600 + m * 60 - (iso.slice(5, 7) === '07' ? 3600 : 0))
    const EDGES = [239, 240, 241, 569, 570, 571, 779, 780, 959, 960, 961, 1199, 1200, 1201]   // ET minute of day
    for (let d = 0; d < 60; d++) {
      const day = utcMidnight('2026-02-02') + d * 7 * 86400 + (d % 5) * 86400                // weekdays across DST
      for (const em of EDGES) for (const off of [4 * 3600, 5 * 3600]) ts.push(day + off + em * 60)
    }
    ts.sort((a, b) => a - b)
    const rows = rowsAt([...new Set(ts)])
    let compared = 0
    for (const code of CODES) {
      for (const extended of [false, true]) {
        const spec = resampleSpec(code, { extended })
        expect(spec && spec.kind, code).toBe('intradaySession')
        const regular = (Number.isFinite(spec.anchorMin) ? spec.anchorMin : 570) === 570
        const got = resampleForSpec(rows, spec)
        const want = refResample(regular ? refRegularRows(rows) : rows, spec.minutes, Number.isFinite(spec.anchorMin) ? spec.anchorMin : 570)
        expect(same(got, want), `${code} ${extended ? 'extended' : 'regular'}`).toBe(true)
        compared += got.length
      }
    }
    expect(compared).toBeGreaterThan(1000)
  }, 60000)

  it('E3 random instants across 2018-2032, arbitrary seconds: every row\'s bucket key identical, every spec', () => {
    let s = 20261126
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    const lo = utcMidnight('2018-01-01')
    const hi = utcMidnight('2032-12-31')
    const ts = Array.from({ length: 4000 }, () => Math.floor(lo + rnd() * (hi - lo)))
    let rth = 0
    for (const B of MINUTES) {
      for (const A of ANCHORS) {
        const key = bucketKeyOf({ kind: 'intradaySession', minutes: B, anchorMin: A })
        const ref = refSessionKey(B, A)
        for (const t of ts) {
          const want = A === 570 && !isRthBar(t) ? null : ref(t)        // a regular spec takes regular rows only
          if (A === 570 && want != null) rth += 1
          expect(key(t), `${B}m @${A} t=${t}`).toBe(want)
        }
      }
    }
    expect(rth, 'the draw held regular-session rows').toBeGreaterThan(200)
  }, 60000)

  it('E4 the cost: no formatter constructed and at most two Intl reads per day (the old reading: one formatter per row)', () => {
    const days = 30
    const ts = []
    const start = utcMidnight('2033-02-01')                                    // days no other case has asked about
    for (let d = 0; d < days; d++) for (let m = 240; m < 1200; m += 5) ts.push(start + d * 86400 + 5 * 3600 + m * 60)
    const rows = rowsAt(ts)
    const Real = Intl.DateTimeFormat
    const realFTP = Real.prototype.formatToParts
    let built = 0
    let reads = 0
    const count = (fn) => {
      built = 0; reads = 0
      // eslint-disable-next-line no-global-assign
      Intl.DateTimeFormat = function DateTimeFormat(...a) { built += 1; return new Real(...a) }
      Intl.DateTimeFormat.prototype = Real.prototype
      Real.prototype.formatToParts = function formatToParts(...a) { reads += 1; return realFTP.apply(this, a) }
      try { return fn() } finally { Intl.DateTimeFormat = Real; Real.prototype.formatToParts = realFTP }
    }
    const got = count(() => resampleIntradaySession(rows, 240, { anchorMin: 240 }))
    const newBuilt = built
    const newReads = reads
    const want = count(() => refResample(rows, 240, 240, refEtHM))
    expect(same(got, want)).toBe(true)
    expect(built, 'the control: the old reading builds one formatter per row').toBe(rows.length)
    expect(newBuilt, 'formatters constructed by a resample').toBe(0)
    const utcDays = new Set(ts.map((t) => Math.floor(t / 86400))).size        // the rows reach into ${days} + 1 UTC days
    expect(newReads, `Intl reads for ${utcDays} UTC days`).toBeLessThanOrEqual(2 * utcDays)
    expect(newReads, 'the memo was asked (a fresh span)').toBeGreaterThan(0)
  }, 60000)
})

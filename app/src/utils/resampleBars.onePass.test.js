// ⚡ (2026-11-26) THE CUSTOM-INTRADAY RESAMPLE IN ONE PASS, BAR FOR BAR THE SAME. On the 4h regular board the chart's own
// resample (useBarSnapshotBars → resampleForSpec) was ~5 ms of the switch's key task (production build, flip proof,
// n=10): every base row was filtered twice (the regular-session rows, then the valid rows), each filter built a `Date`
// per row to validate its time, and the buckets were sorted again although the session keys arrive ascending. Now one
// pass, no Date per row, and the final sort only when the keys did not arrive ascending.
//   E1 the output is IDENTICAL to the previous implementation (copied below as the reference) over real sessions,
//      both anchors, odd bucket sizes, unsorted / duplicated / descending input and every odd `t` a row can carry
//   E2 (red first) a regular resample builds no Date per row
//   E3 (red first) already-ascending input is never sorted; E3b (control) unsorted input still is, and matches
import { describe, it, expect, vi, afterEach } from 'vitest'
import { resampleForSpec, resampleIntradaySession } from './resampleBars'
import { isRthBar, etMinuteOfDay } from '../components/chart/barTime'

// ── THE REFERENCE: the implementation before this change, verbatim in behaviour ──────────────────────────────────────
const refIsUnixT = (t) => t !== '' && !Number.isNaN(new Date(t * 1000).getTime())
function refAggregate(rawBars, keyFn, isValidT) {
  const bars = rawBars.filter((b) => b && b.t != null && isValidT(b.t))
  const sorted = bars.every((b, i) => i === 0 || b.t >= bars[i - 1].t)
    ? bars
    : [...bars].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
  const buckets = new Map()
  for (const b of sorted) {
    const key = keyFn(b.t)
    const cur = buckets.get(key)
    if (!cur) {
      buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 })
    } else {
      cur.h = Math.max(cur.h, b.h)
      cur.l = Math.min(cur.l, b.l)
      cur.c = b.c
      cur.v += (b.v || 0)
    }
  }
  return [...buckets.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
}
const MIDNIGHT_HOUR = (() => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date(Date.UTC(2026, 0, 15, 5, 0)))
    return +parts.find((p) => p.type === 'hour').value
  } catch { return 0 }
})()
function refEtHM(tSec) {
  const m = etMinuteOfDay(+tSec)
  return m < 60 && MIDNIGHT_HOUR === 24 ? m + 1440 : m
}
function refSessionKey(B, A) {
  return (t) => {
    const minsSinceOpen = refEtHM(t) - A
    const off = ((minsSinceOpen % B) + B) % B
    return t - off * 60
  }
}
function refResampleIntradaySession(bars, bucketMinutes, { anchorMin = 570 } = {}) {
  if (!bars || !bars.length || !(bucketMinutes > 0)) return []
  const A = Number.isFinite(anchorMin) ? anchorMin : 570
  return refAggregate(bars, refSessionKey(bucketMinutes, A), refIsUnixT)
}
const refRegularRows = (bars) => bars.filter((b) => !b || b.t == null || !refIsUnixT(b.t) || isRthBar(Number(b.t)))
function refResampleForSpec(baseBars, spec) {
  if (!spec || !baseBars) return baseBars || []
  const a = Number.isFinite(spec.anchorMin) ? spec.anchorMin : 570
  const rows = a === 570 ? refRegularRows(baseBars) : baseBars
  return refResampleIntradaySession(rows, spec.minutes, { anchorMin: spec.anchorMin })
}

// ── inputs ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `stepMin`-minute rows, 04:00-20:00 ET, on the weekdays of [from, to] (unix s at UTC midnight), DST change included. */
function sessionRows(stepMin, days) {
  const out = []
  let i = 0
  for (const d of days) {
    const midnightUtc = Date.UTC(...d) / 1000
    for (let s = midnightUtc; s < midnightUtc + 86400; s += stepMin * 60) {
      const m = etMinuteOfDay(s)
      if (m < 240 || m >= 1200) continue
      const p = 100 + ((i * 7919) % 97) / 10
      out.push({ t: s, o: p, h: p + 1 + (i % 3), l: p - 1 - (i % 2), c: p + ((i % 5) - 2) / 10, v: (i % 4 === 0) ? undefined : 1000 + i })
      i++
    }
  }
  return out
}
const DAYS = [[2026, 9, 29], [2026, 9, 30], [2026, 10, 2], [2026, 10, 3], [2026, 10, 25]]   // Oct 29-30, Nov 2-3 (DST ended Nov 1), Nov 25
const SPECS = [
  { kind: 'intradaySession', minutes: 240, anchorMin: 570 },
  { kind: 'intradaySession', minutes: 240, anchorMin: 240 },
  { kind: 'intradaySession', minutes: 120 },
  { kind: 'intradaySession', minutes: 45, anchorMin: 570 },
  { kind: 'intradaySession', minutes: 65, anchorMin: 570 },
  { kind: 'intradaySession', minutes: 2, anchorMin: 240 },
  { kind: 'intradaySession', minutes: 240, anchorMin: null },
]
const ODD_T = ['', null, undefined, NaN, Infinity, -Infinity, '1794330000', '1.7943e9', ' ', 'abc', true, false, 0, -0,
  8.64e12, 8.64e12 + 1, -8.64e12, -8.64e12 - 1, [1794330000], [], {}, '999999960', '1794321000', 1794321000.5]
function shuffled(rows, seed) {
  const a = rows.slice()
  let x = seed
  for (let i = a.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648
    const j = x % (i + 1);
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
function inputs() {
  const r60 = sessionRows(60, DAYS)
  const r30 = sessionRows(30, DAYS)
  const r1 = sessionRows(1, [DAYS[1], DAYS[2]])
  const odd = r30.slice(0, 40).map((b, i) => (i % 2 ? { ...b, t: ODD_T[(i >> 1) % ODD_T.length] } : b))
  const sparse = r60.slice(0, 20)
  delete sparse[5]
  sparse[9] = null
  const dup = [...r30.slice(0, 30), ...r30.slice(10, 20)]
  const strT = r60.slice(0, 30).map((b) => ({ ...b, t: String(b.t) }))
  const mixedLen = [{ t: '999999960', o: 1, h: 2, l: 0, c: 1, v: 1 }, { t: '1794321000', o: 2, h: 3, l: 1, c: 2, v: 2 }, { t: '1794324600', o: 3, h: 4, l: 2, c: 3, v: 3 }]
  // ONE odd time per input as well: a value both implementations throw on would otherwise hide every other odd value in
  // the same input (a thrown outcome equals a thrown outcome)
  const base = r60.slice(0, 30)
  const oddOne = Object.fromEntries(ODD_T.map((t, k) => [`odd${k}`, [...base.slice(0, 15), { t, o: 5, h: 6, l: 4, c: 5, v: 7 }, ...base.slice(15)]]))
  return {
    r60, r30, r1, odd, sparse, dup, strT, mixedLen, ...oddOne,
    shuffled: shuffled(r30, 7), descending: r60.slice().reverse(), empty: [], allOdd: ODD_T.map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 })),
  }
}
function outcome(fn) {
  try { return { ok: fn() } } catch (e) { return { threw: e?.constructor?.name ?? String(e) } }
}

afterEach(() => { vi.restoreAllMocks() })

describe('custom-intraday resample: one pass, the same bars', () => {
  it('E1 identical to the previous implementation over every input and spec (resampleForSpec and resampleIntradaySession)', () => {
    const ins = inputs()
    let compared = 0
    for (const [name, rows] of Object.entries(ins)) {
      for (const spec of SPECS) {
        expect(outcome(() => resampleForSpec(rows, spec)), `${name} ${JSON.stringify(spec)}`).toEqual(outcome(() => refResampleForSpec(rows, spec)))
        expect(outcome(() => resampleIntradaySession(rows, spec.minutes, { anchorMin: spec.anchorMin ?? undefined })), `${name} session ${spec.minutes}`)
          .toEqual(outcome(() => refResampleIntradaySession(rows, spec.minutes, { anchorMin: spec.anchorMin ?? undefined })))
        compared++
      }
    }
    expect(compared).toBe(Object.keys(ins).length * SPECS.length)
    // the two odd times the validity test must judge exactly as before ('' and a time just past the Date range) are real
    // checks: the previous implementation answers bars for them (it does not throw), with and without the regular filter
    for (const t of ['', 8.64e12 + 1]) {
      for (const spec of SPECS) expect('ok' in outcome(() => refResampleForSpec(ins[`odd${ODD_T.indexOf(t)}`], spec)), `${String(t)} ${JSON.stringify(spec)}`).toBe(true)
    }
    // the inputs reach every branch: rows dropped, rows kept, extended rows dropped by a regular spec, the sort fallback
    expect(resampleForSpec(ins.r30, SPECS[0]).length).toBeGreaterThan(5)
    expect(resampleForSpec(ins.r30, SPECS[1]).length).toBeGreaterThan(resampleForSpec(ins.r30, SPECS[0]).length)
  })

  it('E2 (red first) a regular resample builds no Date per base row', () => {
    const rows = sessionRows(30, DAYS)
    resampleForSpec(rows, SPECS[0])                     // the ET-offset memo warms its days first
    const Real = globalThis.Date
    let built = 0
    globalThis.Date = class extends Real { constructor(...a) { super(...a); built++ } }
    try {
      resampleForSpec(rows, SPECS[0])
    } finally {
      globalThis.Date = Real
    }
    expect(built, `${built} Dates for ${rows.length} rows`).toBeLessThan(rows.length / 10)
  })

  it('E3 (red first) already-ascending input is never sorted; E3b (control) unsorted input still is, and matches', () => {
    const rows = sessionRows(30, DAYS)
    const sort = vi.spyOn(Array.prototype, 'sort')
    resampleForSpec(rows, SPECS[0])
    resampleForSpec(rows, SPECS[1])
    expect(sort, 'ascending rows were sorted').not.toHaveBeenCalled()
    const mixed = shuffled(rows, 3)
    const out = resampleForSpec(mixed, SPECS[0])
    expect(sort).toHaveBeenCalled()
    sort.mockRestore()
    expect(out).toEqual(refResampleForSpec(mixed, SPECS[0]))
  })
})

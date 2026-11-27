// app/src/components/chart/engine/secondaryBars.etWhenMemo.test.js
//
// ─── offSessionRowOf READS ET WEEKDAY AND MINUTE FROM barTime's MEMO, NOT ONE formatToParts PER ROW (2026-11-26) ─────
//
// #2801's upgrade capture: a 19,200-row benchmark page's landing task spent 29 ms in `_etWhen`, one `formatToParts` per
// base row. It now reads barTime's per-UTC-day ET offset. The old reading is copied below as the reference:
//   W1 random instants 2018-2032 (arbitrary seconds), DST days minute by minute, weekends, midnight and the 04:00 /
//      20:00 edges: the refusal words (weekday and HH:MM included) or null, identical, on three specs
//   W2 the cost: judging a 30-day page makes at most two Intl reads per UTC day; the reference makes one per row
import { describe, it, expect } from 'vitest'
import { offSessionRowOf } from './secondaryBars'
import { isRegularSessionSpec } from '../../../utils/resampleBars'
import { isRthBar } from '../barTime'

// ── THE OLD READING, verbatim: the reference ────────────────────────────────────────────────────────────────────────
const REF_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})
function refEtWhen(t) {
  const parts = REF_PARTS.formatToParts(new Date(t * 1000))
  const get = (type) => (parts.find((p) => p.type === type) || {}).value
  const h = Number(get('hour')) % 24
  return { wd: get('weekday'), min: h * 60 + Number(get('minute')) }
}
const WEEKEND = new Set(['Sat', 'Sun'])
function refOffSessionRowOf(baseBars, spec) {
  const step = Number(spec.base)
  const regular = isRegularSessionSpec(spec)
  const anchor = Number.isFinite(spec.anchorMin) ? spec.anchorMin : 570
  let pending = null
  let sawRegular = false
  for (const b of baseBars) {
    if (!b || typeof b.t !== 'number') continue
    const { wd, min } = refEtWhen(b.t)
    if (WEEKEND.has(wd) || min < 240 || min >= 1200 || (((min - anchor) % step) + step) % step !== 0) {
      const words = `a ${step}-minute bar at ${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')} ET on a ${wd}`
      if (regular && !WEEKEND.has(wd) && !isRthBar(b.t)) { if (pending === null) pending = words; continue }
      return words
    }
    if (regular && isRthBar(b.t)) sawRegular = true
  }
  return regular && !sawRegular ? pending : null
}

const SPECS = [
  { kind: 'intradaySession', base: '1', minutes: 2, anchorMin: 240 },      // every minute on the grid: the window and the weekend judge
  { kind: 'intradaySession', base: '60', minutes: 240, anchorMin: 240 },   // extended 4h on the 60m clock grid
  { kind: 'intradaySession', base: '15', minutes: 45, anchorMin: 570 },    // regular 45m: the pending rule
]
const utc = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000

describe('offSessionRowOf reads ET weekday and minute from barTime\'s memo: identical words, a cost per day', () => {
  it('W1 random instants, DST days, weekends, midnight and the edges: identical words (or null), three specs', () => {
    let s = 112620261
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    const ts = Array.from({ length: 3000 }, () => Math.floor(utc('2018-01-01') + rnd() * (utc('2032-12-31') - utc('2018-01-01'))))
    for (const iso of ['2025-03-09', '2025-11-02', '2026-03-08', '2026-11-01']) {
      for (let m = 0; m < 3 * 1440; m += 7) ts.push(utc(iso) - 86400 + m * 60)                  // Sat..Mon around each
    }
    for (let d = 0; d < 40; d++) {
      const day = utc('2026-01-05') + d * 9 * 86400
      for (const em of [0, 1, 59, 60, 239, 240, 241, 570, 1199, 1200, 1201, 1439]) for (const off of [4, 5]) ts.push(day + off * 3600 + em * 60)
    }
    let words = 0
    for (const spec of SPECS) {
      for (const t of ts) {
        const page = [{ t, o: 1, h: 1, l: 1, c: 1, v: 1 }]
        const want = refOffSessionRowOf(page, spec)
        if (want) words += 1
        expect(offSessionRowOf(page, spec), `${spec.base}/${spec.anchorMin} t=${t}`).toBe(want)
      }
    }
    expect(words, 'the draw refused rows by name (weekday and time in the words)').toBeGreaterThan(1000)
  }, 60000)

  it('W2 the cost: at most two Intl reads per UTC day for a 30-day page (the reference: one per row)', () => {
    const page = []
    const start = utc('2034-01-09')                                           // days no other case asked about (no DST change)
    for (let d = 0, n = 0; n < 30; d++) {                                      // 30 WEEKDAYS: a weekend row refuses the page
      const wd = new Date((start + d * 86400) * 1000).getUTCDay()
      if (wd === 0 || wd === 6) continue
      n += 1
      for (let m = 240; m < 1200; m += 60) page.push({ t: start + d * 86400 + 5 * 3600 + m * 60, o: 1, h: 1, l: 1, c: 1, v: 1 })
    }
    const spec = SPECS[1]
    const proto = Intl.DateTimeFormat.prototype
    const real = proto.formatToParts
    let reads = 0
    proto.formatToParts = function formatToParts(...a) { reads += 1; return real.apply(this, a) }
    let got, newReads, want
    try {
      got = offSessionRowOf(page, spec)
      newReads = reads
      reads = 0
      want = refOffSessionRowOf(page, spec)
    } finally { proto.formatToParts = real }
    expect(got).toBe(want)
    expect(got, 'a page on the grid, weekdays only: nothing refused').toBe(null)
    expect(reads, 'the control: the reference reads once per row').toBe(page.length)
    const utcDays = new Set(page.map((b) => Math.floor(b.t / 86400))).size
    expect(newReads).toBeLessThanOrEqual(2 * utcDays)
  })
})

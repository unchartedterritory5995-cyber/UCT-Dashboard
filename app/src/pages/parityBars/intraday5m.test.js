// ─── THE INTRADAY PARITY FIXTURE IS DATA A GATE DEPENDS ON ──────────────────
//
// `ramp200.json` is 200 DAILY bars. VWAP is gated to `VWAP_TFS = {1,5,15,30,60}`
// (`StockChart.jsx:559`), so a VWAP parity case measured against it renders an
// EMPTY chart on BOTH sides and reports 0 changed pixels forever. That is a gate
// that cannot fail — the exact class the whole parity runbook exists to prevent.
// `intraday5m.json` is the fixture that makes B3 Task 8's VWAP gate real.
//
// These assertions are what stop somebody regenerating it, and they are also the
// PROOF that the fixture can see what it exists to see: that UTC-calendar-day
// bucketing and ET-session bucketing produce MATERIALLY DIFFERENT numbers on
// this series. If they agreed here, the fixture would be wrong and every VWAP
// number measured against it would prove nothing — including the 2,590 changed
// pixels `VWAP_SESSION_ANCHOR` was decided on.
//
// ⚠️ `computeVWAP` moved from the first bucketing to the second on 2026-08-03
// (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`). The fixture did not
// change one byte — which is the whole reason the two oracles below could be
// re-pointed without re-baselining anything.
//
// The ET wall-clock is read from the PLATFORM tz database via `Intl`, never from
// the generator's own arithmetic. `tools/gen_intraday_fixture.py` writes the
// timestamps from hard-coded UTC offsets (so it needs no `tzdata` on Windows);
// this file is the independent check that those offsets were the right ones.
import { describe, it, expect } from 'vitest'
import fixture from './intraday5m.json'
import { computeVWAP } from '../../components/chart/indicators'

const bars = fixture.bars

/** The bucket `computeVWAP` used until `VWAP_SESSION_ANCHOR` — UTC calendar day. */
const utcDay = (t) => {
  const d = new Date(t * 1000)
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
}

const _ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
})
const etParts = (t) => _ET.formatToParts(new Date(t * 1000))
  .reduce((a, p) => ({ ...a, [p.type]: p.value }), {})
/** The bucket the shipped `computeVWAP` uses — ET calendar day. */
const etDay = (t) => { const p = etParts(t); return `${p.year}-${p.month}-${p.day}` }
const etHour = (t) => Number(etParts(t).hour) % 24   // Intl can render midnight as "24"

/** Cumulative VWAP bucketed by an arbitrary key function — the shared oracle
 *  both bucketings are measured with, so neither gets a bespoke implementation
 *  that could be wrong in its own private way. */
const vwapBy = (key) => {
  let pv = 0, vol = 0, cur = null
  return bars.map((b) => {
    const k = key(b.t)
    if (k !== cur) { pv = 0; vol = 0; cur = k }
    pv += ((b.h + b.l + b.c) / 3) * b.v
    vol += b.v
    return pv / vol
  })
}

const firstIndexWhere = (fn) => bars.findIndex((b, i) => fn(b, i))

describe('the intraday parity fixture (B3 carry #4)', () => {
  it('is 5-minute bars with NUMERIC unix-second timestamps', () => {
    expect(fixture.name).toBe('intraday5m')
    expect(fixture.tf).toBe('5')
    expect(bars.length).toBeGreaterThan(400)
    for (const b of bars) {
      expect(typeof b.t, 'computeVWAP does new Date(t*1000) — a date STRING yields NaN').toBe('number')
      expect(Number.isInteger(b.t)).toBe(true)
      for (const k of ['o', 'h', 'l', 'c', 'v']) {
        expect(Number.isFinite(b[k]), `bar field ${k} is not finite`).toBe(true)
      }
      expect(b.h).toBeGreaterThanOrEqual(Math.max(b.o, b.c))
      expect(b.l).toBeLessThanOrEqual(Math.min(b.o, b.c))
      expect(b.v, 'a zero-volume bar leaves a VWAP gap the baseline bakes in').toBeGreaterThan(0)
    }
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].t, `bars must be strictly ascending at ${i}`).toBeGreaterThan(bars[i - 1].t)
    }
    // Exactly 5 minutes apart INSIDE a session; the only larger steps are the
    // overnight/weekend gaps, and there must be some (the daily fixture has none).
    const gaps = bars.slice(1).map((b, i) => b.t - bars[i].t)
    expect(new Set(gaps.filter(g => g === 300)).size).toBe(1)
    expect(gaps.filter(g => g > 300).length, 'no overnight gap — this is one long session').toBe(2)
  })

  it('spans THREE ET trading sessions, so VWAP has something to reset between', () => {
    const etDays = [...new Set(bars.map(b => etDay(b.t)))]
    expect(etDays.length, 'a single-day fixture cannot see a session reset').toBe(3)
    // …and every session has the identical wall-clock shape, so a difference
    // between them can only be the timezone offset, never the bars.
    const hoursOf = (d) => bars.filter(b => etDay(b.t) === d).map(b => etHour(b.t))
    expect(hoursOf(etDays[1])).toEqual(hoursOf(etDays[0]))
    expect(hoursOf(etDays[2])).toEqual(hoursOf(etDays[0]))
  })

  it('is EXTENDED HOURS, 04:00 through 20:00 ET — spec §9.1\'s first session case', () => {
    // Regular hours (09:30–16:00 ET) are ALWAYS inside one UTC day, which is
    // exactly why no unit test ever caught the bucketing bug. A fixture without
    // pre- and post-market bars cannot express it.
    const hours = bars.map(b => etHour(b.t))
    expect(Math.min(...hours)).toBe(4)
    expect(Math.max(...hours)).toBe(20)
    expect(hours.filter(h => h < 9).length, 'no pre-market bars').toBeGreaterThan(0)
    expect(hours.filter(h => h >= 16).length, 'no post-market bars').toBeGreaterThan(0)
  })

  it('crosses UTC MIDNIGHT inside a session — and the ET hour that trips it MOVES', () => {
    // Spec §9.1's two mandatory session cases are the SAME phenomenon here.
    // EDT is UTC-4, so 20:00 ET is 00:00 UTC the next day; EST is UTC-5, so the
    // same boundary lands at 19:00 ET. Both appear in this one fixture.
    const crossings = []
    for (let i = 1; i < bars.length; i++) {
      if (utcDay(bars[i].t) !== utcDay(bars[i - 1].t) && etDay(bars[i].t) === etDay(bars[i - 1].t)) {
        crossings.push({ i, hour: etHour(bars[i].t), zone: etParts(bars[i].t).timeZoneName })
      }
    }
    expect(crossings.length, 'no MID-SESSION UTC-midnight crossing').toBeGreaterThanOrEqual(2)
    const byZone = new Map(crossings.map(c => [c.zone, c.hour]))
    expect([...byZone.keys()].sort(), 'the fixture must span EDT and EST').toEqual(['EDT', 'EST'])
    expect(byZone.get('EDT'), 'EDT (UTC-4) must trip at 20:00 ET').toBe(20)
    expect(byZone.get('EST'), 'EST (UTC-5) must trip at 19:00 ET').toBe(19)
  })

  it('VWAP computes a finite value on EVERY bar', () => {
    const out = computeVWAP(bars)
    expect(out).toHaveLength(bars.length)
    expect(out.every(p => Number.isFinite(p.value))).toBe(true)
    // Bar-for-bar it IS the ET-session bucketing (`VWAP_SESSION_ANCHOR`), fed
    // through the SAME `vwapBy` oracle the two bucketings are compared with, so
    // the shipped function is not being checked against a private lookalike.
    const et = vwapBy(etDay)
    out.forEach((p, i) => expect(p.value).toBeCloseTo(et[i], 9))
    // …and it is NOT the retired one, on the bars where they disagree — without
    // this the assertion above would pass on a fixture where both agree.
    const utc = vwapBy(utcDay)
    const apart = out.filter((p, i) => Math.abs(p.value - utc[i]) > 0.01).length
    expect(apart, 'the two bucketings agree everywhere — the fixture pins nothing').toBe(207)
  })

  it('the accumulator resets at ET SESSION OPENS, and at nothing else', () => {
    const out = computeVWAP(bars)
    const tp = (b) => (b.h + b.l + b.c) / 3
    let resets = 0
    for (let i = 1; i < bars.length; i++) {
      const opensSession = etDay(bars[i].t) !== etDay(bars[i - 1].t)
      if (opensSession) {
        // The first bar of a session is its own VWAP: that bar's typical price
        // alone. That collapse is the tell the accumulator was wiped.
        expect(out[i].value, `bar ${i} opens a session but did not reset`).toBeCloseTo(tp(bars[i]), 9)
        resets++
      } else {
        // The half that used to be false. A UTC-day boundary MID-SESSION must
        // no longer wipe anything — that was the $14.45.
        expect(out[i].value, `bar ${i} reset mid-session`).not.toBeCloseTo(tp(bars[i]), 6)
      }
    }
    expect(resets, 'no ET session boundary in the fixture').toBe(2)
    // The negative half is only load-bearing if there ARE mid-session UTC
    // boundaries to be wrong about.
    const midSession = bars.filter((b, i) =>
      i > 0 && utcDay(b.t) !== utcDay(bars[i - 1].t) && etDay(b.t) === etDay(bars[i - 1].t)).length
    expect(midSession, 'no mid-session UTC boundary — the loop above proves nothing').toBe(3)
  })

  // ── THE POINT OF THE WHOLE FIXTURE ────────────────────────────────────────
  // A fixture on which UTC-day and ET-session bucketing agree would make Task 8's
  // gate meaningless: the migration could silently "fix" or silently keep the bug
  // and the number would be 0 either way. These two cases are the proof it can
  // tell them apart, in both directions.

  it('DISTINGUISHES UTC-day from ET-session bucketing — a whole session carries over', () => {
    const utc = vwapBy(utcDay)
    const et = vwapBy(etDay)

    // The EST post-market bars (19:00–20:00 ET) already opened the NEXT UTC day,
    // so the following trading day's 04:00 ET open is NOT a UTC-day boundary and
    // never resets: the whole session inherits the previous evening's volume.
    const openIdx = firstIndexWhere((b, i) =>
      i > 0 && etDay(b.t) !== etDay(bars[i - 1].t) && utcDay(b.t) === utcDay(bars[i - 1].t))
    expect(openIdx, 'no session opens inside a UTC day — the carry-over is absent').toBeGreaterThan(0)
    expect(etHour(bars[openIdx].t)).toBe(4)

    // At that open the two bucketings are far apart, and stay apart for the whole
    // session — the divergence is a session-long stretch, not one bar.
    expect(Math.abs(utc[openIdx] - et[openIdx])).toBeGreaterThan(5)
    const sessionDay = etDay(bars[openIdx].t)
    const diverged = bars
      .map((b, i) => (etDay(b.t) === sessionDay && Math.abs(utc[i] - et[i]) > 0.5 ? i : -1))
      .filter(i => i >= 0)
    expect(diverged.length, 'the two bucketings agree across the carried-over session').toBeGreaterThan(100)
  })

  it('…and in the other direction: UTC splits sessions ET would have left whole', () => {
    const utc = vwapBy(utcDay)
    const et = vwapBy(etDay)
    const resets = (key) => bars.reduce(
      (acc, b, i) => (i === 0 || key(b.t) !== key(bars[i - 1].t) ? acc + 1 : acc), 0)
    // 5 UTC buckets over 3 ET sessions.
    expect(resets(utcDay)).toBeGreaterThan(resets(etDay))
    // Every MID-SESSION UTC split is materially wrong, by more than a rounding
    // artefact — that is what makes the bug worth a decision rather than a shrug.
    for (let i = 1; i < bars.length; i++) {
      if (utcDay(bars[i].t) !== utcDay(bars[i - 1].t) && etDay(bars[i].t) === etDay(bars[i - 1].t)) {
        expect(Math.abs(utc[i] - et[i]),
          `bar ${i} splits mid-session but the two bucketings agree`).toBeGreaterThan(1)
      }
    }
  })
})

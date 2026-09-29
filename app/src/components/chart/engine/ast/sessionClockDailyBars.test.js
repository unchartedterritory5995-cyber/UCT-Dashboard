// ─── Q-T1: THE SESSION CLOCK ON THE PRODUCT'S OWN DAILY BARS ─────────────────
//
// `time(timeframe.period, "0930-1000:1234567", "GMT-4")` answered `na` on EVERY
// daily bar at the member door, while TradingView answers in-session on EDT days
// and `na` on EST days (`docs/pine/vendor-harness/probes-2026-09-28/READINGS.md`,
// Q-T1: 5,308 of 8,473 SPY 1D bars wrong on B08, first at bar 45, 1993-04-05).
//
// ⭐ WHY `pineVocabularyWave.test.js` NEVER SAW IT. Its `againstCapture` feeds the
// vendor's bars VERBATIM — `t` is the vendor's unix-second session open. The
// product's `/api/bars` serves a daily bar keyed by an ISO DATE, and
// `computeClock`'s unit gate blanked every time-derived column on a date: bare
// `time`, `hour`, `minute`, `dayofweek`, so every session read was `na`, the
// exchange-zone form included (S03 read `na` on all 300 bars of the harness 1D
// capture, never reported only because the probe's S15 row refuses the whole
// script at the door). The fixed-zone arithmetic was right; its input was blank.
//
// The rule (`barOpenInstant` in `indicators.js`, mirrored by
// `indicator_compute.bar_open_instant`): a daily bar keyed by a date OPENED at
// the regular session's open on that date, 09:30 America/New_York — the instant
// the vendor stamps as its `time` — and every time-derived column reads it.
//
// Every test here runs the PRODUCT'S bar shape (`ourSide.toProductBars`, the
// harness's own adapter), never the vendor's raw seconds.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'
import { barOpenInstant, computeClock } from '../../indicators.js'
import { toProductBars, isoDateIn } from '../__tests__/vendorHarness/ourSide.js'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const NY = 'America/New_York'
const load = (rel) => JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))

/** Translate the capture's own source and compare every named plot, bar by
 *  bar, over bars in the shape `shape(capture)` returns. */
function onBars(capture, bars, rows) {
  const t = translatePine(capture.source.text, { strict: true, basePeriod: 'D' })
  const titles = capture.study.plots.map((p) => p.title)
  const index = new Map(capture.bars.rows.map((r, i) => [r[0], i]))
  const byTitle = {}
  for (const o of (t.outputs || [])) {
    if (!rows.includes(o.title)) continue
    expect(o.formula, `${o.title}: refused — ${o.refusal && o.refusal.message}`).toBeTruthy()
    const col = titles.indexOf(o.title)
    const ours = interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined, { tf: 'D' })
    let bad = 0
    let first = null
    for (const r of capture.plotValues.rows) {
      const got = ours[index.get(r[0])]
      const want = r[1 + col]
      const same = (want === null || want === undefined)
        ? Number.isNaN(got)
        : Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))
      if (!same) { bad += 1; if (!first) first = { t: r[0], want, got } }
    }
    byTitle[o.title] = { bad, n: capture.plotValues.rows.length, first }
  }
  for (const title of rows) expect(byTitle[title], `${title}: no output`).toBeTruthy()
  return byTitle
}

const SESSION_ROWS = ['S03_na_0930_1600', 'S04_secs_0930_1600', 'S05_na_0930_1000_OR_window',
  'S06_secs_0930_1000', 'S07_na_1000_1100_EXCLUDES_OPEN', 'S08_secs_1000_1100',
  'S09_na_0930_1000_ALLDAYS', 'S10_na_0930_1000_MON_FRI_23456', 'S11_na_OR_GMTminus4_CORPUS_FORM',
  'S12_na_OR_GMTminus5', 'S13_na_OR_America_New_York', 'S14_na_OR_syminfo_timezone',
  'S16_na_0930_1030_IB_window', 'S17_secs_0930_1030', 'S18_dayofweek_for_S10',
  'S01_hour_MUST_VARY_ON_INTRADAY', 'S02_minute']

/** The session probe WITHOUT its S15 row: `"2000-0000"` refuses by name
 *  (`pineVocabularyWave.test.js` holds why), and one refused output does not
 *  make the other seventeen unreadable. */
function withoutS15(capture) {
  const src = capture.source.text.split('\n')
    .filter((l) => !l.startsWith('tJ = ') && !l.includes('S15_na')).join('\n')
  return { ...capture, source: { ...capture.source, text: src } }
}

describe('⭐⭐ a daily bar keyed by a DATE opens at its session open — the vendor\'s own `time`', () => {
  for (const rel of ['harness/vw-bool-cast-spy-1d-2026-09-28.json', 'vw-time-session-spy-1d-2026-09-27.json']) {
    it(`reproduces the vendor's bar time from the date alone on every row of ${rel}`, () => {
      const d = load(rel)
      expect(d.bars.timeUnit).toBe('unix-s')
      let edt = 0
      let est = 0
      for (const [t] of d.bars.rows) {
        expect(barOpenInstant(isoDateIn(t, NY), 'D'), `row t=${t}`).toBe(t)
        if (((t % 86400) + 86400) % 86400 === 13.5 * 3600) edt += 1
        else est += 1
      }
      // ⛔ NON-VACUITY: both halves of the year are in the capture, so a rule that
      // ignored DST (a fixed UTC offset) would miss one of them on every row.
      expect(d.bars.rows.length).toBeGreaterThan(8000)
      expect(edt).toBeGreaterThan(1000)
      expect(est).toBeGreaterThan(1000)
    })
  }

  it('⛔ reads a DAILY ISO date and nothing it cannot vouch for', () => {
    expect(barOpenInstant('1993-04-05', 'D')).toBe(734016600) // EDT: 13:30 UTC
    expect(barOpenInstant('1993-03-19', 'D')).toBe(732551400) // EST: 14:30 UTC
    expect(barOpenInstant('1993-04-05', 'W')).toBe(null)      // a week's key day is unmeasured
    expect(barOpenInstant('1993-04-05', 'M')).toBe(null)
    expect(barOpenInstant('1993-04-05', '60')).toBe(null)
    expect(barOpenInstant('1993-04-05', undefined)).toBe(null) // an absent tf never guesses daily
    expect(barOpenInstant(19930405, 'D')).toBe(null)          // the screen's YYYYMMDD int
    expect(barOpenInstant('2025-02-30', 'D')).toBe(null)      // not a date
    expect(barOpenInstant('1989-12-29', 'D')).toBe(null)      // below the unit floor
    expect(barOpenInstant(734016600, 'D')).toBe(734016600)    // an instant passes as itself
  })

  it('every clock column reads that instant: hour 9, minute 30, and `time` the open', () => {
    const cols = computeClock([{ t: '1993-04-05' }, { t: '1993-12-06' }], 'D', false)
    expect(Array.from(cols.hour)).toEqual([9, 9])
    expect(Array.from(cols.minute)).toEqual([30, 30])
    expect(Array.from(cols.time)).toEqual([734016600, 755188200])
    expect(Array.from(cols.dayofweek)).toEqual([2, 2])          // Mondays, Pine's day 2
    // A weekly series keyed the same way stays blank, all-or-nothing.
    expect(Number.isNaN(computeClock([{ t: '1993-04-05' }], 'W', false).hour[0])).toBe(true)
  })
})

describe('⭐⭐ Q-T1 — the session clock on the PRODUCT\'S daily bars, bar for bar', () => {
  it('B07 and B08 (the corpus `"GMT-4"` form) match on all 8,473 SPY 1D bars', () => {
    const d = load('harness/vw-bool-cast-spy-1d-2026-09-28.json')
    const res = onBars(d, toProductBars(d), ['B07_corpus_time_membership_first_bar', 'B08_t_is_na_CONTROL'])
    for (const [title, r] of Object.entries(res)) {
      expect(r.n).toBe(8473)
      expect(r.bad, `${title}: ${r.bad}/${r.n} bars differ, first ${JSON.stringify(r.first)}`).toBe(0)
    }
    // ⛔ NON-VACUITY: the vendor's B08 is in on some bars and out on others, so
    // "always na" and "never na" would each have failed this.
    const b08 = 1 + d.study.plots.map((p) => p.title).indexOf('B08_t_is_na_CONTROL')
    const inSession = d.plotValues.rows.filter((r) => r[b08] === 0).length
    expect(inSession).toBeGreaterThan(1000)
    expect(d.plotValues.rows.length - inSession).toBeGreaterThan(1000)
  })

  for (const [rel, min] of [['vw-time-session-spy-1d-2026-09-27.json', 8000], ['harness/vw-time-session-spy-1d-2026-09-28.json', 300]]) {
    it(`S01–S14 and S16–S18 match on every bar of ${rel}`, () => {
      const d = withoutS15(load(rel))
      const res = onBars(d, toProductBars(d), SESSION_ROWS)
      for (const [title, r] of Object.entries(res)) {
        expect(r.n).toBeGreaterThanOrEqual(min)
        expect(r.bad, `${title}: ${r.bad}/${r.n} bars differ, first ${JSON.stringify(r.first)}`).toBe(0)
      }
    })
  }

  it('⛔ CONTROL — the same probe on the screen\'s `YYYYMMDD` ints still reads `na`, so the bars above went through the gate', () => {
    // The screen's stored daily bars are DATES as ints and stay behind the unit
    // gate. If this ever matched the vendor, the test above would no longer be
    // proving that the ISO date was TRANSLATED — only that something let it by.
    const d = load('harness/vw-bool-cast-spy-1d-2026-09-28.json')
    const asInts = toProductBars(d).map((b) => ({ ...b, t: Number(b.t.replace(/-/g, '')) }))
    const res = onBars(d, asInts, ['B08_t_is_na_CONTROL'])
    expect(res.B08_t_is_na_CONTROL.bad).toBeGreaterThan(5000)
  })
})

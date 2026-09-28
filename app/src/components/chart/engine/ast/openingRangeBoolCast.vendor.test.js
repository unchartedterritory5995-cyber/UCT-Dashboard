// app/src/components/chart/engine/ast/openingRangeBoolCast.vendor.test.js
//
// ─── ⭐⭐ THE SCRIPT THE v5 IMPLICIT BOOL CAST WAS FOUND ON, HELD BAR BY BAR ──
//
// `corpus/committed/opening-range-initial-balance-opening-price__4a7416ab01.pine`
// (v5) attaches at the member door since `time(tf, session, tz)` landed
// (`pineVocabularyWave.test.js`). Its opening price is
//
//     opening := OR_t and not(OR_t[1]) ? open : opening[1]
//
// with `OR_t = time(timeframe.period, "0930-1000:1234567", "GMT-4")` — a
// TIMESTAMP, `na` outside the session. Pine v5 reads a number in a bool context
// as `na`/0 → false (`implicitBoolCast` in pine.js). This door read it as a bare
// `&&`/`!`, which carries `na` forward, so `OR_t[1]` being `na` on the session's
// first bar made the whole test `na` and the plot never left its seed:
// **0 of 300 bars finite** on the SPY 60m capture, where TradingView draws a price.
//
// ⭐ THE ORACLE IS THE VENDOR'S OWN MEMBERSHIP, NOT OURS. No capture carries this
// script's plots, so the expected values are a Pine-v5 reference simulation of
// the script's own text, driven by the session membership TradingView itself
// plotted on the same bars (S11 = this script's exact `time()` call, S16 = its
// IB window) and by the capture's own OHLC. The door's membership is already
// held to those columns bar for bar in `pineVocabularyWave.test.js`; this file
// holds what the script BUILDS on it.
//
// ⚠️ WHAT THIS DOES NOT CLAIM: the door's recurrences are `accum(…, 250)`, so
// every level is `na` for the first 250 bars of a fetch and TradingView's is not.
// That is the engine's bounded-state warm-up (`PINE_STATE_WARMUP`), a separate
// and known property — on a 5,000-bar chart it is the oldest 5%. The comparison
// is exact on every bar the door computes, and the door is required to compute
// every bar after the warm-up.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const SOURCE = fs.readFileSync(path.join(REPO, 'corpus', 'committed',
  'opening-range-initial-balance-opening-price__4a7416ab01.pine'), 'utf8')
const WARMUP = 250
/** `orOpens` is read off the capture below, not assumed: on the EXTENDED-hours
 *  60m grid the bars open on the hour, so no bar OPENS inside 09:30-10:00 and
 *  TradingView answers `na` for the OR window on every one of them (S11 is never
 *  0 there). That capture therefore holds the other half — `na` where the
 *  vendor's membership says the opening price cannot have been set. */
const CAPTURES = [
  { rel: 'harness/vw-time-session-spy-60-rth-2026-09-28.json', orOpens: true },
  { rel: 'harness/vw-time-session-spy-60-ext-2026-09-28.json', orOpens: false },
]
/** The seven titled plots, in the order the script declares them. The script
 *  itself titles both mid lines "OR Low"/"IB Low" — a copy-paste in the source,
 *  kept verbatim because the title is the member's. */
const PLOTS = ['Opening price', 'OR High', 'OR Low', 'OR Low', 'IB High', 'IB Low', 'IB Low']

function load(rel) {
  const d = JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
  const titles = d.study.plots.map((p) => p.title)
  const col = (name) => {
    const i = titles.indexOf(name)
    expect(i, `${rel} carries no ${name}`).toBeGreaterThanOrEqual(0)
    const byTime = new Map(d.plotValues.rows.map((r) => [r[0], r[1 + i]]))
    return d.bars.rows.map((r) => byTime.get(r[0]))
  }
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  return { d, bars, col }
}

/** Pine v5 semantics of the script's own text, over vendor membership. */
function reference(bars, inOR, inIB) {
  const n = bars.length
  const opening = new Array(n).fill(NaN)
  const levels = (inS) => {
    const hi = new Array(n).fill(NaN)
    const lo = new Array(n).fill(NaN)
    for (let i = 0; i < n; i++) {
      // `X_is_first = X_in_session and not X_in_session[1]`
      const first = inS[i] && !(i > 0 && inS[i - 1])
      let h = first ? bars[i].h : (i > 0 ? hi[i - 1] : NaN)
      let l = first ? bars[i].l : (i > 0 ? lo[i - 1] : NaN)
      // `if high > X_h and X_in_session` — a comparison against na is false
      if (bars[i].h > h && inS[i]) h = bars[i].h
      if (bars[i].l < l && inS[i]) l = bars[i].l
      hi[i] = h; lo[i] = l
    }
    return { hi, lo, mid: hi.map((v, i) => (v + lo[i]) / 2) }
  }
  for (let i = 0; i < n; i++) {
    // `OR_t and not(OR_t[1])` under the v5 cast: a timestamp is true, na is false
    const cond = inOR[i] && !(i > 0 && inOR[i - 1])
    opening[i] = cond ? bars[i].o : (i > 0 ? opening[i - 1] : NaN)
  }
  const or = levels(inOR)
  const ib = levels(inIB)
  return [opening, or.hi, or.lo, or.mid, ib.hi, ib.lo, ib.mid]
}

describe('⭐⭐ opening range / initial balance — the v5 implicit bool cast, bar by bar', () => {
  for (const { rel, orOpens } of CAPTURES) {
    it(`matches a vendor-membership reference on every computed bar of ${rel}`, () => {
      const { bars, col } = load(rel)
      const s11 = col('S11_na_OR_GMTminus4_CORPUS_FORM')
      const s13 = col('S13_na_OR_America_New_York')
      const s05 = col('S05_na_0930_1000_OR_window')
      const s09 = col('S09_na_0930_1000_ALLDAYS')
      const s16 = col('S16_na_0930_1030_IB_window')
      // ⛔ NON-VACUITY OF THE ORACLE. S16 is the IB window in the EXCHANGE zone
      // with no day list, while the script asks for "GMT-4" and ":1234567". On
      // these bars those are the same question — GMT-4 agrees with New York on
      // every bar (no DST boundary inside the capture) and the all-days list
      // agrees with the default one — and that is asserted, not assumed.
      expect(s11).toEqual(s13)
      expect(s09).toEqual(s05)
      const inOR = s11.map((v) => v === 0)
      const inIB = s16.map((v) => v === 0)
      // …and the session opens inside the capture as often as it should.
      const opens = inOR.filter((x, i) => x && !(i > 0 && inOR[i - 1])).length
      if (orOpens) expect(opens).toBeGreaterThan(20)
      else expect(opens).toBe(0)

      const t = translatePine(SOURCE, { strict: true, basePeriod: '60' })
      expect(t.ok, t.refusal && t.refusal.message).toBe(true)
      const titled = t.outputs.filter((o) => o.title != null && o.formula)
      expect(titled.map((o) => o.title)).toEqual(PLOTS)
      const want = reference(bars, inOR, inIB)
      titled.forEach((o, k) => {
        // ⚠️ SEE THE KNOWN-DIVERGENCE CASE BELOW: where the OR never opens, the
        // opening price is a different defect (the `var` seed), not this cast.
        if (!orOpens && k === 0) return
        const got = Array.from(interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined,
          { tf: '60', newestBarIsForming: false }))
        let compared = 0
        for (let i = 0; i < bars.length; i++) {
          // Past the warm-up: `na` exactly where the reference is `na`, the
          // number where it is not. Inside it the door may only be `na` or right.
          if (i >= WARMUP) {
            expect(Number.isFinite(got[i]), `${o.title}#${k} bar ${i}: door ${got[i]}, reference ${want[k][i]}`)
              .toBe(Number.isFinite(want[k][i]))
          }
          if (!Number.isFinite(got[i])) continue
          compared += 1
          expect(Math.abs(got[i] - want[k][i]), `${o.title}#${k} bar ${i}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want[k][i])))
        }
        // ⛔ NOT OVER AN EMPTY SET: where the OR opens, every post-warm-up bar
        // carries a number, and all seven lines are compared on it.
        if (orOpens) expect(compared, `${o.title}#${k}`).toBeGreaterThanOrEqual(bars.length - WARMUP)
      })
    })
  }

  it('⚠️ KNOWN DIVERGENCE, NOT THE CAST: where the session never opens, the door reads the `var` seed', () => {
    // `var opening = 0.0` then `opening := cond ? open : opening[1]`. In Pine the
    // seed is NEVER observable: on bar 0 `opening[1]` is `na` and overwrites it,
    // so until the OR first opens the line is `na`. This door folds the pair into
    // `accum(0, cond ? open : self, 250)` — `self` at a window start is the SEED —
    // so a window in which the OR never opens reads 0.0. On the extended-hours
    // 60m grid no bar opens inside 09:30-10:00 (the vendor's own S11 is `na` on
    // every bar), so the door draws a flat 0.0 where TradingView draws nothing.
    // ⛔ This case PINS THE WRONG ANSWER ON PURPOSE, labelled as one, so the
    // divergence is on record and this test goes red the day the seed is fixed.
    // Before the cast the line was `na` on every bar of EVERY capture, which is
    // why it never showed: the cast exposed it, it did not cause it.
    const { bars, col } = load(CAPTURES[1].rel)
    const inOR = col('S11_na_OR_GMTminus4_CORPUS_FORM').map((v) => v === 0)
    const inIB = col('S16_na_0930_1030_IB_window').map((v) => v === 0)
    const want = reference(bars, inOR, inIB)[0]
    const t = translatePine(SOURCE, { strict: true, basePeriod: '60' })
    const f = t.outputs.find((o) => o.title === 'Opening price').formula
    const got = Array.from(interpret(parseFormula(f).ast, bars, {}, undefined, undefined,
      { tf: '60', newestBarIsForming: false }))
    expect(want.every((v) => !Number.isFinite(v))).toBe(true)
    expect(got.slice(WARMUP).every((v) => v === 0)).toBe(true)
  })

  it('⭐ the opening-price line is the one the cast repaired, and it now computes', () => {
    // The before/after in one assertion: the line's own test, rebuilt without the
    // cast, is `na` on every bar — the defect as it shipped. With it, the plot
    // computes on every bar past the warm-up.
    const { bars } = load(CAPTURES[0].rel)
    const t = translatePine(SOURCE, { strict: true, basePeriod: '60' })
    const f = t.outputs.find((o) => o.title === 'Opening price').formula
    expect(f).toMatch(/!= 0/)
    const values = Array.from(interpret(parseFormula(f).ast, bars, {}, undefined, undefined,
      { tf: '60', newestBarIsForming: false }))
    expect(values.slice(WARMUP).every(Number.isFinite)).toBe(true)
    // The uncast spelling of the same test propagates na on every bar.
    const uncast = f.replace(/ != 0\)/g, ')').replace(/ != 0/g, '')
    expect(uncast).not.toMatch(/!= 0/)
    const before = Array.from(interpret(parseFormula(uncast).ast, bars, {}, undefined, undefined,
      { tf: '60', newestBarIsForming: false }))
    expect(before.filter(Number.isFinite).length).toBe(0)
  })
})

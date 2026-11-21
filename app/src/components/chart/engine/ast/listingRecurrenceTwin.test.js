// app/src/components/chart/engine/ast/listingRecurrenceTwin.test.js
//
// ⭐⭐ (coordinator ruling 2026-11-20, (i)) — FROM THE LISTING, A RECURRENCE IS THE CHART LANE'S.
//
// From the listing (`historyFromListing`, ruling R-W) the chart lane runs a recurrence from bar 0 (`listingPass`, C12w),
// which is TradingView's own value: graded by the RDDT-from-listing captures (`vendorHarness.c12wListing.test.js`). The
// Python lane (`ast_interpret.py`) never ported that pass and answered the bounded window there, a DIFFERENT number:
// `nz(accum(close, self * 0.5 + close * 0.5, 6))` on bar 7 of the chart below is 85.05277 in this lane and 85.05684
// there. Now the Python lane withholds such a plot whole, by name (`var-origin:listing-pass`), and never draws the
// bounded window's number from the listing. Off the listing the two lanes agree bar for bar.
//
// ⛔ LIFT CONDITION: a server path that passes `historyFromListing` (none does: `pine_strategy_backtest.py` states it is
// always false) needs the full port of the listing pass to the Python lane, option (ii); until then the code stands.
//
// This rail WRITES `tests/fixtures/ast/listing_recurrence_twin.json` (LISTING_RECURRENCE_TWIN_WRITE=1) and holds it byte
// for byte; `tests/test_pine_listing_recurrence_fail_closed.py` reads it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { interpret, CHART_CLOCK_WITHHELD, CHART_CLOCK_WHOLE, LISTING_PASS_CHART_LANE } from './interpret'

const FIXTURE = path.resolve(process.cwd(), '..', 'tests', 'fixtures', 'ast', 'listing_recurrence_twin.json')
const S = (name) => ({ type: 'series', name })
const num = (value) => ({ type: 'num', value })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const SENTINEL = -12345.25
const CHART = { tf: 'D', newestBarIsForming: false, barIndexAbsolute: true, varOriginAbsolute: true }

function weekdays(start, count) {
  const out = []
  for (let d = new Date(`${start}T00:00:00Z`); out.length < count; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(d.toISOString().slice(0, 10))
  }
  return out
}
/** The truth proxy's seeded random walk, 4 decimals (the window-edge rail's, so bar 7 is the bar measured there). */
function walk(days, seed) {
  let s = seed >>> 0
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
  let p = 100
  return days.map((t) => {
    const o = p
    const c = Math.max(1, o * (1 + (rnd() - 0.5) * 0.04))
    const h = Math.max(o, c) * (1 + rnd() * 0.01)
    const l = Math.min(o, c) * (1 - rnd() * 0.01)
    p = c
    return { t, o: +o.toFixed(4), h: +h.toFixed(4), l: +l.toFixed(4), c: +c.toFixed(4), v: Math.round(1e6 * (0.5 + rnd())) }
  })
}
const BARS = walk(weekdays('2022-01-03', 360), 7).slice(100, 190)
const half = (bind) => op('+', op('*', S(bind), num(0.5)), op('*', S('close'), num(0.5)))
const asNulls = (col) => Array.from(col || []).map((v) => (Number.isFinite(v) ? v : null))

const CASES = {
  // the recurrence the lanes disagreed on
  accum: call('nz', call('accum', S('close'), half('self'), num(6)), num(SENTINEL)),
  // CONTROL: no recurrence in the tree, so from the listing the Python lane computes it
  sma: call('nz', call('sma', S('close'), num(5)), num(SENTINEL)),
}

function build() {
  const cases = Object.entries(CASES).map(([name, tree]) => ({
    name,
    tree,
    off: asNulls(interpret(tree, BARS, {}, undefined, undefined, CHART)),
    listing: asNulls(interpret(tree, BARS, {}, undefined, undefined, { ...CHART, historyFromListing: true })),
  }))
  return {
    _about: 'Ruling (i), 2026-11-20. WRITTEN by app/src/components/chart/engine/ast/listingRecurrenceTwin.test.js '
      + '(LISTING_RECURRENCE_TWIN_WRITE=1), READ by tests/test_pine_listing_recurrence_fail_closed.py. Per case: `off` '
      + '(this lane off the listing, which the Python lane must equal) and `listing` (this lane from the listing: for a '
      + 'recurrence, the listing pass the Python lane does not run, so it withholds the plot by name instead).',
    chart: CHART,
    code: LISTING_PASS_CHART_LANE,
    bars: BARS,
    cases,
  }
}

let _text = null
const text = () => {
  if (_text === null) {
    _text = `${JSON.stringify(build(), null, 1)}\n`
    if (process.env.LISTING_RECURRENCE_TWIN_WRITE === '1') fs.writeFileSync(FIXTURE, _text)
  }
  return _text
}

describe('(i) from the listing a recurrence is the chart lane\'s; the Python lane withholds it by name', () => {
  it('⭐ the fixture regenerates byte for byte (LISTING_RECURRENCE_TWIN_WRITE=1 rewrites it)', () => {
    const want = text()
    expect(fs.existsSync(FIXTURE) ? fs.readFileSync(FIXTURE, 'utf8') : '').toBe(want)
  })
  it('bar 7: this lane\'s listing pass is not the bounded window (the number the Python lane drew there)', () => {
    const c = JSON.parse(text()).cases.find((x) => x.name === 'accum')
    expect(c.listing[7]).toBeCloseTo(85.05277, 4)
    expect(c.off[7]).toBeCloseTo(85.05684, 4)
    // and from the listing the chart lane draws every bar
    expect(c.listing.every((v) => v !== null && v !== SENTINEL)).toBe(true)
  })
  it('the control reads no recurrence: from the listing it is the same column as off it, past its warm-up', () => {
    const c = JSON.parse(text()).cases.find((x) => x.name === 'sma')
    for (let i = 4; i < BARS.length; i++) expect(c.listing[i], `bar ${i}`).toBe(c.off[i])
  })
  it('the code is a whole withholding with a sentence that states its lift condition', () => {
    expect(CHART_CLOCK_WHOLE).toContain(LISTING_PASS_CHART_LANE)
    const sentence = CHART_CLOCK_WITHHELD[LISTING_PASS_CHART_LANE]('D')
    expect(sentence).toMatch(/historyFromListing|listing/)
    expect(sentence).toMatch(/What would settle it/)
  })
})

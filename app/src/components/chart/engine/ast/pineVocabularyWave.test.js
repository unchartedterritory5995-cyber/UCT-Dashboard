// ─── THE 2026-09-27 VOCABULARY WAVE — two names that needed no new column ────
//
// Census: `docs/pine/capture-queue-2026-09-27.md` and PARITY-PROGRAMME.md's
// dated section. Of the vocabulary walls standing at the member door, two were
// implementable from evidence already on disk, and both are IDENTITIES onto a
// column this engine already carries — so neither adds a table name, and
// neither moves a frozen per-ast digest or the Python lane:
//
//   1. `ta.vwap(hlc3)` / v4 `vwap(hlc3)` → `vwap()`. VENDOR-PINNED:
//      `tests/fixtures/vendor/groupb-round-max-vwap-spy-1d-2026-09-10.json`.
//   2. `year|month|dayofmonth|dayofweek|hour|minute(time)` → the bare clock
//      field. PINE-REFERENCE-PINNED (`year(time, timezone)`, timezone defaulting
//      to `syminfo.timezone`, is the bare `year` by definition); the confirmation
//      capture is OWED — probe `tools/visual_conformance/probes/vw-clock-vwap.pine`.
//
// Each rail also pins the NEAR MISS that must keep refusing, because "we serve
// this" and "we refuse this" are both facts, and only a pin that asserts both can
// tell a narrowing from a silent widening.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const V6 = '//@version=6\nindicator("p")\n'
const V4 = '//@version=4\nstudy("p")\n'

const tr = (src) => translatePine(src, { strict: true })
const formulaOf = (src) => {
  const t = tr(src)
  const o = (t.outputs || [])[t.selected]
  return { t, formula: o ? o.formula : null }
}

describe('ta.vwap(hlc3) is the zero-argument vwap — vendor-pinned', () => {
  const capture = JSON.parse(fs.readFileSync(
    path.join(VENDOR, 'groupb-round-max-vwap-spy-1d-2026-09-10.json'), 'utf8'))
  const reading = capture.ta_vwap_default_source

  it('the capture says what this rail relies on (read, not restated)', () => {
    // The identity: hlc3 written out equals the bare form on every bar read.
    expect(reading.vwap_hlc3_minus_vwap_noarg.all_zero).toBe(true)
    expect(reading.vwap_hlc3_minus_vwap_noarg.bars_read).toBeGreaterThanOrEqual(40)
    // The control: another source is NOT the same column.
    expect(reading.vwap_close_minus_vwap_noarg.all_zero).toBe(false)
  })

  it('ta.vwap(hlc3), the spelled-out typical price, and v4 vwap(hlc3) all read back as vwap()', () => {
    const bare = formulaOf(`${V6}plot(ta.vwap)`)
    expect(bare.formula).toBe('vwap()')
    for (const src of [
      `${V6}plot(ta.vwap(hlc3))`,
      `${V6}plot(ta.vwap((high + low + close) / 3))`,
      `${V4}plot(vwap(hlc3))`,
    ]) {
      const got = formulaOf(src)
      expect(got.t.ok, src).toBe(true)
      expect(got.formula, src).toBe(bare.formula)
    }
  })

  it('any other source still refuses, by name, and says which spelling works', () => {
    for (const src of [`${V6}plot(ta.vwap(close))`, `${V4}plot(vwap(high))`]) {
      const t = tr(src)
      expect(t.ok, src).toBe(false)
      expect(t.refusal.guard, src).toBe('pine:arity')
      expect(t.refusal.message, src).toMatch(/was given a source/)
      expect(t.refusal.message, src).toMatch(/ta\.vwap\(hlc3\)/)
    }
  })

  it('the anchored two-argument form is untouched — still the arity refusal', () => {
    const t = tr(`${V6}plot(ta.vwap(hlc3, timeframe.change("D")))`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:arity')
    expect(t.refusal.message).toMatch(/was given 2 arguments/)
  })
})

describe('clock(time) is the bare clock field — Pine-reference-pinned, capture owed', () => {
  const FIELDS = ['year', 'month', 'dayofmonth', 'dayofweek', 'hour', 'minute']

  it('each field(time) reads back as exactly the bare field', () => {
    for (const f of FIELDS) {
      const bare = formulaOf(`${V6}plot(${f})`)
      const called = formulaOf(`${V6}plot(${f}(time))`)
      expect(bare.formula, f).toBe(f)
      expect(called.t.ok, f).toBe(true)
      expect(called.formula, f).toBe(bare.formula)
    }
  })

  it('the timenow form is unchanged (lastbar column), and dayofweek has none', () => {
    for (const f of ['year', 'month', 'dayofmonth', 'hour', 'minute']) {
      expect(formulaOf(`${V6}plot(${f}(timenow))`).formula, f).toBe(`lastbar${f}`)
    }
    const t = tr(`${V6}plot(dayofweek(timenow))`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
  })

  it('a different bar, a named zone and a versionless script still refuse', () => {
    const cases = [
      [`${V6}plot(year(time[1]))`, 'pine:builtin'],
      [`${V6}plot(hour(time, "America/New_York"))`, 'pine:text-value'],
      [`${V6}plot(year(time + 86400000))`, 'pine:builtin'],
      // No `//@version`: bare `time` is OUR seconds column, not Pine's, and the
      // units refusal fires before this door is reached.
      ['study("p")\nplot(year(time))', 'pine:builtin'],
    ]
    for (const [src, guard] of cases) {
      const t = tr(src)
      expect(t.ok, src).toBe(false)
      expect(t.refusal.guard, src).toBe(guard)
    }
  })

  it('the refusal names the forms that DO work', () => {
    const t = tr(`${V6}plot(month(time[1]))`)
    expect(t.refusal.message).toMatch(/`month\(time\)`/)
    expect(t.refusal.message).toMatch(/`month\(timenow\)`/)
  })
})

describe('a screener column the budget refuses is refused at the translate door (pine:budget)', () => {
  // Reached once `ta.vwap(hlc3)` translated: `26-spy-to-es-qqq-to-nq` wraps the
  // session-long `vwap()` in `sma(…, 3)`, which translated on the SCREENER lane
  // and then could not be saved (doorScorecard: "every script that translates can
  // be SAVED"). The guard is this module's; the reason is budget.js's.
  const screener = (src) => translatePine(src, { strict: false })

  it("screener lane: wrapping the session-long vwap refuses by name, with the budget's own reason", () => {
    const t = screener(`${V6}plot(ta.sma(ta.vwap, 3))`)
    expect(t.ok).toBe(false)
    expect(t.mode).toBe('screener')
    expect(t.refusal.guard).toBe('pine:budget')
    expect(t.refusal.message).toMatch(/nothing can be wrapped around it/)
  })

  it('the chart pane lane (strict / host) is untouched — the chart owns its window', () => {
    const t = tr(`${V6}plot(ta.sma(ta.vwap, 3))`)
    expect(t.mode).toBe('host')
    expect(t.ok).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('sma(vwap(), 3)')
  })

  it("an over-long plain window is NOT this guard's (it is a wider change, not taken here)", () => {
    const t = screener(`${V6}plot(ta.sma(close, 1000))`)
    const guards = [t.refusal, ...(t.outputs || []).map((o) => o.refusal)].filter(Boolean).map((r) => r.guard)
    expect(guards).not.toContain('pine:budget')
  })

  it('the control: the bare session vwap, and an ordinary window, still translate on the screener lane', () => {
    expect(screener(`${V6}plot(ta.vwap)`).ok).toBe(true)
    expect(screener(`${V6}plot(ta.sma(close, 3))`).ok).toBe(true)
  })
})

// ─── ⭐⭐ THE 2026-09-28 READINGS, HELD BAR BY BAR ────────────────────────────
//
// Each describe below takes a vendor capture, translates the SOURCE THE VENDOR
// RAN (`capture.source.text`, sha-checked against the probe when it was taken),
// evaluates every output this door produces over the capture's OWN bars, and
// compares against the vendor's plotted value on every bar — `na` where the
// vendor is `na`, the number where it is not. The `atrPine.vendor.test.js`
// pattern, applied to a whole probe at once.

/** Translate a capture's source and compare every named plot bar by bar.
 *  Returns `{ t, byTitle }` where `byTitle[title] = {bad, n, first}`, or
 *  `{refused: guard}` for an output the door refused. */
function againstCapture(rel, basePeriod) {
  const d = JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))
  const t = translatePine(d.source.text, { strict: true, basePeriod })
  const bars = d.bars.rows.map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }))
  const index = new Map(d.bars.rows.map((r, i) => [r[0], i]))
  const titles = d.study.plots.map((p) => p.title)
  const byTitle = {}
  for (const o of (t.outputs || [])) {
    if (!o.formula) { byTitle[o.title] = { refused: o.refusal && o.refusal.guard }; continue }
    const col = titles.indexOf(o.title)
    expect(col, `${o.title} is not a plot of ${rel}`).toBeGreaterThanOrEqual(0)
    const ours = interpret(parseFormula(o.formula).ast, bars, {}, undefined, undefined, { tf: basePeriod })
    let bad = 0
    let first = null
    for (const r of d.plotValues.rows) {
      const got = ours[index.get(r[0])]
      const want = r[1 + col]
      const same = (want === null || want === undefined)
        ? Number.isNaN(got)
        : Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want))
      if (!same) { bad += 1; if (!first) first = { t: r[0], want, got } }
    }
    byTitle[o.title] = { bad, n: d.plotValues.rows.length, first, formula: o.formula }
  }
  return { t, d, byTitle }
}

/** Every named row matches on every bar, and the capture is not vacuous. */
function expectRowsMatch(res, rows, minBars) {
  for (const title of rows) {
    const r = res.byTitle[title]
    expect(r, `${title}: this door produced no output for it`).toBeTruthy()
    expect(r.refused, `${title}: refused at ${r.refused}`).toBeUndefined()
    expect(r.n, `${title}: capture too short`).toBeGreaterThanOrEqual(minBars)
    expect(r.bad, `${title}: ${r.bad}/${r.n} bars differ, first ${JSON.stringify(r.first)} — ${r.formula}`).toBe(0)
  }
}

describe('⭐⭐ int(x) TRUNCATES TOWARD ZERO — vw-int-cast, I01–I09 on every bar', () => {
  const CAP = 'vw-int-cast-spy-1d-2026-09-27.json'
  const ROWS = ['I01_int_2p7', 'I02_int_neg2p7', 'I03_int_2p5', 'I04_int_neg2p5',
    'I05_int_3p5_CONTROL', 'I06_int_minus_TRUNC_series', 'I07_int_minus_FLOOR_series',
    'I08_int_minus_ROUND_series', 'I09_int_of_na_IS_NA']

  it('the capture discriminates: trunc is 0 on every bar, floor and round are NOT', () => {
    // ⛔ NON-VACUITY. If the series never went negative or never had a half,
    // all three candidates would agree and the capture could not have chosen.
    const d = JSON.parse(fs.readFileSync(path.join(VENDOR, CAP), 'utf8'))
    const titles = d.study.plots.map((p) => p.title)
    const col = (name) => 1 + titles.indexOf(name)
    const rows = d.plotValues.rows
    expect(rows.length).toBeGreaterThanOrEqual(200)
    expect(rows.every((r) => r[col('I06_int_minus_TRUNC_series')] === 0)).toBe(true)
    expect(rows.filter((r) => r[col('I07_int_minus_FLOOR_series')] !== 0).length).toBeGreaterThan(50)
    expect(rows.filter((r) => r[col('I08_int_minus_ROUND_series')] !== 0).length).toBeGreaterThan(50)
  })

  it('the door matches I01–I09 on every one of the 300 bars', () => {
    const res = againstCapture(CAP, 'D')
    expect(res.t.ok).toBe(true)
    expectRowsMatch(res, ROWS, 300)
  })

  it('the fractional series reads as `idiv(x, 1)`, and `int(na)` stays `na`', () => {
    expect(formulaOf(`${V6}plot(int(close / 3))`).formula).toBe('idiv(close / 3, 1)')
    expect(formulaOf(`${V6}plot(close + int(-2.7))`).formula).toBe('close + -2')
    const na = interpret(parseFormula(formulaOf(`${V6}plot(close + int(float(na)))`).formula).ast,
      [{ t: 1700000000, o: 1, h: 1, l: 1, c: 1, v: 1 }])
    expect(Number.isNaN(na[0])).toBe(true)
  })
})

describe('⭐⭐ timeframe.in_seconds(<literal>) — the measured constants, vw-time-tf T10–T15', () => {
  const ROWS = ['T10_in_seconds_1', 'T11_in_seconds_60', 'T12_in_seconds_D',
    'T13_in_seconds_W', 'T14_in_seconds_M', 'T15_in_seconds_12M']

  it('the capture carries the six constants the door is held to', () => {
    // Read, not restated: every bar of the 1D capture holds one value per row.
    const d = JSON.parse(fs.readFileSync(path.join(VENDOR, 'vw-time-tf-spy-1d-2026-09-27.json'), 'utf8'))
    const titles = d.study.plots.map((p) => p.title)
    const one = (t) => [...new Set(d.plotValues.rows.map((r) => r[1 + titles.indexOf(t)]))]
    expect(ROWS.map(one)).toEqual([[60], [3600], [86400], [604800], [2628003], [31536036]])
  })

  it('matches T10–T15 on every bar of the 1D capture and of the 60m capture', () => {
    expectRowsMatch(againstCapture('vw-time-tf-spy-1d-2026-09-27.json', 'D'), ROWS, 8000)
    expectRowsMatch(againstCapture('harness/vw-time-tf-spy-60-2026-09-28.json', '60'), ROWS, 100)
  })

  it('"12M" is exactly 12 × "M", and a code with no measured length still refuses', () => {
    expect(formulaOf(`${V6}plot(close + timeframe.in_seconds("3M"))`).formula).toBe(`close + ${3 * 2628003}`)
    const t = tr(`${V6}plot(close + timeframe.in_seconds("30S"))`)
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:builtin')
    expect(t.refusal.message).toMatch(/timeframe\.in_seconds/)
  })
})

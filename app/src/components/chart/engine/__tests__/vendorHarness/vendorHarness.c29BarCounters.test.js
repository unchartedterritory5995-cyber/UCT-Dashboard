// ─── ⭐⭐ C29 (C12w) — bar counters, from the listing ───────────────────────────
//
// Read off `vw-bar-counters-rddt-1d-2026-09-30.json` (probe `vw-bar-counters.pine`,
// NYSE:RDDT 1D FROM THE LISTING, 634 bars): TradingView's five counter spellings
// read bar_index + 1 (`var n = 0; n := n + 1`, `n += 1`, `ta.cum(1)`) and bar_index
// (`n := na(n[1]) ? 0 : n[1] + 1`, `var n = na; n := na(n) ? 0 : n + 1`), none `na`
// on bar 0. Through the member door, from the listing, every row is the vendor's on
// every bar — the two spellings that become one tree are told apart by the reading
// the translator writes into the switched mark (`interpret.js::readingSeed`).
// Behind the listing (the curtain default, ruling R-W) every counter is WITHHELD —
// `ta.cum(1)` included since 2026-11-09, by name (`running-total:window`).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide, withheldPlotsOf } from './ourSide'
import { compareCapture } from '../../../../../../../tools/vendor_harness/compare.mjs'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const cap = JSON.parse(fs.readFileSync(path.join(H, 'vw-bar-counters-rddt-1d-2026-09-30.json'), 'utf8'))
const vend = (() => {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => { if (f !== 'time') out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i])) })
  return out
})()
const ROWS = ['C01_var_n_plus_1', 'C02_na_hist_seeded_counter', 'C03_var_compound', 'C04_var_na_seed_counter',
  'C05_ta_cum_1', 'C06_n1_minus_bar_index', 'C07_n2_minus_bar_index']

describe('C29 — bar counters, from the listing, are TradingView\'s on every bar', () => {
  it('the capture: from the listing, bar_index + 1 and bar_index, never na on bar 0', () => {
    expect(cap.history.startsAtBar0).toBe(true)
    expect(vend.get('C00_bar_index_CONTROL')[0]).toBe(0)
    expect(vend.get('C06_n1_minus_bar_index').every((v) => v === 1)).toBe(true)
    expect(vend.get('C07_n2_minus_bar_index').every((v) => v === 0)).toBe(true)
    for (const t of ROWS) expect(vend.get(t)[0], t).not.toBe(null)
  })

  it('through the member door, from the listing: every row equals the vendor on all 634 bars', () => {
    // C06/C07 are constant (1 and 0) and the door hides a constant row by design;
    // read them `+ close * 0` (Pine's identity: close is never na on these bars).
    const src = cap.source.text.split('\n').map((l) => l.replace(/^plot\((n[12] - bar_index),/, 'plot(($1) + close * 0,')).join('\n')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: src } })
    expect(ours.ok, ours.refusal).toBe(true)
    const byTitle = new Map(ours.plots.map((p) => [p.title, p]))
    let compared = 0
    for (const t of ROWS) {
      const p = byTitle.get(t)
      expect(p && p.column, `${t}: ${p && p.missingReason}`).toBeTruthy()
      const col = Array.from(p.column)
      const v = vend.get(t)
      for (let i = 0; i < v.length; i++) { expect(col[i], `${t} bar ${i}`).toBe(v[i]); compared++ }
    }
    expect(compared).toBe(ROWS.length * 634)
  })

  it('behind the listing (history not asserted), every counter is withheld — never a window count', () => {
    const ours = runOurSide({ ...cap, history: { startsAtBar0: false, why: 'test: not asserted' } })
    expect(ours.ok, ours.refusal).toBe(true)
    for (const p of ours.plots) {
      // ⚠️ `ta.cum(1)` is not asserted on THIS capture: its control row reads
      // `bar_index` 0 on bar 0, so the harness knows the window starts at the
      // listing (`barIndexStartsAtZero`) and the count is TradingView's. SPY 1m below.
      if (!ROWS.includes(p.title) || !p.column || p.title === 'C05_ta_cum_1') continue
      expect(Array.from(p.column).every(Number.isNaN), `${p.title} was drawn behind the listing`).toBe(true)
    }
  })

  // ⭐⭐ 2026-11-09 — `ta.cum(1)` behind the listing. It was served as the LOADED
  // count (1, 2, 3 …) while TradingView reads 11,761 on SPY 1m
  // (`vw-bar-counters-spy-1-2026-10-02` C05): a silently wrong number beside four
  // counters that were correctly withheld. It is now withheld too, BY NAME.
  it('behind the listing on SPY 1m (the capture that found it): C05 is not 1 where TradingView reads 11,761', () => {
    const spy = JSON.parse(fs.readFileSync(path.join(H, 'vw-bar-counters-spy-1-2026-10-02.json'), 'utf8'))
    expect(spy.history.startsAtBar0).not.toBe(true)
    const ours = runOurSide(spy)
    expect(ours.ok, ours.refusal).toBe(true)
    const c05 = ours.plots.find((p) => p.title === 'C05_ta_cum_1')
    expect(Array.from(c05.column).every(Number.isNaN), 'C05 drew a number behind the listing').toBe(true)
    expect(c05.withheldBy).toBe('running-total:window')
    expect(c05.missingReason).toMatch(/by name \(running-total:window\)/)
    expect(ours.notes.some((n) => n.includes('running-total:window'))).toBe(true)
  })

  // ⭐ review N2 — the PER-BAR branch: a plot named by a per-bar code
  // (`bar-index:early-bars`) whose column holds no value on any bar is withheld by
  // name and graded INCONCLUSIVE; a plot of the same code that DOES draw is graded on
  // its values. `bar_index > 100000` is never true in this window, so every bar is
  // unknown off the listing; `bar_index > 100` is known from bar 101 on.
  it('a per-bar withholding that reached every bar grades INCONCLUSIVE with the code; one that left values is graded', () => {
    const spy = JSON.parse(fs.readFileSync(path.join(H, 'vw-bar-counters-spy-1-2026-10-02.json'), 'utf8'))
    const src = spy.source.text.split('\n')
      .map((l) => l.replace(/^plot\(ta\.cum\(1\),\s*"C05_ta_cum_1"\)/, 'plot(bar_index > 100000 ? close : na, "C05_ta_cum_1")'))
      .map((l) => l.replace(/^plot\(n1,\s*"C01_var_n_plus_1"\)/, 'plot(bar_index > 100 ? close : open, "C01_var_n_plus_1")'))
      .join('\n')
    expect(src).toContain('bar_index > 100000')
    expect(src).toContain('bar_index > 100 ?')
    const ours = runOurSide({ ...spy, source: { ...spy.source, text: src } })
    expect(ours.ok, ours.refusal).toBe(true)
    const c05 = ours.plots.find((p) => p.title === 'C05_ta_cum_1')
    expect(Array.from(c05.column).every(Number.isNaN)).toBe(true)
    expect(c05.withheldBy).toBe('bar-index:early-bars')
    const c01 = ours.plots.find((p) => p.title === 'C01_var_n_plus_1')
    expect(c01.withheldBy).toBeNull()
    expect(Array.from(c01.column).some((v) => !Number.isNaN(v))).toBe(true)
    const verdict = compareCapture(spy, ours)
    const row = verdict.plots.find((p) => p.title === 'C05_ta_cum_1')
    expect(row).toMatchObject({ verdict: 'INCONCLUSIVE', withheld: 'bar-index:early-bars' })
    expect(row.reason).toMatch(/by name \(bar-index:early-bars\)/)
    expect(verdict.plots.find((p) => p.title === 'C01_var_n_plus_1').withheld).toBeUndefined()
  })
})

// ⛔ review N2 — the column decides for EVERY code. A whole-series code named on a
// plot that still draws a value (a mislabel) is graded on the values, and said.
describe('withheldPlotsOf — the column decides, for whole-series codes too', () => {
  const report = (code, plots) => ({ withheld: [{ code, reason: 'r', plots }] })
  it('a whole code on an all-na column withholds it; on a column with values it does not, and says so', () => {
    const notes = []
    const cols = { a: new Float64Array([NaN, NaN]), b: new Float64Array([NaN, 3]) }
    const held = withheldPlotsOf(report('running-total:window', ['a', 'b']), cols, notes)
    expect([...held]).toEqual([['a', 'running-total:window']])
    expect(notes.some((n) => n.startsWith('b: named running-total:window') && n.includes('graded on them'))).toBe(true)
  })
  it('a per-bar code withholds only a column with no value on any bar', () => {
    const cols = { a: new Float64Array([NaN, NaN]), b: new Float64Array([1, NaN]) }
    const held = withheldPlotsOf(report('bar-index:early-bars', ['a', 'b']), cols, [])
    expect([...held]).toEqual([['a', 'bar-index:early-bars']])
  })
})

// ─── ⭐⭐ C29 (C12w) — bar counters, from the listing ───────────────────────────
//
// Read off `vw-bar-counters-rddt-1d-2026-09-30.json` (probe `vw-bar-counters.pine`,
// NYSE:RDDT 1D FROM THE LISTING, 634 bars): TradingView's five counter spellings
// read bar_index + 1 (`var n = 0; n := n + 1`, `n += 1`, `ta.cum(1)`) and bar_index
// (`n := na(n[1]) ? 0 : n[1] + 1`, `var n = na; n := na(n) ? 0 : n + 1`), none `na`
// on bar 0. Through the member door, from the listing, every row is the vendor's on
// every bar — the two spellings that become one tree are told apart by the reading
// the translator writes into the switched mark (`interpret.js::readingSeed`).
// Behind the listing (the curtain default, ruling R-W) every counter is WITHHELD.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide } from './ourSide'

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
      // ⚠️ `ta.cum(1)` stays the host's `cum` (pine.js names why: moving it behind the
      // curtain would blank `atr-trailing-stoploss` off the listing) — not asserted here.
      if (!ROWS.includes(p.title) || !p.column || p.title === 'C05_ta_cum_1') continue
      expect(Array.from(p.column).every(Number.isNaN), `${p.title} was drawn behind the listing`).toBe(true)
    }
  })
})

// ─── ⭐⭐ 2026-11-09 — A `var` THAT BEGAN BEFORE THE LOADED BARS, ON THE VENDOR'S CAPTURES ───
//
// `vw-bar-origin-spy-1d-300-2026-10-02` (AMEX:SPY 1D, the last 300 bars, NOT scrolled): TradingView
// reads `var first_time = time` as the LISTING day (8429.6 days — 1993-01-29) and
// `barstate.isfirst` false on this window's first bar (its bar 0 is the listing, 8,177 bars
// earlier). Through the member door this window drew O07 as the time 250 bars back (20294.6, a
// moving number) and O02 as 1 on its first bar: wrong values with no name. Now both are withheld
// BY NAME (`var-origin:window`, `bar-index:first-bar`), the `var` counters beside them (O03, and
// `vw-bar-counters-spy-1-2026-10-02` C01–C04, blank before with NO name) are named too, and
// every value the door still draws is TradingView's.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { runOurSide } from './ourSide'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const load = (id) => JSON.parse(fs.readFileSync(path.join(H, `${id}.json`), 'utf8'))
const vendorOf = (cap) => {
  const titleOf = new Map(cap.study.plots.map((p) => [p.id, p.title]))
  const out = new Map()
  cap.plotValues.fields.forEach((f, i) => { if (f !== 'time') out.set(titleOf.get(f), cap.plotValues.rows.map((r) => r[i])) })
  return out
}
const codesIn = (ours) => ours.notes.map((n) => (n.match(/withheld \(([^)]+)\)/) || [])[1]).filter(Boolean)

describe('vw-bar-origin-spy-1d-300 — off the listing', () => {
  const cap = load('vw-bar-origin-spy-1d-300-2026-10-02')
  const vend = vendorOf(cap)
  const ours = runOurSide(cap)
  const plot = (t) => ours.plots.find((p) => p.title === t)

  it('the capture: TradingView\'s first bar is the listing, not this window\'s', () => {
    expect(cap.history.startsAtBar0).toBe(false)
    expect(vend.get('O00_bar_index_CONTROL')[0]).toBe(8177)
    expect(vend.get('O02_isfirst').every((v) => v === 0)).toBe(true)
    expect(new Set(vend.get('O07_first_bar_time_in_days')).size).toBe(1)
  })

  it('`var first_time = time` (O07) and the `var` counter (O03) are withheld on every bar, by name', () => {
    expect(ours.ok, ours.refusal).toBe(true)
    for (const t of ['O07_first_bar_time_in_days', 'O03_bars_seen_by_a_var_counter']) {
      expect(plot(t).column, t).toBeNull()
      expect(plot(t).missingReason, t).toContain('var-origin:window')
    }
    expect(codesIn(ours)).toContain('var-origin:window')
  })

  it('`barstate.isfirst` (O02) is withheld on the first bar only, and is TradingView\'s 0 on every other', () => {
    const c = Array.from(plot('O02_isfirst').column)
    expect(Number.isNaN(c[0])).toBe(true)
    expect(c.slice(1)).toEqual(vend.get('O02_isfirst').slice(1))
    // `ta.barssince(barstate.isfirst)` (O06) reaches that bar from every bar
    expect(Array.from(plot('O06_barssince_isfirst').column).every(Number.isNaN)).toBe(true)
    expect(codesIn(ours)).toContain('bar-index:first-bar')
  })

  it('every value still drawn is TradingView\'s', () => {
    let compared = 0
    for (const p of ours.plots) {
      if (!p.column) continue
      const v = vend.get(p.title)
      const c = Array.from(p.column)
      for (let i = 0; i < c.length; i++) {
        if (Number.isNaN(c[i])) continue
        expect(c[i], `${p.title} bar ${i}`).toBe(v[i])
        compared += 1
      }
    }
    expect(compared).toBeGreaterThan(400)
  })
})

describe('vw-bar-counters-spy-1 — the `var` counters are named, where they were blank with no name', () => {
  const cap = load('vw-bar-counters-spy-1-2026-10-02')
  const ours = runOurSide(cap)
  it('C01–C04 are withheld on every bar by `var-origin:window`', () => {
    expect(ours.ok, ours.refusal).toBe(true)
    for (const t of ['C01_var_n_plus_1', 'C02_na_hist_seeded_counter', 'C03_var_compound', 'C04_var_na_seed_counter']) {
      const p = ours.plots.find((x) => x.title === t)
      expect(p.column, t).toBeNull()
      expect(p.missingReason, t).toContain('var-origin:window')
    }
  })
})

describe('CONTROL — from the listing the same probe draws every row, and names nothing of this lane\'s', () => {
  const cap = load('vw-bar-counters-rddt-1d-2026-09-30')
  const ours = runOurSide(cap)
  it('no `var-origin:` code from the listing', () => {
    expect(cap.history.startsAtBar0).toBe(true)
    expect(ours.ok, ours.refusal).toBe(true)
    expect(codesIn(ours).filter((c) => c.startsWith('var-origin:'))).toEqual([])
    const p = ours.plots.find((x) => x.title === 'C01_var_n_plus_1')
    expect(Array.from(p.column).every((v) => Number.isFinite(v))).toBe(true)
  })
})

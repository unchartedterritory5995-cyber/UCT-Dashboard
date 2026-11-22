// ─── ⭐⭐ 2026-11-09 — A `var` THAT BEGAN BEFORE THE LOADED BARS, ON THE VENDOR'S CAPTURES ───
//
// Off the listing a `var` that keeps its first value or keeps counting is withheld BY NAME
// (`interpret.js::varOriginMask`, `var-origin:window` / `var-origin:bars`); from the
// listing it is drawn. Since DIV-1 (engine 42) the harness REPLAYS a capture from the
// listing when a committed capture supplies the prehistory (`ourSide.js::replayDecisionOf`),
// so the two sides are rail-ed on two captures:
//   - `vw-bar-origin-rddt-5-2026-10-02` (NYSE:RDDT 5m, no prehistory, not the listing):
//     before this lane `var first_time = time` (O07) drew the time 250 bars back on every
//     bar (19,957 bars off by a moving amount) and the counters (O03–O05) were blank with
//     NO name; now each is withheld by name, and every value still drawn is TradingView's.
//   - `vw-bar-counters-spy-1-2026-10-02` (AMEX:SPY 1m, cold): C01–C04 named likewise.
//   - `vw-bar-origin-spy-1d-300-2026-10-02` (AMEX:SPY 1D, replayed from the 1993 listing):
//     the SAME `var`s and `barstate.isfirst` are drawn, and are TradingView's on every bar —
//     the lane withholds only where it cannot know.

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
const drawnAgree = (ours, vend) => {
  let compared = 0
  for (const p of ours.plots) {
    if (!p.column || p.withheldBy) continue
    const v = vend.get(p.title)
    const c = Array.from(p.column)
    for (let i = 0; i < c.length; i++) {
      if (Number.isNaN(c[i])) continue
      expect(c[i], `${p.title} bar ${i}`).toBe(v[i])
      compared += 1
    }
  }
  return compared
}

describe('vw-bar-origin-rddt-5 — off the listing, no prehistory: withheld by name', () => {
  const cap = load('vw-bar-origin-rddt-5-2026-10-02')
  const ours = runOurSide(cap)
  const plot = (t) => ours.plots.find((p) => p.title === t)

  it('the capture is not replayed: its window is all the history this chart holds', () => {
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.historyReplay.historyFromListing).toBe(false)
    expect(new Set(vendorOf(cap).get('O07_first_bar_time_in_days')).size).toBe(1)
  })

  it('`var first_time = time` (O07) and the `var` counter (O03, O04) are withheld on every bar, `var-origin:window`', () => {
    for (const t of ['O07_first_bar_time_in_days', 'O03_bars_seen_by_a_var_counter', 'O04_bar_index_minus_counter_MUST_BE_MINUS_1']) {
      expect(plot(t).withheldBy, t).toBe('var-origin:window')
    }
    expect(plot('O05_bar_index_where_isfirst_was_true').withheldBy).toBe('var-origin:bars')
    expect(codesIn(ours)).toEqual(expect.arrayContaining(['var-origin:window', 'var-origin:bars']))
  })

  it('every value still drawn is TradingView\'s', () => {
    expect(drawnAgree(ours, vendorOf(cap))).toBeGreaterThan(100000)
  })
})

describe('vw-bar-counters-spy-1 — the `var` counters are named, where they were blank with no name', () => {
  const ours = runOurSide(load('vw-bar-counters-spy-1-2026-10-02'))
  it('C01–C04 are withheld on every bar by `var-origin:window`', () => {
    expect(ours.ok, ours.refusal).toBe(true)
    for (const t of ['C01_var_n_plus_1', 'C02_na_hist_seeded_counter', 'C03_var_compound', 'C04_var_na_seed_counter']) {
      expect(ours.plots.find((x) => x.title === t).withheldBy, t).toBe('var-origin:window')
    }
  })
})

describe('vw-bar-origin-spy-1d-300 — replayed from the listing: the same `var`s are DRAWN, and are TradingView\'s', () => {
  const cap = load('vw-bar-origin-spy-1d-300-2026-10-02')
  const vend = vendorOf(cap)
  const ours = runOurSide(cap)
  it('replayed from the listing, and O02 / O03 / O06 / O07 equal the vendor on all 300 bars', () => {
    expect(ours.ok, ours.refusal).toBe(true)
    expect(ours.historyReplay.historyFromListing).toBe(true)
    for (const t of ['O02_isfirst', 'O03_bars_seen_by_a_var_counter', 'O06_barssince_isfirst', 'O07_first_bar_time_in_days']) {
      const p = ours.plots.find((x) => x.title === t)
      expect(p.withheldBy, t).toBe(null)
      expect(Array.from(p.column), t).toEqual(vend.get(t))
    }
    expect(codesIn(ours).filter((c) => c.startsWith('var-origin:'))).toEqual([])
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

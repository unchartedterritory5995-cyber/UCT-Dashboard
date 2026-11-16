// app/src/components/chart/engine/ast/lenientBlockLocalHistory.test.js
//
// ─── THE LENIENT LANE READ A BLOCK LOCAL'S `x[1]` AS THE PREVIOUS BAR'S ────────
//
// Pine keeps a block local's history per RUN of its block: in
//
//     float p = na
//     if close > open
//         x = close * 2
//         p := x[1]
//
// `x[1]` is `x` at the block's previous run, not at the previous chart bar.
// `Resolver.blockLocalHistory` (C48) knows that and refuses it by name, but only
// for a resolver that asks (`refuseCondCalls`, the object pass; `condGate`, the
// host lane's outputs). Every other resolver fell through to `barOffsetNode`,
// which is the chart-bar history, and the lenient lane (`translatePine(src)`,
// screens) is one of those. ⚰️ MEASURED 2026-11-15: the s10 probe
// `vw-w3n-draw-block-history-d` translated `ok` on the lenient lane and
// disagreed with TradingView on 169 of 315 compared RDDT bars (bar 2: vendor
// 100.88, ours 92).
//
// ⭐ The fix is at that read: in the screener lane (`Resolver.screen`) nothing
// carries the block's guard to a bind, so the read refuses by the same sentence
// (`pine:block`) the object pass already gives; a block that runs exactly once
// keeps its witnessed `na` (capture `vw-call-site-history`, A12).
//
// ⛔ NOT refused: a top-level name's history read from inside the block (its
// per-bar history is TradingView's: `vw-getter-history` G03), a block local read
// without history, and a block that runs on every bar.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from './pine'
import { parseFormula } from './parse'
import { interpret } from './interpret'

const REPO = path.resolve(process.cwd(), '..')
const PROBE_D = fs.readFileSync(path.join(REPO, 'tools/visual_conformance/probes/vw-w3n-draw-block-history-d.pine'), 'utf8')
const CALL_SITE = JSON.parse(fs.readFileSync(path.join(REPO,
  'tests/fixtures/vendor/harness/vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
// The s10 captures of the probe (committed with session S10, 335a665e94).
const S10 = (sym) => JSON.parse(fs.readFileSync(path.join(REPO,
  `tests/fixtures/vendor/harness/vw-w3n-draw-block-history-d-${sym}-1d-2026-11-15.json`), 'utf8'))

const barsOf = (cap) => cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
// by position: a refused output carries no title on this lane
const outputOf = (t, i) => t.outputs[i]
const columnOf = (formula, bars) => {
  const parsed = parseFormula(formula)
  expect(parsed.ok, formula).toBe(true)
  return Array.from(interpret(parsed.ast, bars, {}, undefined, {}), (x) => (Number.isFinite(x) ? x : null))
}
/** The capture's column for one plot title, aligned to its bars by time. */
const vendorColumn = (cap, title) => {
  const i = cap.study.plots.findIndex((p) => p.title === title)
  expect(i, title).toBeGreaterThanOrEqual(0)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[1 + i]]))
  return cap.bars.rows.map((b) => (byTime.has(b[0]) ? byTime.get(b[0]) : undefined))
}
const same = (a, b) => (a === null && b === null)
  || (a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)))
/** By hand: `x[1]` at the block's previous RUN (Pine), or at the previous BAR (the old read). */
function byHand(bars, previous) {
  let lastRun = null
  return bars.map((b, i) => {
    if (!(b.c > b.o)) return null
    const prev = previous === 'run' ? lastRun : (i > 0 ? bars[i - 1].c * 2 : null)
    lastRun = b.c * 2
    return prev
  })
}

describe('the lenient lane: a block local\'s history read refuses by name', () => {
  it('⛔ the s10 probe D04 refuses `pine:block`, naming `x[1]` and the previous RUN; its control plot still translates', () => {
    const t = translatePine(PROBE_D)
    expect(t.mode).toBe('screener')
    const d04 = outputOf(t, 0)
    expect(d04.refusal && d04.refusal.guard).toBe('pine:block')
    expect(d04.refusal.message).toMatch(/`x\[1\]` reads the history of a name declared inside a block that does not run on every bar/)
    expect(d04.refusal.message).toMatch(/previous RUN/)
    expect(d04.line).toBe(8)   // `plot(p, "D04_block_local_x1_plot")`
    const d00 = outputOf(t, 1)
    expect(d00.title).toBe('D00_bar_index_CONTROL')
    expect(d00.refusal).toBeFalsy()
    expect(d00.formula).toBeTruthy()
  })

  it('⛔ the same read inside a helper\'s argument, and a `var` declared in the block, refuse too', () => {
    const src = ['//@version=6', 'indicator("t")', 'float p = na', 'float q = na',
      'if close > open', '    x = close * 2', '    var float s = close',
      '    p := math.abs(x[2] - close)', '    q := s[1]',
      'plot(p, "P")', 'plot(q, "Q")'].join('\n')
    const t = translatePine(src)
    expect(outputOf(t, 0).refusal && outputOf(t, 0).refusal.guard).toBe('pine:block')
    expect(outputOf(t, 0).refusal.message).toMatch(/`x\[2\]`/)
    expect(outputOf(t, 1).refusal && outputOf(t, 1).refusal.guard).toBe('pine:block')
  })

  it('⭐ control: `x` declared at the TOP LEVEL still translates, and equals `close[1] * 2` on the bars the block runs', () => {
    const src = ['//@version=6', 'indicator("t")', 'float p = na', 'x = close * 2',
      'if close > open', '    p := x[1]', 'plot(p, "P")'].join('\n')
    const t = translatePine(src)
    const out = outputOf(t, 0)
    expect(out.refusal, JSON.stringify(out.refusal)).toBeFalsy()
    const bars = barsOf(CALL_SITE)
    const col = columnOf(out.formula, bars)
    const want = byHand(bars, 'bar')
    let compared = 0
    bars.forEach((_, i) => {
      if (i === 0) return
      compared += 1
      expect(same(col[i], want[i]), `bar ${i}: ${col[i]} vs ${want[i]}`).toBe(true)
    })
    expect(compared).toBe(bars.length - 1)
  })

  it('⭐ control: a block local read WITHOUT history still translates, and is `close * 2` on the bars the block runs', () => {
    const src = ['//@version=6', 'indicator("t")', 'float p = na',
      'if close > open', '    x = close * 2', '    p := x', 'plot(p, "P")'].join('\n')
    const t = translatePine(src)
    const out = outputOf(t, 0)
    expect(out.refusal, JSON.stringify(out.refusal)).toBeFalsy()
    const bars = barsOf(CALL_SITE)
    const col = columnOf(out.formula, bars)
    bars.forEach((b, i) => expect(same(col[i], b.c > b.o ? b.c * 2 : null), `bar ${i}`).toBe(true))
  })

  it('⭐ control: a block that runs on every bar (a constant test) keeps its every-bar history', () => {
    const src = ['//@version=6', 'indicator("t")', 'float p = na',
      'if true', '    x = close * 2', '    p := x[1]', 'plot(p, "P")'].join('\n')
    const out = outputOf(translatePine(src), 0)
    expect(out.refusal, JSON.stringify(out.refusal)).toBeFalsy()
  })

  it('⭐ a block that runs exactly once keeps the witnessed `na` (A12), as the strict lane does', () => {
    const src = ['//@version=6', 'indicator("t")', 'float p = na',
      'if barstate.islast', '    bx = close * 2', '    p := bx[1]', 'plot(p, "P")'].join('\n')
    const lenient = outputOf(translatePine(src), 0)
    const strict = outputOf(translatePine(src, { strict: true }), 0)
    expect(lenient.refusal, JSON.stringify(lenient.refusal)).toBeFalsy()
    expect(lenient.formula).toBe(strict.formula)
    const bars = barsOf(CALL_SITE)
    const col = columnOf(lenient.formula, bars)
    expect(col[bars.length - 1]).toBe(null)
  })

  it('⚰️ the old read was wrong against TradingView: C05 (`cx[1]` under `if close > open`) is the previous RUN, never the previous BAR', () => {
    // The committed capture `vw-call-site-history-rddt-1d-2026-10-01`, row C05:
    // the very shape D04 has. The previous-BAR column is what the lenient lane served.
    const bars = barsOf(CALL_SITE)
    const vendor = vendorColumn(CALL_SITE, 'C05_local_x1_cond')
    const run = byHand(bars, 'run')
    const bar = byHand(bars, 'bar')
    let n = 0
    let runWrong = 0
    let barWrong = 0
    bars.forEach((_, i) => {
      if (vendor[i] === undefined) return
      n += 1
      if (!same(vendor[i], run[i])) runWrong += 1
      if (!same(vendor[i], bar[i])) barWrong += 1
    })
    expect(n).toBeGreaterThan(600)
    expect(runWrong).toBe(0)
    expect(barWrong).toBeGreaterThan(100)
    // ...and the C05 shape is refused on the lenient lane now, not served as `bar`.
    const c05 = ['//@version=6', 'indicator("t")', 'float p = na',
      'if close > open', '    cx = close * 2', '    p := cx[1]', 'plot(p, "C05")'].join('\n')
    expect(outputOf(translatePine(c05), 0).refusal.guard).toBe('pine:block')
  })

  /** Grade D04 against the s10 capture: every bar the vendor has a row for, from the
   *  block's first run in the window on (before it, the previous run lies outside the
   *  loaded bars unless the history starts at the listing). */
  function gradeD04(cap) {
    const bars = barsOf(cap)
    const vendor = vendorColumn(cap, 'D04_block_local_x1_plot')
    const run = byHand(bars, 'run')
    const bar = byHand(bars, 'bar')
    const from = cap.history && cap.history.startsAtBar0 === true ? 0 : bars.findIndex((b) => b.c > b.o) + 1
    const g = { n: 0, runWrong: 0, barWrong: 0, firstBarWrong: -1, vendor, bar }
    bars.forEach((_, i) => {
      if (i < from || vendor[i] === undefined) return
      g.n += 1
      if (!same(vendor[i], run[i])) g.runWrong += 1
      if (!same(vendor[i], bar[i])) { g.barWrong += 1; if (g.firstBarWrong < 0) g.firstBarWrong = i }
    })
    return g
  }

  it('⚰️ the s10 capture, RDDT 1D from the listing: TradingView is the previous RUN on every bar; the previous BAR (the old read) is wrong from bar 2 (100.88 vs 92)', () => {
    const cap = S10('rddt')
    expect(cap.history.startsAtBar0).toBe(true)
    const g = gradeD04(cap)
    expect(g.n).toBe(cap.bars.rows.length)
    expect(g.runWrong).toBe(0)
    expect(g.barWrong).toBe(169)
    expect(g.firstBarWrong).toBe(2)
    expect(g.vendor[2]).toBe(100.88)
    expect(g.bar[2]).toBe(92)
    expect(outputOf(translatePine(cap.source.text), 0).refusal.guard).toBe('pine:block')
  })

  it('⚰️ the s10 capture, SPY 1D: the same — previous RUN everywhere, the previous BAR wrong', () => {
    const g = gradeD04(S10('spy'))
    expect(g.n).toBeGreaterThan(1000)
    expect(g.runWrong).toBe(0)
    expect(g.barWrong).toBeGreaterThan(100)
  })
})

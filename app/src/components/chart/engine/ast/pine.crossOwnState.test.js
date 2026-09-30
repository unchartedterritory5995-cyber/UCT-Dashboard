// app/src/components/chart/engine/ast/pine.crossOwnState.test.js
//
// ─── ⭐⭐ C12 — `ta.crossover(x, v)` INSIDE `v`'s OWN UPDATE (the reset-after-break idiom) ──
//
// Triage class C12 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`):
//
//     var float lvl = na
//     if <new level>
//         lvl := <level>
//     if not na(lvl) and ta.crossover(close, lvl)
//         lvl := na                       ← the reset, read through crossover
//
// The read of `lvl` is inside `lvl`'s own update, under `crossOver`, and was
// refused (`selfOutsideTheStepLoop`). Pine's crossover is `x > y and x[1] <= y[1]`,
// and `y[1]` of a VARIABLE is its value at the end of the previous bar — the
// accumulator's `self` — so the call folds exactly (`Resolver.crossOfOwnState`).
// The vendor half is `institutional-smc-order-flow-matrix-pro`
// (`__tests__/c12BlockState.vendor.test.js`).
//
// ⛔ EVERY CASE IS A PINE REFERENCE REPLAYED FROM BAR 0 over bars built so the
// level is set, crossed, reset and set again many times, compared on every bar
// past the accumulator's warm-up (the engine's `accum` is not computable before
// it, by design — `interpret.js::runRecurrence`).
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const HEAD = '//@version=6\nindicator("t", overlay=true)\n'
const W = 250
const N = 420

/** A saw-tooth market: a slow drift with a 9-bar wobble, so down bars (which
 *  set the level) and closes above it (which cross it) both recur. */
const BARS = Array.from({ length: N }, (_, i) => {
  const base = 100 + i * 0.05 + 3 * Math.sin(i / 1.5)
  const o = base + (i % 9 < 4 ? 1.2 : -1.1)
  const c = base
  return { t: 1_700_000_000 + i * 86400, o, h: Math.max(o, c) + 0.4, l: Math.min(o, c) - 0.4, c, v: 1000 + i }
})

function column(script) {
  const out = translatePine(HEAD + script, { strict: true })
  const chosen = out.outputs.find((o) => o.formula)
  expect(chosen, (out.refusals || []).map((r) => `${r.guard}: ${r.message}`).join(' | ')).toBeTruthy()
  return Array.from(interpret(parseFormula(chosen.formula).ast, BARS, {}, undefined, undefined,
    { tf: 'D', newestBarIsForming: false }))
}

/** Pine, bar by bar from bar 0. `setOn(b)` → the level to set (or null);
 *  `crossed(x, y, xPrev, yPrev)` is Pine's crossover / crossunder with `na`
 *  comparisons false. `y[1]` is the variable's value at the END of the previous bar. */
function pineReplay(setOn, src, crossed) {
  const out = []
  let lvl = NaN
  let prevFinal = NaN
  for (let i = 0; i < BARS.length; i++) {
    const s = setOn(BARS[i])
    if (s !== null) lvl = s
    const x = src(BARS[i])
    const xPrev = i > 0 ? src(BARS[i - 1]) : NaN
    if (!Number.isNaN(lvl) && crossed(x, lvl, xPrev, prevFinal)) lvl = NaN
    out.push(lvl)
    prevFinal = lvl
  }
  return out
}
const lt = (a, b) => !Number.isNaN(a) && !Number.isNaN(b) && a < b
const OVER = (x, y, xp, yp) => lt(y, x) && !Number.isNaN(xp) && !Number.isNaN(yp) && xp <= yp
const UNDER = (x, y, xp, yp) => lt(x, y) && !Number.isNaN(xp) && !Number.isNaN(yp) && xp >= yp

function sameAfterWarmup(ours, ref) {
  let compared = 0
  let resets = 0
  for (let i = W; i < N; i++) {
    if (Number.isNaN(ref[i])) expect(Number.isNaN(ours[i]), `bar ${i}: ours ${ours[i]}, Pine na`).toBe(true)
    else expect(ours[i], `bar ${i}`).toBeCloseTo(ref[i], 9)
    compared += 1
    if (!Number.isNaN(ref[i - 1]) && Number.isNaN(ref[i])) resets += 1
  }
  // ⛔ a fixture that never resets, or never holds a level, cannot tell the
  // fold from a refusal or from a variable that is never set
  expect(compared).toBe(N - W)
  expect(resets).toBeGreaterThan(5)
  expect(ref.slice(W).some((v) => !Number.isNaN(v))).toBe(true)
}

describe('C12 — crossover / crossunder of a `var` inside its own update', () => {
  it('⭐ crossover(close, lvl) resets the level exactly where Pine does', () => {
    const ours = column([
      'var float lvl = na',
      'if close < open',
      '    lvl := high',
      'if not na(lvl) and ta.crossover(close, lvl)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(ours, pineReplay((b) => (b.c < b.o ? b.h : null), (b) => b.c, OVER))
  })

  it('⭐ crossunder(close, lvl) — the mirror, with the level on the other side', () => {
    const ours = column([
      'var float lvl = na',
      'if close > open',
      '    lvl := low',
      'if not na(lvl) and ta.crossunder(close, lvl)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(ours, pineReplay((b) => (b.c > b.o ? b.l : null), (b) => b.c, UNDER))
  })

  it('⭐ the state may be either argument — crossover(lvl, close) is crossunder of the pair', () => {
    const ours = column([
      'var float lvl = na',
      'if close > open',
      '    lvl := low',
      'if not na(lvl) and ta.crossover(lvl, close)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(ours, pineReplay((b) => (b.c > b.o ? b.l : null), (b) => b.c,
      (x, y, xp, yp) => OVER(y, x, yp, xp)))
  })

  it('⭐ a level SET on the bar that breaks it: `y[1]` is the previous bar\'s level, not this one', () => {
    // Set on every up bar at its open, so the close is above the new level on the
    // same bar; whether it counts as a cross is decided by the PREVIOUS bar's level
    // alone — the case that separates `self` from the partial read.
    const ours = column([
      'var float lvl = na',
      'if close > open',
      '    lvl := open',
      'if not na(lvl) and ta.crossover(close, lvl)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(ours, pineReplay((b) => (b.c > b.o ? b.o : null), (b) => b.c, OVER))
  })

  it('⭐ `x[1] <= y[1]` / `x[1] >= y[1]` — equality counts, exactly as Pine writes it', () => {
    // The level is the CLOSE, so on the next bar `close[1] == lvl[1]` exactly.
    const over = column([
      'var float lvl = na',
      'if close < open',
      '    lvl := close',
      'if not na(lvl) and ta.crossover(close, lvl)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(over, pineReplay((b) => (b.c < b.o ? b.c : null), (b) => b.c, OVER))
    const under = column([
      'var float lvl = na',
      'if close > open',
      '    lvl := close',
      'if not na(lvl) and ta.crossunder(close, lvl)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(under, pineReplay((b) => (b.c > b.o ? b.c : null), (b) => b.c, UNDER))
  })

  it('⭐ `lvl[1]` read AFTER an earlier `lvl :=` in the same bar is the previous bar\'s value (was pine:timeout)', () => {
    // History is committed at the end of a bar, so this bar's reassignment above
    // the read does not move `lvl[1]` (`Resolver.selfOffsetLag`).
    const ours = column([
      'var float lvl = na',
      'if close > open',
      '    lvl := open',
      'if not na(lvl) and close > lvl and close[1] <= lvl[1]',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'))
    sameAfterWarmup(ours, pineReplay((b) => (b.c > b.o ? b.o : null), (b) => b.c, OVER))
  })

  it('⭐ the `trigger()` idiom: a function-body `var` read as `v[1]` above its own reassignments', () => {
    // `tests/fixtures/pine/02-ict-retracement-to-order-block-screener.pine` lines
    // 103–112, reduced to two plain conditions. `nz(current_state[1])` sits above
    // three reassignments of `current_state` in the same body; it refused
    // `pine:state` before `selfOffsetLag` knew the chain's own partial binding.
    const ours = column([
      'trigger(p, s) =>',
      '    var current_state = 0',
      '    previous_state = nz(current_state[1])',
      '    current_state := previous_state == 2 ? 0 : previous_state',
      '    if p and current_state == 0',
      '        current_state := 1',
      '    if s and current_state == 1',
      '        current_state := 2',
      '    trigger_condition = current_state == 2 ? true : false',
      '    [current_state, trigger_condition]',
      '[st, fired] = trigger(close > open, close < close[1])',
      'plot(st, "st")',
    ].join('\n'))
    const ref = []
    let prev = NaN
    for (let i = 0; i < N; i++) {
      const b = BARS[i]
      let cur = Number.isNaN(prev) ? 0 : prev
      cur = cur === 2 ? 0 : cur
      if (b.c > b.o && cur === 0) cur = 1
      if (i > 0 && b.c < BARS[i - 1].c && cur === 1) cur = 2
      ref.push(cur)
      prev = cur
    }
    for (let i = W; i < N; i++) expect(ours[i], `bar ${i}`).toBe(ref[i])
    // ⛔ the fixture walks all three states, or it cannot tell a latch from a constant
    expect(new Set(ref.slice(W))).toEqual(new Set([0, 1, 2]))
  })

  it('⭐ two spellings, one column: `ta.crossover(close, lvl)` IS `close > lvl and close[1] <= lvl[1]`', () => {
    // The written spelling already translates (a `var` read through `[1]` is a
    // history read — `varSeedOf`), so the call must answer exactly what it does,
    // seed included. With no set event the column is the seed alone: a history
    // read makes it `na` (the house rule for `x[1]` — "never draw a number Pine
    // never draws"), and the call counts its `y[1]` the same way.
    const body = (cond) => [
      'var float lvl = 50.0',
      'if close < open and close > 1000000',
      '    lvl := high',
      `if not na(lvl) and ${cond}`,
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n')
    const called = column(body('ta.crossover(close, lvl)'))
    const written = column(body('close > lvl and close[1] <= lvl[1]'))
    expect(called.length).toBe(written.length)
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(written[i])) expect(Number.isNaN(called[i]), `bar ${i}: ${called[i]}`).toBe(true)
      else expect(called[i], `bar ${i}`).toBe(written[i])
    }
    // and the same equality where the level does move
    const moving = (cond) => body(cond).replace('close > 1000000', 'close > 0')
    const c2 = column(moving('ta.crossover(close, lvl)'))
    const w2 = column(moving('close > lvl and close[1] <= lvl[1]'))
    for (let i = 0; i < N; i++) {
      if (Number.isNaN(w2[i])) expect(Number.isNaN(c2[i]), `bar ${i}: ${c2[i]}`).toBe(true)
      else expect(c2[i], `bar ${i}`).toBe(w2[i])
    }
    expect(w2.slice(W).some((v) => !Number.isNaN(v))).toBe(true)
  })

  it('⛔ the other argument may not read the state — still refused, by name', () => {
    const out = translatePine(HEAD + [
      'var float lvl = na',
      'if close < open',
      '    lvl := high',
      'if not na(lvl) and ta.crossover(lvl + 1, lvl)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'), { strict: true })
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:state')
  })

  it('⛔ an EXPRESSION of the state is not the variable — `y[1]` of it was never held', () => {
    const out = translatePine(HEAD + [
      'var float lvl = na',
      'if close < open',
      '    lvl := high',
      'if not na(lvl) and ta.crossover(close, lvl * 1.01)',
      '    lvl := na',
      'plot(lvl, "lvl")',
    ].join('\n'), { strict: true })
    expect(out.ok).toBe(false)
    expect(out.refusal.guard).toBe('pine:state')
  })

  it('⛔ CONTROL — crossover of a variable OUTSIDE its update is untouched (the table\'s own)', () => {
    const out = translatePine(HEAD + [
      'var float lvl = na',
      'if close < open',
      '    lvl := high',
      'plot(ta.crossover(close, lvl) ? 1 : 0, "x")',
    ].join('\n'), { strict: true })
    const chosen = out.outputs.find((o) => o.formula)
    expect(chosen.formula).toMatch(/crossOver\(/)
  })
})

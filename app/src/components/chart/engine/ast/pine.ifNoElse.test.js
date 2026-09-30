// app/src/components/chart/engine/ast/pine.ifNoElse.test.js
//
// ─── ⭐⭐ C12 — AN `if` WITH NO `else` IS A VALUE, AND THE MISSING BRANCH IS `na` ──
//
// Triage class C12 (`docs/pine/vendor-harness/objects-triage-2026-09-28.md`).
// `x = if cond` / `<expr>` with no `else` refused the whole binding as "a branch
// with no value". Pine returns `na` when an `if` used as an expression runs no
// branch. The vendor half is `atr-support-and-resistance`
// (`__tests__/c12BlockState.vendor.test.js`), where the choice between `na` and
// any other fallthrough decides the object count.
//
// ⛔ ONLY A PROVEN NUMBER. Pine v6 made `bool` non-`na` (its missing branch is
// `false`), v5 keeps `na`, and no capture on disk separates them — so a bool
// branch keeps the `pine:block` refusal, now naming why.
//
// ⛔ EVERY VALUE CASE IS CHECKED AGAINST A PINE REFERENCE SIMULATED FROM THE
// BARS, on a fixture where the fallthrough bars exist and the taken bars exist,
// so a fold that took the wrong arm, or read `0`, cannot pass.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { interpret } from './interpret.js'
import { parseFormula } from './parse.js'

const head = (v) => `//@version=${v}\nindicator("t")\n`
const N = 40

/** Alternating up/down bars with distinct prices, so a value names its bar. */
const BARS = Array.from({ length: N }, (_, i) => {
  const o = 100 + i
  const c = i % 3 === 0 ? o + 2 : o - 1
  return { t: 1_700_000_000 + i * 86400, o, h: Math.max(o, c) + 0.5, l: Math.min(o, c) - 0.5, c, v: 1000 + i }
})

function translate(script, v = 6) {
  return translatePine(head(v) + script, { strict: true })
}

function column(script, v = 6) {
  const out = translate(script, v)
  const chosen = out.outputs.find((o) => o.formula)
  expect(chosen, (out.refusals || []).map((r) => `${r.guard}: ${r.message}`).join(' | ')).toBeTruthy()
  return Array.from(interpret(parseFormula(chosen.formula).ast, BARS, {}, undefined, undefined,
    { tf: 'D', newestBarIsForming: false }))
}

const same = (ours, ref) => {
  expect(ours.length).toBe(ref.length)
  for (let i = 0; i < ref.length; i++) {
    if (Number.isNaN(ref[i])) expect(Number.isNaN(ours[i]), `bar ${i}: ours ${ours[i]}, Pine na`).toBe(true)
    else expect(ours[i], `bar ${i}`).toBeCloseTo(ref[i], 9)
  }
}

describe('C12 — an `if` expression with no `else`', () => {
  it('⭐ one arm: the taken bars carry the arm, every other bar is `na` (v6)', () => {
    const ours = column('w = if close > open\n    open - low\nplot(w, "w")')
    const ref = BARS.map((b) => (b.c > b.o ? b.o - b.l : NaN))
    same(ours, ref)
    // ⛔ the fixture has both kinds of bar, or it cannot tell `na` from `0`
    expect(ref.some(Number.isNaN)).toBe(true)
    expect(ref.some((x) => !Number.isNaN(x))).toBe(true)
  })

  it('⭐ the same in v5 and v4 — a number is `na` in every version', () => {
    const ref = BARS.map((b) => (b.c > b.o ? b.h - b.o : NaN))
    same(column('w = if close > open\n    high - open\nplot(w, "w")', 5), ref)
    same(column('w = if close > open\n    high - open\nplot(w, "w")', 4), ref)
  })

  it('⭐ an `else if` chain with no final `else`: each arm on its bars, `na` on the rest', () => {
    const ours = column('w = if close > open\n    high\nelse if close < open - 0.5\n    low\nplot(w, "w")')
    const ref = BARS.map((b) => (b.c > b.o ? b.h : (b.c < b.o - 0.5 ? b.l : NaN)))
    same(ours, ref)
  })

  it('⭐ the `na` reaches a comparison the way Pine reads it — `na <= x` is false', () => {
    // The atr-support-and-resistance shape: the wick test in front of every box.
    const ours = column([
      'w = if close > open',
      '    open - low',
      'ok = w / (high - low) <= 0.25 ? 1 : 0',
      'plot(ok, "ok")',
    ].join('\n'))
    const ref = BARS.map((b) => (b.c > b.o ? (((b.o - b.l) / (b.h - b.l)) <= 0.25 ? 1 : 0) : 0))
    same(ours, ref)
  })

  it('⭐ a constant test takes its arm and never reads the missing one', () => {
    same(column('m = input.string("A")\nw = if m == "A"\n    close\nplot(w, "w")'), BARS.map((b) => b.c))
    same(column('m = input.string("B")\nw = if m == "A"\n    close\nplot(w, "w")'), BARS.map(() => NaN))
  })

  it('⛔ a BOOL branch still refuses — v6 returns `false` there, v5 `na`, no capture separates them', () => {
    for (const v of [5, 6]) {
      const out = translate('b = if close > open\n    true\nplot(b ? 1 : 0, "b")', v)
      expect(out.ok).toBe(false)
      expect(out.refusal.guard).toBe('pine:block')
      expect(out.refusal.message).toMatch(/no `else` returns `na` for a number/)
    }
  })

  it('⛔ CONTROL — an `if` WITH an `else` is unchanged (the `else` arm, never `na`)', () => {
    const ours = column('w = if close > open\n    open - low\nelse\n    0\nplot(w, "w")')
    same(ours, BARS.map((b) => (b.c > b.o ? b.o - b.l : 0)))
  })

  it('⛔ a tuple branch with no `else` still refuses — a missing tuple is not one `na`', () => {
    const out = translate('[a, b] = if close > open\n    [open, close]\nplot(a, "a")')
    expect(out.ok).toBe(false)
  })
})

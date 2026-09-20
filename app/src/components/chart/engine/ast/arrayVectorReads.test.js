// app/src/components/chart/engine/ast/arrayVectorReads.test.js
//
// ─── ⭐⭐ WAVE 2 (a) — THE FOUR RAILS, EACH WITH A CONTROL ───────────────────
//
// Mechanism A: an array is a PLAN-TIME VECTOR of expression slots, so a read of
// one folds to a slot's TREE before the chart runs. These drive the shipped door
// (`translatePine`) rather than the internals, because a rail on the internals
// cannot tell a wired path from an unwired one.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine.js'
import { MAX_VECTOR_SLOTS } from './arrayVectors.js'

const HEAD = 'indicator("t", overlay=true)\n'
const run = (body, mode = 'host') => translatePine(`${HEAD}${body}`, { mode })
const guards = (t) => [...new Set((t.refusals || []).map((r) => r.guard))]
const msg = (t) => (t.refusals || []).map((r) => r.message).join(' | ')
const notes = (t) => (t.notes || []).map((n) => `${n.code}@${n.line}`)

describe('rail 1 — a read resolves to a recorded creation, or refuses by name', () => {
  it('⭐ a creation is RECORDED in the result (F2), with type and persistence', () => {
    const t = run('var a = array.new<float>(4)\nplot(close)\n')
    expect(notes(t)).toContain('pine:vector@2')
    expect((t.notes || []).find((n) => n.code === 'pine:vector').message)
      .toMatch(/persisting across bars/)
  })

  it('⭐ a non-`var` creation says it is REBUILT each bar — the other half', () => {
    const t = run('a = array.new_float(4)\nplot(close)\n')
    expect((t.notes || []).find((n) => n.code === 'pine:vector').message)
      .toMatch(/rebuilt each bar/)
  })

  it('⛔ a read of a name nothing created REFUSES, and is never `na`', () => {
    // ⚠️ `ghost` is bound to a number, so it exists — what it is NOT is an array.
    const t = run('ghost = 3\nplot(array.get(ghost, 0))\n')
    expect(guards(t)).toContain('pine:collection')
    expect(msg(t)).toMatch(/nothing in this script creates it/)
  })

  it('⛔⛔ CONTROL — the same read on a REAL vector does not refuse', () => {
    // Without this, rail 1 would pass on an engine that refused every read.
    const t = run('a = array.new_float(2)\nplot(array.get(a, 0))\n')
    expect(guards(t)).not.toContain('pine:collection')
  })
})

describe('rail 2 — `var` persists, non-`var` rebuilds, and both are recorded', () => {
  it('⭐ the two spellings produce DIFFERENT records for the same source shape', () => {
    const v = run('var a = array.new_float(2)\nplot(close)\n')
    const n = run('a = array.new_float(2)\nplot(close)\n')
    const line = (t) => (t.notes || []).find((x) => x.code === 'pine:vector').message
    expect(line(v)).not.toBe(line(n))
    expect(line(v)).toMatch(/persisting/)
    expect(line(n)).toMatch(/rebuilt/)
  })
})

describe('rail 3 — an out-of-range read REFUSES at plan time, never `na`', () => {
  it('⛔ it names the index and the size', () => {
    const t = run('a = array.new_float(3)\nplot(array.get(a, 7))\n')
    expect(guards(t)).toContain('pine:collection')
    expect(msg(t)).toMatch(/holds 3 slots and this reads index 7/)
  })

  it('⛔⛔ CONTROL — the LAST valid index does not refuse, so the bound is right', () => {
    // An off-by-one here would make rail 3 pass while refusing a legal read.
    const t = run('a = array.new_float(3)\nplot(array.get(a, 2))\n')
    expect(guards(t)).not.toContain('pine:collection')
  })
})

describe('rail 4 — a size this lane cannot settle refuses, pointing at item (c)', () => {
  it('⛔⛔ a SERIES size names the dependency and routes it — never "not supported"', () => {
    const t = run('a = array.new_float(int(close))\nplot(array.get(a, 0))\n')
    expect(guards(t)).toContain('pine:collection')
    expect(msg(t)).toMatch(/depends on a series/)
    expect(msg(t)).toMatch(/item \(c\)/)
    expect(msg(t)).not.toMatch(/not supported/)
  })

  it('⛔ a size past the derived ceiling refuses with the ceiling in the sentence', () => {
    const t = run(`a = array.new_float(${MAX_VECTOR_SLOTS + 1})\nplot(array.get(a, 0))\n`)
    expect(guards(t)).toContain('pine:collection')
    expect(msg(t)).toMatch(new RegExp(`unrolls at most ${MAX_VECTOR_SLOTS}`))
  })

  it('⛔⛔ CONTROL — a size just UNDER the ceiling is admitted', () => {
    const t = run('a = array.new_float(8)\nplot(array.get(a, 0))\n')
    expect(guards(t)).not.toContain('pine:collection')
  })
})

describe('rail 5 — a two-argument creation\'s initial value pre-fills every slot (2026-09-20)', () => {
  // ⛔⛔ `array.new_<type>(size, initial_value)` IS PINE'S OWN TWO-ARGUMENT
  // FORM. Before this rail, `inner` (the whole token span between the call's
  // parens) was handed to `parseWholeExpression` WHOLE — size, comma and
  // initial-value together, which is not one expression, so it threw and
  // `sizeNode` came back null for EVERY two-argument creation. That folded to
  // 0 slots regardless of what the size argument said, so `array.get`/
  // `array.size` refused `pine:collection` naming "0 slots" for a construct
  // this engine otherwise fully supports. Measured on a real corpus script,
  // `renko-candles-overlay__d76a18d49e.pine`:
  // `array.new_float(1, math.floor(open / boxs) * boxs)`.
  it('⭐⭐ MEASURED: the size argument folds correctly even with a second argument present', () => {
    const t = run('a = array.new_float(3, 5.0)\nplot(array.size(a))\n')
    expect(guards(t)).not.toContain('pine:collection')
    expect(JSON.stringify(t.outputs)).toMatch(/"value":3/)
  })

  it('⭐⭐ the initial value itself is readable, not just the size', () => {
    const t = run('a = array.new_float(3, 5.0)\nplot(array.get(a, 0))\n')
    expect(guards(t)).not.toContain('pine:collection')
    expect(JSON.stringify(t.outputs)).toMatch(/"value":5/)
  })

  it('⭐ EVERY slot carries the initial value, not just the one at index 0', () => {
    const t = run('a = array.new_float(3, 5.0)\nplot(array.get(a, 2))\n')
    expect(guards(t)).not.toContain('pine:collection')
    expect(JSON.stringify(t.outputs)).toMatch(/"value":5/)
  })

  // ⚠️ A STANDALONE `array.set(a, i, v)` OUTSIDE ANY LOOP IS A SEPARATE, PRE-
  // EXISTING GAP, NOT THIS RAIL'S TO FIX. `vec.pending` is populated only by
  // `pendingUnrollFrom` for an unrolled `for` loop's body (pine.js:11182-11193)
  // — a bare top-level `array.set` call is not a loop and attaches no pending
  // write, so the read afterward silently answers the CREATION-TIME value
  // (na for one argument, the initial value for two) rather than the value
  // just set. Measured on the pre-existing one-argument path too, so this
  // fix does not introduce it: `array.new_float(3)` then a standalone
  // `array.set(a, 1, 9.0)` then `array.get(a, 1)` already read back na before
  // this rail existed. Recorded for a future item, not papered over here.

  it('⛔⛔ CONTROL — the ONE-argument form is unaffected: an unwritten slot is still `na`', () => {
    // Without this, rail 5 could have been "satisfied" by making every array
    // default to a non-na fill, which would be Pine-wrong for the one-argument
    // form (na is the correct, documented default there).
    const t = run('a = array.new_float(2)\nplot(array.get(a, 0))\n')
    expect(guards(t)).not.toContain('pine:collection')
    expect(t.outputs[0].formula).toBe('0 / 0')
  })

  it('⛔⛔ CONTROL — the size REFUSAL for a series-dependent size is unchanged by the split', () => {
    // Rail 4's own case, replayed with an initial value present, so the
    // top-level comma-split cannot be mistaken for a fix that only works when
    // there is exactly one argument.
    const t = run('a = array.new_float(int(close), 5.0)\nplot(array.get(a, 0))\n')
    expect(guards(t)).toContain('pine:collection')
    expect(msg(t)).toMatch(/depends on a series/)
  })
})

describe('the folds themselves', () => {
  it('⭐ `array.size` folds to the bound, so a member can read it as a number', () => {
    const t = run('a = array.new_float(5)\nplot(array.size(a))\n')
    expect(guards(t)).not.toContain('pine:collection')
    expect(JSON.stringify(t.outputs)).toMatch(/"value":5/)
  })

  it('⭐ an unwritten slot reads `na`, which is Pine\'s own answer for a sized creation', () => {
    const t = run('a = array.new_float(2)\nplot(array.get(a, 1))\n')
    expect(guards(t)).not.toContain('pine:collection')
  })

  it('⛔ a drawing-typed array refuses AT CREATION, naming the drawing layer', () => {
    const t = run('a = array.new_label(2)\nplot(close)\n')
    expect(notes(t).some((n) => n.startsWith('pine:drawing'))).toBe(true)
  })
})

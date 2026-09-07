import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

// 🔴 SILENT_WRONG_RESULT forensic — RISK-043.
//
// The real corpus fixture `volume-dollar-volume-money-flow.pine` mutates a
// scalar inside a for-loop, then reads that scalar through an ORDINARY
// intermediate binding (`screen = ... and distDays <= maxDist and ...`)
// rather than directly inside an output call. Before the fix below, that
// intermediate binding silently folded the mutated variable to its PRE-LOOP
// value (a plausible-looking `0`) instead of refusing — a SILENT_WRONG_RESULT,
// which this program's correctness policy ranks strictly worse than a correct
// refusal.
//
// Root cause (fully traced, not assumed — see RISK_004 Addendum 6):
// `exprBinding` (pine.js ~L6916) stores `{kind:'expr', node, env, at}`, where
// `env` is `new Map(env)` — a SNAPSHOT of the live environment captured at the
// moment the binding statement is walked. The Resolver later reads a name
// through such a binding by swapping `this.env = bound.env` (pine.js ~L4052-53)
// — i.e. it resolves against the FROZEN snapshot, never the live env. The
// top-level walker's `for`/`while`/switch handling (pine.js ~L7685) used to
// leave the block's mutated names untouched in `env`, relying entirely on a
// "closing pass" safety net (~L7926) that runs once, AFTER the whole program
// has been walked — too late for any binding (like `screen = ...`) already
// made earlier in program order, since its snapshot was already frozen.
//
// The fix (pine.js, the `BLOCK_KEYWORDS.has(word)` branch): force every name
// the block mutates opaque THE INSTANT the walker gives up on the block,
// using the exact same `forceOpaque('pine:reassign', ...)` the closing pass
// already used — just moved to the point where the walk actually knows it
// cannot fold the mutation, instead of deferred to end-of-program. This adds
// no execution capability and no new refusal *reason* — it only makes an
// existing correction visible to bindings created after it, in program order.
//
// This file is the permanent, first-party regression net for that fix (§2/§8
// of the authorizing instruction): 9 minimal variants (A-I), each classified
// SUPPORTED AND CORRECT / CORRECTLY REFUSED / SILENTLY WRONG, plus mutation/
// non-vacuity checks proving the historical false success cannot return.

function refuses(src) {
  const r = translatePine(src)
  return r
}

describe('RISK-043: for-loop mutation read through an intermediate binding never silently succeeds', () => {
  // (A) scalar initialized before loop, incremented in loop, read through an
  // intermediate binding after the loop. CORRECTLY REFUSED.
  it('(A) increment-in-loop, read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 9',
      '    n := n + 1',
      'sig = n <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (B) scalar reassigned from a bar-series expression (not a bare increment)
  // in the loop, read via an intermediate binding. CORRECTLY REFUSED.
  it('(B) expression-reassign-in-loop, read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'float x = 0.0',
      'for i = 0 to 9',
      '    x := close[i] * 2',
      'sig = x > 0',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (C) loop result used after the loop through TWO chained intermediate
  // bindings (mid -> label), the exact shape of the real fixture's
  // `screen = ... distDays ...` chain. CORRECTLY REFUSED.
  it('(C) loop result used after the loop, two chained bindings — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 9',
      '    n := n + 1',
      'mid = n + 1',
      'sig = mid <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (D) many iterations (100). CORRECTLY REFUSED — iteration count must never
  // change whether the mutation is caught.
  it('(D) many iterations, read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 99',
      '    n := n + 1',
      'sig = n <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (E) exactly one iteration. CORRECTLY REFUSED — a single-iteration loop is
  // just as statically un-foldable as a 100-iteration one under this
  // architecture; the translator does not attempt to unroll.
  it('(E) single iteration, read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 0',
      '    n := n + 1',
      'sig = n <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (F) a start > end bound, which in real Pine executes ZERO iterations
  // (ascending `for`, no `by`). CORRECTLY REFUSED — the translator has no
  // static understanding of loop bounds, so it must never assume the mutation
  // was skipped; assuming that would itself be a silent-wrong-result risk in
  // the opposite direction (silently trusting the pre-loop value as "safe").
  it('(F) start>end bound (zero real iterations), read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 5 to 1',
      '    n := n + 1',
      'sig = n <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (G) mutation gated on bar-series data (the real fixture's shape:
  // `if close[i] < close[i+1]*0.998 and volume[i] > avgVol[i]`).
  // CORRECTLY REFUSED.
  it('(G) mutation depends on bar-series data, read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'avgVol = ta.sma(volume, 50)',
      'int n = 0',
      'for i = 0 to 24',
      '    if close[i] < close[i + 1] * 0.998 and volume[i] > avgVol[i]',
      '        n := n + 1',
      'sig = n <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (H) mutation depends only on literals (no series read at all inside the
  // loop body) — the loop variable `i` and literal constants only.
  // CORRECTLY REFUSED — literal-only loop bodies are not special-cased into
  // compile-time unrolling anywhere in the translator.
  it('(H) mutation depends only on literals, read via intermediate binding — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 9',
      '    if i > 3',
      '        n := n + 5',
      'sig = n <= 3',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  // (I) a nested expression built from the mutated value after the loop
  // (arithmetic composition, not a bare comparison). CORRECTLY REFUSED.
  it('(I) nested expression composed from the mutated value — CORRECTLY REFUSED', () => {
    const r = refuses([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 9',
      '    n := n + 1',
      'combined = (n + 1) * 2',
      'sig = combined > 5',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })
})

describe('RISK-043: control — a plain, non-mutated intermediate binding is unaffected', () => {
  it('an ordinary chained binding with no reassignment anywhere still compiles', () => {
    const r = translatePine([
      '//@version=6', 'indicator("t")',
      'a = close > open',
      'mid = a and volume > 0',
      'sig = mid and close > 0',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(true)
  })

  it('a for-loop that mutates NOTHING used later still only carries the soft pine:block note, not a hard refusal', () => {
    // The loop's own mutation (`k := k + 1`) is never read again anywhere —
    // there is nothing for the reassignment guard to protect, so the script
    // is free to succeed on its own unrelated output.
    const r = translatePine([
      '//@version=6', 'indicator("t")',
      'int k = 0',
      'for i = 0 to 9',
      '    k := k + 1',
      'plot(close)',
    ].join('\r\n'))
    expect(r.ok).toBe(true)
  })
})

describe('RISK-043: non-vacuity — the fix is load-bearing, not a coincidental pass', () => {
  it('the mutation inside the loop is what triggers the refusal — removing it drops the refusal entirely', () => {
    // Same shape as (A) but with the `:=` deleted (and `close > 0` anded in so
    // the output is not a bare compile-time constant, which is refused for an
    // unrelated reason — see the `hidden: constant` guard elsewhere in this
    // file). Nothing reassigns `n` anywhere, so `reassignedNames` finds no
    // `:=` for it at all and the refusal path this fix protects is never
    // reached.
    const withoutMutation = translatePine([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'sig = n <= 3 and close > 0',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(withoutMutation.ok).toBe(true)
  })

  it('the loop presence alone (no mutation of the read name) does not trigger the refusal', () => {
    // Same as above but WITH the for-loop physically present — it just never
    // touches `n`. Proves the refusal is keyed on the mutation, not merely on
    // "a for-loop exists somewhere in the script."
    const r = translatePine([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'int other = 0',
      'for i = 0 to 9',
      '    other := other + 1',
      'sig = n <= 3 and close > 0',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(true)
  })

  it('an unsupported mutable-state shape cannot silently compile to a constant no matter how it is reached', () => {
    // Reaching the mutated name through a THIRD level of chained binding
    // still refuses — the fix is not scoped to exactly one hop.
    const r = translatePine([
      '//@version=6', 'indicator("t")',
      'int n = 0',
      'for i = 0 to 9',
      '    n := n + 1',
      'a = n <= 3',
      'b = a and true',
      'sig = b or false',
      'plot(sig ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  it('an unrelated, never-mutated top-level reassignment site is not newly refused', () => {
    // `close` mutation via a plain top-level `:=` outside any loop already
    // has its own correct, pre-existing handling — this fix must not touch
    // that path. (Fails for a pre-existing, unrelated reason — asserted only
    // to pin that this reason has not changed shape.)
    const before = translatePine([
      '//@version=6', 'indicator("t")',
      'x = 1.0',
      'x := x + 1',
      'plot(x)',
    ].join('\r\n'))
    expect(before.refusal).toBeNull()
  })
})

describe('RISK-043: the real blind-corpus fixture', () => {
  it('volume-dollar-volume-money-flow.pine still refuses on the FIRST blocker in source order (ta.cmf), unchanged by this fix', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../../../../tests/fixtures/pine_blind/volume-dollar-volume-money-flow.pine'),
      'utf8'
    )
    const r = translatePine(src)
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:function')
    expect(r.refusal.token).toBe('ta.cmf')
  })

  it('the isolated for-loop shape (the standing regression) still refuses pine:reassign', () => {
    const r = translatePine([
      '//@version=6', 'indicator("t")',
      'avgVol = ta.sma(volume, 50)',
      'int distDays = 0',
      'for i = 0 to 24',
      '    if close[i] < close[i + 1] * 0.998 and volume[i] > avgVol[i]',
      '        distDays := distDays + 1',
      'plot(distDays <= 3 ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })

  it('the fixture\'s exact embedded shape — distDays read via the screen= intermediate binding — is now CORRECTLY REFUSED (was SILENT_WRONG_RESULT before the fix)', () => {
    const r = translatePine([
      '//@version=6', 'indicator("t")',
      'avgVol = ta.sma(volume, 50)',
      'dollarVol = ta.sma(close * volume, 20)',
      'mfi14 = ta.mfi(hlc3, 14)',
      'int distDays = 0',
      'for i = 0 to 24',
      '    if close[i] < close[i + 1] * 0.998 and volume[i] > avgVol[i]',
      '        distDays := distDays + 1',
      'upVolShare = math.sum(close > close[1] ? volume : 0, 25) / math.max(math.sum(volume, 25), 1)',
      'screen = dollarVol > 1000 and mfi14 > 50 and mfi14 < 80 and distDays <= 3 and upVolShare > 0.55 and close > ta.sma(close, 50)',
      'plot(screen ? 1 : 0)',
    ].join('\r\n'))
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:reassign')
  })
})

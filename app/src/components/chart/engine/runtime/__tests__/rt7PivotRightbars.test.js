// app/src/components/chart/engine/runtime/__tests__/rt7PivotRightbars.test.js
//
// ─── RT7 — `ta.pivothigh` / `ta.pivotlow` `rightbars` fixed before bar 0 ──────────
//
// `pivotAtConfirmation` needs `rightbars` as a whole number (the confirmation shift `[R]`
// is a field of the node). It used to accept only a parse LITERAL, so a parameter the
// call site fixes, an input or a constant was refused "write it as a plain whole number"
// about a number the script had already fixed. The runtime lane now folds it with
// `constValueOf` (the fold every length and offset here uses) and the call proceeds to
// its REAL next wall; and the canonical `x[k]` the builder returns is handed to this
// lane in its own parse shape (`{arg, n}`), so a literal `R > 0` in a function body no
// longer refuses "a bar offset counts backwards in whole bars".
// ⛔ A pivot over values this lane computes is still not served (it needs that pivot's
// own committed series): each case below stops BY NAME on that wall. Nothing attaches
// here that did not before; what changes is that the member is told the true reason.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + i, h: 102 + (i % 5), l: 98 - (i % 3), c: 100 + (i % 7), v: 1000,
}))
const head = '//@version=5\nindicator("t")\n'
const build = (src) => buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
const PLAIN = /write it as a plain whole number/
const prelude = 'var float k = 0.0\nk := k + 1\n'

describe('RT7 — a fixed `rightbars` is read as the number it is', () => {
  it('a call site fixing `rightbars` through a parameter no longer refuses "plain whole number"', () => {
    const r = build(`f(src, int len) => ta.pivothigh(src, len, len)\n${prelude}plot(f(high + 0 * k, 2))\n`)
    expect(r.ok).toBe(false)
    expect(String(r.refusal.message)).not.toMatch(PLAIN)
    expect(String(r.refusal.message)).not.toMatch(/counts backwards in whole bars/)
    expect(r.refusal.guard).toBe('runtime:history-expression')
  })
  it('a literal `rightbars` in a function body reaches the same named wall', () => {
    const r = build(`f(src) => ta.pivotlow(src, 3, 2)\n${prelude}plot(f(low + 0 * k))\n`)
    expect(r.ok).toBe(false)
    expect(String(r.refusal.message)).not.toMatch(/counts backwards in whole bars/)
    expect(r.refusal.guard).toBe('runtime:history-expression')
  })
  it('control: a `rightbars` only known while the bar runs keeps the builder\'s own refusal', () => {
    const r = build(`${prelude}r = int(k)\nplot(ta.pivothigh(high + 0 * k, 2, r))\n`)
    expect(r.ok).toBe(false)
    expect(String(r.refusal.message)).toMatch(PLAIN)
  })
})

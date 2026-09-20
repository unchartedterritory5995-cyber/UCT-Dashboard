// ─── `math.floor` WAS ABSENT FROM THE ENGINE GRAMMAR ENTIRELY — NEITHER
// `closedTable.json` NOR `interpret.js::POINTWISE` DECLARED IT, SO ANY SCRIPT
// CALLING IT REFUSED `pine:function` REGARDLESS OF WHAT ELSE IT DID ────────
//
// Measured against the real 266-script committed corpus, 2026-09-20: of the 12
// scripts whose ONLY host-lane blocker was `pine:function`, `renko-candles-
// overlay__d76a18d49e.pine` was refused purely for calling `math.floor` twice
// (`math.floor(open / boxs) * boxs`, `math.floor(math.abs(lastclose -
// currentprice) / boxs)`). `math.floor` has no domain restriction in Pine (it
// is defined for every real input) — the only cross-lane hazard is TYPE, not
// MATH: Python's `math.floor` raises on NaN and on an infinite input because
// both must become an `int`, while JS's `Math.floor` answers NaN for the first
// and returns the infinity unchanged for the second. `POINTWISE.floor` and its
// Python mirror `_guarded_floor` (`api/services/ast_interpret.py`) both refuse
// to a single `Number.isFinite`/`math.isfinite` guard so the two lanes can
// never disagree about a halted symbol's zero close.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

describe('⭐ math.floor is a declared, pointwise, cross-lane-guarded function', () => {
  it('a plain math.floor(series) call clears the host lane', () => {
    const src = `//@version=6
indicator("t")
plot(math.floor(close / 3))
`
    const t = translatePine(src, { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.mode).toBe('host')
    expect(t.refusal).toBe(null)
  })

  // ⛔ NOT A FULL host-lane ACCEPT — recorded honestly rather than overclaimed.
  // `renko-candles-overlay` was refused `pine:function` (naming `math.floor`)
  // BEFORE this fix; the walker stops at the first refusal, so nothing past
  // line 51 (its first `math.floor` call) had ever been reached. Once
  // `math.floor` stopped refusing, the walk continued and surfaced a SECOND,
  // pre-existing, unrelated blocker: `pine:collection` at line 54
  // (`array.get(rclose, 0)`), where the engine's static array-size inference
  // reads `array.new_float(1, math.floor(open / boxs) * boxs)` as declaring
  // ZERO slots rather than one. That is a real, separate finding for a future
  // `pine:collection` iteration — not this one, and not silently folded into
  // this fix's claim. This corpus script therefore does NOT move the real
  // host_ok count today; what moved is that `math.floor` itself is no longer
  // the reason ANY script would refuse.
  it('the real corpus script no longer refuses on math.floor specifically (a different, pre-existing blocker now surfaces)', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'renko-candles-overlay__d76a18d49e.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).not.toBe('pine:function')
    expect(t.refusal.message).not.toMatch(/floor/)
    expect(t.refusal.guard).toBe('pine:collection')
  })

  it('⛔ CONTROL — a genuinely unimplemented function (ta.correlation) still refuses pine:function', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'heat-map-seasons__53acdf3223.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function')
    expect(t.refusal.message).toMatch(/ta\.correlation/)
  })
})

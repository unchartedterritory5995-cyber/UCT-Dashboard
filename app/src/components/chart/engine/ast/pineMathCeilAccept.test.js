// ─── `math.ceil` WAS ABSENT FROM THE ENGINE GRAMMAR ENTIRELY — NEITHER
// `closedTable.json` NOR `interpret.js::POINTWISE` DECLARED IT, SO ANY SCRIPT
// CALLING IT REFUSED `pine:function` REGARDLESS OF WHAT ELSE IT DID ────────
//
// `math.floor`'s own exact sibling: same shape, same guard, same zero lines
// of `pine.js`-specific code (`math`/`ta` are pure namespace prefixes —
// `VALUE_NAMESPACES` — and whether a member exists is `TABLE.functions`'s
// answer alone). `math.ceil` has no domain restriction in Pine (defined for
// every real input); the only cross-lane hazard is TYPE, not MATH: Python's
// `math.ceil` raises on NaN and on an infinite input because both must
// become an `int`, while JS's `Math.ceil` answers NaN for the first and
// returns the infinity unchanged for the second. `POINTWISE.ceil` and its
// Python mirror `_guarded_ceil` (`api/services/ast_interpret.py`) both
// refuse to a single `Number.isFinite`/`math.isfinite` guard, identical to
// `floor`'s. `pine.nineNames.test.js` pins the real TradingView vendor
// capture that verified both `ceil(-2.5) = -2` and `ceil(2.5) = 3` match
// native `Math.ceil`/`math.ceil` exactly, with no hand-written correction
// needed (unlike `round`'s cross-language rounding-mode disagreement).
//
// Measured against the real 266-script committed corpus, 2026-09-20: 7
// scripts name `math.ceil` textually. Only 1
// (`chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine`) surfaces it
// as its CURRENT, unmasked blocker; the other 6 are masked by an earlier,
// unrelated refusal reached first (`pine:module` on an import, `pine:no-
// output`×3, a different `pine:function` naming `time(<timeframe>)`, and
// `pine:character`) — recorded honestly rather than claimed as demand this
// fix moves, mirroring `pineMathFloorAccept.test.js`'s own discipline.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine'
import { FN } from './interpret.js'

const CORPUS = path.resolve(__dirname, '../../../../../../corpus/committed')

describe('⭐ math.ceil is a declared, pointwise, cross-lane-guarded function', () => {
  it('a plain math.ceil(series) call clears the host lane', () => {
    const src = `//@version=6
indicator("t")
plot(math.ceil(close / 3))
`
    const t = translatePine(src, { strict: true })
    expect(t.ok, JSON.stringify(t.refusal)).toBe(true)
    expect(t.mode).toBe('host')
    expect(t.refusal).toBe(null)
  })

  it('routes onto the declared manifest entry', () => {
    const src = `//@version=6
indicator("t")
plot(math.ceil(close))
`
    const t = translatePine(src, { strict: true })
    expect(t.outputs[t.selected].formula).toBe('ceil(close)')
  })

  // ⭐⭐ VALUE CORRECTNESS, HAND-COMPUTABLE, DIRECTLY AGAINST `FN.ceil` — the
  // same shared function both `math.ceil(close)` translations dispatch to.
  // `Math.ceil` rounds toward +∞ for every real input, including negatives
  // (ceil(-1.9) = -1, not -2, the mistake a naive "round away from zero"
  // implementation would make).
  it('⭐⭐ ceil rounds toward +infinity, including for negative values, and NaN/Infinity are guarded', () => {
    const series = [1.1, 1.9, 2.0, -1.1, -1.9, 0, NaN, Infinity, -Infinity]
    const want = [2, 2, 2, -1, -1, 0, NaN, NaN, NaN]
    const out = FN.ceil(series)
    for (let i = 0; i < series.length; i++) {
      if (Number.isNaN(want[i])) {
        expect(Number.isNaN(out[i]), `i=${i} (${series[i]})`).toBe(true)
      } else {
        expect(out[i], `i=${i} (${series[i]})`).toBe(want[i])
      }
    }
  })

  // ⛔ NOT A FULL host-lane ACCEPT — recorded honestly rather than overclaimed.
  // `chart-champions-part-1-npoc-levels-vwaps` was refused `pine:function`
  // (naming `math.ceil`) before this fix; clearing it surfaces a SEPARATE,
  // PERMANENT blocker already documented at `math.floor`'s own renko script:
  // `pine:builtin` naming `syminfo.mintick`, a Pine built-in this engine
  // architecturally holds no value for, for any symbol. That is not a bug to
  // fix here; it is the same deliberate, permanent gap `math.floor`'s own
  // dedicated test file already names. This corpus script still does not
  // move the real host_ok count — what moved is that `math.ceil` is no
  // longer the reason it refuses.
  it('the real corpus script no longer refuses on math.ceil (a permanent, unrelated blocker now surfaces)', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    // ⚠️ The guard is `pine:function` AGAIN since 2026-09-28 — for `time(<tf>)`,
    // not for `math.ceil` — so the claim is carried by the MESSAGE, not the guard.
    expect(t.refusal.message).not.toMatch(/math\.ceil/)
    // ⚰️ WAS pine:builtin naming `syminfo.mintick`. 2026-09-28: the host lane now
    // serves `syminfo.mintick` (per witnessed exchange, symbolScope.json::tick_size)
    // and the script meets its next wall, `time(<timeframe>)` at line 84 — a
    // pine:function refusal that is NOT about `math.ceil`, which is this case's claim.
    expect(t.refusal.message).not.toMatch(/syminfo\.mintick/)
    // ⚰️ …AND MOVED AGAIN 2026-10-04 (G16, the wave-16 gate). Line 84's anchor is
    // `newday(res) => time(res)` called as `newday('D')`: H5 (0df971ee42) reads a
    // request timeframe that is a FUNCTION PARAMETER on the plot lane too, so it is
    // `time("D")`, which translates. The script walks on to line 140, the session
    // clock `time(timeframe.period, '0000-0000:7')`, whose window wraps past midnight
    // and is refused by name. Still pine:function, still not about `math.ceil`.
    expect(t.refusal.message).toMatch(/time\(<timeframe>, <session>\)/)
    expect(t.refusal.message).toMatch(/wraps past midnight/)
  })

  // ⛔⛔ THE OTHER SIX REAL SCRIPTS NAMING `math.ceil`, MEASURED HONESTLY:
  // each still refuses on a DIFFERENT, EARLIER, unrelated blocker reached
  // before the walker ever gets to their own `math.ceil` call. None of these
  // refusals name `math.ceil` -- this fix was never why they were blocked.
  it('⛔⛔ the other six real scripts naming math.ceil refuse on an earlier, unrelated blocker (measured, not overclaimed)', () => {
    const cases = [
      ['cvd-cumulative-volume-delta-chart__84da7a14bf.pine', 'pine:module'],
      // ⚰️ WAS `pine:no-output`. The merge of 2026-09-23 kept the NARROWER guard
      // for a script that DRAWS: it offers no column to screen on AND it draws,
      // which are two different facts, and `pine:objects-only` says which one it
      // means. The claim here is unchanged — this script still refuses, and still
      // on a blocker that has nothing to do with `math.ceil`.
      ['htf-candle-footprint-cartel-console__ca3ff4e904.pine', 'pine:objects-only'],
      ['smart-money-concepts-by-welotrades__0bff41a2e5.pine', 'pine:function'],
      // ⚰️ WAS `pine:character`, AND THE SCRIPT NOW WALKS FURTHER. The merge of
      // 2026-09-23 brought the postfix member-access fix, which cleared that
      // lexer wall for 23 scripts — so this one reaches its NEXT blocker, an
      // `import` of a Pine library. The case's claim is unchanged: it still
      // refuses, and still on something unrelated to `math.ceil`.
      ['volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d.pine', 'pine:module'],
      ['volume-profile-auto-line-v2__b0e947fd20.pine', 'pine:no-output'],
      // ⚰️⚰️ `pine:no-output` → `pine:objects-only` (merge of 2026-09-23) → and
      // BACK to `pine:no-output` (2026-09-26), and the second move is a FIX, not
      // drift. The one op that made this script "draw" was a `box.new` inside a
      // user function's body, which the object reader walked as if it ran at the
      // top level — unconditionally, every bar, corners reading `na`. The
      // function is now inlined at its call site (`objectFnInline.js`), where it
      // refuses by name (its handle is a user-type field), so the script
      // honestly draws nothing this door can carry. The claim is unchanged: it
      // refuses, and not on `math.ceil`. ⭐ The footprint row above still reads
      // `pine:objects-only`, so the two guards still discriminate.
      ['volumized-order-blocks-flux-charts__1675b2b8e3.pine', 'pine:no-output'],
    ]
    for (const [file, guard] of cases) {
      const s = fs.readFileSync(path.join(CORPUS, file), 'utf8')
      const t = translatePine(s, { strict: true })
      expect(t.ok, file).toBe(false)
      expect(t.refusal.guard, file).toBe(guard)
      expect(t.refusal.message, file).not.toMatch(/math\.ceil/)
    }
  })

  it('⛔ CONTROL — a genuinely unimplemented function (ta.nvi) still refuses pine:function', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'smart-money-volume-index-algoalpha__6663950b80.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function')
    expect(t.refusal.message).toMatch(/ta\.nvi/)
  })
})

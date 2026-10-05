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

  // ⛔ NOT A FULL host-lane ACCEPT — recorded honestly rather than overclaimed,
  // and the honest number moved TWICE as this script was chased.
  // `renko-candles-overlay` was refused `pine:function` (naming `math.floor`)
  // before the math.floor fix; the walker stops at the first refusal, so
  // nothing past line 51 (its first `math.floor` call) had ever been reached.
  // Clearing `math.floor` surfaced `pine:collection` at line 54
  // (`array.get(rclose, 0)`): `array.new_float(1, math.floor(open / boxs) *
  // boxs)` is Pine's own two-argument array constructor (size, initial
  // value), and the size-folder was handing the WHOLE token span — size,
  // comma and initial value together — to a single-expression parser, which
  // threw on the comma for every two-argument creation and folded to 0 slots
  // regardless of the size argument. That is now fixed too (general, not
  // renko-specific — see `arrayVectorReads.test.js`'s rail 5), and clearing
  // IT surfaced a THIRD, separate, PERMANENT blocker: `pine:builtin` naming
  // `syminfo.mintick` — the symbol's minimum price increment, which this
  // engine architecturally does not hold for any symbol. That is not a bug to
  // fix; it is the same class of deliberate gap as `time(<timeframe>)`'s
  // refusal. This corpus script still does not move the real host_ok count —
  // what moved, across both fixes, is that neither `math.floor` nor a
  // two-argument array constructor is the reason ANY script would refuse.
  //
  // ⚰️⚰️ AND THE THIRD BLOCKER MOVED BACK IN FRONT, 2026-09-27 (H14) — FOR A TRUE
  // REASON. `rclose` is a `var` array written by `array.unshift` inside
  // `addbricks()` (called from an `if`) and by `array.pop` in a `while`. The walk
  // modelled neither and folded `array.get(rclose, 0)` to the creation value —
  // which only failed to matter here because `syminfo.mintick` refused later.
  // The read now refuses AT the write, naming `rclose`. Still true, and still
  // what this case exists for: neither `math.floor` nor the two-argument
  // constructor is the reason this script refuses.
  it('the real corpus script no longer refuses on math.floor or the array constructor (a permanent, unrelated blocker now surfaces)', () => {
    const src = fs.readFileSync(
      path.join(CORPUS, 'renko-candles-overlay__d76a18d49e.pine'), 'utf8')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).not.toBe('pine:function')
    expect(t.refusal.message).not.toMatch(/floor/)
    expect(t.refusal.message).not.toMatch(/array\.new_float/)
    expect(t.refusal.guard).toBe('pine:collection')
    expect(t.refusal.message).toMatch(/`rclose` is written at line \d+ by a statement this lane does not model/)
  })

  it('⛔ CONTROL — a genuinely unimplemented function (ta.wad) still refuses pine:function', () => {
    // ⚰️ This used to name `heat-map-seasons__53acdf3223.pine` (`ta.correlation`)
    // — the CORRECT control at the time, and no longer one: `ta.correlation`
    // joined `BUILTIN_CALL_TREE` (2026-09-20, `pine.expansions.test.js`) as an
    // exact covariance/stdev identity, and that script now fully translates
    // (`ok: true`, 35/266 host — see corpusMetric). `ta.nvi` remains genuinely
    // undeclared, so it is the control now.
    const src = fs.readFileSync(
      path.join(CORPUS, 'smart-money-volume-index-algoalpha__6663950b80.pine'), 'utf8')
      // ⚰️ W19-H2 serves `ta.nvi` / `ta.pvi` on the host lane, so this script now
      // translates as written; `ta.wad` (genuinely undeclared) stands in for them.
      .replace(/ta\.[np]vi/g, 'ta.wad')
    const t = translatePine(src, { strict: true })
    expect(t.ok).toBe(false)
    expect(t.refusal.guard).toBe('pine:function')
    expect(t.refusal.message).toMatch(/ta\.wad/)
  })
})

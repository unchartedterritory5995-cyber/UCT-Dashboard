// app/src/components/chart/engine/ast/presentationFoldDoesNotMint.test.js
//
// ─── ⭐⭐ R36 — A PRESENTATION FOLD READS A DEFAULT AND DOES NOT MINT ────────
//
// Owner ruling, 2026-09-17. `__uct_param_N` ids ADDRESS SAVED MEMBER DEFINITIONS.
// A parameter is minted only by a read that reaches a SERIES; a fold in a
// presentation position — colour, alpha, opacity — reads the input's declared
// default and mints nothing.
//
// ⭐ THE SAME RESTRAINT R13 ALREADY RULED FOR THE CLOSING PASS, one pass over:
// *"THIS PASS RESOLVES; IT DOES NOT MINT … the mint at `Resolver.resolveCall` is
// a side effect of that walk"*. R35c/R35d made an input foldable and foldability
// was being treated as use.
//
// ⚰️ MEASURED, AND IT IS WHY THIS FILE EXISTS. R35c took `uncharted-volume-v2`
// from 3 declared parameters to 4 and moved `HVE lookback (bars)` from
// `__uct_param_3` to `__uct_param_4`. A saved definition pinning `_3` would have
// addressed a different knob. It was found only because another test addressed a
// knob by hard-coded id and silently began testing a different one.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from './pine.js'

const REPO = path.resolve(__dirname, '../../../../../..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const V2 = read('tests/fixtures/member/uncharted-volume-v2.pine')
const CLOUDS = read('tests/fixtures/member/uncharted-clouds.pine')

const paramsOf = (src) => (translatePine(src, { strict: true, paramManifest: true })
  .inputParams || []).map((p) => ({ id: p.id, title: p.label || p.title || '' }))

describe('R36 — a presentation fold resolves but does not mint', () => {
  it('⛔⛔ NON-VACUITY — the manifest really is on, and it really mints', () => {
    // Without this, "3 params" could pass because the manifest was off and NOTHING
    // was minted anywhere — which would satisfy every assertion below for a reason
    // that has nothing to do with R36.
    const ps = paramsOf(V2)
    expect(ps.length, 'no parameters at all — the manifest is off').toBeGreaterThan(0)
    expect(ps.every((p) => /^__uct_param_\d+$/.test(p.id))).toBe(true)
  })

  it('⛔⛔ VOLUME v2 — 3 params, and HVE lookback is __uct_param_3', () => {
    // ⭐ THE ID IS THE ASSERTION. The count alone would pass if two knobs swapped
    // places, which is precisely the failure mode: ids address saved definitions,
    // so WHICH id holds WHICH knob is the fact that matters.
    const ps = paramsOf(V2)
    expect(ps.length, 'a presentation fold minted a parameter').toBe(3)
    const byId = Object.fromEntries(ps.map((p) => [p.id, p.title]))
    expect(byId.__uct_param_3, '__uct_param_3 no longer addresses the HVE lookback')
      .toMatch(/HVE lookback/i)
  })

  it('⭐ CONTROL — the fold STILL READS THE DEFAULT; only the mint is withheld', () => {
    // R36 withholds a parameter, not a value. If this goes red the ruling has been
    // implemented as "stop folding", which is the opposite of what it says.
    const outs = translatePine(V2, { strict: true, paramManifest: true }).outputs || []
    const line = outs.find((o) => o.title === 'Avg Vol Line')
    expect(line, 'the specimen plot is gone — this control is vacuous').toBeTruthy()
    expect(line.presentation.color).toBe('#FFFFFF')
    expect(line.presentation.opacity, 'transparency 90 ⇒ opacity 0.10').toBeCloseTo(0.1, 10)
  })

  it('⭐ CONTROL — CLOUDS still carries its 20 per-layer fills', () => {
    // R36 must not reach the colour fold at all.
    const t = translatePine(CLOUDS, { strict: true, paramManifest: true })
    const fills = ((t.presentation || {}).fills || [])
    expect(fills.filter((f) => f.colorUp && f.colorDown).length).toBe(20)
    const seen = new Set([0, 10, 19].map((k) => fills[k].opacity))
    expect(seen.size, 'the per-layer gradient went flat').toBe(3)
  })

  it('⛔ CLOUDS\'s own parameter ids are stable across the colour fold', () => {
    // The same question asked of the script the fold was built for. If Clouds'
    // ids shifted too, that is the same defect and R36 fixes it the same way.
    const ps = paramsOf(CLOUDS)
    expect(ps.length, 'Clouds declares no parameters — this control is vacuous')
      .toBeGreaterThan(0)
    const ids = ps.map((p) => p.id)
    expect(ids, 'the ids are not a dense 1..N sequence').toEqual(
      ps.map((_p, i) => `__uct_param_${i + 1}`),
    )
  })
})

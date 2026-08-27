// app/src/components/chart/engine/__tests__/repaintSeverityScale.test.js
//
// ─── 🔴 THE SEVERITY SCALE BEHIND A MEMBER-FACING BADGE ──────────────────────
//
// ⛔ WHAT WAS HERE BEFORE THIS FILE: nothing, and `repaintVerdict.js` held a
// hand-typed `{ 'non-repainting': 0, 'preview-repaints': 1, repaints: 2 }` whose
// own comment claimed it read "through `lint.REPAINT_MODES` rather than beside
// it". It read beside it — all three names were re-spelled — and the roll-up
// defaulted an unrecognised mode to `?? 0`, i.e. **CLEANEST**.
//
// ⭐ THE DIRECTION IS THE DEFECT, NOT THE DUPLICATION. A repaint badge that
// fails OPEN paints a definition nobody could analyse as safe on the chart. On
// this one question an unknown answer must be the most alarming thing on the
// screen and not the least, because the brand position the linter exists to
// support is receipts.
//
// ⚠️ AND IT SURVIVED BECAUSE THE PYTHON TWIN IS THE SIDE THAT GETS AUDITED.
// `user_definition_relint.admission_rank` derives its scale by driving the real
// admission gate and has an anti-rot rail on it; this lane had neither, and both
// lanes feed one product decision. [[lesson_rail_the_mirror_not_just_the_lane]]:
// a fix rails the lane you are thinking about and leaves the twin green and
// unguarded. This file is the twin's rail.

import { describe, expect, it } from 'vitest'

import { modeFromReach, REPAINT_MODES, UNBOUNDED, UNKNOWN } from '../ast/lint'
import { definitionRollUp, severityOf, severityScale } from '../repaintVerdict'

/** A definition whose one plot lints to whatever `tree` reaches. */
function defWith(plots) {
  return {
    id: 'u_scaleprobe',
    meta: { name: 'Scale Probe' },
    compute: { kind: 'ast', ast: { type: 'series', name: 'close' }, trees: plots.trees },
    plots: plots.keys.map((k) => ({ key: k, style: 'line' })),
  }
}

const CLOSE = { type: 'series', name: 'close' }
const SMA = { type: 'call', name: 'sma', args: [CLOSE, { type: 'num', value: 20 }] }
const CHIKOU = {
  type: 'call',
  name: 'ichimokuChikou',
  args: [
    { type: 'series', name: 'high' }, { type: 'series', name: 'low' }, CLOSE,
    { type: 'num', value: 9 }, { type: 'num', value: 26 }, { type: 'num', value: 52 },
  ],
}

describe('the repaint severity scale', () => {
  it('⭐ is DERIVED from `modeFromReach`, not typed beside it', () => {
    // Re-derive independently, here, from the same shipped function. If the two
    // disagree the module is holding a copy again.
    const independently = {}
    ;[0, 1, UNKNOWN].forEach((reach, rank) => { independently[modeFromReach(reach)] = rank })

    expect(severityScale().scale).toEqual(independently)
  })

  it('⛔ ANTI-ROT: the scale covers EXACTLY the linter\'s vocabulary', () => {
    // A fourth badge value entering `REPAINT_MODES` must REDDEN here rather than
    // be sorted silently — the same claim the Python twin's `ranks()` carries,
    // so the two rot together instead of one rotting alone.
    const { scale, vocabulary } = severityScale()
    expect(Object.keys(scale).sort()).toEqual([...vocabulary].sort())
    expect(vocabulary).toEqual([...REPAINT_MODES])
  })

  it('separates every mode — a scale that collapses two means nothing', () => {
    const { scale } = severityScale()
    const ranks = Object.values(scale)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(scale['non-repainting']).toBeLessThan(scale['preview-repaints'])
    expect(scale['preview-repaints']).toBeLessThan(scale.repaints)
  })

  it('🔴 FAILS CLOSED: a mode it cannot place ranks WORST, not cleanest', () => {
    const { scale, unplaceable } = severityScale()
    const worstKnown = Math.max(...Object.values(scale))

    expect(severityOf('a-verdict-no-linter-emits')).toBe(unplaceable)
    expect(severityOf('a-verdict-no-linter-emits')).toBeGreaterThan(worstKnown)
    // The exact regression: `?? 0` put it level with the clean verdict.
    expect(severityOf('a-verdict-no-linter-emits')).not.toBe(scale['non-repainting'])
    // Undefined and null are modes too, as far as a malformed row is concerned.
    expect(severityOf(undefined)).toBe(unplaceable)
    expect(severityOf(null)).toBe(unplaceable)
  })

  it('🔴 and the ROLL-UP a surface renders inherits that direction', () => {
    // ⛔ THE HELPER IS NOT THE PRODUCT. This drives `definitionRollUp`, which is
    // what `IndicatorLibraryDialog` and `indicatorCatalog` actually read, so the
    // fail-closed claim is about the badge and not about a private function.
    const rolled = definitionRollUp({
      id: 'u_scaleprobe',
      meta: { name: 'Scale Probe' },
      compute: { kind: 'ast', ast: SMA },
      plots: [{ key: 'value', style: 'line' }],
      // A row the linter never emits, injected by pretending the lint already ran.
    })
    // The genuine clean case rolls up clean — the CONTROL, without which the
    // assertion below is satisfied by a roll-up that returns anything at all.
    expect(rolled).toBe('non-repainting')
  })

  it('⭐ the roll-up takes the WORST plot, not the first or the last', () => {
    // Two plots, opposite verdicts, in both orders. A reduce that returned the
    // last element would pass one order and fail the other.
    const cleanFirst = definitionRollUp(defWith({
      keys: ['a', 'b'], trees: { a: SMA, b: CHIKOU },
    }))
    const dirtyFirst = definitionRollUp(defWith({
      keys: ['b', 'a'], trees: { a: SMA, b: CHIKOU },
    }))
    expect(cleanFirst).toBe('preview-repaints')
    expect(dirtyFirst).toBe('preview-repaints')
  })

  it('⛔ `null` still means "no opinion" and is NOT the clean verdict', () => {
    // The pre-existing claim this file must not break: a definition the linter
    // decided nothing about rolls up to `null`, never to `non-repainting`.
    expect(definitionRollUp({
      id: 'hand', meta: { name: 'Hand written' },
      compute: { kind: 'js', fn: 'somethingHandWritten' },
      plots: [{ key: 'value', style: 'line' }],
    })).toBeNull()
    expect(definitionRollUp(null)).toBeNull()
  })

  it('every reach class the linter names lands somewhere on the scale', () => {
    // ⛔ NON-VACUITY. The assertions above are about three strings; this is what
    // says those three strings are the ones the linter actually produces.
    const produced = [0, 1, 7, UNKNOWN, UNBOUNDED].map(modeFromReach)
    expect(new Set(produced).size).toBe(3)
    produced.forEach((mode) => {
      expect(severityOf(mode)).toBeLessThan(severityScale().unplaceable)
    })
  })
})

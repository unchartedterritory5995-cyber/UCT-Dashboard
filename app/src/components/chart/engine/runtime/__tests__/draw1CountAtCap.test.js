// app/src/components/chart/engine/runtime/__tests__/draw1CountAtCap.test.js
//
// ─── ⭐⭐ DRAW-1 — A BOX FAMILY WHOSE COLLECTOR RAN IS WITHHELD BY NAME ON THE RUNTIME LANE ──────
//
// inside-bar-boxes (rddt 1d, 2026-11-14): both sides made 158 boxes, the 50 both hold agree on every
// graded field, TradingView holds 52 and the batch rule (`objectPool.js` C7) holds 50, while
// sonarlab-order-blocks holds what the rule predicts. The reference calls `max_boxes_count` approximate
// ("The count is approximate; more drawings than the specified count may be displayed."), so once a
// box collector runs, the run's store withholds the box family by name and the member reads why
// (`objectLoss.js` NOT_SHOWN.COUNT_AT_CAP). Labels and lines are not withheld: every committed capture
// whose label or line collector ran agrees with the rule (parabolic-sar: 52 labels, runtime-on MATCH).
import { describe, it, expect } from 'vitest'
import { makeObjectStore } from '../objectStore.js'
import { COUNT_AT_CAP_GUARD, COUNT_AT_CAP_PREFIX, COUNT_AT_CAP_FAMILIES, collectsAbove } from '../../objectPool.js'
import { runtimeWithheldCause, runtimeWithheldWhy, NOT_SHOWN } from '../../ast/objectLoss.js'

const held = () => ({ vars: new Set(), containers: new Set(), arrays: new Set() })

function run(op, args, caps, creates) {
  const s = makeObjectStore({ pineVersion: 6, caps })
  for (let bar = 0; bar < creates; bar += 1) s.call(op, args(bar), bar, held)
  return s.finish()
}
const boxes = (cap, creates) => run('box.new', (b) => [b, 2, b + 1, 1], { box: cap }, creates)
const labels = (cap, creates) => run('label.new', (b) => [b, 1, 'L'], { label: cap }, creates)

describe('DRAW-1 — the count at the cap', () => {
  it('a box family whose collector ran is withheld, with the count-at-cap reason', () => {
    const f = boxes(3, collectsAbove(3) + 4)
    expect(String(f.withheld.box || '')).toMatch(new RegExp(`^${COUNT_AT_CAP_PREFIX}`))
    expect(f.live.filter((r) => r.family === 'box')).toEqual([])
    expect(f.withheldCounts.box).toBeGreaterThan(0)
  })

  it('CONTROL: a box family that never passed its trigger is drawn whole', () => {
    const f = boxes(3, collectsAbove(3))
    expect(f.withheld.box).toBeUndefined()
    expect(f.live.filter((r) => r.family === 'box').length).toBe(collectsAbove(3))
  })

  it('CONTROL: a label family whose collector ran is still drawn, by the witnessed rule', () => {
    expect(COUNT_AT_CAP_FAMILIES).toEqual(['box'])
    const f = labels(3, collectsAbove(3) + 4)
    expect(f.withheld.label).toBeUndefined()
    const n = f.live.filter((r) => r.family === 'label').length
    expect(n).toBeGreaterThanOrEqual(3)
    expect(n).toBeLessThanOrEqual(collectsAbove(3))
  })

  it('the reason maps to its own member sentence, never the generic one', () => {
    const f = boxes(3, collectsAbove(3) + 1)
    expect(runtimeWithheldCause(f.withheld.box, 'box')).toBe(NOT_SHOWN.COUNT_AT_CAP)
    expect(NOT_SHOWN.COUNT_AT_CAP).toBe(COUNT_AT_CAP_GUARD)
    expect(runtimeWithheldWhy(f.withheld).box).toMatch(/approximate/)
  })
})

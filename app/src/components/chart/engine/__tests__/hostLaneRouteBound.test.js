// ─── ⭐⭐ TRAIN e95 (the 2b bind audit's eighth reader) — THE HOST LANE ROUTES BY THE DOCUMENT A BINDING DRAWS ───────────
//
// Since unit 2b a saved document keeps every arm of a `switch` on a member's `input.string`. The host lane's route reads
// #1711's estimate (`hostLaneCost.js::hostLaneCostOf`): a document over the budget always computes off the chart's
// thread. Read off the SAVED document, Fred RS's eight knobs left the estimate unable to read the tree, so it was never
// "over", and the chart computed it on its own thread once a pass was measured cheap. #2593's ORDERING rail
// (`hostLaneFirstPage.test.js`) caught it on the train. The route now reads the document bound at the instance's
// settings (`hostLaneAsync.js::routeDocOf`); mutant BA8 un-binds it (`ci/mutants/e95-bind-audit.json`).

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { hostLaneCostOf } from '../hostLaneCost'
import { boundAtInputs } from '../knobBind'
import { asMember } from '../../../../testing/runtimeGate'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
asMember({ allow: true, pane: true, hkd: true })

describe('Fred RS: the route\'s estimate reads the bound document', () => {
  it('its knobs are live settings; bound at its defaults it is over the budget (and the saved document reads as not over)', () => {
    const d = memberPaneDefinition({ source: RS, name: 'RS Rating', id: 'u_fred-route-bound' })
    expect(d.ok, d.reason).toBe(true)
    const def = d.definition
    expect((def.inputs || []).filter((i) => i && i.type === 'enum').length).toBeGreaterThanOrEqual(8)
    const bound = hostLaneCostOf(boundAtInputs(def, {}))
    expect(bound.over, JSON.stringify(bound)).toBe(true)
    // the defect the binding removes: the saved document, every arm in it, is not read as over
    const saved = hostLaneCostOf(def)
    expect(saved.over, JSON.stringify(saved)).toBe(false)
  })
})

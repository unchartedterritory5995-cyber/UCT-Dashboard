// app/src/components/chart/builder/memberPane/offsetParamCarry.test.js
//
// ─── ⭐⭐ e98 E3 — NO MEMBER EDIT IS LOST WHEN AN OFFSET PARAMETER BECOMES A SETTING (coordinator ruling 2026-11-25) ───
//
// Before E3, `opening-range-initial-balance-opening-price` (committed corpus) held its three label positions
// (`OP_pos`, `OR_pos`, `IB_pos`: `plotshape(…, offset = OR_pos)`, positive defaults) as PARAMETERS folded into the tree
// (`__uct_param_2/4/5`, chart settings `param2/4/5`). Since E3 each is a draw-time setting (`plots[].displaceInput`), and
// the parameters are gone from today's manifest. So:
//   * the setting is keyed where the parameter's setting was (`param4`): an instance value a member saved lands on it;
//   * a saved COPY whose parameter a member EDITED is re-translated with that value as the setting's default, and is
//     drawn at the edited shift; an unedited copy keeps the script's default;
//   * where the old parameter does not provably map to one setting, nothing is guessed: the stored copy is kept as
//     saved (its own tree-fold + parameter), named.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import { judgeRetranslation, carryOffsetParams } from './savedScriptUpgrade'
import { applyParamEdit } from '../paramEdit'
import { __offsetSettingsForTests } from '../../engine/ast/pine.js'
import { drawShiftOf } from '../../engine/binder'
import { validateDefinition } from '../../engine/defSchema'

const REPO = path.resolve(__dirname, '../../../../../..')
const DIR = path.join(REPO, 'corpus/committed')
const SOURCE = fs.readFileSync(path.join(DIR, fs.readdirSync(DIR).find((f) => f.startsWith('opening-range-initial-balance-opening-price__4a7416ab01'))), 'utf8')
const ID = 'u_e98-offset-carry'

const today = () => memberPaneDefinition({ source: SOURCE, id: ID })
/** The copy a member saved before E3: the same door with the rule off (the tree-fold + parameters). */
function savedBeforeE3() {
  __offsetSettingsForTests(false)
  try { return memberPaneDefinition({ source: SOURCE, id: ID }) } finally { __offsetSettingsForTests(true) }
}
const row = (definition) => ({ definition, pine_source: SOURCE, def_id: ID, version: 3 })
const orPlot = (def) => def.plots.find((p) => p.displaceInput && p.displaceInput.key === 'param4')

describe('e98 E3 — the offset parameters a saved copy held, and the settings that replaced them', () => {
  const now = today()
  const old = savedBeforeE3()
  it('non-vacuity: before E3 they were parameters; today they are settings keyed where those parameters were', () => {
    expect(old.ok && now.ok).toBe(true)
    const was = old.definition.compute.paramManifest
    expect(['__uct_param_2', '__uct_param_4', '__uct_param_5'].map((id) => was[id] && was[id].sourceName)).toEqual(['OP_pos', 'OR_pos', 'IB_pos'])
    const nowManifest = now.definition.compute.paramManifest || {}
    expect(Object.keys(nowManifest)).not.toContain('__uct_param_4')
    expect(now.definition.inputs.filter((i) => /^param[245]$/.test(i.key)).map((i) => [i.key, i.default]))
      .toEqual([['param2', 10], ['param4', 5], ['param5', 10]])
    expect(validateDefinition(now.definition).errors || []).toEqual([])
  })

  it('an INSTANCE value saved on the old setting (`param4: 12`) lands on the new one', () => {
    expect(drawShiftOf(orPlot(now.definition), now.definition, { param4: 12 })).toBe(12)
  })

  it('an EDITED saved copy comes back drawn at the edited shift', () => {
    const edited = applyParamEdit(old.definition, '__uct_param_4', 12)
    expect(edited.ok, edited.error).toBe(true)
    const j = judgeRetranslation(row(edited.definition), now, null)
    expect(j.status).toBe('upgraded')
    expect(j.carriedOffsets).toEqual([{ id: '__uct_param_4', key: 'param4', value: 12 }])
    const d = j.definition
    expect(d.inputs.find((i) => i.key === 'param4').default).toBe(12)
    expect(drawShiftOf(orPlot(d), d, {})).toBe(12)
    // the other two, unedited, keep the script's defaults
    expect(d.inputs.find((i) => i.key === 'param2').default).toBe(10)
    expect(validateDefinition(d).errors || []).toEqual([])
  })

  it('an UNEDITED saved copy keeps the script\'s default', () => {
    const j = judgeRetranslation(row(old.definition), now, null)
    expect(j.status).toBe('upgraded')
    expect(j.carriedOffsets).toBeUndefined()
    expect(drawShiftOf(orPlot(j.definition), j.definition, {})).toBe(5)
  })

  it('not provably one-to-one: NOT guessed; the stored copy is kept as saved, and named', () => {
    const edited = applyParamEdit(old.definition, '__uct_param_4', 12).definition
    // today's document with no setting under the parameter's key: there is nothing the value provably belongs to
    const stripped = { ...now, definition: { ...now.definition, plots: now.definition.plots.map((p) => {
      if (!p.displaceInput || p.displaceInput.key !== 'param4') return p
      const { displaceInput, ...rest } = p
      return rest
    }) } }
    const j = judgeRetranslation(row(edited), stripped, null)
    expect(j.status).toBe('inconclusive')
    expect(j.reason).toContain('kept as saved')
    expect(j.reason).toContain('`OR_pos` (__uct_param_4)')
    expect(carryOffsetParams(edited, stripped.definition).ambiguous).toBeTruthy()
  })

  it('a value outside the setting\'s bounds is not carried silently either', () => {
    const def = { ...now.definition, inputs: now.definition.inputs.map((i) => (i.key === 'param4' ? { ...i, max: 8 } : i)) }
    const edited = applyParamEdit(old.definition, '__uct_param_4', 12).definition
    expect(carryOffsetParams(edited, def).ambiguous).toContain('outside its setting\'s bounds')
  })
})

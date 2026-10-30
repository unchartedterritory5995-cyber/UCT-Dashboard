// app/src/components/chart/builder/memberPane/memberPaneLinewidth.test.js
//
// ⭐ A Pine plot's `linewidth` is the default of its Style width input (round 1:
// the member door never carried it, so every member plot drew 1 px). This pins
// what that change does and does NOT move:
//   • a new document's width input defaults to the script's linewidth, and the
//     settings UI shows it;
//   • a member's STORED value is untouched — an instance that saved width 1
//     under the old default still draws 1;
//   • a `linewidth` above 4 is clamped to the width input's own 1-4 (TradingView's
//     style UI range). ⚠️ What TradingView PAINTS for a Pine `linewidth = 5+` is in
//     no committed capture — see the report; the clamp is the Builder's existing rule.
import { describe, it, expect, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { addInstance, setInstanceInput } from '../../engine/instanceControls'
import { mergeChartSettings } from '../../chartDefaults'
import { fieldsForInstance } from '../../indicatorRegistry'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const CLOUDS = fs.readFileSync(path.join(REPO, 'tests/fixtures/member/uncharted-clouds.pine'), 'utf8')
const ID = 'u_member-pane-lwtest'
afterAll(() => registry.uninstallUserDefinition(ID))

describe('member plot linewidth', () => {
  it('the width input defaults to the script\'s linewidth, and the settings UI shows it', () => {
    const b = memberPaneDefinition({ source: CLOUDS, id: ID })
    expect(b.ok, b.reason).toBe(true)
    const spec = b.definition.inputs.find((i) => i.key === 'lineWidth')
    expect(spec).toMatchObject({ default: 2, min: 1, max: 4 })
    const { installed } = registry.installUserDefinitions([b.definition])
    const def = installed[0]
    const cs = addInstance(mergeChartSettings({}), def.id, registry)
    const inst = cs.indicatorInstances.find((i) => i.defId === def.id)
    const model = fieldsForInstance(def, inst)
    expect(model.values.lineWidth).toBe(2)
    expect(model.style.some((f) => f.key === 'lineWidth')).toBe(true)
  })

  it('⛔ a member\'s STORED width is untouched by the new default', () => {
    const b = memberPaneDefinition({ source: CLOUDS, id: ID })
    const { installed } = registry.installUserDefinitions([b.definition])
    const def = installed[0]
    let cs = addInstance(mergeChartSettings({}), def.id, registry)
    const inst = cs.indicatorInstances.find((i) => i.defId === def.id)
    cs = setInstanceInput(cs, inst.instanceId, 'lineWidth', 1, registry)
    const stored = cs.indicatorInstances.find((i) => i.instanceId === inst.instanceId)
    expect(stored.inputs.lineWidth).toBe(1)
    expect(fieldsForInstance(def, stored).values.lineWidth).toBe(1)
  })

  it('a linewidth above 4 is clamped to the width input\'s range', () => {
    const src = '//@version=5\nindicator("w", overlay = true)\nplot(close, "a", linewidth = 6)\n'
    const b = memberPaneDefinition({ source: src, id: ID })
    expect(b.ok, b.reason).toBe(true)
    expect(b.definition.inputs.find((i) => i.key === 'lineWidth').default).toBe(4)
  })
})

// app/src/components/chart/builder/memberPane/memberPaneDefinition.noGuess.test.js
//
// ⛔⛔ THE DOOR NEVER CLAIMS A LITERAL THE AUTHOR HARD-CODED.
//
// A parameter is placed only where the translator TAGGED a literal as coming from
// it (`pineParamManifest.paramLocatorsIn`). ⚰️ Round 2 also matched call SHAPE, so
// in
//
//     len = input.int(21)
//     plot(ta.ema(close, len), color = close > ta.ema(close, 21) ? green : red)
//
// the colour rule's hard-coded `ta.ema(close, 21)` was claimed by `len`: editing
// `len` to 50 rewrote the colour rule to ema 50 — a colour TradingView never paints.
// Railed both ways: the hard-coded constant stays put (at the default AND when it
// equals the edited value), and a colour rule that really reads `len` moves with it.
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from './memberPaneDefinition'
import { applyParamEdit } from '../paramEdit'
import { migrateMemberDocument } from '../../engine/memberDocumentMigration'

const ID = 'u_member-pane-noguess'
const src = (rule) => `//@version=5\nindicator("ng", overlay = true)\nlen = input.int(21, "Length")\nplot(ta.ema(close, len), color = close > ${rule} ? color.green : color.red)\n`

function build(rule) {
  const b = memberPaneDefinition({ source: src(rule), id: ID })
  expect(b.ok, b.reason).toBe(true)
  const def = b.definition
  const plot = def.plots.find((p) => typeof p.colorMode === 'string' && p.colorMode.startsWith('column:'))
  expect(plot, 'NON-VACUITY: the colour rule is a condition column').toBeTruthy()
  const column = plot.colorMode.slice('column:'.length)
  const pid = Object.keys(def.compute.paramManifest).find((k) => def.compute.paramManifest[k].sourceName === 'len')
  expect(pid).toBeTruthy()
  return { def, column, pid, drawn: plot.key }
}
const treeOf = (def, k) => JSON.stringify(def.compute.trees[k])
const inColumn = (def, pid, column) => def.compute.paramManifest[pid].locators.filter((l) => l.treeIndex === column)

describe('the door places a parameter only where the translator tagged it', () => {
  it('⛔ a hard-coded constant AT the default is not claimed; an edit leaves the colour rule alone', () => {
    const { def, column, pid, drawn } = build('ta.ema(close, 21)')
    expect(inColumn(def, pid, column)).toEqual([])
    const e = applyParamEdit(def, pid, 50)
    expect(e.ok, e.error).toBe(true)
    expect(treeOf(e.definition, drawn), 'the drawn line moves').not.toBe(treeOf(def, drawn))
    expect(treeOf(e.definition, column), 'the hard-coded colour rule does not').toBe(treeOf(def, column))
    expect(JSON.stringify(e.definition.compute.trees[column])).toContain('21')
  })

  it('⛔ a hard-coded constant EQUAL TO THE EDITED value is not claimed either', () => {
    const { def, column, pid } = build('ta.ema(close, 50)')
    const at50 = applyParamEdit(def, pid, 50).definition
    expect(inColumn(at50, pid, column)).toEqual([])
    const at30 = applyParamEdit(at50, pid, 30).definition
    expect(treeOf(at30, column)).toBe(treeOf(def, column))
  })

  it('⭐ CONTROL — a colour rule that READS len is placed, and moves with an edit', () => {
    const { def, column, pid } = build('ta.ema(close, len)')
    expect(inColumn(def, pid, column).length).toBeGreaterThan(0)
    const e = applyParamEdit(def, pid, 50).definition
    expect(treeOf(e, column)).not.toBe(treeOf(def, column))
  })

  it('⛔ and the load-time migration claims nothing in an old-shape copy of the hard-coded document', () => {
    const { def, column, pid } = build('ta.ema(close, 21)')
    const edited = applyParamEdit(def, pid, 50).definition
    for (const d of [def, edited]) {
      const m = migrateMemberDocument(d)
      expect(inColumn(m, pid, column)).toEqual([])
      expect(treeOf(m, column)).toBe(treeOf(d, column))
    }
  })
})

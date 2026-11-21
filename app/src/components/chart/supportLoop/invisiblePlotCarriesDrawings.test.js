// app/src/components/chart/supportLoop/invisiblePlotCarriesDrawings.test.js
//
// ─── A DRAWING-ONLY REQUEST: THE PLOT THAT KEEPS IT IN ALERTS IS INVISIBLE (2026-11-21) ──────
//
// Seen in a live round: asked ONLY for a box, a line or two labels, half the scripts the assistant
// wrote also drew the value the drawing is made from, as a faint visible line. That is something the
// member did not ask for (the script contract's rule 11). The plot is worth keeping, though: a script
// with a plot works in alerts and one without does not. So rule 11 (`api/services/pine_authoring.py`)
// now says: keep that plot, and make it invisible with a fully transparent colour.
//
// ⛔ THAT SENTENCE IS THREE CLAIMS ABOUT THE ENGINE, each held here on the member's own path:
//   1. with the invisible plot the script runs AND is offered in alerts, its drawing is made, and the
//      column still carries the value (an alert has something to read);
//   2. the colour really is fully transparent in the document a member saves, where the faint form
//      the live scripts wrote is not;
//   3. CONTROL: with no plot at all the script still runs but is NOT offered in alerts, which is the
//      only reason the plot is there. The day that stops being true, this case fails and the sentence
//      can go.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import * as registry from '../engine/nativeRegistry'
import { inspectSource } from '../builder/PineBox'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { editorStatus } from '../builder/editorStatus'
import { drawingLossOf } from '../builder/authoring/scriptAnswer'
import { objectReaderFor } from '../engine/objectColumns'
import { evaluateObjects } from '../engine/objectRuntime'
import { toRenderState } from '../engine/objectRenderState'
import { __permitRuntimePaneForTests } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../engine/runtimeKill'
import { RUNS_STATES } from './assistantPineReference'
import { recipeBars, recipeContext } from './assistantRecipes'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8').match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const BARS = recipeBars('daily')
const LAST = BARS.length - 1
const N = 20
const HEAD = `//@version=5\nindicator("Range box", overlay=true)\nn = input.int(${N}, "Bars")\nhi = ta.highest(high, n)\nlo = ta.lowest(low, n)\n`
const BOX = 'var box b = na\nif barstate.islast\n    box.delete(b)\n    b := box.new(bar_index - n + 1, hi, bar_index, lo, border_color=color.blue, bgcolor=color.new(color.blue, 85))\n'
/** the form rule 11 teaches: the plot is there for alerts, and fully transparent */
const INVISIBLE = `${HEAD}${BOX}plot(hi, "Range high", color=color.new(color.gray, 100))\n`
/** what half the live scripts wrote: the same plot, faint but visible */
const FAINT = `${HEAD}${BOX}plot(hi, "Range high", color=color.new(color.blue, 60))\n`
/** and the drawing alone */
const NO_PLOT = `${HEAD}${BOX}`

let made = 0
function member(source) {
  const report = inspectSource(source, 'pine')
  const pane = memberPaneDefinition({ source, id: `u_invisible_${made += 1}`, name: 'probe' })
  const status = editorStatus({ report, pane, savedRow: null, inspectedSource: source })
  return { pane, status, lost: pane.ok === true ? drawingLossOf(pane) : null }
}
function boxesOf(pane) {
  const ctx = recipeContext('daily', 'fromListing')
  const reader = objectReaderFor(pane.definition, BARS, { inputs: undefined, tf: ctx.tf, symbol: ctx.symbol })
  expect(reader.failed).toEqual([])
  const run = evaluateObjects(reader.program, { barCount: BARS.length, readNode: reader.readNode, readUnknown: reader.readUnknown, readTime: (i) => BARS[i].t })
  expect(run.status).toBe('ok')
  return toRenderState(run.live, { bars: BARS }).boxes
}
/** the alpha of a plot's own colour in the saved document: '00' is fully transparent */
const alphaOf = (pane) => {
  const colour = pane.definition.inputs.find((i) => i.type === 'color').default
  expect(colour).toMatch(/^#[0-9A-Fa-f]{8}$/)
  return colour.slice(7).toUpperCase()
}
const hi20 = Math.max(...BARS.slice(LAST - N + 1).map((b) => b.h))
const lo20 = Math.min(...BARS.slice(LAST - N + 1).map((b) => b.l))
const IN_ALERTS = /^Runs on the chart and in alerts/
const NOT_IN_ALERTS = /not in alerts/

beforeAll(() => { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() })

describe('a drawing-only script: the plot that keeps it in alerts can be invisible', () => {
  it('with the invisible plot it runs, is offered in alerts, draws its box and still carries the value', () => {
    const { pane, status, lost } = member(INVISIBLE)
    expect(pane.ok, pane.reason || '').toBe(true)
    expect(RUNS_STATES).toContain(status.state)
    expect(status.headline).toMatch(IN_ALERTS)
    expect(lost).toBeNull()                                          // the drawing program is carried
    const boxes = boxesOf(pane)
    expect(boxes).toHaveLength(1)
    expect(boxes[0].top).toBeCloseTo(hi20, 9)
    expect(boxes[0].bottom).toBeCloseTo(lo20, 9)
    expect([boxes[0].left, boxes[0].right]).toEqual([BARS[LAST - N + 1].t, BARS[LAST].t])
    // an alert has something to read: the hidden plot's column is the value itself
    const cols = registry.computeFor(pane.definition, BARS, undefined, recipeContext('daily', 'fromListing'))
    expect(registry.columnErrors(cols) || {}).toEqual({})
    expect(Object.keys(cols)).toHaveLength(1)
    expect(Array.from(Object.values(cols)[0])[LAST]).toBeCloseTo(hi20, 9)
  })

  it('the colour is fully transparent in the saved document, and the faint form is not', () => {
    expect(alphaOf(member(INVISIBLE).pane)).toBe('00')
    const faint = member(FAINT)
    expect(faint.status.headline).toMatch(IN_ALERTS)                 // the faint plot works as well; it is only visible
    expect(alphaOf(faint.pane)).not.toBe('00')
    expect(parseInt(alphaOf(faint.pane), 16)).toBeGreaterThan(40)    // a line a member can see
  })

  it('CONTROL: with no plot the same drawing still runs, but is not offered in alerts', () => {
    const { pane, status } = member(NO_PLOT)
    expect(pane.ok, pane.reason || '').toBe(true)
    expect(RUNS_STATES).toContain(status.state)
    expect(status.headline).toMatch(NOT_IN_ALERTS)
    expect(status.headline).not.toMatch(IN_ALERTS)
    expect(boxesOf(pane)).toHaveLength(1)                            // the drawing itself never needed the plot
  })
})

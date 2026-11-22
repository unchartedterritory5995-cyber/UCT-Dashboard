// ⭐⭐ Engine 66 (#1473) (bt, 2026-11-16) — A KNOB MAY NEVER COST THE SCRIPT ITS INSTALL.
//
// A declared member input is a `series` leaf named for the input, and the install budget counts
// DISTINCT series names (`engine/ast/budget.js::seriesRefs`, cap `maxSeriesRefs`), so a column the
// author's defaults draw within the cap can measure over it once its inputs are live knobs — and the
// registry then refuses the WHOLE definition. `builderInputs.js::memberInputTranslation` gives those
// knobs back (folded to the author's defaults) and names each one (`budgetRefusal`).
// The real case is `corpus/committed/session-hilo__WM2g5GtC4h.pine` (`engine/ast/btSessionClock.test.js`).
import { describe, it, expect } from 'vitest'
import { memberPaneDefinition } from './memberPane/memberPaneDefinition.js'
import * as registry from '../engine/nativeRegistry.js'
import { checkBudget } from '../engine/ast/budget.js'
import { translatePine } from '../engine/ast/pine.js'

const V6 = '//@version=6\nindicator("k")\n'
// four toggles and five columns: nine distinct series with the toggles live, one at their defaults
const OVER = `${V6}useO = input.bool(true, "O")\nuseH = input.bool(true, "H")\n`
  + 'useL = input.bool(true, "L")\nuseC = input.bool(true, "C")\n'
  + 'plot(useO ? open : useH ? high : useL ? low : useC ? close : volume)'
// one toggle and two columns: three, well under the cap
const UNDER = `${V6}useO = input.bool(true, "O")\nplot(useO ? open : close)`

const install = (d, id) => {
  try {
    const r = registry.installUserDefinitions([d.definition])
    return { errors: r.errors, installed: r.installed.length }
  } finally {
    try { registry.uninstallUserDefinition(id) } catch { /* nothing installed */ }
  }
}
const givenBack = (d) => (d.translation.outputs || []).flatMap((o) => o.skippedInputs || [])
  .filter((e) => e && e.budgetBound)

describe('a knob never costs the script its install', () => {
  it('the fixture is over the cap with its knobs live (the condition, measured, not assumed)', () => {
    const live = translatePine(OVER, { strict: true, declareInputs: ['useO', 'useH', 'useL', 'useC'] })
    const b = checkBudget(live.outputs[0].ast)
    expect(b.ok).toBe(false)
    expect(b.guard).toBe('budget:series')
    expect(b.measured.maxSeriesRefs).toBe(9)
  })
  it('the inputs an over-budget column reads are given back, by name, and the script installs', () => {
    const d = memberPaneDefinition({ source: OVER, id: 'u_bt_knobs_over', name: 'over' })
    expect(d.ok, d.reason).toBe(true)
    expect(install(d, 'u_bt_knobs_over')).toEqual({ errors: [], installed: 1 })
    // all four are given back; `useO` folded to its default (true) takes the first branch, so the
    // other three are never reached and only `useO` is listed (measured on GitHub runners)
    const back = givenBack(d)
    expect(back.map((e) => e.name)).toEqual(['useO'])
    for (const e of back) expect(e.reason).toMatch(/install budget[\s\S]*`budget:series`/)
    for (const knob of ['useO', 'useH', 'useL', 'useC']) expect(d.translation.declared || []).not.toContain(knob)
    // the column is drawn as the author's defaults draw it
    expect(d.translation.outputs[0].formula).not.toMatch(/use[OHLC]/)
    expect(d.translation.outputs[0].formula).toMatch(/\bopen\b/)
  })
  it('CONTROL: a script under the cap keeps its knob', () => {
    const d = memberPaneDefinition({ source: UNDER, id: 'u_bt_knobs_under', name: 'under' })
    expect(d.ok, d.reason).toBe(true)
    expect(install(d, 'u_bt_knobs_under')).toEqual({ errors: [], installed: 1 })
    expect(givenBack(d)).toEqual([])
    expect(d.translation.declared).toContain('useO')
    expect(d.translation.outputs[0].formula).toMatch(/useO/)
  })
})

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
  // ⭐⭐ e95 unit 2b (2026-11-22, coordinator ruling) — THE INSTALL BUDGET IS THE DEFAULTS' PROGRAM. Every install-time
  // measurement reads the tree pruned at the knobs' defaults (`astColumns.js::defaultBoundDocument`,
  // `bind.js::pruneAtLeafDefaults`): here `useO ? open : …` at `useO = true` is `open`, one series. So the four knobs
  // stay live and the script installs; each binding is measured by its own compute budget, and none of this script's
  // settings reaches the cap (the widest, `useO` off, reads seven series). ⚰️ Before, the saved tree (nine series,
  // every arm) was measured and the four knobs were given back, folded to the author's defaults.
  it('its knobs stay live: the install measures the program at the defaults, and each setting draws its own branch', () => {
    const d = memberPaneDefinition({ source: OVER, id: 'u_bt_knobs_over', name: 'over' })
    expect(d.ok, d.reason).toBe(true)
    expect(install(d, 'u_bt_knobs_over')).toEqual({ errors: [], installed: 1 })
    expect(givenBack(d)).toEqual([])
    for (const knob of ['useO', 'useH', 'useL', 'useC']) expect(d.translation.declared || []).toContain(knob)
    const BARS = Array.from({ length: 5 }, (_, i) => ({ t: `2026-01-0${i + 5}`, o: 10 + i, h: 20 + i, l: 5 + i, c: 15 + i, v: 100 + i }))
    const col = (inputs) => Array.from(Object.values(registry.computeFor(d.definition, BARS, inputs, { tf: 'D' }))[0])
    expect(col(undefined)).toEqual(BARS.map((b) => b.o))
    expect(col({ useO: 0 })).toEqual(BARS.map((b) => b.h))
    expect(col({ useO: 0, useH: 0, useL: 0, useC: 0 })).toEqual(BARS.map((b) => b.v))
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

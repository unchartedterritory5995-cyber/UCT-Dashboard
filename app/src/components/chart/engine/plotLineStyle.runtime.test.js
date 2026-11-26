// app/src/components/chart/engine/plotLineStyle.runtime.test.js
//
// ─── ⭐ e98 E1 — THE RUNTIME LANE DRAWS A PLOT'S `linestyle` AS THE HOST LANE DOES ──────────────────────────────────
//
// The runtime document's rows read their presentation from the host translation's rows, so a plot's line style comes
// from the one reader (`pine.js::outputLineStyleOf`) through the one projection (`memberPaneDefinition.js::
// lineStyleRowOf`). ⚰️ Measured 2026-11-25 with the runtime lane forced: `linestyle = plot.linestyle_dashed` was drawn
// solid with no note, and a linestyle chosen by an `input.bool` likewise. Run with the runtime pane as the runtime-on
// lane runs.

import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition, __forceRuntimeLaneForTests } from '../builder/memberPane/memberPaneDefinition'
import { plotLineStyleAt } from './knobBind.js'
import { validateDefinition } from './defSchema.js'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from './runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const H = '//@version=6\nindicator("t", overlay = true)\n'

function runtimeDoor(body) {
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __forceRuntimeLaneForTests(true)
  try {
    const r = memberPaneDefinition({ source: `${H}${body}\n` })
    expect(r.ok, r.reason).toBe(true)
    expect(r.lane).toBe('runtime')
    return r
  } finally { __forceRuntimeLaneForTests(false) }
}
const plotOf = (def, label) => def.plots.find((p) => p.label === label)

describe('e98 E1 — the runtime lane carries a plot\'s linestyle', () => {
  it('a literal dashed / dotted line, and a setting\'s choice bound per instance', () => {
    const r = runtimeDoor('d = input.bool(true, "Dash")\n'
      + 'plot(ta.sma(close, 50), "a", linestyle = plot.linestyle_dashed)\n'
      + 'plot(ta.sma(close, 20), "b", linestyle = plot.linestyle_dotted)\n'
      + 'plot(ta.ema(close, 9), "c", linestyle = d ? plot.linestyle_dashed : plot.linestyle_solid)\n'
      + 'plot(ta.ema(close, 30), "e")')
    const def = r.definition
    expect(plotOf(def, 'a').lineStyle).toBe('dashed')
    expect(plotOf(def, 'b').lineStyle).toBe('dotted')
    expect(plotOf(def, 'e').lineStyle).toBeUndefined()
    const c = plotOf(def, 'c')
    expect(c.lineStyleWhen && c.lineStyleWhen.length).toBe(2)
    expect(def.inputs.some((i) => i.key === 'd')).toBe(true)
    expect(validateDefinition(def).ok).toBe(true)
    expect(plotLineStyleAt(c, def, {}).lineStyle).toBe('dashed')
    expect(plotLineStyleAt(c, def, { d: false }).lineStyle).toBe('solid')
  }, 120000)

  it('an unreadable linestyle is drawn solid and said by name on this lane too', () => {
    const r = runtimeDoor('plot(ta.sma(close, 50), "m", linestyle = close > open ? plot.linestyle_dashed : plot.linestyle_solid)')
    expect(plotOf(r.definition, 'm').lineStyle).toBeUndefined()
    expect((r.notes || []).map((n) => n.note).join('\n')).toContain('`m` is drawn with a solid line: its `linestyle`')
  }, 120000)
})

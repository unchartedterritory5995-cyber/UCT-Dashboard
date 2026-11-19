// app/src/components/chart/builder/memberPane/plotarrowWithheld.test.js
//
// ─── ⭐⭐ PLOTARROW, WITHHELD BY NAME (coordinator ruling 2026-11-19) ─────────────────────────────────────────────────
//
// The reference: `plotarrow` "Plots up and down arrows on the chart. Up arrow is drawn at every indicator positive
// value, down arrow is drawn at every negative value." The member door drew it as a LINE of its value (in the neutral
// ink, its colours withheld): a picture TradingView never draws. Until arrows are built it is not drawn on the chart
// pane, and the door says so by its title; the screener still offers its value as a column (the translation's own
// selection, untouched), and `builder/plotshapeEndToEnd.test.js` still pins that it is not drawn as a marker either.
// The runtime lane never drew one (`runRowPairing.RUNTIME_ROW_KINDS` leaves it out); it now names it too.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import { translatePine } from '../../engine/ast/pine'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

afterEach(() => { vi.unstubAllEnvs() })

const H = '//@version=6\nindicator("A", overlay = true)\n'
const ARROWS = /TradingView draws a `plotarrow` as up and down arrows at its positive and negative values, which this chart does not draw yet/

function door(source, id, runtime = false) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '0')
  if (runtime) { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() }
  return memberPaneDefinition({ source, id, name: 'arrow' })
}
const rowsOf = (d) => Object.fromEntries((d.definition.plots || []).map((p) => [p.label || p.key, p.hidden === true]))
const noteFor = (d, name) => (d.notes || []).find((n) => n.name === name)

describe('a `plotarrow` is never drawn as a line of its value: withheld by name', () => {
  it('beside a plot: the plot is drawn; the arrow is carried, not drawn, and named', () => {
    const d = door(`${H}plot(close, title = "C")\nplotarrow(close - open, title = "Arr")\n`, 'u_arrow_1')
    expect(d.ok, d.reason).toBe(true)
    expect(rowsOf(d)).toEqual({ C: false, Arr: true })
    expect(noteFor(d, 'Arr') && noteFor(d, 'Arr').note).toMatch(ARROWS)
  })
  it('an untitled arrow is named as a `plotarrow`', () => {
    const d = door(`${H}plot(close, title = "C")\nplotarrow(close - open)\n`, 'u_arrow_2')
    expect(d.ok, d.reason).toBe(true)
    expect(noteFor(d, 'plotarrow') && noteFor(d, 'plotarrow').note).toMatch(ARROWS)
  })
  it('alone: the script is refused by that name, never "declares nothing a chart can draw"', () => {
    const d = door(`${H}plotarrow(close - open, title = "Arr")\n`, 'u_arrow_3')
    expect(d.ok).toBe(false)
    expect(d.guard).toBe('pine:plotarrow-not-drawn')
    expect(d.reason).toMatch(ARROWS)
  })
  it('the screener still offers its value as a column', () => {
    const t = translatePine(`${H}plotarrow(close - open, title = "Arr")\n`, {})
    expect(t.mode).toBe('screener')
    expect(t.ok).toBe(true)
    expect(t.outputs[t.selected].kind).toBe('plotarrow')
  })
  it('the runtime lane names it too (it never drew one)', () => {
    const coupled = '//@version=6\nindicator("A")\nvar float a = 0.0\nvar float b = 0.0\na := b * 0.5 + close\nb := a * 0.5 - open\n'
      + 'plot(a, title = "A")\nplotarrow(a - a[1], title = "Arr")\n'
    const d = door(coupled, 'u_arrow_4', true)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBe('runtime')
    expect(rowsOf(d)).toEqual({ A: false })
    expect(noteFor(d, 'Arr') && noteFor(d, 'Arr').note).toMatch(ARROWS)
  })
  it('CONTROL: a `plotshape` beside a plot is drawn as before, with no such note', () => {
    const d = door(`${H}plot(close, title = "C")\nplotshape(close > open, title = "S")\n`, 'u_arrow_5')
    expect(d.ok, d.reason).toBe(true)
    expect(rowsOf(d)).toEqual({ C: false, S: false })
    expect((d.notes || []).some((n) => ARROWS.test(String(n.note)))).toBe(false)
  })
})

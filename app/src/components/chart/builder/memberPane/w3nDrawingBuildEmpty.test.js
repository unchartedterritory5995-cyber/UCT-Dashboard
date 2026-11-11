// app/src/components/chart/builder/memberPane/w3nDrawingBuildEmpty.test.js
//
// ─── W3W4-D2 — "THE DRAWING BUILD LOWERS NOTHING" WAS THE VALUE BUILD'S WORD ──
//
// A script that only draws has nothing to plot in the VALUE build (it hands every drawing to
// the host object program), so that build refuses `runtime:no-output` whatever the drawing
// build says. The door took that word as the script's. The drawing build (`objectsInRun`)
// lowers these shapes (objectOps > 0) or refuses for a real, named reason; the door now says
// THAT reason. Shape: a drawing whose argument converts a mutable value (the
// `rth-opening-range-with-extensions` wall). Controls: a drawing the run holds attaches; a script with no
// drawing at all still declines `runtime:no-output`.
import { describe, it, expect, vi, afterEach } from 'vitest'

import { memberPaneDefinition } from './memberPaneDefinition'
import { valueBuildDefersToDrawing, runtimeOwnObjectsOf } from './runtimeObjectsDoor'
import { translatePine } from '../../engine/ast/pine'
import { probeRuntimeProgram } from '../../engine/runtime/runtimeColumns'
import * as registry from '../../engine/nativeRegistry'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const ID = 'u_w3n-d2'
// the conversion sits inside the DRAWING's argument, which only the drawing build lowers
const MUT_CONV = `${H}var float acc = 0\nacc += close\nif bar_index % 50 == 0\n`
  + '    label.new(bar_index, close, str.tostring(bool(acc)))\n'
const MUT_CONV_ARG = `${H}var float acc = 0\nacc += close\nif bar_index % 50 == 0\n`
  + '    label.new(bar_index, close, str.tostring(acc), size = bool(acc) ? size.large : size.small)\n'
const HELD = `${H}var float acc = 0\nacc += close\nif bar_index % 50 == 0\n    label.new(bar_index, close, str.tostring(acc, "#"))\n`
// the host program draws this label cleanly; the value build has nothing to plot
const HOST_DRAWS = `${H}if bar_index % 50 == 0
    label.new(bar_index, close, "x")
`
// the host program draws the label AND the script plots: the value build stands
const HOST_DRAWS_AND_PLOTS = `${HOST_DRAWS}plot(close)
`
const NO_DRAWING = `${H}var float acc = 0\nacc += close\n`

const door = (source) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return memberPaneDefinition({ source, id: ID, name: 'T' })
}
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('W3W4-D2 — the door names the drawing build\'s refusal, not the value build\'s', () => {
  it('the value build says no-output for a drawing-only script the drawing build holds', () => {
    const v = probeRuntimeProgram(HELD)
    expect(v.ok).toBe(false)
    expect(v.refusal.guard).toBe('runtime:no-output')
    expect(probeRuntimeProgram(HELD, { objectsInRun: true }).ok).toBe(true)
  })

  it('a drawing behind a mutable conversion declines by that name', () => {
    const r = door(MUT_CONV)
    expect(r.ok).toBe(false)
    expect(r.runtimeDeclined.code).toBe('runtime:call-conversion-state')
  })

  it('the same wall through another argument of the drawing', () => {
    const r = door(MUT_CONV_ARG)
    expect(r.ok).toBe(false)
    expect(r.runtimeDeclined.code).toBe('runtime:call-conversion-state')
  })

  it('control: a drawing the run holds lowers (objectOps > 0) and attaches with run-owned objects', () => {
    const d = probeRuntimeProgram(HELD, { objectsInRun: true })
    expect(d.ok).toBe(true)
    expect(d.objectOps).toBeGreaterThan(0)
    const r = door(HELD)
    expect(r.ok).toBe(true)
    expect(r.definition.compute.objects).toBe(true)
  })

  it('control: a script with no drawing at all still declines `runtime:no-output`', () => {
    const r = door(NO_DRAWING)
    expect(r.ok).toBe(false)
    expect(r.runtimeDeclined.code).toBe('runtime:no-output')
  })

  it('the predicate: exactly the two value-build words that defer', () => {
    expect(valueBuildDefersToDrawing('runtime:object-op')).toBe(true)
    expect(valueBuildDefersToDrawing('runtime:no-output')).toBe(true)
    expect(valueBuildDefersToDrawing('runtime:loop')).toBe(false)
    expect(valueBuildDefersToDrawing(undefined)).toBe(false)
  })

  it('runtimeOwnObjectsOf: a clean host drawing whose value build says no-output is asked of the drawing build', () => {
    const t = translatePine(HOST_DRAWS, {})
    expect(((t.objects || {}).ops || []).length).toBeGreaterThan(0)
    const own = runtimeOwnObjectsOf({ source: HOST_DRAWS, t })
    expect(own.probe).not.toBeNull()
    expect(own.probe.objectOps).toBeGreaterThan(0)
  })

  it('control: the same host drawing with a plot (value build stands) keeps the host program', () => {
    const t = translatePine(HOST_DRAWS_AND_PLOTS, {})
    const own = runtimeOwnObjectsOf({ source: HOST_DRAWS_AND_PLOTS, t })
    expect(own.probe).toBeNull()
  })
})

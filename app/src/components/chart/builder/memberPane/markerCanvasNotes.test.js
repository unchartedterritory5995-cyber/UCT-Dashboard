// app/src/components/chart/builder/memberPane/markerCanvasNotes.test.js
//
// ─── e99 — WITH THE CANVAS MARKERS ON, THE MEMBER IS TOLD WHAT IS STILL APPROXIMATE ──
//
// `engine/markerCanvas.js` (behind `markerCanvasGate.js`, OFF) draws each Pine
// shape as its own glyph at its own location, so with it on a marker is no longer
// "drawn as an arrow" nor "placed above the bar" (E5's sentences); but its size
// and offset come from a PROVISIONAL table, so it is recorded `geometryApprox` and
// the member door says THAT, by name, on both lanes. Off, E5's sentences stand.

import { describe, it, expect, vi, afterAll, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition, __forceRuntimeLaneForTests } from './memberPaneDefinition'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const CANVAS = flagOf('src/components/chart/engine/markerCanvasGate.js')
const lanesOn = () => {
  vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
  vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
}
afterEach(() => { vi.unstubAllEnvs() })
afterAll(() => __forceRuntimeLaneForTests(false))

const H = '//@version=6\nindicator("t", overlay = true)\n'
function door(body, runtime) {
  if (runtime) { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); __forceRuntimeLaneForTests(true) }
  try {
    const r = memberPaneDefinition({ source: `${H}${body}\nplot(ta.ema(close, 3), "x")\n` })
    expect(r.ok, r.reason).toBe(true)
    expect(r.lane === 'runtime').toBe(runtime)
    const plot = ((r.definition || {}).plots || []).find((p) => p.marker)
    return { text: (r.notes || []).map((n) => n.note).join('\n'), marker: plot ? plot.marker : null }
  } finally { if (runtime) __forceRuntimeLaneForTests(false) }
}

const GEOMETRY = '`m` is drawn at an approximate size and offset: the sizes and offsets TradingView draws its markers at are not measured yet.'

describe('e99 — the canvas markers, said at the member door', () => {
  it('the gate this file stubs is found in the gate module (not a typed name)', () => {
    expect(CANVAS).toBe('VITE_PINE_MARKER_CANVAS_ENABLED')
  })

  for (const runtime of [false, true]) {
    const lane = runtime ? 'runtime' : 'host'
    it(`${lane}: ON, a triangle at the pane's top is no longer a substitution, and its geometry is said`, () => {
      lanesOn()
      vi.stubEnv(CANVAS, '1')
      const { text, marker } = door('plotshape(close > open, "m", style = shape.triangleup, location = location.top)', runtime)
      expect(text).toContain(GEOMETRY)
      expect(text).not.toContain('`m` is drawn as an arrow up')
      expect(text).not.toContain('`m` is placed above the bar')
      expect(marker).toMatchObject({ shapeApprox: false, positionApprox: false, geometryApprox: true, pineShape: 'shape.triangleup' })
    })

    it(`${lane}: ON, a plotchar is drawn as its character, at an approximate size`, () => {
      lanesOn()
      vi.stubEnv(CANVAS, '1')
      const { text } = door('plotchar(close > open, "m", "★")', runtime)
      expect(text).toContain(GEOMETRY)
      expect(text).not.toContain('with its character beside it')
    })

    it(`${lane}: ⛔ OFF, E5's sentences stand and nothing says geometry`, () => {
      lanesOn()
      const { text, marker } = door('plotshape(close > open, "m", style = shape.triangleup)', runtime)
      expect(text).toContain('`m` is drawn as an arrow up: TradingView draws `shape.triangleup`')
      expect(text).not.toContain('approximate size')
      expect(marker.geometryApprox).toBeUndefined()
      expect(marker.shapeApprox).toBe(true)
    })
  }
})

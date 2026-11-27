// app/src/components/chart/builder/memberPane/markerCanvasNotes.test.js
//
// ─── e99 — WITH THE CANVAS MARKERS ON, THE MEMBER IS TOLD WHAT IS STILL APPROXIMATE ──
//
// `engine/markerCanvas.js` (behind `markerCanvasGate.js`, OFF) draws each Pine
// shape as its own glyph at its own location, so with it on a marker is no longer
// "drawn as an arrow" nor "placed above the bar" (E5's sentences). Its size and
// offset are PINNED from FRED RS's measurement of TradingView (run
// markers-2026-11-26), so a plain marker says nothing more; a marker whose drawing
// touches a fact that run did not pin (its text, a `plotchar`'s character, a
// triangle at `location.absolute`) is recorded `geometryApprox` and the member door
// names THAT fact, by name, on both lanes. Off, E5's sentences stand.

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

const TEXT = '`m` is drawn with its text at an approximate size and offset: TradingView\'s marker text is measured on one triangle and one label only.'
const CHAR = '`m` is drawn at an approximate character size and offset: TradingView\'s `plotchar` is measured for the star only, and a character\'s size follows its font.'
const ABS_TRI = '`m` is placed at an approximate height at its value: where TradingView pins a triangle to a price (`location.absolute`) is not measured.'

describe('e99 — the canvas markers, said at the member door', () => {
  it('the gate this file stubs is found in the gate module (not a typed name)', () => {
    expect(CANVAS).toBe('VITE_PINE_MARKER_CANVAS_ENABLED')
  })

  for (const runtime of [false, true]) {
    const lane = runtime ? 'runtime' : 'host'
    it(`${lane}: ON, a triangle at the pane's top is no longer a substitution, and its pinned geometry says nothing`, () => {
      lanesOn()
      vi.stubEnv(CANVAS, '1')
      const { text, marker } = door('plotshape(close > open, "m", style = shape.triangleup, location = location.top)', runtime)
      expect(text).not.toMatch(/approximate (size|height|character)/)
      expect(text).not.toContain('`m` is drawn as an arrow up')
      expect(text).not.toContain('`m` is placed above the bar')
      expect(marker).toMatchObject({ shapeApprox: false, positionApprox: false, pineShape: 'shape.triangleup' })
      expect(marker.geometryApprox).toBeUndefined()
    })

    it(`${lane}: ON, a plotchar is drawn as its character, and the door names the character size as approximate`, () => {
      lanesOn()
      vi.stubEnv(CANVAS, '1')
      const { text, marker } = door('plotchar(close > open, "m", "★")', runtime)
      expect(text).toContain(CHAR)
      expect(text).not.toContain(TEXT)
      expect(text).not.toContain('with its character beside it')
      expect(marker.geometryApprox).toBe(true)
    })

    it(`${lane}: ON, the door names the fact: a shape's text, and a triangle at its value`, () => {
      lanesOn()
      vi.stubEnv(CANVAS, '1')
      const withText = door('plotshape(close > open, "m", style = shape.triangleup, location = location.belowbar, text = "Up")', runtime)
      expect(withText.text).toContain(TEXT)
      expect(withText.text).not.toContain(ABS_TRI)
      const atValue = door('plotshape(close, "m", style = shape.triangledown, location = location.absolute)', runtime)
      expect(atValue.text).toContain(ABS_TRI)
      expect(atValue.text).not.toContain(TEXT)
      const square = door('plotshape(close, "m", style = shape.square, location = location.absolute)', runtime)
      expect(square.text).not.toMatch(/approximate (size|height|character)/)
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

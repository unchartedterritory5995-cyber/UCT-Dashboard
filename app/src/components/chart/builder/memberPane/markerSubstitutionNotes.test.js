// app/src/components/chart/builder/memberPane/markerSubstitutionNotes.test.js
//
// ─── ⭐⭐ e99 E5 — A MARKER THIS CHART DRAWS AS ANOTHER SHAPE IS SAID SO, BY NAME, ON BOTH LANES ─────────────────────
//
// ⚰️ MEASURED 2026-11-25 (both lanes identical): this chart's markers draw only a circle, a square and an arrow up or down,
// so the translator maps every other Pine shape onto one of them (`pine.js::PINE_MARKER_SHAPES`) and stamps the marker
// `shapeApprox` (and a `location.top` / `location.bottom` marker `positionApprox`), which NOTHING read. `shape.triangleup` drew
// as an arrow, `shape.labeldown` as an arrow, `shape.diamond` / `cross` / `xcross` (and a `plotshape` with no style) as squares,
// a `plotchar` as a circle with its character beside it: silent substitutions, a wrong picture, on 71 committed scripts (27
// served on the production lane, 41 on runtime-on), 69 reference and 3 built-in ones.
//
// ⭐ NOW: each is said by name (`memberPaneDefinition.js::markerSubstitutionNotes`), one sentence per substitution naming
// every visible row it applies to. Nothing about the drawing changes (the shapes themselves are a later unit, behind
// captures). ⛔ And whatever the translator approximates must reach the member: a rail holds every `*Approx` flag the
// translator writes to a reader in the member door.

import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { memberPaneDefinition, __forceRuntimeLaneForTests } from './memberPaneDefinition'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
afterAll(() => __forceRuntimeLaneForTests(false))

const H = '//@version=6\nindicator("t", overlay = true)\n'
function door(body, runtime) {
  if (runtime) { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); __forceRuntimeLaneForTests(true) }
  try {
    const r = memberPaneDefinition({ source: `${H}${body}\nplot(ta.ema(close, 3), "x")\n` })
    expect(r.ok, r.reason).toBe(true)
    expect(r.lane === 'runtime').toBe(runtime)
    return (r.notes || []).map((n) => n.note).join('\n')
  } finally { if (runtime) __forceRuntimeLaneForTests(false) }
}

const CASES = [
  ['triangleup', '`m` is drawn as an arrow up: TradingView draws `shape.triangleup`, which this chart does not draw yet.'],
  ['triangledown', '`m` is drawn as an arrow down: TradingView draws `shape.triangledown`'],
  ['labelup', '`m` is drawn as an arrow up: TradingView draws `shape.labelup`'],
  ['labeldown', '`m` is drawn as an arrow down: TradingView draws `shape.labeldown`'],
  ['flag', '`m` is drawn as an arrow up: TradingView draws `shape.flag`'],
  ['diamond', '`m` is drawn as a square: TradingView draws `shape.diamond`'],
  ['cross', '`m` is drawn as a square: TradingView draws `shape.cross`'],
  ['xcross', '`m` is drawn as a square: TradingView draws `shape.xcross`'],
]

describe('e99 E5 — every substituted shape is said by name, on both lanes', () => {
  for (const runtime of [false, true]) {
    const lane = runtime ? 'runtime' : 'host'
    for (const [shape, sentence] of CASES) {
      it(`${lane}: shape.${shape}`, () => {
        expect(door(`plotshape(close > open, "m", style = shape.${shape})`, runtime)).toContain(sentence)
      })
    }
    it(`${lane}: a plotshape with no style (Pine's default, shape.xcross)`, () => {
      expect(door('plotshape(close > open, "m")', runtime)).toContain('`m` is drawn as a square: TradingView draws `shape.xcross`')
    })
    it(`${lane}: a plotchar is a circle beside its character`, () => {
      expect(door('plotchar(close > open, "m", "★")', runtime))
        .toContain('`m` is drawn as a circle with its character beside it: TradingView draws the character alone')
    })
    it(`${lane}: a marker at the pane's top is placed at the bar, and said`, () => {
      expect(door('plotshape(close > open, "m", style = shape.circle, location = location.top)', runtime))
        .toContain('`m` is placed above the bar: TradingView places it at the top of the pane (`location.top`)')
    })
    it(`${lane}: the four shapes this chart draws say nothing`, () => {
      for (const shape of ['circle', 'square', 'arrowup', 'arrowdown']) {
        expect(door(`plotshape(close > open, "m", style = shape.${shape})`, runtime), shape).not.toContain('`m` is drawn as')
      }
    })
  }

  it('one sentence per substitution, naming every row; a hidden row says nothing', () => {
    const text = door('plotshape(close > open, "a", style = shape.triangleup)\n'
      + 'plotshape(close < open, "b", style = shape.triangleup)\n'
      + 'plotshape(close == open, "c", style = shape.diamond, display = display.none)', false)
    expect(text).toContain('`a` and `b` are drawn as arrows up: TradingView draws `shape.triangleup`')
    expect(text.match(/shape\.triangleup/g)).toHaveLength(1)
    expect(text).not.toContain('`c`')
  })
})

/** The code with its comments removed (block comments, then line comments not inside a quote on that line). */
function stripComments(src) {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlocks.split('\n').map((line) => {
    let quote = null
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (quote) { if (ch === '\\') i += 1; else if (ch === quote) quote = null; continue }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
    }
    return line
  }).join('\n')
}

describe('e99 E5 — every approximation the translator stamps has a reader at the member door (source rail)', () => {
  const read = (rel) => stripComments(fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8'))
  const flagsIn = (src) => [...new Set([...src.matchAll(/\b([a-z][A-Za-z]*Approx)\b/g)].map((m) => m[1]))].sort()
  it('control: a flag written only in a comment is not a flag', () => {
    expect(flagsIn(stripComments('x.fooApprox = true\n// y.barApprox = true'))).toEqual(['fooApprox'])
  })
  it('the translator\'s flags are all read by the member door', () => {
    const written = flagsIn(read('src/components/chart/engine/ast/pine.js'))
    expect(written).toEqual(expect.arrayContaining(['positionApprox', 'shapeApprox']))
    const door = read('src/components/chart/builder/memberPane/memberPaneDefinition.js')
    for (const f of written) expect(door, `${f} has no reader`).toMatch(new RegExp(`\\.${f}\\b`))
  })
})

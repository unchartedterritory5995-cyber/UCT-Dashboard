// app/src/components/chart/engine/plotOffsetSetting.test.js
//
// ─── ⭐⭐ e98 E3 — A PLOT'S `offset = <input>` IS THE MEMBER'S SETTING, AND IT SHIFTS THE DRAWING, NEVER THE SERIES ───
//
// ⚰️ MEASURED 2026-11-25 on TradingView's built-in moving averages' shape (`offset = input.int(title="Offset",
// defval=0, minval=-500, maxval=500)`, `plot(out, offset=offset)`):
//   * default 0 (the built-ins' own): NO Offset setting on either lane (folded away; the runtime lane pinned it);
//   * default > 0: folded into the TREE (`sma(…)[3]`), so the series a scan or an alert read was SHIFTED, and the
//     author's `minval = -500` was dropped, so a member's -2 wrote `sma(…)[-2]`, which the chart lane refused;
//   * default < 0: drawn displaced at the default, no setting; the runtime lane withheld every rightward one.
// TradingView: "In the case of plot function's offset parameter, the shift is only cosmetic; the actual values in the
// series are not moved" (Pine User Manual v4, `plot` annotation), and TradingView's own support note on alerts with
// offsets: the offset "does not affect the alert triggering" (solution 43000744279).
//
// ⭐ NOW (coordinator ruling 2026-11-25): an int input ONLY a plot's `offset` reads (`pine.js::offsetSettingInputs`)
// is the member's own int setting (its `minval` / `maxval` carried, negatives included), and the binder draws the plot
// `scale * value + add` bars right (or left) of the bar that computed it (`plots[].displaceInput`,
// `binder.drawShiftOf`, colour columns alike). The column is never shifted. LITERAL offsets keep today's paths.

import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { translatePine } from './ast/pine.js'
import { memberPaneDefinition, __forceRuntimeLaneForTests } from '../builder/memberPane/memberPaneDefinition'
import { drawShiftOf, displacedColumn } from './binder'
import { validateDefinition } from './defSchema.js'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from './runtimeKill'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')
afterAll(() => __forceRuntimeLaneForTests(false))

const H = '//@version=6\nindicator(title="Moving Average Simple", shorttitle="SMA", overlay=true)\n'
/** The built-in moving averages' shape (written here, not copied): a Length, a Source, an Offset only the plot reads. */
const MA = (dflt, offsetExpr = 'offset') => 'len = input.int(9, minval=1, title="Length")\nsrc = input(close, title="Source")\n'
  + `offset = input.int(title="Offset", defval=${dflt}, minval=-500, maxval=500, display = display.data_window)\n`
  + `out = ta.sma(src, len)\nplot(out, color=color.blue, title="MA", offset=${offsetExpr})`

function door(body, { runtime = false } = {}) {
  if (runtime) { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); __forceRuntimeLaneForTests(true) }
  try {
    const r = memberPaneDefinition({ source: `${H}${body}\n` })
    expect(r.ok, r.reason).toBe(true)
    expect(r.lane === 'runtime').toBe(runtime)
    expect(validateDefinition(r.definition).errors || []).toEqual([])
    return r
  } finally { if (runtime) __forceRuntimeLaneForTests(false) }
}
const maPlot = (def) => def.plots.find((p) => p.label === 'MA')

describe('e98 E3 — an Offset only the plot reads is the member\'s setting, on both lanes', () => {
  for (const runtime of [false, true]) {
    const lane = runtime ? 'runtime' : 'host'
    for (const dflt of [0, 3, -2]) {
      it(`${lane}, default ${dflt}: an int setting with the author's bounds, drawn at the member's value either side`, () => {
        const { definition: def } = door(MA(dflt), { runtime })
        const off = def.inputs.find((i) => i.key === 'offset')
        expect(off, 'the Offset setting').toMatchObject({ type: 'int', default: dflt, min: -500, max: 500 })
        const plot = maPlot(def)
        expect(plot.displaceInput).toEqual({ key: 'offset', scale: 1, add: 0 })
        expect(plot.displace, 'one authority over the drawing').toBeUndefined()
        expect(drawShiftOf(plot, def, {})).toBe(dflt)
        expect(drawShiftOf(plot, def, { offset: 5 })).toBe(5)
        expect(drawShiftOf(plot, def, { offset: -7 })).toBe(-7)
      })
    }
    it(`${lane}: an arithmetic offset on the setting (-offset + 1) keeps its relation`, () => {
      const { definition: def } = door(MA(4, '-offset + 1'), { runtime })
      const plot = maPlot(def)
      expect(plot.displaceInput).toEqual({ key: 'offset', scale: -1, add: 1 })
      expect(drawShiftOf(plot, def, {})).toBe(-3)
      expect(drawShiftOf(plot, def, { offset: -2 })).toBe(3)
    })
  }

  it('the SERIES is never shifted: the host tree is the unshifted average at every default', () => {
    for (const dflt of [0, 3, -2]) {
      const { definition: def } = door(MA(dflt))
      expect(def.compute.source, `default ${dflt}`).toBe('sma(close, 9)')
    }
  })

  it('the drawing moves either side, colour columns alike; the column itself is untouched', () => {
    const col = Float64Array.from([1, 2, 3, 4, 5])
    expect(Array.from(displacedColumn(col, 2))).toEqual([NaN, NaN, 1, 2, 3])
    expect(Array.from(displacedColumn(col, -2))).toEqual([3, 4, 5, NaN, NaN])
    expect(displacedColumn(['a', 'b', 'c'], 1)).toEqual([null, 'a', 'b'])
    expect(Array.from(col)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('e98 E3 — what keeps today\'s path', () => {
  it('a LITERAL offset: +N in the tree, -N as displace, no setting', () => {
    const pos = door('plot(ta.sma(close, 9), "MA", offset = 3)').definition
    expect(pos.compute.source).toBe('sma(close, 9)[3]')
    expect(maPlot(pos).displaceInput).toBeUndefined()
    const neg = door('plot(ta.sma(close, 9), "MA", offset = -2)').definition
    expect(maPlot(neg).displace).toBe(-2)
    expect(maPlot(neg).displaceInput).toBeUndefined()
  })

  it('an input the VALUE reads too keeps the fold (it is not only the offset\'s)', () => {
    const t = translatePine(`${H}n = input.int(3)\nplot(ta.sma(close, 9) + n, "MA", offset = n)\n`, { basePeriod: 'D', strict: true })
    expect(t.outputs[0].formula).toBe('(sma(close, 9) + 3)[3]')
    expect(t.outputs[0].displaceSetting).toBeUndefined()
  })

  it('a reassigned input, or one a paint offset reads, keeps the fold', () => {
    for (const body of ['n = input.int(3)\nn := n + 0\nplot(close, "MA", offset = n)',
      'n = input.int(3)\nbgcolor(color.red, offset = n)\nplot(close, "MA", offset = n)']) {
      const t = translatePine(`${H}${body}\n`, { basePeriod: 'D', strict: true })
      const row = t.outputs.find((o) => o.kind === 'plot')
      expect(row.displaceSetting, body).toBeUndefined()
    }
  })
})

describe('e98 E3 — an author\'s negative bound is a bound (minval = -500)', () => {
  it('carried on the folded entry and refused below it', () => {
    const t = translatePine(`${H}k = input.int(0, minval = -5, maxval = 5)\nplot(close + k, "MA")\n`, { basePeriod: 'D', strict: true })
    const e = t.outputs[0].inputsFolded.find((x) => x.name === 'k')
    expect([e.min, e.max]).toEqual([-5, 5])
    const out = translatePine(`${H}k = input.int(0, minval = -5, maxval = 5)\nplot(close + k, "MA")\n`,
      { basePeriod: 'D', strict: true, inputValues: { k: -9 } })
    expect(JSON.stringify(out.outputs[0].refusal || out.refusal)).toContain('bounded it to -5..5')
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

describe('e98 E3 — every draw-shift reader asks with the instance\'s inputs (source rail)', () => {
  /** Every `drawShiftOf(…)` call's top-level argument count (balanced parentheses), the definition excluded. */
  const calls = (src) => {
    const out = []
    let at = src.indexOf('drawShiftOf(')
    while (at >= 0) {
      let depth = 0
      let args = 1
      let i = at + 'drawShiftOf'.length
      for (; i < src.length; i += 1) {
        const ch = src[i]
        if (ch === '(') depth += 1
        else if (ch === ')') { depth -= 1; if (depth === 0) break }
        else if (ch === ',' && depth === 1) args += 1
      }
      const text = src.slice(at, i + 1)
      if (!/^drawShiftOf\(plot, def = null/.test(text)) out.push({ text, args: /^drawShiftOf\(\s*\)$/.test(text) ? 0 : args })
      at = src.indexOf('drawShiftOf(', i)
    }
    return out
  }
  it('control: a call without inputs is seen, and a comment is not', () => {
    expect(calls(stripComments('x = drawShiftOf(plot)\n// drawShiftOf(a, b, c)'))).toEqual([{ text: 'drawShiftOf(plot)', args: 1 }])
    expect(calls('y = drawShiftOf(f((p) => p.k), d, g(i))')[0].args).toBe(3)
  })
  it('binder.js and the vendor harness pass (plot, def, inputs) at every site', () => {
    const binder = stripComments(fs.readFileSync(path.join(HERE, 'binder.js'), 'utf8'))
    const harness = stripComments(fs.readFileSync(path.join(HERE, '__tests__/vendorHarness/ourSide.js'), 'utf8'))
    const sites = [...calls(binder), ...calls(harness)]
    expect(sites.length).toBe(10)
    for (const c of sites) expect(c.args, c.text).toBe(3)
  })
})

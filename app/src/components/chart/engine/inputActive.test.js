// app/src/components/chart/engine/inputActive.test.js
//
// ─── ⭐⭐ e98 E2 — AN INPUT'S `active =` GREYS THE SETTING AS TRADINGVIEW DOES; ITS VALUE STILL APPLIES ─────────────────
//
// ⚰️ Pine v6 (July 2025): `input*(…, active = <bool>)` greys the setting out in TradingView's settings when false. The
// engine ignored it in silence on both lanes (measured at the member door, 2026-11-25), whatever it said: a setting,
// a literal `false`, even a per-bar condition.
//
// ⭐ NOW: ONE reader (`pine.js::resolveInputActives`, through `Resolver.settingChoiceTestOf`, the test `display` and
// `linestyle` read) answers each input's `active =`; the member door writes it as `inputs[].activeWhen` in its KNOB
// TEST shape (U6's grammar, the one checker `defSchema.hiddenWhenProblem`), and the settings panel greys by the one
// evaluator (`knobBind.knobTestAt`, through `indicatorRegistry.evalActiveWhen`).
//
// ⛔ COORDINATOR RULING (2026-11-25): `inputs[].activeWhen` holds EXACTLY TWO SHAPES (the native `{key, …}` condition
// and the knob test); a third is REFUSED by both validators and read as INACTIVE, never as active (it failed open).

import { describe, it, expect, vi, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { memberPaneDefinition, __forceRuntimeLaneForTests } from '../builder/memberPane/memberPaneDefinition'
import { evalActiveWhen, fieldsForInstance } from '../indicatorRegistry'
import { validateDefinition, activeWhenShape } from './defSchema.js'
import { listDefinitions, getDefinition } from './nativeRegistry'
import { __permitRuntimePaneForTests } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from './runtimeKill'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const H = '//@version=6\nindicator("t", overlay = true)\n'
const COLOUR_PLOT = 'plot(close, "m", color = show ? color.red : color.blue)'

function door(body, { runtime = false } = {}) {
  if (runtime) { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests(); __forceRuntimeLaneForTests(true) }
  try {
    const r = memberPaneDefinition({ source: `${H}${body}\n` })
    expect(r.ok, r.reason).toBe(true)
    expect(r.lane === 'runtime').toBe(runtime)
    expect(validateDefinition(r.definition).ok).toBe(true)
    return r
  } finally { if (runtime) __forceRuntimeLaneForTests(false) }
}
afterAll(() => __forceRuntimeLaneForTests(false))
const inputOf = (def, key) => def.inputs.find((i) => i.key === key)
const notesText = (r) => (r.notes || []).map((n) => n.note).join('\n')
/** Whether the settings panel shows this input active for these form values (the panel's own call). */
const activeAt = (def, key, values) => evalActiveWhen(inputOf(def, key).activeWhen, values, def)

describe('e98 E2 — a setting test greys the setting, per instance, on both lanes', () => {
  for (const runtime of [false, true]) {
    const lane = runtime ? 'runtime' : 'host'
    it(`${lane}: an input.bool controller (declared because the greyed setting is)`, () => {
      const { definition: def } = door('useMa = input.bool(true, "Use MA")\nshow = input.bool(true, "Show", active = useMa)\n'
        + COLOUR_PLOT, { runtime })
      expect(inputOf(def, 'useMa'), 'the controller is the member\'s control').toBeTruthy()
      expect(inputOf(def, 'show').activeWhen).toEqual({ type: 'series', name: 'useMa' })
      expect(inputOf(def, 'useMa').activeWhen).toBeUndefined()
      const off = runtime ? false : 0
      const on = runtime ? true : 1
      expect(activeAt(def, 'show', { useMa: on })).toBe(true)
      expect(activeAt(def, 'show', { useMa: off })).toBe(false)
    })
    it(`${lane}: an option compared (mode == "EMA")`, () => {
      const { definition: def } = door('mode = input.string("SMA", "Mode", options = ["SMA", "EMA"])\nlen = input.int(20, "Length")\n'
        + 'show = input.bool(true, "Show", active = mode == "EMA")\n'
        + 'plot(mode == "EMA" ? ta.ema(close, len) : ta.sma(close, len), "m", color = show ? color.red : color.blue)', { runtime })
      expect(activeAt(def, 'show', { mode: 'EMA' })).toBe(true)
      expect(activeAt(def, 'show', { mode: 'SMA' })).toBe(false)
    })
    it(`${lane}: a literal false greys it at every setting; a literal true greys nothing`, () => {
      const { definition: def } = door('show = input.bool(true, "Show", active = false)\nk = input.bool(true, "K", active = true)\n'
        + 'plot(close, "m", color = show and k ? color.red : color.blue)', { runtime })
      expect(inputOf(def, 'show').activeWhen).toEqual({ type: 'num', value: 0 })
      expect(activeAt(def, 'show', {})).toBe(false)
      expect(inputOf(def, 'k').activeWhen).toBeUndefined()
    })
    it(`${lane}: a test that is not one of the script's settings is said by name, never guessed`, () => {
      const r = door(`show = input.bool(true, "Show", active = close > open)\n${COLOUR_PLOT}`, { runtime })
      expect(inputOf(r.definition, 'show').activeWhen).toBeUndefined()
      expect(notesText(r)).toContain('`Show` is not greyed here as it is on TradingView: its `active` is a condition that is not one of the script\'s settings')
    })
  }

  it('the settings panel\'s own form model carries it, and greys at the instance\'s values', () => {
    const { definition: def } = door('useMa = input.bool(false, "Use MA")\nshow = input.bool(true, "Show", active = useMa)\n' + COLOUR_PLOT)
    const model = fieldsForInstance(def, { instanceId: 'i:1', defId: def.id, inputs: {} })
    const field = model.all.find((f) => f.key === 'show')
    expect(field.activeWhen).toEqual({ type: 'series', name: 'useMa' })
    expect(evalActiveWhen(field.activeWhen, model.values, def)).toBe(false)
    expect(evalActiveWhen(field.activeWhen, { ...model.values, useMa: 1 }, def)).toBe(true)
  })

  it('a parameter of the formulas (a `param<N>` setting at load) is said by its title, not greyed in silence', () => {
    const r = door('useMa = input.bool(true, "Use MA")\nlen = input.int(20, "Length", active = useMa)\nplot(ta.sma(close, len), "m")')
    expect(Object.values(r.definition.compute.paramManifest || {}).map((m) => m.sourceName)).toContain('len')
    expect(notesText(r)).toContain('`Length` is not greyed here as it is on TradingView: it is a setting of the script\'s formulas (a parameter), which this chart does not grey yet')
    // and a controller that greys nothing here is not declared
    expect(inputOf(r.definition, 'useMa')).toBeUndefined()
  })

  it('the VALUE is untouched: the same document but for the greying', () => {
    const strip = (def) => JSON.parse(JSON.stringify({ ...def, inputs: def.inputs.map(({ activeWhen, ...rest }) => rest) }))
    const a = door('useMa = input.bool(true, "Use MA")\nk = input.bool(true, "K", active = false)\nplot(close, "m", color = k ? color.red : color.blue)').definition
    const b = door('useMa = input.bool(true, "Use MA")\nk = input.bool(true, "K")\nplot(close, "m", color = k ? color.red : color.blue)').definition
    expect(strip(a).compute).toEqual(strip(b).compute)
    expect(strip(a).plots).toEqual(strip(b).plots)
    expect(strip(a).inputs).toEqual(strip(b).inputs)
  })
})

describe('e98 E2 — exactly two shapes; a third fails CLOSED (coordinator ruling)', () => {
  /** The `{key}` evaluator as it stood before E2 (`indicatorRegistry.evalActiveWhen`, master 2026-11-25), for the key
   *  shape only: an old document must read exactly as it did. */
  function legacyKeyEval(aw, values) {
    const v = values ? values[aw.key] : undefined
    if ('equals' in aw) return v === aw.equals
    if ('notEquals' in aw) return v !== aw.notEquals
    if ('in' in aw) return Array.isArray(aw.in) && aw.in.includes(v)
    if ('gt' in aw) return Number(v) > Number(aw.gt)
    if ('gte' in aw) return Number(v) >= Number(aw.gte)
    if ('lt' in aw) return Number(v) < Number(aw.lt)
    if ('lte' in aw) return Number(v) <= Number(aw.lte)
    if (Object.keys(aw).some((k) => k !== 'key')) return true
    return !!v
  }

  it('an old {key} document reads exactly as before: every native definition, UCT RS among them', () => {
    const rs = getDefinition('rsLine')
    expect(rs && rs.inputs.some((i) => i.activeWhen), 'UCT RS declares activeWhen (the fixture is not vacuous)').toBe(true)
    let compared = 0
    for (const def of listDefinitions()) {
      expect(validateDefinition(def).errors || [], def.id).toEqual([])
      for (const inp of def.inputs || []) {
        if (inp.activeWhen === undefined) continue
        expect(activeWhenShape(inp.activeWhen), `${def.id}.${inp.key}`).toBe('key')
        const keyInput = def.inputs.find((i) => i.key === inp.activeWhen.key) || {}
        const opts = Array.isArray(keyInput.options) ? keyInput.options.map((o) => (o && typeof o === 'object' ? o.value : o)) : []
        for (const v of [undefined, true, false, 0, 1, 5, '', 'x', ...opts]) {
          const values = { [inp.activeWhen.key]: v }
          expect(evalActiveWhen(inp.activeWhen, values, def), `${def.id}.${inp.key} at ${JSON.stringify(v)}`)
            .toBe(legacyKeyEval(inp.activeWhen, values))
          compared += 1
        }
      }
    }
    expect(compared).toBeGreaterThan(100)
  })

  it('no activeWhen is active', () => {
    expect(evalActiveWhen(undefined, {})).toBe(true)
    expect(evalActiveWhen(null, {})).toBe(true)
  })

  it('a third shape is REFUSED at validation, by name', () => {
    const base = door(`show = input.bool(true, "Show")\n${COLOUR_PLOT}`).definition
    for (const bad of [{ when: 'show' }, { key: 'show', type: 'series', name: 'show' }, { key: 7 }]) {
      const def = JSON.parse(JSON.stringify(base))
      def.inputs.find((i) => i.key === 'show').activeWhen = bad
      const r = validateDefinition(def)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      expect(r.errors.join('\n')).toContain('is neither a `{key, …}` condition nor a setting test')
    }
  })

  it('a third shape is read INACTIVE, never active', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const bad of [{ when: 'show' }, { key: 'show', type: 'series', name: 'show' }, 'yes', 1]) {
        expect(evalActiveWhen(bad, { show: 1 }), JSON.stringify(bad)).toBe(false)
      }
    } finally { warn.mockRestore() }
  })

  it('a knob test that cannot be evaluated is inactive, never guessed active', () => {
    expect(evalActiveWhen({ type: 'series', name: 'nowhere' }, {}, { inputs: [] })).toBe(false)
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

describe('e98 E2 — the settings panel greys with the row\'s definition (source rail)', () => {
  const PASSES = /evalActiveWhen\(\s*f\.activeWhen\s*,\s*row\.values\s*,\s*registry\?\.getDefinition\?\.\(row\.defId\)\s*\)/
  it('control: the scan reads code, never a comment', () => {
    expect(PASSES.test(stripComments('// evalActiveWhen(f.activeWhen, row.values, registry?.getDefinition?.(row.defId))'))).toBe(false)
    expect(PASSES.test(stripComments('x = evalActiveWhen(f.activeWhen, row.values, registry?.getDefinition?.(row.defId))'))).toBe(true)
  })
  it('ChartSettingsIndicators passes the definition', () => {
    const src = stripComments(fs.readFileSync(path.join(HERE, '..', 'ChartSettingsIndicators.jsx'), 'utf8'))
    expect(src).toMatch(PASSES)
  })
})

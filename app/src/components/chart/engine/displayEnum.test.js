// app/src/components/chart/engine/displayEnum.test.js
//
// ─── ⭐⭐ e97 U8 — AN ENUM SETTING'S DISPLAY THROUGH A `var`, AND A `switch` THAT MATCHES NOTHING ──────────────────────
//
// ⚰️ Measured before this unit, on the built-in moving-average family (SMA, EMA, OBV, CCI, RCI, RVI):
//   (a) `ma(src, len, type) => switch type` with no default arm, at the default "None", was REFUSED (`pine:block`,
//       "no arm matches it and there is no default") on the host lane: Pine yields `na` there;
//   (b) `var enableMA = maType != "None"` / `var isBB = maType == "SMA + Bollinger Bands"` read as per-bar STATE, so
//       `display = enableMA ? display.all : display.none` was "not one of the script's settings" (withheld), or folded
//       to the default with no control; under U7 the proof then declined and CCI / RCI / RVI lost their MA type and
//       BB StdDev settings.
//
// ⭐ NOW: a no-match switch with no default yields Pine's `na`; a display test that is a NAME bound (plainly, or by a `var`
// nothing reassigns) to `<input.string> == / != "<option>"` is the member's enum setting (`displayKnobLeafOf`), the same
// leaf in both passes (declared or folded), so the colour-inputs proof sees one shape and the setting comes across.
// The MA-family shape below is written for this rail (not the built-ins' text).

import { describe, it, expect } from 'vitest'

import { translatePine } from './ast/pine.js'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { plotHiddenAt } from './knobBind.js'
import { fillActiveFor } from './binder.js'
import { validateDefinition } from './defSchema.js'

const H = '//@version=6\nindicator("t", overlay = true)\n'
const door = (body) => {
  const r = memberPaneDefinition({ source: `${H}${body}\n` })
  expect(r.ok, r.reason).toBe(true)
  expect(validateDefinition(r.definition).ok, JSON.stringify(validateDefinition(r.definition).errors)).toBe(true)
  return r
}
const plotOf = (def, label) => def.plots.find((p) => p.label === label)
const inputOf = (def, key) => (def.inputs || []).find((i) => i.key === key)

const FAMILY = [
  'src = close',
  'base = ta.sma(src, 9)',
  'plot(base, "Base", color = color.blue)',
  'kind = input.string("None", "Type", options = ["None", "SMA", "SMA + BB", "EMA"])',
  'var useBands = kind == "SMA + BB"',
  'mult = input.float(2.0, "Mult")',
  'var useMa = kind != "None"',
  'smooth(x, n, t) =>',
  '    switch t',
  '        "SMA" => ta.sma(x, n)',
  '        "SMA + BB" => ta.sma(x, n)',
  '        "EMA" => ta.ema(x, n)',
  'm = useMa ? smooth(base, 14, kind) : na',
  'dev = useBands ? ta.stdev(base, 14) * mult : na',
  'plot(m, "Smoothed", color = color.yellow, display = useMa ? display.all : display.none)',
  'up = plot(m + dev, "Upper", color = color.green, display = useBands ? display.all : display.none)',
  'lo = plot(m - dev, "Lower", color = color.green, display = useBands ? display.all : display.none)',
  'fill(up, lo, color = useBands ? color.new(color.green, 90) : na, display = useBands ? display.all : display.none)',
].join('\n')

describe('e97 U8(b) — a display read through a `var` (or a plain binding) to an enum setting', () => {
  it('the MA-family shape: MA type and Mult are the member\'s settings; plots and band follow the type', () => {
    const { definition: def } = door(FAMILY)
    expect(inputOf(def, 'kind')).toMatchObject({ type: 'enum', default: 'None' })
    expect(inputOf(def, 'kind').options).toEqual(['None', 'SMA', 'SMA + BB', 'EMA'])
    expect(inputOf(def, 'mult')).toMatchObject({ type: 'float' })
    const hidden = (label, inputs) => plotHiddenAt(plotOf(def, label), def, inputs)
    expect(hidden('Smoothed', {})).toBe(true)
    expect(hidden('Smoothed', { kind: 'SMA' })).toBe(false)
    expect(hidden('Upper', { kind: 'SMA' })).toBe(true)
    expect(hidden('Upper', { kind: 'SMA + BB' })).toBe(false)
    const band = def.plots.find((p) => p.fill)
    expect(fillActiveFor(band.fill, { def, inst: { inputs: {} } })).toBe(false)
    expect(fillActiveFor(band.fill, { def, inst: { inputs: { kind: 'SMA + BB' } } })).toBe(true)
  })

  it('a plain binding reads the same way', () => {
    const { definition: def } = door('kind = input.string("A", "Kind", options = ["A", "B"])\non = kind == "B"\n'
      + 'plot(close, "p", display = on ? display.all : display.none)')
    expect(inputOf(def, 'kind')).toMatchObject({ type: 'enum' })
    expect(plotHiddenAt(plotOf(def, 'p'), def, {})).toBe(true)
    expect(plotHiddenAt(plotOf(def, 'p'), def, { kind: 'B' })).toBe(false)
  })

  it('⛔ CONTROL: a `var` the script REASSIGNS is per-bar state, not the setting', () => {
    const r = memberPaneDefinition({ source: `${H}kind = input.string("A", "Kind", options = ["A", "B"])\nvar on = kind == "B"\n`
      + 'if close > open\n    on := true\nplot(close, "p", display = on ? display.all : display.none)\n' })
    const p = r.ok ? plotOf(r.definition, 'p') : null
    expect(!!(p && p.hiddenWhen && JSON.stringify(p.hiddenWhen).includes('"kind"'))).toBe(false)
  })
})

describe('e97 U8(a) — a `switch` no arm matches, with no default arm, is Pine\'s `na`', () => {
  const SW = 'kind = input.string("None", "Kind", options = ["None", "SMA", "EMA"])\n'
    + 'f(x, t) =>\n    switch t\n        "SMA" => ta.sma(x, 3)\n        "EMA" => ta.ema(x, 3)\nplot(f(close, kind), "s")\n'
  it('folded at its default (no member knob): served, its value `na`', () => {
    const t = translatePine(`${H}${SW}`, { strict: true })
    const o = t.outputs.find((x) => x.title === 's')
    expect(o.refusal).toBe(null)
    expect(o.formula).toContain('0 / 0')
  })
  it('as the member\'s enum knob (a switch on the setting itself): every arm built, the unnamed option `na`', () => {
    const t = translatePine(`${H}kind = input.string("None", "Kind", options = ["None", "SMA", "EMA"])\n`
      + 'm = switch kind\n    "SMA" => ta.sma(close, 3)\n    "EMA" => ta.ema(close, 3)\nplot(m, "s")\n',
    { strict: true, enumInputs: true, declareInputs: 'all' })
    const o = t.outputs.find((x) => x.title === 's')
    expect(o.refusal).toBe(null)
    expect(o.formula).toBe('kind == 1 ? sma(close, 3) : kind == 2 ? ema(close, 3) : 0 / 0')
  })
  it('CONTROL: a switch with a default arm still takes it', () => {
    const t = translatePine(`${H}kind = input.string("None", "Kind")\nf(x, t) =>\n    switch t\n        "SMA" => ta.sma(x, 3)\n        => x\nplot(f(close, kind), "s")\n`, { strict: true })
    const o = t.outputs.find((x) => x.title === 's')
    expect(o.refusal).toBe(null)
    expect(o.formula).not.toContain('0 / 0')
  })
})

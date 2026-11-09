// app/src/components/chart/engine/__tests__/rsSavedLayout.test.js
//
// ─── UCT Relative Strength, Phase 1 (review fix unit 9) — A SAVED v1 LAYOUT
//     SURVIVES v2 ────────────────────────────────────────────────────────────
//
// Review finding F3 / Q4. The v1 definition's one colour input was `color`; a
// premium member who recoloured the RS line and saved the layout carries
// `{benchmark, color, lineWidth}` in `cs.indicatorInstances`. v2 KEEPS the key
// `color` for the line's "above" colour (nativeRegistry.js, the Line group) so
// that instance still validates — but until this file no test fed one through
// the gates, and a later rename would refuse saved layouts again in silence
// ("can't be shown", Repair discards the colour). This walks the whole path:
//
//   validateInstance → normalizeInstances (kept, never dropped)
//   → unavailableInstances (not reported) → fieldsForInstance (every v2 input
//   defaulted around the three stored) → resolvePlotForInstance (the member's
//   colour on the line) → columnColorsForPlot and the legend chip → pickServerInputs
//   (the colour never keys the fetch).
//
// ⛔ WITH A CONTROL. The unit-5-era key `lineColor` — the rename f684c400b0 undid —
// is exactly what the finding describes, so an instance carrying it must be
// REPORTED as `input-removed`. A rail that cannot go red on the defect it guards
// is a rail in name only.
import { describe, it, expect } from 'vitest'
import { getDefinition, listDefinitions, resolveInputs } from '../nativeRegistry'
import { validateInstance, normalizeInstances } from '../instances'
import { unavailableInstances, UNAVAILABLE_REASONS } from '../unavailableInstances'
import { checkInstanceInput } from '../instanceControls'
import { resolvePlotForInstance, columnColorsForPlot } from '../pool'
import { pickServerInputs } from '../serverCompute'
import { legendChips } from '../readout'
import { fieldsForInstance } from '../../indicatorRegistry'

const REGISTRY = { getDefinition, listDefinitions }
const def = getDefinition('rsLine')
const linePlot = def.plots.find((p) => p.key === 'rsLine')

/** The stored v1 instance, byte for byte as the finding states it. */
const V1 = Object.freeze({
  instanceId: 'rsLine', defId: 'rsLine',
  inputs: Object.freeze({ benchmark: 'QQQ', color: '#4ECDC4', lineWidth: 2 }),
})
/** …and the shape `addInstance` would have stamped on a v1 build. */
const V1_VERSIONED = Object.freeze({ ...V1, defVersion: 1, hidden: false })

const DEFAULT_LINE_COLOUR = '#6ba3be'

describe('the stored v1 instance {benchmark: QQQ, color: #4ECDC4, lineWidth: 2}', () => {
  it('is the current definition it instantiates: version 5 (round 2), `color` still declared, `lineColor` not', () => {
    expect(def.version).toBe(5)
    const keys = new Set(def.inputs.map((i) => i.key))
    for (const k of Object.keys(V1.inputs)) expect(keys.has(k), `v1 key "${k}" must still be declared`).toBe(true)
    expect(keys.has('lineColor')).toBe(false)
    expect(def.inputs.find((i) => i.key === 'color')).toMatchObject({ type: 'color', default: DEFAULT_LINE_COLOUR })
  })

  it('validates — and the upper-case hex is a colour the gate admits', () => {
    expect(validateInstance(V1, REGISTRY)).toEqual({ ok: true, inst: V1 })
    expect(validateInstance(V1_VERSIONED, REGISTRY).ok).toBe(true)
    for (const [k, v] of Object.entries(V1.inputs)) {
      expect(checkInstanceInput(def, k, v).ok, `${k} = ${JSON.stringify(v)}`).toBe(true)
    }
  })

  it('survives normalizeInstances: kept, not dropped, beside a v2 neighbour', () => {
    const v2 = { instanceId: 'rsLine:2', defId: 'rsLine', inputs: { benchmark: 'SPY', lineDownColor: '#e74c3c' } }
    const out = normalizeInstances([V1, V1_VERSIONED && { ...V1_VERSIONED, instanceId: 'rsLine:v' }, v2], REGISTRY)
    expect(out.dropped).toEqual([])
    expect(out.kept.map((i) => i.instanceId)).toEqual(['rsLine', 'rsLine:v', 'rsLine:2'])
    expect(out.kept[0]).toBe(V1)
  })

  it('is NOT reported by unavailableInstances — nothing to Remove, Keep or Repair', () => {
    expect(unavailableInstances({ indicatorInstances: [V1] }, REGISTRY)).toEqual([])
    expect(unavailableInstances({ indicatorInstances: [V1_VERSIONED] }, REGISTRY)).toEqual([])
  })

  it('every v2 input defaults around the three stored values', () => {
    const { values } = fieldsForInstance(def, V1)
    expect(values).toMatchObject({ benchmark: 'QQQ', color: '#4ECDC4', lineWidth: 2 })
    for (const inp of def.inputs) {
      if (inp.key in V1.inputs) continue
      expect(values[inp.key], inp.key).toBe(inp.default)
    }
    // The v2 inputs by name — a renamed one fails here, not in a member's layout.
    expect(values).toMatchObject({
      maLength: 21, maType: 'EMA', lookback: 252, priceTolerance: 2,
      showNewHigh: true, showNewHighBeforePrice: true, shortHistoryDots: true,
      lineDownColor: DEFAULT_LINE_COLOUR, maColor: '#8a8574',
      dotColor: DEFAULT_LINE_COLOUR, dotBeforePriceColor: '#c9a84c', dotPartialColor: '#8a8574',
    })
    // …and the v3 ones (2a-14): every new reading OFF, so the stored v1 layout
    // still draws Classic — no Mansfield line, no red-day or new-low dots.
    expect(values).toMatchObject({
      showMansfield: false, mansfieldLength: 200, showRedDay: false, showNewLow: false,
      mansfieldColor: DEFAULT_LINE_COLOUR, dotCrossColor: '#8a8574', dotRedColor: DEFAULT_LINE_COLOUR, dotLowColor: '#8a8574',
    })
    // …and the v4 ones (3-08): the ratio Reading, no custom ticker, the default
    // anchor and the Terminal's RRG lengths, so the stored v1 layout is still Classic.
    expect(values).toMatchObject({
      view: 'ratio', customBenchmark: '', anchorDate: '', rrgRatioLength: 10, rrgMomentumLength: 5,
      clenowWindow: 90, clenowGapPct: 15, atrLength: 20, varsLookback: 60,
    })
  })

  it('resolvePlotForInstance: colorUp (and the chip colour) is #4ECDC4, colorDown the default, width 2', () => {
    // The pool hands the STORED inputs straight in (`planBindings`); the dialog
    // hands the DEFAULTED values. Both must land the same plot.
    const { values } = fieldsForInstance(def, V1)
    for (const inputs of [V1.inputs, values]) {
      const plot = resolvePlotForInstance(linePlot, inputs)
      expect(plot).not.toBe(linePlot)
      expect(plot).toMatchObject({ key: 'rsLine', color: '#4ECDC4', colorUp: '#4ECDC4', colorDown: DEFAULT_LINE_COLOUR, width: 2 })
      expect(columnColorsForPlot(plot)).toEqual({ key: 'rsAbove', up: '#4ECDC4', down: DEFAULT_LINE_COLOUR })
    }
    // Pure: the definition's own plot is untouched.
    expect(linePlot.colorUp).toBe(DEFAULT_LINE_COLOUR)
    expect(linePlot.width).toBe(1)
  })

  it('the legend chip wears the member\'s colour and reads the benchmark', () => {
    const chips = legendChips([], null, REGISTRY, [V1])
    const rs = chips.find((c) => c.plotKey === 'rsLine')
    expect(rs).toBeTruthy()
    expect(rs.color).toBe('#4ECDC4')
    expect(chips.map((c) => c.plotKey)).toEqual(['rsLine'])
  })

  it('the colour and width never key the server fetch; the benchmark does', () => {
    expect(pickServerInputs(def, V1.inputs)).toEqual({ benchmark: 'QQQ' })
    const { values } = fieldsForInstance(def, V1)
    const sent = pickServerInputs(def, values)
    // Every server input a dialog control exists for. `redDayThreshold` is the ONE
    // Phase 1 server input with no control (the golden test and the Python range
    // rail pin the same fact), so it is absent from the defaulted values as well.
    expect(def.inputs.some((i) => i.key === 'redDayThreshold')).toBe(false)
    expect(Object.keys(sent).sort()).toEqual(def.meta.serverInputs.filter((k) => k !== 'redDayThreshold').sort())
    // v4: a v1 layout asks the v4 row for the ratio view, nothing custom, no picked anchor
    expect(sent).toMatchObject({ view: 'ratio', customBenchmark: '', anchorDate: '', showMansfield: false })
    expect(sent).not.toHaveProperty('color')
    expect(sent).not.toHaveProperty('lineWidth')
    expect(sent.benchmark).toBe('QQQ')
  })
})

describe('⛔ CONTROL — the rename this rail guards against', () => {
  const RENAMED = { instanceId: 'rsLine', defId: 'rsLine', inputs: { benchmark: 'QQQ', lineColor: '#4ECDC4', lineWidth: 2 } }

  it('an instance carrying the unit-5-era key `lineColor` is refused and reported as input-removed', () => {
    expect(validateInstance(RENAMED, REGISTRY).ok).toBe(false)
    const out = normalizeInstances([RENAMED], REGISTRY)
    expect(out.kept).toEqual([])
    expect(out.dropped.length).toBe(1)
    const rows = unavailableInstances({ indicatorInstances: [RENAMED] }, REGISTRY)
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ instanceId: 'rsLine', defId: 'rsLine', reason: UNAVAILABLE_REASONS.INPUT_REMOVED, keys: ['lineColor'] })
  })
})

// ─── Phase 3, unit 3-08 — SAVED v3 LAYOUTS LOAD ON v4 ───────────────────────
//
// v4 adds nine inputs and turns `showMansfield` into a `legacy` input (still
// declared, never rendered). Every instance a v3 build could have stored must
// therefore still validate, normalise and stay unreported, and a saved Trend
// layout must still ask the server for the Mansfield reading.
describe('saved v3 layouts on the v4 definition', () => {
  const TREND_V3 = Object.freeze({
    instanceId: 'rsLine', defId: 'rsLine', defVersion: 3, hidden: false,
    inputs: Object.freeze({ maLength: 21, maType: 'EMA', lookback: 252, showMansfield: true, mansfieldLength: 200,
      mansfieldColor: '#6ba3be', dotCrossColor: '#6ba3be', showRedDay: false, showNewLow: false }),
    visibility: { preset: 'dailyUp' }, presentation: { plots: { dotMansfieldCross: { dotSize: 'medium' } } },
  })
  const STRESS_V3 = Object.freeze({
    instanceId: 'rsLine:2', defId: 'rsLine', defVersion: 3, hidden: false,
    inputs: Object.freeze({ benchmark: 'RSP', maLength: 21, maType: 'EMA', lookback: 252, showRedDay: true,
      showNewHighBeforePrice: false, dotRedColor: '#c9a84c', color: '#6ba3be', lineDownColor: '#6ba3be',
      dotColor: '#6ba3be', showMansfield: false, showNewLow: false, headlineRating: 'both', showComponents: true }),
  })

  it('validate, survive normalizeInstances and are never reported', () => {
    for (const inst of [TREND_V3, STRESS_V3]) {
      expect(validateInstance(inst, REGISTRY).ok, inst.instanceId).toBe(true)
      for (const [k, v] of Object.entries(inst.inputs)) expect(checkInstanceInput(def, k, v).ok, `${k}`).toBe(true)
    }
    const out = normalizeInstances([TREND_V3, STRESS_V3], REGISTRY)
    expect(out.dropped).toEqual([])
    expect(out.kept).toEqual([TREND_V3, STRESS_V3])
    expect(unavailableInstances({ indicatorInstances: [TREND_V3, STRESS_V3] }, REGISTRY)).toEqual([])
  })

  // ⭐ 3-14: rendered only while its successor (`view`) is undeclared — on a v3
  // server it is the control that draws Mansfield; a v4 row replaces it.
  it('the legacy Mansfield switch is still declared (a stored true validates) and rendered only until the Reading is', () => {
    const showMansfield = def.inputs.find((i) => i.key === 'showMansfield')
    expect(showMansfield).toMatchObject({ type: 'bool', default: false, legacy: true })
    const v3Model = fieldsForInstance(def, TREND_V3)
    expect(v3Model.all.map((f) => f.key)).toContain('showMansfield')
    expect(v3Model.values.showMansfield).toBe(true)
    const v4 = { inputs: def.meta.serverInputs, options: { view: ['ratio', 'mansfield', 'rotation', 'quality', 'vars'] } }
    expect(fieldsForInstance(def, TREND_V3, { declared: v4 }).all.map((f) => f.key)).not.toContain('showMansfield')
  })

  it('a saved Trend layout asks the server for the Mansfield Reading (the legacy switch maps onto view, 3-08b)', () => {
    const { values } = fieldsForInstance(def, TREND_V3)
    // `showMansfield.mapsTo`: stored true and no stored view reads as
    // view: 'mansfield'; a v3 server drops `view` and reads showMansfield as it
    // always did, so both rows draw Mansfield
    expect(pickServerInputs(def, values)).toMatchObject({ showMansfield: true, view: 'mansfield', mansfieldLength: 200 })
    expect(pickServerInputs(def, resolveInputs(def, TREND_V3.inputs))).toMatchObject({ showMansfield: true, view: 'mansfield' })
    // read-time only: the frozen stored instance carries no view
    expect(TREND_V3.inputs).not.toHaveProperty('view')
  })

  it('a stored Reading wins: showMansfield true with view ratio asks for the RS line', () => {
    const inputs = { ...TREND_V3.inputs, view: 'ratio' }
    expect(validateInstance({ ...TREND_V3, inputs }, REGISTRY).ok).toBe(true)
    expect(pickServerInputs(def, resolveInputs(def, inputs))).toMatchObject({ showMansfield: true, view: 'ratio' })
    expect(fieldsForInstance(def, { ...TREND_V3, inputs }).values.view).toBe('ratio')
  })
})

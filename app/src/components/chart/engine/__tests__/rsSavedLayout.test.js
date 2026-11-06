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
import { getDefinition, listDefinitions } from '../nativeRegistry'
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
  it('is the v3 definition it instantiates: version 3, `color` still declared, `lineColor` not', () => {
    expect(def.version).toBe(3)
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
      mansfieldColor: DEFAULT_LINE_COLOUR, dotCrossColor: '#8a8574', dotRedColor: '#c9a84c', dotLowColor: '#8a8574',
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

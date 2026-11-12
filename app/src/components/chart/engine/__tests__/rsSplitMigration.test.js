// app/src/components/chart/engine/__tests__/rsSplitMigration.test.js
//
// ─── UCT RS split, U7 — NO SAVED `rsLine` INSTANCE IS DROPPED (map §(b)) ─────
//
// F20 (`instances.js`): a stored instance carrying an undeclared input key, or
// an illegal enum value, is DROPPED whole, silently. So every shape a v1…v5 build
// could have stored must still validate on the slim UCT RS Line, normalise
// (kept, never dropped), stay unreported by `unavailableInstances`, PLAN the
// ratio line, and send none of the retired keys to the server — because a
// `view: 'mansfield'` or `showMansfield: true` that still reached the rev 5 row
// would blank the line (`rs_provider` keeps only the chosen view's family).
//
// One case per §(b) row, each run against BOTH definitions: the v5 one (the
// control: it accepted these shapes yesterday and must still) and the slim one
// (the contract). The "sends none of the removed keys" half is the slim
// definition's alone; v5 sends them by design.
import { describe, it, expect } from 'vitest'
import { registerDefinitions, resolveInputs, RS_LINE_V5_RAW, RS_LINE_SLIM_RAW } from '../nativeRegistry'
import { validateInstance, normalizeInstances } from '../instances'
import { unavailableInstances } from '../unavailableInstances'
import { checkInstanceInput, addInstance, ensureLegacyInstance, setInstanceInput } from '../instanceControls'
import { pickServerInputs } from '../serverCompute'
import { planBindings } from '../pool'
import { legendChips } from '../readout'
import { resolveDisplayTarget } from '../displayTarget'
import { fieldsForInstance } from '../../indicatorRegistry'
import { mergeChartSettings } from '../../chartDefaults'

const SLIM = registerDefinitions([RS_LINE_SLIM_RAW]).defs[0]
const V5 = registerDefinitions([RS_LINE_V5_RAW]).defs[0]
const registryOf = (def) => ({ getDefinition: (id) => (id === 'rsLine' ? def : null), listDefinitions: () => [def] })
const BOTH = [['v5', V5], ['slim', SLIM]]

/** Every key the slim definition stops sending (§(b) rows 1–3). */
const REMOVED = Object.freeze(['view', 'showMansfield', 'priceTolerance', 'shortHistoryDots', 'showNewLow',
  'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow', 'clenowGapPct', 'atrLength', 'varsLookback', 'anchorDate'])

/** The stored shapes, one per §(b) row, as a member's `cs.indicatorInstances` holds them. */
const SHAPES = Object.freeze({
  // row 1: the five non-ratio Readings a v4/v5 build stored, with their lengths
  viewMansfield: { instanceId: 'rsLine', defId: 'rsLine', defVersion: 4, inputs: { view: 'mansfield', mansfieldLength: 200, mansfieldColor: '#6ba3be', dotCrossColor: '#6ba3be' },
    visibility: { preset: 'dailyUp' }, presentation: { plots: { dotMansfieldCross: { dotSize: 'medium' } } } },
  viewRotation: { instanceId: 'rsLine:r', defId: 'rsLine', defVersion: 4, inputs: { view: 'rotation', rrgRatioLength: 10, rrgMomentumLength: 5, lookback: 52 } },
  viewQuality: { instanceId: 'rsLine:q', defId: 'rsLine', defVersion: 4, inputs: { view: 'quality', clenowWindow: 90, clenowGapPct: 15 } },
  viewVars: { instanceId: 'rsLine:v', defId: 'rsLine', defVersion: 4, inputs: { view: 'vars', atrLength: 20, varsLookback: 60 } },
  // row 8: the one-day RS Rating Reading (rev 5)
  viewRating: { instanceId: 'rsLine:rt', defId: 'rsLine', defVersion: 5, inputs: { view: 'rating' } },
  // row 2: a v3 Trend instance (showMansfield true, no view)
  trendV3: { instanceId: 'rsLine', defId: 'rsLine', defVersion: 3, hidden: false,
    inputs: { maLength: 21, maType: 'EMA', lookback: 252, showMansfield: true, mansfieldLength: 200,
      mansfieldColor: '#6ba3be', dotCrossColor: '#6ba3be', showRedDay: false, showNewLow: false },
    visibility: { preset: 'dailyUp' }, presentation: { plots: { dotMansfieldCross: { dotSize: 'medium' } } } },
  // row 2, the hard one: BOTH stored, view mansfield AND showMansfield true (the Trend preset wrote both)
  trendV4: { instanceId: 'rsLine', defId: 'rsLine', defVersion: 4,
    inputs: { maLength: 21, maType: 'EMA', lookback: 252, view: 'mansfield', showMansfield: true, mansfieldLength: 200,
      mansfieldColor: '#6ba3be', dotCrossColor: '#6ba3be', showRedDay: false, showNewLow: false },
    visibility: { preset: 'dailyUp' }, presentation: { plots: { dotMansfieldCross: { dotSize: 'medium' } } } },
  // row 3: every Phase 3 / method / checks input stored at a non-default value
  methodKeys: { instanceId: 'rsLine:m', defId: 'rsLine', defVersion: 5,
    inputs: { rrgRatioLength: 12, rrgMomentumLength: 7, clenowWindow: 120, clenowGapPct: 10, atrLength: 14, varsLookback: 90,
      anchorDate: '2026-10-15', mansfieldLength: 52, priceTolerance: 3.5, shortHistoryDots: false, showNewLow: true, lookback: 52 } },
  // row 4: every presentation input stored, the seven colour keys included
  presentation: { instanceId: 'rsLine:p', defId: 'rsLine', defVersion: 5,
    inputs: { headlineRating: 'both', showComponents: true, ratingBands: false, showRating: true, showRanksTable: false,
      shadeVsAverage: true, showCrossMarkers: true, dotPartialColor: '#111111', dotLowColor: '#222222', mansfieldColor: '#333333',
      dotCrossColor: '#444444', lineDownColor: '#e74c3c', dotRedColor: '#c9a84c', maColor: '#555555' } },
  // row 6: the Stress preset's shape (instance dotSize / visibility written by the preset)
  stress: { instanceId: 'rsLine:s', defId: 'rsLine', defVersion: 5,
    inputs: { maLength: 21, maType: 'EMA', lookback: 252, showRedDay: true, showNewHighBeforePrice: false, dotRedColor: '#c9a84c',
      color: '#6ba3be', lineDownColor: '#6ba3be', dotColor: '#6ba3be', view: 'ratio', showMansfield: false, showNewLow: false },
    presentation: { plots: { dotNHred: { dotSize: 'large' } } }, visibility: { preset: 'dailyUp' } },
  // the v1 shape (rsSavedLayout.test.js's own case), and a slim-era instance that stored the new switch
  v1: { instanceId: 'rsLine', defId: 'rsLine', inputs: { benchmark: 'QQQ', color: '#4ECDC4', lineWidth: 2 } },
  slimEra: { instanceId: 'rsLine:n', defId: 'rsLine', defVersion: 5, inputs: { showAverage: true, benchmark: 'RSP' } },
})

describe('every §(b) stored shape validates, normalises and is never reported — on v5 (control) and on the slim definition', () => {
  for (const [name, inst] of Object.entries(SHAPES)) {
    for (const [label, def] of BOTH) {
      it(`${name} on ${label}`, () => {
        const REG = registryOf(def)
        const v = validateInstance(inst, REG)
        expect(v.ok, (v.errors || []).join('\n')).toBe(true)
        for (const [k, val] of Object.entries(inst.inputs)) expect(checkInstanceInput(def, k, val).ok, `${k} = ${JSON.stringify(val)}`).toBe(true)
        const out = normalizeInstances([inst], REG)
        expect(out.dropped).toEqual([])
        expect(out.kept).toEqual([inst])
        expect(unavailableInstances({ indicatorInstances: [inst] }, REG)).toEqual([])
      })
    }
  }

  it('⛔ CONTROL — a key NEITHER definition declares is still refused, and an illegal Reading value too', () => {
    for (const [, def] of BOTH) {
      const REG = registryOf(def)
      expect(validateInstance({ instanceId: 'x', defId: 'rsLine', inputs: { lineColor: '#fff' } }, REG).ok).toBe(false)
      expect(validateInstance({ instanceId: 'x', defId: 'rsLine', inputs: { view: 'weinstein' } }, REG).ok).toBe(false)
    }
  })
})

describe('on the slim definition every shape draws the RATIO line and sends none of the removed keys', () => {
  const REG = registryOf(SLIM)
  for (const [name, inst] of Object.entries(SHAPES)) {
    it(`${name}: the plan binds rsLine (and no Mansfield, Rotation, Quality, VARS or rating plot); the fetch carries no retired key`, () => {
      const plan = planBindings([inst], REG, [], {})
      const keys = plan.bind.map((b) => b.plotKey)
      expect(keys[0]).toBe('rsLine')
      for (const k of keys) expect(['rsLine', 'rsAbove', 'rsMa', 'dotNH', 'dotNHred', 'dotNHbeforePx'], k).toContain(k)
      // the stored inputs, resolved as the binder resolves them, then picked as the fetch is keyed
      const sent = pickServerInputs(SLIM, resolveInputs(SLIM, inst.inputs))
      for (const k of REMOVED) expect(sent, `${name} sends ${k}`).not.toHaveProperty(k)
      for (const k of Object.keys(sent)) expect(SLIM.meta.serverInputs, k).toContain(k)
      // and straight off the stored blob, the way `rsSavedLayout` pins it
      for (const k of REMOVED) expect(pickServerInputs(SLIM, inst.inputs), `${name} sends stored ${k}`).not.toHaveProperty(k)
      // the legend chip is the RS line's
      const chips = legendChips([], null, REG, [inst])
      expect(chips.map((c) => c.plotKey)).toEqual(['rsLine'])
    })
  }

  it('a stored view: mansfield + showMansfield: true (the Trend preset) still asks for the ratio line — nothing maps it back', () => {
    const { values } = fieldsForInstance(SLIM, SHAPES.trendV4)
    expect(values).toMatchObject({ view: 'mansfield', showMansfield: true })
    const sent = pickServerInputs(SLIM, values)
    expect(sent).not.toHaveProperty('view')
    expect(sent).not.toHaveProperty('showMansfield')
    expect(sent).toMatchObject({ maLength: 21, maType: 'EMA', lookback: 252, mansfieldLength: 200 })
    // the v3 Trend shape: no `mapsTo` reads showMansfield as the Mansfield view any more — the default Reading stands
    expect(resolveInputs(SLIM, SHAPES.trendV3.inputs).view, 'no successor mapping on the slim definition').toBe('ratio')
    expect(resolveInputs(V5, SHAPES.trendV3.inputs).view, 'the v5 control still maps it').toBe('mansfield')
    expect(pickServerInputs(SLIM, resolveInputs(SLIM, SHAPES.trendV3.inputs))).not.toHaveProperty('showMansfield')
  })

  it('the method keys fall back to the server defaults: tolerance and anchor are not sent; lookback 52 is', () => {
    const sent = pickServerInputs(SLIM, resolveInputs(SLIM, SHAPES.methodKeys.inputs))
    expect(sent).toEqual({ lookback: 52, mansfieldLength: 52, maLength: 21, maType: 'EMA', showNewHigh: true,
      showNewHighBeforePrice: true, showRedDay: false, benchmark: 'SPY', customBenchmark: '' })
  })

  it('every rendered input defaults around a v1 instance; the legacy ones default too and are never rendered', () => {
    const model = fieldsForInstance(SLIM, SHAPES.v1)
    expect(model.values).toMatchObject({ benchmark: 'QQQ', color: '#4ECDC4', lineWidth: 2, showAverage: false, maLength: 21, lookback: 252 })
    expect(model.values).toMatchObject({ view: 'ratio', showMansfield: false, anchorDate: '', priceTolerance: 2 })
    const rendered = model.all.map((f) => f.key)
    for (const k of REMOVED) expect(rendered, k).not.toContain(k)
    expect(rendered).toContain('showAverage')
  })
})

describe('placement (map §(b) row 5): the default moves onto the price pane; a member who moved it keeps the stored target', () => {
  const cs = (inst) => mergeChartSettings({ indicatorInstances: [inst] })

  it('no stored placement.target: the slim definition resolves to price, v5 to its own pane', () => {
    const inst = { instanceId: 'rs', defId: 'rsLine', inputs: {} }
    expect(SLIM.placement.target).toBe('price')
    expect(resolveDisplayTarget(inst, cs(inst), SLIM.placement.target)).toBe('price')
    expect(resolveDisplayTarget(inst, cs(inst), V5.placement.target)).toBe('pane')
  })

  it('a stored target is kept on either definition: pane stays pane, price stays price', () => {
    const toPane = { instanceId: 'rs', defId: 'rsLine', inputs: {}, placement: { target: 'pane', targetExplicit: true } }
    const toPrice = { instanceId: 'rs', defId: 'rsLine', inputs: {}, placement: { target: 'price', targetExplicit: true } }
    for (const [, def] of BOTH) {
      expect(resolveDisplayTarget(toPane, cs(toPane), def.placement.target)).toBe('pane')
      expect(resolveDisplayTarget(toPrice, cs(toPrice), def.placement.target)).toBe('price')
    }
  })

  it('both definitions declare the own invisible scale and the 64 px pane floor', () => {
    for (const [, def] of BOTH) {
      expect(def.placement).toMatchObject({ ownScale: true, axis: 'hidden', pane: { height: 0.2, minPx: 64 } })
    }
  })
})

describe('the member\'s "Save as my default" blob (map §(b) row 7) holding removed keys still makes a valid instance', () => {
  it('an instance built from a v5 default blob validates on the slim definition', () => {
    const blob = { benchmark: 'RSP', view: 'rotation', rrgRatioLength: 10, headlineRating: 'fast', showComponents: true,
      anchorDate: '2026-09-01', shadeVsAverage: true, lineDownColor: '#e74c3c' }
    const inst = { instanceId: 'rsLine:d', defId: 'rsLine', inputs: { ...blob } }
    for (const [, def] of BOTH) expect(validateInstance(inst, registryOf(def)).ok).toBe(true)
    expect(pickServerInputs(SLIM, resolveInputs(SLIM, inst.inputs))).not.toHaveProperty('view')
  })
})

describe('Show average is ON for a NEW UCT RS Line and changes nothing already saved (2026-11-11)', () => {
  const REG = registryOf(SLIM)
  const instOf = (cs) => cs.indicatorInstances.find((i) => i.defId === 'rsLine')
  const keysOf = (inst) => planBindings([inst], REG, [], {}).bind.map((b) => b.plotKey)

  it('the DECLARED default stays false (it is what a saved instance without the key means); the new-copy value rides meta.createInputs', () => {
    expect(SLIM.inputs.find((i) => i.key === 'showAverage').default).toBe(false)
    expect(SLIM.meta.createInputs).toEqual({ showAverage: true })
  })

  it('addInstance (Chart Settings > Indicators > Add) stores showAverage true and the average + shade plan', () => {
    const inst = instOf(addInstance(mergeChartSettings(null), 'rsLine', REG))
    expect(inst.inputs.showAverage).toBe(true)
    expect(resolveInputs(SLIM, inst.inputs).showAverage).toBe(true)
    expect(keysOf(inst)).toContain('rsMa')
  })

  it('ensureLegacyInstance (turning it on from the legacy toggle) also creates it with the average on', () => {
    const inst = instOf(ensureLegacyInstance(mergeChartSettings(null), 'rsLine', REG))
    expect(inst.inputs.showAverage).toBe(true)
  })

  it('a member can still switch it off on the new copy, and it stays off', () => {
    const cs0 = addInstance(mergeChartSettings(null), 'rsLine', REG)
    const id = instOf(cs0).instanceId
    const cs1 = setInstanceInput(cs0, id, 'showAverage', false, REG)
    const inst = instOf(cs1)
    expect(inst.inputs.showAverage).toBe(false)
    expect(keysOf(inst)).not.toContain('rsMa')
  })

  for (const [name, inst] of Object.entries(SHAPES)) {
    if (name === 'slimEra') continue // stored showAverage: true — unaffected by definition
    it(`SAVED ${name}: no showAverage stored, so it still resolves OFF, draws no average, and a settings round trip adds no key`, () => {
      expect(Object.prototype.hasOwnProperty.call(inst.inputs, 'showAverage')).toBe(false)
      expect(resolveInputs(SLIM, inst.inputs).showAverage).toBe(false)
      expect(keysOf(inst)).not.toContain('rsMa')
      const round = mergeChartSettings({ indicatorInstances: [inst] })
      const out = normalizeInstances(round.indicatorInstances, REG)
      expect(out.kept.find((i) => i.instanceId === inst.instanceId).inputs).not.toHaveProperty('showAverage')
      // a legacy:rsLine mirror toggle on a chart that already holds this instance revives nothing new
      const again = ensureLegacyInstance({ ...round, indicatorInstances: [inst] }, 'rsLine', REG)
      expect(again.indicatorInstances.find((i) => i.instanceId === inst.instanceId).inputs).not.toHaveProperty('showAverage')
    })
  }

  it('a stored slim-era showAverage: true is untouched', () => {
    expect(resolveInputs(SLIM, SHAPES.slimEra.inputs).showAverage).toBe(true)
  })
})

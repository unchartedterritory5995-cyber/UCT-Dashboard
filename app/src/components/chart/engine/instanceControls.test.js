// ─── THE WRITE PATH FOR A FLIPPED INDICATOR ─────────────────────────────────
//
// Flip B makes the INSTANCE the read authority. These are the writers that make
// the four controls which currently write `cs.indicators.<id>.<field>` reach it —
// and the invariant every case below asserts on BOTH sides of: **the legacy
// mirror always agrees with the instance**, because the alert evaluator, the
// alert popover, the screener and the `?indicators=` route read that section and
// know nothing about instances.
import { describe, it, expect } from 'vitest'
import { setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled } from './instanceControls'
import { normalizeInstances, migrateLegacyToInstances, legacyInstanceId } from './instances'
import * as engineRegistry from './nativeRegistry'

const R = engineRegistry
const base = () => ({ indicators: { rsi: { enabled: false, period: 14, color: '#7b68ee' } }, indicatorInstances: [] })
const live = (cs) => normalizeInstances(cs.indicatorInstances, R).kept

describe('setIndicatorEnabled — the instance AND the mirror, always both', () => {
  it('turning one ON adds an instance carrying the blob\'s current params', () => {
    const next = setIndicatorEnabled(base(), 'rsi', true, R)
    const inst = live(next).find(i => i.defId === 'rsi')
    expect(inst.instanceId).toBe(legacyInstanceId('rsi'))
    expect(inst.inputs).toEqual({ period: 14, color: '#7b68ee' })
    // …and the mirror, so the alert evaluator and IndicatorAlertPopover -- which
    // read cs.indicators and know nothing about instances -- keep working.
    expect(next.indicators.rsi.enabled).toBe(true)
  })

  it('…and the instance is BYTE-IDENTICAL to the one the migrator would make', () => {
    // The read-time migrator runs on every paint after Flip B, so a control that
    // built a DIFFERENT instance shape would make "did the user add this or did
    // the migrator?" observable — and `inputsSignature` keys the binder's pool on
    // exactly these bytes, so a difference is a series churn (#2049) too.
    const cs = base()
    const viaControl = setIndicatorEnabled(cs, 'rsi', true, R).indicatorInstances
      .find(i => i.defId === 'rsi')
    const viaMigrator = migrateLegacyToInstances(
      { ...cs, indicators: { ...cs.indicators, rsi: { ...cs.indicators.rsi, enabled: true } } }, R,
    ).find(i => i.defId === 'rsi')
    expect(JSON.stringify(viaControl)).toBe(JSON.stringify(viaMigrator))
  })

  it('…including the VOLUME-OVERLAY placement, which is a placement fact in the blob', () => {
    // `volumeOverlayIndicators` moves a pane oscillator onto the volume pane's
    // left axis (`StockChart.indTarget`). The migrator honours it; a control that
    // did not would silently move a user's overlaid RSI back into its own band
    // the first time they re-enabled it.
    const cs = { indicators: { rsi: { enabled: false, period: 14, color: '#7b68ee' } },
      indicatorInstances: [], volumeOverlayIndicators: ['rsi'] }
    const inst = setIndicatorEnabled(cs, 'rsi', true, R).indicatorInstances.find(i => i.defId === 'rsi')
    expect(inst.placement).toEqual({ target: 'volume' })
    expect(JSON.stringify(inst)).toBe(JSON.stringify(
      migrateLegacyToInstances({ ...cs, indicators: { rsi: { ...cs.indicators.rsi, enabled: true } } }, R)
        .find(i => i.defId === 'rsi')))
  })

  it('turning one OFF writes a TOMBSTONE, not a deletion', () => {
    // A bare removal is undone by the very next read: `migrateLegacyToInstances`
    // would see `enabled: true`… and a grid cell whose snapshot predates the
    // delete names the instance in full on its next unrelated write. Only a
    // persisting marker survives that (B2 Task 5).
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    const off = setIndicatorEnabled(on, 'rsi', false, R)
    expect(off.indicatorInstances).toEqual([{ instanceId: 'legacy:rsi', deleted: true }])
    expect(off.indicators.rsi.enabled).toBe(false)
    expect(live(off)).toEqual([])
  })

  it('the tombstone survives a re-migration — "I turned it off and it came back"', () => {
    const off = setIndicatorEnabled(setIndicatorEnabled(base(), 'rsi', true, R), 'rsi', false, R)
    // The read-time migrator runs on every paint after Flip B.
    const remigrated = migrateLegacyToInstances(off, R)
    expect(normalizeInstances(remigrated, R).kept.filter(i => i.defId === 'rsi')).toEqual([])
  })

  it('OFF tombstones EVERY live instance of the definition, not just the legacy one', () => {
    // A settings row is per-DEFINITION at v1. Tombstoning only `legacy:rsi` would
    // leave a second RSI drawing while the checkbox reads unchecked — and
    // `isIndicatorEnabled` would then re-check the box on the next render, which
    // is the same lie the `disabled` treatment exists to end, animated.
    const cs = { indicators: { rsi: { enabled: true } }, indicatorInstances: [
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false },
      { instanceId: 'second:rsi', defId: 'rsi', inputs: { period: 50 }, hidden: false },
    ] }
    const off = setIndicatorEnabled(cs, 'rsi', false, R)
    expect(live(off)).toEqual([])
    expect(isIndicatorEnabled(off, 'rsi', new Set(['rsi']))).toBe(false)
    expect(off.indicatorInstances.map(i => i.instanceId).sort()).toEqual(['legacy:rsi', 'second:rsi'])
  })

  it('…and leaves ANOTHER definition\'s instances alone', () => {
    const cs = { indicators: { rsi: { enabled: true }, bb: { enabled: true } }, indicatorInstances: [
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false },
      { instanceId: 'legacy:bb', defId: 'bb', inputs: {}, hidden: false },
    ] }
    const off = setIndicatorEnabled(cs, 'rsi', false, R)
    expect(live(off).map(i => i.defId)).toEqual(['bb'])
    expect(off.indicators.bb.enabled).toBe(true)
  })

  it('turning it back ON revives the same id', () => {
    const off = setIndicatorEnabled(setIndicatorEnabled(base(), 'rsi', true, R), 'rsi', false, R)
    const again = setIndicatorEnabled(off, 'rsi', true, R)
    const kept = live(again).filter(i => i.defId === 'rsi')
    expect(kept).toHaveLength(1)
    expect(kept[0].instanceId).toBe('legacy:rsi')
    expect(again.indicators.rsi.enabled).toBe(true)
  })

  it('is idempotent — enabling twice does not add a second instance', () => {
    const once = setIndicatorEnabled(base(), 'rsi', true, R)
    const twice = setIndicatorEnabled(once, 'rsi', true, R)
    expect(live(twice).filter(i => i.defId === 'rsi')).toHaveLength(1)
  })

  it('…and re-enabling KEEPS the instance the user edited, rather than rebuilding it', () => {
    // The blob still says period 14. Rebuilding from it would silently discard a
    // period the user set through the new UI — "I changed it and it reverted".
    const edited = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 7 }, hidden: false }] }
    const again = setIndicatorEnabled(edited, 'rsi', true, R)
    expect(live(again).find(i => i.defId === 'rsi').inputs.period).toBe(7)
  })

  it('refuses a defId the registry does not know, rather than storing a ghost', () => {
    const cs = base()
    expect(setIndicatorEnabled(cs, 'not-an-indicator', true, R)).toBe(cs)
    expect(setIndicatorEnabled(cs, 'volumeProfile', true, R), 'the carved-out key').toBe(cs)
  })

  it('never mutates the blob it was handed', () => {
    const cs = base()
    const before = JSON.parse(JSON.stringify(cs))
    setIndicatorEnabled(cs, 'rsi', true, R)
    setIndicatorEnabled(cs, 'rsi', false, R)
    expect(cs).toEqual(before)
  })

  it('keeps instances in REGISTRY order, which is legacy z-order for price overlays', () => {
    // Appending would put a newly-enabled Bollinger band ABOVE a Donchian channel
    // it currently sits below: the engine draws all its series at one z-position,
    // and LWC z-stacks by insertion order.
    let cs = { indicators: {}, indicatorInstances: [] }
    for (const id of ['donchian', 'bb', 'vwap']) cs = setIndicatorEnabled(cs, id, true, R)
    expect(live(cs).map(i => i.defId)).toEqual(['bb', 'vwap', 'donchian'])
  })

  it('…and the order it produces IS `listDefinitions()`\'s, not a hand-copied list', () => {
    // Non-vacuity for the case above: assert against the registry rather than
    // against three literals that could both be wrong together.
    const order = R.listDefinitions().map(d => d.id)
    const overlays = ['donchian', 'bb', 'vwap', 'sar', 'ichimoku']
    let cs = { indicators: {}, indicatorInstances: [] }
    for (const id of overlays) cs = setIndicatorEnabled(cs, id, true, R)
    expect(live(cs).map(i => i.defId))
      .toEqual([...overlays].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
  })
})

describe('setIndicatorInput — same rule, both sides', () => {
  it('writes the instance input and mirrors it', () => {
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    const next = setIndicatorInput(on, 'rsi', 'period', 7, R)
    expect(live(next).find(i => i.defId === 'rsi').inputs.period).toBe(7)
    expect(next.indicators.rsi.period).toBe(7)
  })

  it('creates the instance if the indicator is on in the blob but has none yet', () => {
    // The realistic crossover blob: a user who enabled RSI before Flip B shipped.
    const cs = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } }, indicatorInstances: [] }
    const next = setIndicatorInput(cs, 'rsi', 'period', 7, R)
    expect(live(next).find(i => i.defId === 'rsi').inputs).toEqual({ period: 7, color: '#7b68ee' })
  })

  it('an input on a switched-OFF indicator writes the MIRROR and does not switch it on', () => {
    // ⚠️ THE BRIEF'S VERSION TURNED IT ON. `setIndicatorInput` delegating to
    // `setIndicatorEnabled(…, true)` means typing a period into the box beside an
    // unchecked checkbox ADDS the indicator to the chart — a control doing
    // something the user did not ask for, which is the same defect class as one
    // doing nothing. The value is still kept, in the mirror, so enabling later
    // picks it up.
    const off = setIndicatorEnabled(setIndicatorEnabled(base(), 'rsi', true, R), 'rsi', false, R)
    const typed = setIndicatorInput(off, 'rsi', 'period', 7, R)
    expect(live(typed), 'editing a period resurrected a switched-off indicator').toEqual([])
    expect(isIndicatorEnabled(typed, 'rsi', new Set(['rsi']))).toBe(false)
    expect(typed.indicators.rsi.period).toBe(7)
    // …and it survives the round trip: switching it back on adopts the value.
    expect(live(setIndicatorEnabled(typed, 'rsi', true, R)).find(i => i.defId === 'rsi').inputs.period).toBe(7)
  })

  it('…and the same for a blob that never enabled it at all', () => {
    const typed = setIndicatorInput(base(), 'rsi', 'period', 7, R)
    expect(live(typed)).toEqual([])
    expect(typed.indicators.rsi.period).toBe(7)
    expect(typed.indicators.rsi.enabled).toBe(false)
  })

  it('rejects a value the definition would refuse, leaving the blob untouched', () => {
    // `period` is an int 2..100. Storing 500 would produce an instance
    // `normalizeInstances` then DROPS -- the indicator would silently vanish.
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    expect(setIndicatorInput(on, 'rsi', 'period', 500, R)).toBe(on)
    expect(setIndicatorInput(on, 'rsi', 'bogus', 1, R)).toBe(on)
    expect(setIndicatorInput(on, 'rsi', 'period', 1, R), 'below the declared min').toBe(on)
    expect(setIndicatorInput(on, 'rsi', 'period', '', R), 'an emptied number box').toBe(on)
    expect(setIndicatorInput(on, 'not-an-indicator', 'period', 7, R)).toBe(on)
  })

  it('…and refuses an ENUM value outside the declared options', () => {
    // VWAP's `lineStyle` is the only enum among the pilots, and it is the field
    // Task 8 found silently unwired. Storing `squiggly` drops the whole instance.
    const on = setIndicatorEnabled({ indicators: { vwap: { enabled: false } }, indicatorInstances: [] }, 'vwap', true, R)
    expect(setIndicatorInput(on, 'vwap', 'lineStyle', 'squiggly', R)).toBe(on)
    expect(live(setIndicatorInput(on, 'vwap', 'lineStyle', 'dashed', R)).find(i => i.defId === 'vwap')
      .inputs.lineStyle).toBe('dashed')
  })

  it('coerces a numeric string, the way the toolbar produces it', () => {
    // `<input type=number>` hands back a STRING; `updateIndicator` parseInt's it
    // (`ChartToolbar.jsx:141-150`). If this stored "7" the instance would be
    // dropped by the type check and RSI would disappear on the next paint.
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    expect(live(setIndicatorInput(on, 'rsi', 'period', '7', R)).find(i => i.defId === 'rsi').inputs.period).toBe(7)
    const bbOn = setIndicatorEnabled({ indicators: { bb: { enabled: false, period: 20, stdDev: 2 } }, indicatorInstances: [] }, 'bb', true, R)
    expect(live(setIndicatorInput(bbOn, 'bb', 'stdDev', '2.5', R)).find(i => i.defId === 'bb').inputs.stdDev).toBe(2.5)
  })

  it('…and does NOT accept a float where the definition declares an int', () => {
    // `parseInt('7.5')` is 7, which would silently round the user's number. A
    // number box declared `int` has `step: 1`; 7.5 can only arrive by paste.
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    expect(setIndicatorInput(on, 'rsi', 'period', 7.5, R)).toBe(on)
  })

  it('never mutates the blob it was handed', () => {
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    const before = JSON.parse(JSON.stringify(on))
    setIndicatorInput(on, 'rsi', 'period', 7, R)
    expect(on).toEqual(before)
  })
})

describe('isIndicatorEnabled — one answer for every control surface', () => {
  it('reads the INSTANCE for a flipped id', () => {
    const cs = { indicators: { rsi: { enabled: true } }, indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }] }
    expect(isIndicatorEnabled(cs, 'rsi', new Set(['rsi']))).toBe(false)
    expect(isIndicatorEnabled(cs, 'rsi', new Set())).toBe(true)
  })

  it('reads the legacy toggle for an un-flipped id', () => {
    const cs = { indicators: { macd: { enabled: true } }, indicatorInstances: [] }
    expect(isIndicatorEnabled(cs, 'macd', new Set(['rsi']))).toBe(true)
  })

  it('agrees with the READ-TIME MIGRATOR on a crossover blob — toggle on, no instance', () => {
    // ⚠️ THE BRIEF'S VERSION SAID `false` HERE. After Flip B, StockChart reads
    // through `migrateLegacyToInstances`, which projects that toggle into an
    // instance and DRAWS it. A checkbox reading unchecked over a line that is on
    // the chart is the "two answers for one indicator" this function exists to
    // prevent — so the predicate has to model the same three rules the migrator
    // does: a live instance wins, a tombstone blocks, the toggle projects.
    const cs = { indicators: { rsi: { enabled: true } }, indicatorInstances: [] }
    expect(isIndicatorEnabled(cs, 'rsi', new Set(['rsi']))).toBe(true)
    expect(drawnByTheMigrator(cs, 'rsi')).toBe(true)
  })

  it('…and on all four crossover shapes, against the migrator itself', () => {
    // The predicate is checked against what the CHART will do, for every
    // combination of (toggle, stored instance) — not against a restatement of its
    // own rules.
    const shapes = [
      ['toggle on, no instance', { indicators: { rsi: { enabled: true } }, indicatorInstances: [] }],
      ['toggle off, no instance', { indicators: { rsi: { enabled: false } }, indicatorInstances: [] }],
      ['toggle off, live instance', { indicators: { rsi: { enabled: false } },
        indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }] }],
      ['toggle on, tombstone', { indicators: { rsi: { enabled: true } },
        indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }] }],
      ['toggle on, tombstone under ANOTHER id', { indicators: { rsi: { enabled: true } },
        indicatorInstances: [{ instanceId: 'other', deleted: true }] }],
    ]
    for (const [label, cs] of shapes) {
      expect(isIndicatorEnabled(cs, 'rsi', new Set(['rsi'])), label).toBe(drawnByTheMigrator(cs, 'rsi'))
    }
  })

  it('a HIDDEN instance still counts as enabled — the declutter toggle is not the switch', () => {
    // Alt+Shift+I hides every indicator. If that unchecked all their boxes, the
    // user would come back to a chart whose settings panel says nothing is on.
    const cs = { indicators: { rsi: { enabled: false } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: true }] }
    expect(isIndicatorEnabled(cs, 'rsi', new Set(['rsi']))).toBe(true)
  })

  it('survives a blob that is missing everything', () => {
    expect(isIndicatorEnabled(undefined, 'rsi', new Set(['rsi']))).toBe(false)
    expect(isIndicatorEnabled({}, 'rsi', new Set(['rsi']))).toBe(false)
    expect(isIndicatorEnabled({ indicatorInstances: 'nope' }, 'rsi', new Set(['rsi']))).toBe(false)
    expect(isIndicatorEnabled({}, 'rsi', undefined)).toBe(false)
  })

  it('round-trips with the writers, for both flipped and un-flipped ids', () => {
    // The pair that matters at a control: what the writer wrote is what the
    // reader reads. Un-flipped goes through the legacy mirror, flipped through
    // the instance, and both must answer the same question the same way.
    for (const flipped of [new Set(['rsi']), new Set()]) {
      const on = setIndicatorEnabled(base(), 'rsi', true, R)
      expect(isIndicatorEnabled(on, 'rsi', flipped)).toBe(true)
      expect(isIndicatorEnabled(setIndicatorEnabled(on, 'rsi', false, R), 'rsi', flipped)).toBe(false)
    }
  })
})

/** Does the chart draw `defId` for this blob, under Flip B's read path? The
 *  migrator + validator, exactly as `StockChart` will run them. */
function drawnByTheMigrator(cs, defId) {
  return normalizeInstances(migrateLegacyToInstances(cs, R), R).kept.some(i => i.defId === defId)
}

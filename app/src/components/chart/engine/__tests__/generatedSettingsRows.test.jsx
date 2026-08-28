import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  listEngineIndicators, listAllIndicators, applyRowPatch, readEnabled,
  indTarget, splitIndTarget,
} from '../../indicatorRegistry'
import { mergeChartSettings, CHART_DEFAULTS } from '../../chartDefaults'
import { CARVED_OUT_ROWS, NOT_IN_BLOB } from '../../indicatorCatalog'
import { isIndicatorEnabled } from '../instanceControls'
import { ENGINE_OWNED } from '../flipState'
import * as engineRegistry from '../nativeRegistry'
import { computeIchimoku } from '../../indicators'
import { makeBars } from './fakeChart'
import ChartSettingsModal from '../../ChartSettingsModal'

/** Enough bars that every declared period actually computes (senkouB is 52). */
const BARS = makeBars(260)

// ─── B4 TASK 6: A GENERATED ROW FOR EVERY DEFINITION ────────────────────────
//
// B3 Task 12 proved the mechanism on ONE definition — `VWAP_FIELDS`, four
// descriptors that were a verbatim second copy of the definition's four declared
// inputs, deleted and the row derived by `fieldsFromDefinition`. This
// generalises it to all fourteen and deletes `ENGINE_ROW_DEF_IDS`, the
// hand-written list of which definitions got a generated row.
//
// ⚠️ THE LIST IS `definitions ∪ CARVED_OUT_ROWS`, NOT `listDefinitions()`.
// `volumeProfile` is a settings section with no definition and a shipped toolbar
// row; a list built from definitions alone silently drops it — the exact
// user-facing regression B3 Task 11 refused when asked to delete VWAP's row.

const base = () => mergeChartSettings(null)
const DEFS = engineRegistry.listDefinitions()
const rowsFor = (settings = base()) => listEngineIndicators(settings, engineRegistry)
/** THE row for a DEFINITION.
 *
 *  ⚠️ chart-UX-walls TASK 6 — THIS WAS `r.id === id`, AND THE `id` OF A ROW THAT
 *  NAMES AN INSTANCE IS THE INSTANCE ID. Every fixture below that turns an
 *  indicator on now has one (`mergeChartSettings` FOLDS a legacy section into an
 *  instance and deletes the section), so an `r.id` lookup found nothing and
 *  `applyRowPatch(undefined, …)` returned the settings by identity — a whole case
 *  passing over a write that never happened. It THROWS on an ambiguous lookup
 *  rather than silently taking the first of two rows, which is the defect this
 *  task exists to remove one layer up. */
const rowById = (id, settings = base()) => {
  const hits = rowsFor(settings).filter((r) => r.defId === id)
  if (hits.length > 1) throw new Error(`rowById(${id}): ${hits.length} rows — this fixture has `
    + 'more than one live instance and "THE row" is ambiguous; filter by instanceId instead')
  return hits[0]
}

describe('the Indicators tab is generated from the definitions, all of them', () => {
  it('renders one row per settings section, in registry order, carved-out last', () => {
    const rows = listAllIndicators(base(), engineRegistry)
    const indicatorRows = rows.filter((r) => r.path.kind === 'indicator')
    expect(indicatorRows.map((r) => r.id))
      .toEqual([...DEFS.map((d) => d.id), ...CARVED_OUT_ROWS.map((r) => r.id)])
    // The MA overlays and the volume pane are still hand-written and still first:
    // their identity is POSITIONAL and the volume pane is not an indicator.
    // FOUR overlay slots (EMA9/EMA20/SMA50/SMA200) — the terminal SMA5 was removed
    // 2026-08-27. Count is DERIVED from the blob (`CHART_DEFAULTS`), not typed.
    expect(base().overlays.length, 'the overlay slot count moved').toBe(4)
    expect(rows.filter((r) => r.path.kind !== 'indicator').map((r) => r.id))
      .toEqual([...base().overlays.map((_, i) => `overlay-${i}`), 'volume'])
    // …and the loop below is not iterating over an empty registry.
    expect(DEFS.length, 'the registry lists nothing — every case here would pass vacuously')
      .toBeGreaterThanOrEqual(14)
  })

  it('every declared input becomes exactly one control, in declaration order', () => {
    for (const def of DEFS) {
      const row = rowById(def.id)
      expect(row, def.id).toBeTruthy()
      expect(row.fields.map((f) => f.key), def.id).toEqual(def.inputs.map((i) => i.key))
    }
  })

  // ⭐ THE ICHIMOKU TRAP, MEASURED AT d2733adc AND RAILED HERE.
  // `ichimoku`'s definition declares tenkanPeriod / kijunPeriod / senkouBPeriod.
  // `CHART_DEFAULTS.indicators.ichimoku` declares NONE of them — it has
  // `enabled` and five colours. So a generated row would render three number
  // boxes reading `undefined`, writing keys the LEGACY ichimoku block does not
  // read. It is un-flipped, so the instance those writes reach is filtered out
  // of the render pass: three controls that appear and do nothing.
  it('⭐ ichimoku\'s three periods are LIVE ROWS now — the flip is what wired them', () => {
    // 🔴 INVERTED BY B5 TASK 6. It read *"a control whose key the legacy section
    // does not carry is DISABLED with a reason, not live"*, and it was right
    // while `ichimoku` was un-flipped: the hand-written block called
    // `computeIchimoku(bars)` with no arguments, so three number boxes writing
    // keys nobody read is exactly what deserved greying.
    //
    // ⚠️ THE BLOB HAS NOT CHANGED — that half of the premise is still asserted
    // below — and that is why the FLIP is what did it: the instance carries the
    // definition's declared inputs whether the blob has room for them or not.
    const byKey = Object.fromEntries(rowById('ichimoku').fields.map((f) => [f.key, f]))
    for (const k of ['tenkanPeriod', 'kijunPeriod', 'senkouBPeriod']) {
      // ⭐ B5 TASK 9: the blob has no ichimoku SECTION at all now, which is the
      // same premise reached from further along — a key cannot be in a section
      // that does not exist. Asserted on the section rather than on the key so
      // the sentence stays true rather than becoming a `TypeError`.
      expect(CHART_DEFAULTS.indicators.ichimoku,
        `${k}: the blob carries an ichimoku section again — this case's premise `
        + 'would be a different one').toBeUndefined()
      expect(byKey[k].disabled, `${k} is still greyed — the flip did not reach unwiredKeys`)
        .toBeUndefined()
    }
    for (const k of ['tenkanColor', 'kijunColor']) expect(byKey[k].disabled, k).toBeUndefined()
    expect(ENGINE_OWNED.has('ichimoku'),
      'ichimoku is un-flipped again — these three rows are writing where nothing reads').toBe(true)
  })

  it('…and the value a live row writes REACHES COMPUTE, which is the whole claim', () => {
    // ⛔ "NOT GREYED" IS NOT "WIRED". A row could render live, write through
    // `instanceControls`, round-trip the blob and still be ignored by the compute
    // function — which is precisely the state the brief warned about
    // (`activeWhen: false` would have been the honest answer for that). So the
    // claim is asserted end to end: patch the row, take the instance the patch
    // produced, and check the NUMBERS the registry computes from it.
    const settings = mergeChartSettings(JSON.stringify({ indicators: { ichimoku: { enabled: true } } }))
    const next = applyRowPatch(rowById('ichimoku', settings), { tenkanPeriod: 18 }, settings, engineRegistry)
    const inst = next.indicatorInstances.find((i) => i && i.defId === 'ichimoku' && !i.deleted)
    expect(inst, 'the row wrote no instance — it is not routed at instanceControls').toBeTruthy()
    expect(inst.inputs.tenkanPeriod, 'the value never reached the instance').toBe(18)
    // …and it survives a round trip through `mergeChartSettings`' allow-list.
    const roundTripped = mergeChartSettings(JSON.stringify(next))
    const rtInst = roundTripped.indicatorInstances.find((i) => i && i.defId === 'ichimoku' && !i.deleted)
    expect(rtInst.inputs.tenkanPeriod, 'the allow-list dropped it on persist').toBe(18)
    // …and the ENGINE computes a different tenkan column with it. Compared
    // against `computeIchimoku(bars, 18, …)` from the OTHER side, and asserted
    // `not.toEqual` the default so the case cannot pass on an ignored argument.
    const def = engineRegistry.getDefinition('ichimoku')
    const at18 = engineRegistry.computeFor(def, BARS, rtInst.inputs).tenkan
    const at9 = engineRegistry.computeFor(def, BARS, { ...rtInst.inputs, tenkanPeriod: 9 }).tenkan
    expect([...at18], 'tenkanPeriod does not reach computeIchimoku').not.toEqual([...at9])
    expect([...at18]).toEqual([...computeIchimoku(BARS, 18, 26, 52).tenkan.map((p) => p.value)])
  })

  it('…and the same control on a FLIPPED definition is live, which is what makes the rule real', () => {
    // vwap's opacity/lineStyle/lineWidth are all in its legacy section AND it is
    // flipped: nothing is greyed. If this ever greys, the predicate is over-wide.
    expect(rowById('vwap').fields.filter((f) => f.disabled).map((f) => f.key)).toEqual([])
  })

  // ⚠️ THE PROBE THE FOUR FLIPPED DEFINITIONS CANNOT PROVIDE, AND WHY IT EXISTS.
  // `unwiredKeys` short-circuits on FLIPPED. None of rsi/bb/macd/vwap has a
  // declared input the blob lacks — measured, `unwiredKeys(vwap, new Set())` is
  // ALSO empty — so passing an EMPTY flip set here would produce byte-identical
  // rows for every shipped definition and the mutation "drop the flip set at the
  // call site" would be an EQUIVALENT MUTANT. A definition that is flipped AND
  // declares a key the blob has no room for is the only witness, and there is no
  // such definition in the tree, so one is constructed.
  // ⭐⭐ B5 TASK 9 — A REGRESSION THIS TASK CAUSED AND NOTHING NAMED.
  //
  // Every case in this file turns its indicator ON first, so nothing here was
  // reading a row for a definition with NO instance — and that is the row every
  // user sees on a fresh chart. `drawnValues` returned `settings.indicators[id]`
  // in that branch, which Task 9 made `undefined` for all fourteen: an unchecked
  // RSI's Period box went BLANK, on the settings tab, the library dialog and the
  // modal at once, with 4,485 green tests.
  it('⭐ a row for an indicator with NO instance shows the DEFINITION defaults, not blanks', () => {
    const cs = base()
    expect(cs.indicatorInstances, 'the fixture has an instance — this case is the OTHER branch')
      .toEqual([])
    expect(Object.keys(cs.indicators), 'the blob still carries indicator sections')
      .toEqual(['volumeProfile'])
    const blank = []
    for (const def of engineRegistry.listDefinitions()) {
      const row = rowById(def.id)
      for (const i of def.inputs) {
        if (i.default === undefined) continue
        if (row.values[i.key] !== i.default) blank.push(`${def.id}.${i.key}: ${JSON.stringify(row.values[i.key])}`)
      }
    }
    expect(blank,
      'a generated control has no value to show for an indicator that is off. The box renders '
      + 'empty and the number the chart WOULD draw with is nowhere on screen.').toEqual([])
    // …and it is not vacuous: the definitions really declare defaults.
    expect(engineRegistry.listDefinitions().flatMap(d => d.inputs).filter(i => i.default !== undefined).length)
      .toBeGreaterThan(20)
    // …and a LIVE instance still wins over the default, which is the branch that
    // already worked and must keep working.
    // ⚠️ LOOKED UP BY `defId`, NOT BY `id` — chart-UX-walls Task 6. A row that
    // names an instance is KEYED by that instanceId (see the suite below), so
    // `r.id === 'rsi'` would find nothing here and `.values` would throw. The
    // claim is unchanged and is asserted twice over: exactly ONE rsi row, and it
    // shows the INSTANCE's 7 rather than the definition's default.
    const withInst = { ...cs, indicatorInstances: [
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 7 }, hidden: false }] }
    const rows = listEngineIndicators(withInst, engineRegistry).filter(r => r.defId === 'rsi')
    expect(rows, 'one live instance must still produce exactly one row').toHaveLength(1)
    expect(rows[0].id, 'the row is not keyed by the instance it edits').toBe('legacy:rsi')
    expect(rows[0].values.period).toBe(7)
    expect(engineRegistry.getDefinition('rsi').inputs.find(i => i.key === 'period').default,
      'the definition default IS 7 — this case cannot tell the instance from the default')
      .not.toBe(7)
  })

  it('⭐ the flip set really reaches unwiredKeys — proven on a probe, both ways', () => {
    const flippedId = [...ENGINE_OWNED][0]
    const probeDef = {
      ...engineRegistry.getDefinition(flippedId),
      inputs: [
        ...engineRegistry.getDefinition(flippedId).inputs,
        { key: 'notInTheBlob', type: 'int', label: 'Not in the blob', default: 1, min: 1, max: 9, step: 1 },
      ],
    }
    // ⭐ B5 TASK 9: no definition has a blob section any more, so the probe key
    // is absent for the strongest possible reason.
    expect(CHART_DEFAULTS.indicators[flippedId],
      'the blob carries a section for a definition again — the probe proves nothing')
      .toBeUndefined()
    const flipped = listEngineIndicators(base(), { listDefinitions: () => [probeDef] })[0]
    expect(flipped.fields.find((f) => f.key === 'notInTheBlob').disabled,
      'a FLIPPED definition was greyed — the short-circuit is not reaching unwiredKeys').toBeUndefined()
    // …and the same definition under a NON-flipped id is greyed, so the "live"
    // above is the short-circuit and not a predicate that never greys anything.
    //
    // ⚠️ THE UN-FLIPPED ID WAS A MOVING SUBJECT AND B5 TASK 8 EXHAUSTED IT. It
    // was `stoch` (until B5 Task 5), then `mfi` (until Task 7), then `adx` — each
    // time going RED by name rather than quietly turning this control into a
    // restatement of the first half. Task 8 flipped the last three, so
    // `ENGINE_OWNED` equals `listDefinitions()` and NO REAL ID CAN
    // SERVE HERE AGAIN.
    //
    // ⛔ SO THE PROBE IS CONSTRUCTED, exactly as its FLIPPED half already was.
    // That is the point the note above anticipated: this case is about
    // `unwiredKeys` reading the flip SET, not about any particular indicator, and
    // a synthetic id is a STRONGER subject than a real one because it can never
    // migrate underneath the case. The id is deliberately un-registrable-looking
    // so nobody mistakes it for a definition.
    const UNFLIPPED_PROBE_ID = '__unflippedProbe'
    expect(ENGINE_OWNED.has(UNFLIPPED_PROBE_ID),
      'the synthetic probe id joined the flip set — pick another').toBe(false)
    // ⛔ AND THE NON-VACUITY THAT A SYNTHETIC ID COSTS: it must be absent from
    // the blob AND from the registry, or `listEngineIndicators` would resolve it
    // to something real and the greying below would be about that instead.
    expect(engineRegistry.getDefinition(UNFLIPPED_PROBE_ID)).toBeNull()
    expect(UNFLIPPED_PROBE_ID in CHART_DEFAULTS.indicators).toBe(false)
    // …and the real population really is exhausted, which is WHY it is synthetic.
    expect(engineRegistry.listDefinitions().filter(d => !ENGINE_OWNED.has(d.id)),
      'an un-flipped definition exists again — a REAL subject is available and is the '
      + 'better one, because it exercises the shipped blob shape too').toEqual([])
    const unflipped = listEngineIndicators(
      base(), { listDefinitions: () => [{ ...probeDef, id: UNFLIPPED_PROBE_ID }] },
    )[0]
    expect(unflipped.fields.find((f) => f.key === 'notInTheBlob').disabled).toBe(NOT_IN_BLOB)
  })

  it('writes through the ONE writer for every definition, flipped or not', () => {
    for (const def of DEFS) {
      const settings = base()
      const next = applyRowPatch(rowById(def.id, settings), { enabled: true }, settings, engineRegistry)
      expect(isIndicatorEnabled(next, def.id, ENGINE_OWNED), def.id).toBe(true)
      expect(next.indicators[def.id].enabled, `${def.id} mirror`).toBe(true)
      // …and it really went through `instanceControls`: a raw `patchFor` write
      // moves the mirror and nothing else, which is doors five and six all over
      // again. A stored instance is the tell that cannot be faked by a slice write.
      expect(next.indicatorInstances.some((i) => i && i.defId === def.id && !i.deleted),
        `${def.id} wrote the mirror alone — the chart reads the instance`).toBe(true)
    }
  })

  it('a refused value returns the settings by IDENTITY, so nothing persists', () => {
    const settings = base()
    const row = rowById('rsi', settings)
    expect(applyRowPatch(row, { period: 999 }, settings, engineRegistry)).toBe(settings)   // max is 100
    expect(applyRowPatch(row, { period: '7.5' }, settings, engineRegistry)).toBe(settings) // int, not float
  })

  it('the carved-out section keeps the row it has always had', () => {
    const row = listAllIndicators(base(), engineRegistry).find((r) => r.id === 'volumeProfile')
    expect(row.label).toBe('Volume Profile')
    expect(row.fields.map((f) => f.key)).toEqual(['bins', 'color', 'pocColor'])
    // ⛔ It has NO definition, so it must NOT route at instanceControls — there is
    // nothing to instantiate. It writes its settings slice, like the MA overlays.
    expect(row.engineOwned).toBe(false)
    const settings = base()
    const next = applyRowPatch(row, { enabled: true }, settings, engineRegistry)
    expect(next.indicators.volumeProfile.enabled).toBe(true)
    expect(next.indicatorInstances,
      'the carved-out row invented an instance the binder would drop')
      .toEqual(settings.indicatorInstances)
  })

  it('reads OFF over a tombstone the legacy mirror still calls on, for every flipped id', () => {
    for (const id of ENGINE_OWNED) {
      const on = mergeChartSettings(JSON.stringify({ indicators: { [id]: { enabled: true } } }))
      const off = applyRowPatch(rowById(id, on), { enabled: false }, on, engineRegistry)
      expect(off.indicatorInstances.some((i) => i.instanceId === `legacy:${id}` && i.deleted === true), id).toBe(true)
      expect(readEnabled(rowById(id, off)), `${id} ticked a box over a chart with no line`).toBe(false)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⭐⭐ chart-UX-walls TASK 6 — THE ROWS GO PER-INSTANCE
//
// `setIndicatorEnabled`'s docstring blamed the per-definition tombstone on *"a
// settings row is per-DEFINITION at v1"*. These are the cases that end v1.
//
// ⛔ AND THE ONE THING THAT STAYS PER-DEFINITION IS ASSERTED HERE TOO, because
// "make everything per-instance" is the obvious wrong answer: the `enabled`
// toggle is labelled with the DEFINITION's name, so a toggle that removed one of
// two lines would leave an unticked box over a chart that still draws.
// ═══════════════════════════════════════════════════════════════════════════
describe('⭐ TASK 6 — one row per LIVE INSTANCE, and each row edits its own', () => {
  const TWO_RSI = () => ({
    ...base(),
    indicatorInstances: [
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false },
    ],
  })
  const rsiRows = (cs) => listAllIndicators(cs, engineRegistry, {}).filter(r => r.defId === 'rsi')
  const findInstance = (cs, id) => (cs.indicatorInstances || []).find(i => i && i.instanceId === id)

  it('⭐ with TWO instances of one definition there are TWO rows, each naming its instance', () => {
    const rows = rsiRows(TWO_RSI())
    expect(rows.map(r => r.instanceId)).toEqual(['legacy:rsi', 'inst:rsi:1'])
    expect(rows[0].values.period).toBe(14)
    expect(rows[1].values.period).toBe(7)
    // ⛔ AND THE ROW `id` IS THE INSTANCE ID. `ChartSettingsModal` keys every row
    // and every colour-swatch target off `row.id`, so two rows sharing `'rsi'`
    // would send the second row's edits to the first — silently.
    expect(rows.map(r => r.id)).toEqual(['legacy:rsi', 'inst:rsi:1'])
    expect(new Set(rows.map(r => r.id)).size, 'two rows share an id').toBe(2)
    // …and both still live in ONE section, which is the same answer
    // `orderedPaneKeys` gives them on the chart: one pane, one 0-100 axis.
    expect(new Set(rows.map(r => r.group)).size).toBe(1)
  })

  it('…and editing the SECOND row leaves the first alone', () => {
    const cs = TWO_RSI()
    const rows = rsiRows(cs)
    const next = applyRowPatch(rows[1], { period: 9 }, cs, engineRegistry)
    expect(next, 'the write was refused by identity — nothing was edited at all').not.toBe(cs)
    expect(findInstance(next, 'inst:rsi:1').inputs.period).toBe(9)
    expect(findInstance(next, 'legacy:rsi').inputs.period).toBe(14)
    // …and the FIRST row still writes the first instance, so this is not a
    // function that happens to always write the last one.
    const other = applyRowPatch(rows[0], { period: 21 }, cs, engineRegistry)
    expect(findInstance(other, 'legacy:rsi').inputs.period).toBe(21)
    expect(findInstance(other, 'inst:rsi:1').inputs.period).toBe(7)
  })

  it('⛔ …and the MIRROR follows the FOLD\'s instance only — the deviation, pinned', () => {
    // ⭐ THE ONE PLACE `applyRowPatch` DEPARTS FROM THE BRIEF, AS AN ASSERTION
    // RATHER THAN A PARAGRAPH.
    //
    // The brief routed EVERY instance row at `setInstanceInput`, which never
    // writes `cs.indicators.<defId>`. But the mirror is not arbitrary: the
    // migrator projects it into exactly `legacyInstanceId(defId)`, so it IS that
    // instance's mirror — and sending the fold instance's edits away from
    // `setIndicatorInput` leaves the mirror stale beside a live instance that has
    // moved, for every user who has only one copy (i.e. everybody today). Seven
    // assertions across `ChartToolbar.flipB.test.jsx` and
    // `ChartSettingsModal.indicators.test.jsx` say so, on `legacy:*` fixtures.
    //
    // ⛔ AND THE SECOND INSTANCE MUST NOT MIRROR: one key cannot hold two periods,
    // and whichever it held would be a number the `?indicators=` route would draw
    // a line with while the chart drew another.
    const cs = TWO_RSI()
    const rows = rsiRows(cs)
    expect(rows[0].instanceId, 'the first row is not the fold instance').toBe('legacy:rsi')

    const foldEdit = applyRowPatch(rows[0], { period: 21 }, cs, engineRegistry)
    expect(foldEdit.indicators?.rsi?.period,
      'the FOLD instance stopped mirroring — `cs.indicators.rsi.period` is now stale beside a '
      + '`legacy:rsi` that moved, which is the one thing the mirror exists to prevent').toBe(21)

    const addedEdit = applyRowPatch(rows[1], { period: 9 }, cs, engineRegistry)
    expect(addedEdit.indicators?.rsi?.period,
      'a USER-ADDED instance wrote the per-definition mirror. That key cannot hold two '
      + "instances' values, so whichever one it holds is a number the `?indicators=` route "
      + 'would draw a line with while the chart draws another').toBeUndefined()
    // …and it really was the fold instance that moved, not both.
    expect(findInstance(foldEdit, 'inst:rsi:1').inputs.period).toBe(7)
  })

  it('a definition with NO instance still gets exactly ONE row — the "turn it on" control', () => {
    const cs = base()
    expect(cs.indicatorInstances, 'the fixture already has instances — wrong branch').toEqual([])
    const rows = listAllIndicators(cs, engineRegistry, {}).filter(r => r.defId === 'obv')
    expect(rows).toHaveLength(1)
    expect(rows[0].instanceId, 'an off definition has no instance to name').toBeUndefined()
    expect(rows[0].id, 'the no-instance row is keyed by the definition').toBe('obv')
    // …and it writes through the defId door, which is what "type a period beside
    // an unchecked box" has always meant: the mirror moves, the chart does not.
    const next = applyRowPatch(rows[0], { enabled: true }, cs, engineRegistry)
    expect(next.indicators.obv.enabled).toBe(true)
  })

  it('⛔ the ENABLED toggle stays per-DEFINITION, on an instance row too', () => {
    // The deliberate asymmetry. `removeInstance` is the per-instance verb (the
    // chip's ×); a switch named after the definition means the definition.
    const cs = TWO_RSI()
    const rows = rsiRows(cs)
    expect(rows.every(r => r.enabled), 'the rows disagree about whether RSI is on').toBe(true)
    const off = applyRowPatch(rows[1], { enabled: false }, cs, engineRegistry)
    const live = (off.indicatorInstances || []).filter(i => i && i.defId === 'rsi' && !i.deleted)
    expect(live, 'turning "RSI" off left one of the two RSIs drawing under an unticked box')
      .toEqual([])
    expect(off.indicators.rsi.enabled).toBe(false)
    expect(readEnabled(listAllIndicators(off, engineRegistry, {}).find(r => r.defId === 'rsi')))
      .toBe(false)
  })

  it('a TOMBSTONED instance gets no row of its own', () => {
    // A tombstone is not an instance — every door in `instanceControls` refuses
    // one — so a row for it would be a form editing something that is not drawn.
    const cs = TWO_RSI()
    const removed = { ...cs, indicatorInstances: cs.indicatorInstances.map(
      i => (i.instanceId === 'inst:rsi:1' ? { instanceId: i.instanceId, deleted: true } : i)) }
    const rows = rsiRows(removed)
    expect(rows.map(r => r.instanceId)).toEqual(['legacy:rsi'])
  })

  it('every definition still gets AT LEAST one row, whatever the blob holds', () => {
    // ⛔ THE TOTALITY. The loop emits `live.length ? live : [null]`; a mutation
    // that dropped the `[null]` fallback would leave a fresh chart with NO
    // indicator rows at all, and every case above would still pass because they
    // all name a definition that has an instance.
    for (const cs of [base(), TWO_RSI()]) {
      const byDef = new Set(listEngineIndicators(cs, engineRegistry).map(r => r.defId))
      for (const def of DEFS) {
        if (!def.inputs.length) continue
        expect(byDef.has(def.id), `${def.id} lost its generated row`).toBe(true)
      }
    }
  })
})

describe('…and it reaches the real dialog, not just the row builder', () => {
  const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))

  it('renders a section per row group — fifteen indicator sections, derived', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    // ⚠️ `document.body`, not render()'s container: the modal is PORTALED.
    const labels = [...document.body.querySelectorAll('[class*="sectionLabel"]')].map((n) => n.textContent)
    expect(labels).toEqual([
      'Moving averages', 'Volume',
      ...DEFS.map((d) => d.meta.shortName),
      ...CARVED_OUT_ROWS.map((r) => r.shortName),
    ])
  })

  it('⭐ MACD\'s two colours have a control now — the gap B3 measured and could not close', () => {
    const cs = mergeChartSettings(JSON.stringify({ indicators: { macd: { enabled: true } } }))
    render(<ChartSettingsModal open settings={cs} onChange={vi.fn()} />)
    openIndicators()
    const def = engineRegistry.getDefinition('macd')
    for (const key of ['macdColor', 'signalColor']) {
      const label = def.inputs.find((i) => i.key === key).label
      expect(screen.getAllByText(label).length, `no control for ${key}`).toBeGreaterThan(0)
    }
  })

  it('⭐ ichimoku\'s three periods render LIVE in the real dialog — nothing is greyed', () => {
    // 🔴 INVERTED BY B5 TASK 6, AND IT HAD NO OTHER SUBJECT. It read *"a greyed
    // control really renders greyed, with the reason as its title"* and asserted
    // three `[title=NOT_IN_BLOB]` rows. `ichimoku` was the only definition whose
    // declared inputs outran its settings section, so flipping it leaves the
    // whole app with nothing greyed and that selector matching nothing.
    //
    // ⛔ "MATCHES NOTHING" IS THE SHAPE OF A DEAD SELECTOR, so the case does not
    // stop at an empty list: it asserts the three rows are THERE and ENABLED,
    // which is the state a deleted row and a live row cannot both satisfy.
    const cs = mergeChartSettings(JSON.stringify({ indicators: { ichimoku: { enabled: true } } }))
    render(<ChartSettingsModal open settings={cs} onChange={vi.fn()} />)
    openIndicators()
    expect([...document.body.querySelectorAll(`[title="${NOT_IN_BLOB}"]`)],
      'something is still greyed — the totality in indicatorCatalog.test.js says nothing is')
      .toHaveLength(0)
    // ⚠️ NOT `getByText('Tenkan')`: ichimoku declares `tenkanPeriod` and
    // `tenkanColor` with the SAME label, so a label lookup finds two rows. The
    // period rows are the ones carrying a spinbutton.
    const def = engineRegistry.getDefinition('ichimoku')
    const labels = ['tenkanPeriod', 'kijunPeriod', 'senkouBPeriod']
      .map((k) => def.inputs.find((i) => i.key === k).label)
    const spin = [...document.body.querySelectorAll('input[type="number"]')]
    const rows = labels.map((label) => {
      const hit = spin.find((el) => el.closest('[class*="indRow"]')
        ?.querySelector('[class*="indLabel"]')?.textContent === label)
      expect(hit, `${label}'s number box is gone from the dialog entirely`).toBeTruthy()
      return hit
    })
    for (const [i, el] of rows.entries()) {
      expect(el.disabled, `${labels[i]} is still disabled in the DOM`).toBe(false)
    }
    // …and the JSX still CONSUMES `disabled` — the property this case used to
    // prove, kept alive on the only surface that can still exercise it: a
    // `readOnly`/`disabled` control elsewhere in the same dialog would be the
    // successor if one existed, so what is asserted instead is that the greying
    // MECHANISM is still wired at the row level (`generatedSettingsRows`' probe
    // case above) and simply has no subject in the shipped registry.
    expect(NOT_IN_BLOB).toMatch(/not wired/i)
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 🔴 chart-UX-walls TASK 6 — THE COLON. A CONTRACT BETWEEN TWO FILES.
  //
  // `ChartSettingsModal` builds every colour-swatch target as
  // `ind:${row.id}:${f.key}` and used to read it back with `t.split(':')`
  // destructured as `[, rowId, field]`. Task 6 keys a generated row by its
  // INSTANCE id, and an instance id is `legacy:<defId>` or `inst:<defId>:<n>` —
  // so `ind:legacy:rsi:color` parsed as `rowId: 'legacy'`, `field: 'rsi'`, found
  // no row, and the swatch silently wrote NOTHING while looking perfectly live.
  //
  // ⛔ NOT A UNIT TEST OF THE SPLIT ALONE. The unit case below is the diagnosis;
  // the two cases after it drive the SHIPPED modal, because the defect lives in
  // the join between the id one file mints and the separator the other assumes,
  // and a green unit test of either half would have missed it. [[lesson_contract_bugs_need_a_live_surface]]
  // ═════════════════════════════════════════════════════════════════════════
  const TWO_RSI_COLOURED = () => ({
    ...base(),
    indicatorInstances: [
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#111133' }, hidden: false },
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7, color: '#227722' }, hidden: false },
    ],
  })
  /** The `.indBlock`s of the RSI rows, in order, off the PORTALLED modal.
   *
   *  ⚠️ AN EXACT MATCH ON THE DEFINITION'S OWN `meta.name`, NOT A REGEX. A
   *  `/Relative Strength/` test matched THREE blocks — RSI twice and `rsLine`
   *  ("Relative Strength Line") once — so the case would have compared an RS-Line
   *  colour against an RSI expectation and failed for the wrong reason. */
  const RSI_NAME = engineRegistry.getDefinition('rsi').meta.name
  const rsiBlocks = () => [...document.body.querySelectorAll('[class*="indBlock"]')]
    .filter((b) => b.querySelector('[class*="indName"]')?.textContent === RSI_NAME)
  /** One block's colour swatch for the `color` input. */
  const colourSwatchIn = (block) => {
    const label = engineRegistry.getDefinition('rsi').inputs.find((i) => i.key === 'color').label
    const row = [...block.querySelectorAll('[class*="indRow"]')]
      .find((r) => r.querySelector('[class*="indLabel"]')?.textContent === label)
    expect(row, 'the RSI block has no colour row — this case is asserting on nothing').toBeTruthy()
    const sw = row.querySelector('[data-color-swatch]')
    expect(sw, 'the colour row renders no swatch').toBeTruthy()
    return sw
  }
  /** The open ColorPanel's hex box. */
  const hexBox = () => {
    const panel = [...document.body.querySelectorAll('[role="dialog"]')]
      .find((d) => /color$/i.test(d.getAttribute('aria-label') || ''))
    expect(panel, 'clicking the swatch opened no colour panel').toBeTruthy()
    const input = panel.querySelector('input')
    expect(input, 'the colour panel has no hex box').toBeTruthy()
    return input
  }

  it('⛔ the swatch target ROUND-TRIPS every row id the registry can mint', () => {
    // ⭐ AN ENCODE/DECODE ROUND TRIP OVER THE REAL ROW IDS, not a table of typed
    // strings: the encoder and the decoder are the pair that used to live in two
    // files and disagree, so the case drives BOTH halves over every id
    // `listAllIndicators` actually produces on a two-instance blob.
    const rows = listAllIndicators(TWO_RSI_COLOURED(), engineRegistry, {})
    expect(rows.length, 'no rows — the round trip below is vacuous').toBeGreaterThan(10)
    expect(rows.some((r) => r.id.includes(':')),
      'no row id contains a colon — the defect this pair exists for has no subject here')
      .toBe(true)
    for (const row of rows) {
      for (const f of row.fields) {
        expect(splitIndTarget(indTarget(row.id, f.key)), `${row.id}.${f.key}`)
          .toEqual({ rowId: row.id, field: f.key })
      }
    }
    // …and the two id families spelled out, so a reader sees the shape.
    expect(splitIndTarget('ind:legacy:rsi:color')).toEqual({ rowId: 'legacy:rsi', field: 'color' })
    expect(splitIndTarget('ind:inst:rsi:1:color')).toEqual({ rowId: 'inst:rsi:1', field: 'color' })
    expect(splitIndTarget('ind:volumeProfile:pocColor'))
      .toEqual({ rowId: 'volumeProfile', field: 'pocColor' })
    // ⛔ THE CONTROL: the OLD parse really does get it wrong, so the assertions
    // above are not restating a split that never had a problem.
    const [, oldRowId, oldField] = 'ind:legacy:rsi:color'.split(':')
    expect([oldRowId, oldField], 'the naive split now parses an instance id correctly — the '
      + 'premise of this case is gone and the pair may not be needed').toEqual(['legacy', 'rsi'])
  })

  it('⭐ each of TWO RSI rows opens the colour panel on ITS OWN colour', () => {
    render(<ChartSettingsModal open settings={TWO_RSI_COLOURED()} onChange={vi.fn()} />)
    openIndicators()
    const blocks = rsiBlocks()
    expect(blocks, 'two RSI instances did not produce two blocks in the dialog').toHaveLength(2)
    const seen = []
    for (const block of blocks) {
      fireEvent.click(colourSwatchIn(block))
      seen.push(`#${hexBox().value.toLowerCase()}`)
    }
    // ⛔ AN EQUALITY, NOT "they differ". A broken split sends BOTH to the
    // `#c9a84c` fallback in `targetValue`, which "they differ" would not see the
    // first time but WOULD read as a pass if only one row resolved.
    expect(seen, 'the colour panel opened on a colour neither instance holds — the `ind:` '
      + 'target did not resolve to its row').toEqual(['#111133', '#227722'])
  })

  it('⭐ …and editing the SECOND row\'s colour writes the SECOND instance', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={TWO_RSI_COLOURED()} onChange={onChange} />)
    openIndicators()
    fireEvent.click(colourSwatchIn(rsiBlocks()[1]))
    const box = hexBox()
    fireEvent.change(box, { target: { value: '33ff44' } })
    fireEvent.blur(box)
    expect(onChange, 'the swatch wrote nothing — the control is decorative')
      .toHaveBeenCalled()
    const next = onChange.mock.calls.at(-1)[0]
    const byId = Object.fromEntries((next.indicatorInstances || []).map((i) => [i.instanceId, i]))
    expect(byId['inst:rsi:1'].inputs.color, 'the edit did not reach the row it was made on')
      .toBe('#33ff44')
    expect(byId['legacy:rsi'].inputs.color, 'editing the second RSI recoloured the first')
      .toBe('#111133')
  })
})

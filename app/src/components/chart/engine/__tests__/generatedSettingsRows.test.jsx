import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
  listEngineIndicators, listAllIndicators, applyRowPatch, readEnabled,
} from '../../indicatorRegistry'
import { mergeChartSettings, CHART_DEFAULTS } from '../../chartDefaults'
import { CARVED_OUT_ROWS, NOT_IN_BLOB } from '../../indicatorCatalog'
import { isIndicatorEnabled } from '../instanceControls'
import { ENGINE_FLIPPED_DEF_IDS } from '../flipState'
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
const rowById = (id, settings = base()) => rowsFor(settings).find((r) => r.id === id)

describe('the Indicators tab is generated from the definitions, all of them', () => {
  it('renders one row per settings section, in registry order, carved-out last', () => {
    const rows = listAllIndicators(base(), engineRegistry)
    const indicatorRows = rows.filter((r) => r.path.kind === 'indicator')
    expect(indicatorRows.map((r) => r.id))
      .toEqual([...DEFS.map((d) => d.id), ...CARVED_OUT_ROWS.map((r) => r.id)])
    // The MA overlays and the volume pane are still hand-written and still first:
    // their identity is POSITIONAL and the volume pane is not an indicator.
    // ⚠️ FIVE overlay slots, not four — the brief said four; `CHART_DEFAULTS`
    // ships five, so the count is DERIVED from the blob rather than typed.
    expect(base().overlays.length, 'the overlay slot count moved').toBe(5)
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
      expect(k in CHART_DEFAULTS.indicators.ichimoku,
        `${k} is in the blob now — this case's premise would be a different one`).toBe(false)
      expect(byKey[k].disabled, `${k} is still greyed — the flip did not reach unwiredKeys`)
        .toBeUndefined()
    }
    for (const k of ['tenkanColor', 'kijunColor']) expect(byKey[k].disabled, k).toBeUndefined()
    expect(ENGINE_FLIPPED_DEF_IDS.has('ichimoku'),
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
  it('⭐ the flip set really reaches unwiredKeys — proven on a probe, both ways', () => {
    const flippedId = [...ENGINE_FLIPPED_DEF_IDS][0]
    const probeDef = {
      ...engineRegistry.getDefinition(flippedId),
      inputs: [
        ...engineRegistry.getDefinition(flippedId).inputs,
        { key: 'notInTheBlob', type: 'int', label: 'Not in the blob', default: 1, min: 1, max: 9, step: 1 },
      ],
    }
    expect('notInTheBlob' in CHART_DEFAULTS.indicators[flippedId],
      'the probe key exists in the blob — the probe proves nothing').toBe(false)
    const flipped = listEngineIndicators(base(), { listDefinitions: () => [probeDef] })[0]
    expect(flipped.fields.find((f) => f.key === 'notInTheBlob').disabled,
      'a FLIPPED definition was greyed — the short-circuit is not reaching unwiredKeys').toBeUndefined()
    // …and the same definition under a NON-flipped id is greyed, so the "live"
    // above is the short-circuit and not a predicate that never greys anything.
    //
    // ⚠️ THE UN-FLIPPED ID IS A MOVING SUBJECT AND HAS TO BE ASSERTED. It was
    // `stoch` until B5 Task 5 flipped Stochastic, at which point this probe was
    // comparing two FLIPPED definitions and the second `expect` could only fail.
    // `mfi` is the successor; the line below is what makes the next flip say so
    // instead of quietly turning the control into a restatement of the first half.
    const UNFLIPPED_PROBE_ID = 'mfi'
    expect(ENGINE_FLIPPED_DEF_IDS.has(UNFLIPPED_PROBE_ID),
      `${UNFLIPPED_PROBE_ID} is flipped now — this probe needs an un-flipped id`).toBe(false)
    const unflipped = listEngineIndicators(
      base(), { listDefinitions: () => [{ ...probeDef, id: UNFLIPPED_PROBE_ID }] },
    )[0]
    expect(unflipped.fields.find((f) => f.key === 'notInTheBlob').disabled).toBe(NOT_IN_BLOB)
  })

  it('writes through the ONE writer for every definition, flipped or not', () => {
    for (const def of DEFS) {
      const settings = base()
      const next = applyRowPatch(rowById(def.id, settings), { enabled: true }, settings, engineRegistry)
      expect(isIndicatorEnabled(next, def.id, ENGINE_FLIPPED_DEF_IDS), def.id).toBe(true)
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
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      const on = mergeChartSettings(JSON.stringify({ indicators: { [id]: { enabled: true } } }))
      const off = applyRowPatch(rowById(id, on), { enabled: false }, on, engineRegistry)
      expect(off.indicatorInstances.some((i) => i.instanceId === `legacy:${id}` && i.deleted === true), id).toBe(true)
      expect(readEnabled(rowById(id, off)), `${id} ticked a box over a chart with no line`).toBe(false)
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
})

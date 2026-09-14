// app/src/components/chart/engine/__tests__/sourceDerivedNaming.test.js
//
// ─── AN AUTOMATIC NAME FOLLOWS ITS SOURCE ───────────────────────────────────
//
// ⚰️⚰️ MEASURED IN A BROWSER AT PHASE 3, AND EVERY UNIT RAIL WAS GREEN FOR IT.
// A QQQ series re-pointed at NVDA kept its label: the legend read `QQQ 218.29`,
// and 218.29 is NVDA's price. The data was right and the NAME was a frozen copy
// of an answer that had moved on.
//
// ⭐⭐ THE FIX IS PROVENANCE, NOT PRECEDENCE. A stored `display.name` still wins
// — that is what makes a real choice like "Invesco QQQ Trust" stick — but the
// catalogue no longer STORES a name identical to the one the source already
// derives, because that is not a choice, it is a copy. So:
//
//   automatic name  = a function of the current source, recomputed every read
//   explicit name   = stored, preserved, and beats the derived one
//
// ⛔ AND IDENTITY IS NOT DISPLAY. `instanceId` and `inputs.source` are untouched
// by any of this; a label is never encoded into a source string, because two
// display names would then be two different sources and every binding would
// break on a rename.

import { describe, it, expect } from 'vitest'
import * as registry from '../nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { createDirectSeries, lastCreatedInstance, DIRECT_SERIES_DEF_ID } from '../../discoveryCatalog'
import { createFromResult, securityResults } from '../../discoveryCatalog'
import { setInstanceInput, findInstance } from '../instanceControls'
import { instanceLabel, symbolSource, derivedSourceName } from '../sourceRef'
import { engineChips, disambiguateLabels } from '../readout'
import { listEngineIndicators } from '../../indicatorRegistry'

const DEF = registry.getDefinition(DIRECT_SERIES_DEF_ID)
const ofDef = (cs) => (cs.indicatorInstances || []).filter((i) => i && i.defId === DIRECT_SERIES_DEF_ID)

/** Add one direct series through the CATALOGUE door — the door that stamps a
 *  display name — and hand back its id. */
function addViaCatalogue(cs, sym) {
  const [res] = securityResults([{ ticker: sym, name: `${sym} Fund`, type: 'etf' }], { tf: 'D', bars: 400 })
  const next = createFromResult(cs, res, registry)
  return { cs: next, id: lastCreatedInstance(cs, next).instanceId }
}

const labelOf = (cs, id) => instanceLabel(DEF, findInstance(cs, id))
const repoint = (cs, id, sym) => setInstanceInput(cs, id, 'source', symbolSource(sym, 'close'), registry)

describe('the automatic label is a function of the current source', () => {
  it('⛔ the fixture really goes through the catalogue door', () => {
    // If `createFromResult` stopped minting, every case below would be asserting
    // about an empty list.
    const { cs, id } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    expect(ofDef(cs)).toHaveLength(1)
    expect(findInstance(cs, id).inputs.source).toBe('sym:QQQ:close')
  })

  it('⭐ a QQQ series reads QQQ', () => {
    const { cs, id } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    expect(labelOf(cs, id)).toBe('QQQ')
  })

  it('⭐⭐ RE-POINTED AT NVDA, IT READS NVDA — the Phase 3 browser defect', () => {
    const a = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    const cs = repoint(a.cs, a.id, 'NVDA')
    expect(labelOf(cs, a.id)).toBe('NVDA')
  })

  it('⛔⛔ AND THE CATALOGUE DID NOT FREEZE A COPY OF THE DERIVED NAME', () => {
    // The root cause, asserted directly: `display.name = 'QQQ'` on a series whose
    // source already derives `QQQ` is not a recorded choice, so it is not stored.
    const { cs, id } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    const inst = findInstance(cs, id)
    expect(inst.display && inst.display.name).toBeFalsy()
    expect(derivedSourceName(DEF, inst)).toBe('QQQ')
  })

  it('⭐ AN EXPLICIT NAME IS PRESERVED, and beats the derived one', () => {
    // The other half of the rule. Nothing writes this today; the precedence is
    // asserted so a future naming control inherits it rather than inventing it.
    const a = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    const named = {
      ...a.cs,
      indicatorInstances: a.cs.indicatorInstances.map((i) => (
        i.instanceId === a.id ? { ...i, display: { name: 'Invesco QQQ Trust' } } : i)),
    }
    expect(labelOf(named, a.id)).toBe('Invesco QQQ Trust')
    // …and it survives a re-point, because it was a CHOICE about this series.
    const moved = repoint(named, a.id, 'NVDA')
    expect(labelOf(moved, a.id)).toBe('Invesco QQQ Trust')
    expect(findInstance(moved, a.id).inputs.source).toBe('sym:NVDA:close')
  })

  it('⛔⛔ IDENTITY SURVIVES A RENAME — the instanceId and source are untouched', () => {
    const a = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    const cs = repoint(a.cs, a.id, 'NVDA')
    const inst = findInstance(cs, a.id)
    expect(inst.instanceId).toBe(a.id)          // the id is the identity
    expect(inst.defId).toBe(DIRECT_SERIES_DEF_ID)
    expect(inst.inputs.source).toBe('sym:NVDA:close')
    // ⛔ AND THE LABEL IS NOWHERE IN THE SOURCE STRING. Encoding it there would
    // make two display names two different sources.
    expect(inst.inputs.source).not.toMatch(/NVDA Fund|Invesco/)
  })
})

describe('duplicate disambiguation runs AFTER the derived name', () => {
  /** The labels the legend would print for every direct series on the chart. */
  const chipLabels = (cs) => {
    const insts = ofDef(cs)
    const chips = engineChips(
      insts.map((i) => ({
        defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: i.instanceId,
        series: {}, lastValue: 1,
      })),
      new Map(), registry, insts,
    )
    return chips.map((c) => c.label)
  }

  it('⭐ two QQQ are told apart, and the stem is still QQQ', () => {
    let { cs } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    cs = addViaCatalogue(cs, 'QQQ').cs
    const labels = chipLabels(cs)
    expect(labels).toHaveLength(2)
    // The established convention is the ordinal suffix `siblingSuffixes` already
    // owns — NOT a new grammar invented here.
    for (const l of labels) expect(l).toMatch(/^QQQ/)
    expect(new Set(labels).size, 'two identical labels — the duplicate is unreadable').toBe(2)
  })

  it('⭐⭐ RE-POINT ONE OF THEM AND BOTH NAMES SETTLE — QQQ / NVDA', () => {
    let { cs } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    const b = addViaCatalogue(cs, 'QQQ')
    cs = repoint(b.cs, b.id, 'NVDA')
    const labels = chipLabels(cs)
    // ⛔ NO SUFFIX SURVIVES A COLLISION THAT ENDED. Once the second series is
    // NVDA there is nothing to disambiguate, so both read plainly.
    expect(labels.sort()).toEqual(['NVDA', 'QQQ'])
  })

  it('⭐ …and a re-point INTO an existing name disambiguates against it', () => {
    let { cs } = addViaCatalogue(mergeChartSettings({}), 'NVDA')
    const b = addViaCatalogue(cs, 'QQQ')
    cs = repoint(b.cs, b.id, 'NVDA')
    const labels = chipLabels(cs)
    expect(labels).toHaveLength(2)
    for (const l of labels) expect(l).toMatch(/^NVDA/)
    expect(new Set(labels).size, 'two NVDA series print one name').toBe(2)
  })

  it('⛔⛔ A MIXED GROUP: only the COLLIDING names take a suffix', () => {
    // ⚰️ THE CASE THAT MAKES THE GROUPING CLAIM BITEABLE. Two series with
    // different names are skipped by the "all labels distinct" guard whichever way
    // the group is keyed, so a two-series case proves nothing about it. THREE —
    // two QQQ and one SPY — is the shape that separates them: keyed by
    // defId::plotKey alone, all three land in one group and SPY comes out `SPY #3`
    // for a name nothing collided with.
    let { cs } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    cs = addViaCatalogue(cs, 'QQQ').cs
    cs = addViaCatalogue(cs, 'SPY').cs
    const labels = chipLabels(cs)
    expect(labels).toHaveLength(3)
    expect(labels.filter((l) => l === 'SPY'),
      'SPY took a duplicate suffix it never earned').toHaveLength(1)
    expect(labels.filter((l) => /^QQQ/.test(l))).toHaveLength(2)
    expect(new Set(labels).size).toBe(3)
  })

  it('⛔ disambiguation NEVER leaks the source address', () => {
    let { cs } = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    cs = addViaCatalogue(cs, 'QQQ').cs
    for (const l of chipLabels(cs)) {
      expect(l).not.toContain('sym:')
      expect(l).not.toContain('source')
    }
  })
})

describe('ONE naming answer, read by every surface', () => {
  it('⭐⭐ the settings row, the legend chip and the picker all say the same thing', () => {
    const a = addViaCatalogue(mergeChartSettings({}), 'QQQ')
    const cs = repoint(a.cs, a.id, 'NVDA')
    const inst = findInstance(cs, a.id)

    const fromPicker = instanceLabel(DEF, inst)
    const fromRow = listEngineIndicators(cs, registry)
      .find((r) => r.instanceId === a.id).label
    const fromChip = engineChips(
      [{ defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: a.id, series: {}, lastValue: 1 }],
      new Map(), registry, [inst],
    )[0].label

    // ⛔ THREE SURFACES, ONE ANSWER. They are not the same FUNCTION — the picker
    // names an instance, the chip names a plot, the row names a settings block —
    // so they agree by reading one declaration, not by one calling another.
    // Phase 3 shipped with two of the three fixed and the third reading
    // "Data Series", which is exactly what this case exists to catch.
    expect(fromPicker).toBe('NVDA')
    expect(fromRow).toBe('NVDA')
    expect(fromChip).toBe('NVDA')
  })

  it('⛔ an ORDINARY definition is untouched by any of it', () => {
    // The gate is `meta.labelFrom`, never a definition id.
    const rsi = registry.getDefinition('rsi')
    expect(instanceLabel(rsi, { instanceId: 'x', defId: 'rsi', inputs: { period: 14 } }))
      .toMatch(/RSI/)
    expect(derivedSourceName(rsi, { inputs: {} })).toBeNull()
  })

  it('⛔ disambiguateLabels leaves a NON-colliding set completely alone', () => {
    const rows = [
      { defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: 'a', label: 'QQQ', inputs: { source: 'sym:QQQ:close' } },
      { defId: DIRECT_SERIES_DEF_ID, plotKey: 'value', instanceId: 'b', label: 'SPY', inputs: { source: 'sym:SPY:close' } },
    ]
    expect(disambiguateLabels(rows, (id) => registry.getDefinition(id))).toEqual(['QQQ', 'SPY'])
  })
})

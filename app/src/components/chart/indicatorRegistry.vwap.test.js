import { describe, it, expect } from 'vitest'
import {
  listIndicators,
  listEngineIndicators,
  listAllIndicators,
  fieldsFromDefinition,
  fieldFromInput,
  applyRowPatch,
  patchFor,
  readEnabled,
} from './indicatorRegistry'
import { CARVED_OUT_ROWS } from './indicatorCatalog'
import { mergeChartSettings, mergeSettingsOverride, CHART_DEFAULTS, instanceTombstone } from './chartDefaults'
import * as engineRegistry from './engine/nativeRegistry'
import { ENGINE_MIGRATED_DEF_IDS } from './engine/flipState'

// VWAP was the first indicator folded out of the old flat `indicators` map and into
// the registry-driven Indicators tab, and at B3 Task 12 it became the first one
// folded back OUT of the hand-written registry and onto the engine definition.
// `VWAP_FIELDS` — four descriptors that were a verbatim second copy of the
// definition's four declared inputs — is DELETED. These pin the two halves of
// what replaced it: the row's fields are DERIVED, and the row's writes go
// through `instanceControls` like every other control door onto a flipped id.

const vwapRow = (settings) => listEngineIndicators(settings, engineRegistry).find((r) => r.id === 'vwap')
const VWAP_DEF = engineRegistry.getDefinition('vwap')

describe('the rail — the hand-written registry lists nothing the engine owns', () => {
  it('listIndicators() is MA overlays and the volume pane, and nothing migrated', () => {
    const rows = listIndicators(mergeChartSettings(null))
    const owned = rows.filter((r) => ENGINE_MIGRATED_DEF_IDS.has(r.id) || ENGINE_MIGRATED_DEF_IDS.has(r.path?.key))
    expect(owned.map((r) => r.id),
      'a settings-tab row and an engine definition are two sources of truth for one indicator').toEqual([])
    expect(rows.map((r) => r.group)).toEqual([
      ...rows.filter((r) => r.id.startsWith('overlay-')).map(() => 'Moving averages'), 'Volume',
    ])
  })

  // ⭐ INVERTED AT B4 TASK 6, NOT DELETED. It read *"every id that KEEPS a row is
  // a migrated definition"* and looped over `ENGINE_ROW_DEF_IDS`, which was the
  // one-element list `['vwap']`. That list is gone: EVERY definition keeps a
  // row, migrated or not. The claim that survives — and the one that could have
  // gone wrong in this change — is the opposite: a generated row must exist for
  // every definition, and it must not exist for anything that has no definition
  // and no carved-out exemption.
  it('every generated row is a definition, and every definition has a generated row', () => {
    const ids = listEngineIndicators(mergeChartSettings(null), engineRegistry).map((r) => r.id)
    expect(ids, 'a definition lost its generated row, or a row appeared for a non-definition')
      .toEqual(engineRegistry.listDefinitions().map((d) => d.id))
    expect(ids, 'VWAP is still one of them — it was the FIRST, at B3 Task 12').toContain('vwap')
    for (const id of ENGINE_MIGRATED_DEF_IDS) {
      expect(ids, `${id} is migrated and has no row`).toContain(id)
    }
  })

  it('the tab shows Moving averages, Volume, then one section per definition, then the carved-out ones', () => {
    const groups = [...new Set(listAllIndicators(mergeChartSettings(null), engineRegistry).map((r) => r.group))]
    expect(groups).toEqual([
      'Moving averages', 'Volume',
      ...engineRegistry.listDefinitions().map((d) => d.meta.shortName),
      ...CARVED_OUT_ROWS.map((r) => r.shortName),
    ])
    // ⛔ AND THE CARVED-OUT ROW IS STILL THERE. A section list derived from
    // definitions ALONE would drop `volumeProfile` — the user-facing regression
    // B3 Task 11 refused when it was asked to delete VWAP's row.
    expect(groups).toContain('Vol Profile')
  })
})

describe('the VWAP row is DERIVED from the definition, not written here', () => {
  const settings = mergeChartSettings(null)

  it('has one field per declared input, in declaration order, with the definition\'s labels', () => {
    const row = vwapRow(settings)
    expect(row).toBeTruthy()
    expect(row.fields.map((f) => f.key)).toEqual(VWAP_DEF.inputs.map((i) => i.key))
    expect(row.fields.map((f) => f.label)).toEqual(VWAP_DEF.inputs.map((i) => i.label))
    // …and it is the SAME derivation the exported helper performs, so a consumer
    // building rows another way cannot drift from the tab.
    expect(row.fields).toEqual(fieldsFromDefinition(VWAP_DEF))
  })

  it('carries the definition\'s own bounds and options — not a second copy of them', () => {
    const row = vwapRow(settings)
    const byKey = Object.fromEntries(row.fields.map((f) => [f.key, f]))
    const inputByKey = Object.fromEntries(VWAP_DEF.inputs.map((i) => [i.key, i]))
    for (const key of Object.keys(byKey)) {
      const input = inputByKey[key]
      if (input.type === 'int' || input.type === 'float') {
        expect([byKey[key].min, byKey[key].max, byKey[key].step], key).toEqual([input.min, input.max, input.step])
      }
      if (input.type === 'enum') {
        expect(byKey[key].options.map(([v]) => v), key).toEqual(input.options.map((o) => (Array.isArray(o) ? o[0] : o)))
      }
    }
  })

  it('says "intraday only" because the definition declares a timeframe list without D', () => {
    expect(VWAP_DEF.meta.timeframes).not.toContain('D')
    expect(vwapRow(settings).label).toContain('(intraday only)')
    // The note is derived, not typed: a definition with no timeframe list gets none.
    const noTfs = { ...VWAP_DEF, meta: { ...VWAP_DEF.meta, timeframes: undefined } }
    const rows = listEngineIndicators(settings, { listDefinitions: () => [noTfs] })
    expect(rows[0].label).not.toContain('intraday')
  })

  it('maps each declared input TYPE onto the control the tab can render', () => {
    expect(fieldFromInput({ key: 'c', label: 'C', type: 'color' })).toEqual({ key: 'c', label: 'C', type: 'color' })
    expect(fieldFromInput({ key: 'b', label: 'B', type: 'bool' })).toEqual({ key: 'b', label: 'B', type: 'toggle' })
    expect(fieldFromInput({ key: 'e', label: 'E', type: 'enum', options: [{ value: 'a', label: 'A' }] }))
      .toEqual({ key: 'e', label: 'E', type: 'select', options: [['a', 'A']] })
    expect(fieldFromInput({ key: 'n', label: 'N', type: 'int', min: 1, max: 4, step: 1 }))
      .toEqual({ key: 'n', label: 'N', type: 'number', min: 1, max: 4, step: 1 })
    // A type with no control renders NOTHING rather than rendering wrong — a
    // control that writes nowhere is the defect this whole task is retiring.
    expect(fieldFromInput({ key: 's', label: 'S', type: 'string' })).toBe(null)
    expect(fieldFromInput({ key: 'src', label: 'Src', type: 'source' })).toBe(null)
  })
})

describe('the row is a CONTROL DOOR — one reader, one writer', () => {
  const off = mergeChartSettings(null)
  const legacyOn = mergeChartSettings(JSON.stringify({ indicators: { vwap: { enabled: true } } }))

  it('reads OFF by default and ON from a legacy toggle with no instance (the crossover blob)', () => {
    expect(readEnabled(vwapRow(off))).toBe(false)
    expect(readEnabled(vwapRow(legacyOn))).toBe(true)
  })

  it('⭐ reads OFF over a TOMBSTONE the legacy mirror still calls on', () => {
    // The mirror alone would tick this box over a chart with no line — which is
    // exactly what the raw `patchFor` writer used to produce.
    const tombstoned = mergeSettingsOverride(
      { ...legacyOn, indicatorInstances: [instanceTombstone('legacy:vwap')] },
      { indicators: { vwap: { enabled: true } } },
    )
    // ⭐ B5 TASK 9: the divergence is set up through the OVERRIDE lane, which is
    // the one that still injects a legacy section — `mergeChartSettings`' fold
    // destroys the mirror, `mergeSettingsOverride` does not. That lane is a grid
    // cell's `settingsOverride` and the `?indicators=` render route, and it is
    // why `isIndicatorEnabled`'s legacy-mirror rule still has a live subject.
    // The claim is unchanged: the row reads the INSTANCE, not the mirror.
    expect(tombstoned.indicators.vwap.enabled, 'the fixture does not set up the divergence')
      .toBe(true)
    expect(readEnabled(vwapRow(tombstoned)),
      'the row read the mirror instead of the instance').toBe(false)
  })

  it('turning it ON writes an INSTANCE and the mirror with it', () => {
    const next = applyRowPatch(vwapRow(off), { enabled: true }, off, engineRegistry)
    expect(next.indicatorInstances.some((i) => i.defId === 'vwap' && !i.deleted)).toBe(true)
    expect(next.indicators.vwap.enabled).toBe(true)
  })

  it('turning it OFF TOMBSTONES — the mirror alone would come back on the next paint', () => {
    const on = applyRowPatch(vwapRow(off), { enabled: true }, off, engineRegistry)
    const next = applyRowPatch(vwapRow(on), { enabled: false }, on, engineRegistry)
    expect(next.indicators.vwap.enabled).toBe(false)
    expect(next.indicatorInstances.some((i) => i.instanceId === 'legacy:vwap' && i.deleted === true)).toBe(true)
    expect(readEnabled(vwapRow(next))).toBe(false)
  })

  it('⭐ an opacity edit reaches the STORED INSTANCE, which the raw mirror write never did', () => {
    // THE DEFECT THIS FIXES. `migrateLegacyToInstances` skips an instance id it
    // already has, so once ANY control door has created `legacy:vwap` — the
    // toolbar checkbox, either right-click door, Ctrl/Alt — a write to
    // `settings.indicators.vwap.opacity` is read by nobody and the slider does
    // nothing. Task 11's gate rendered a blob with NO instance and could not see it.
    const on = applyRowPatch(vwapRow(off), { enabled: true }, off, engineRegistry)
    const next = applyRowPatch(vwapRow(on), { opacity: 40 }, on, engineRegistry)
    const inst = next.indicatorInstances.find((i) => i.defId === 'vwap')
    expect(inst.inputs.opacity, 'the opacity write never reached the instance').toBe(40)
    expect(next.indicators.vwap.opacity, 'the legacy mirror stopped being written').toBe(40)
  })

  it('shows what the CHART is drawing with, not the mirror, when the two differ', () => {
    const on = applyRowPatch(vwapRow(off), { enabled: true }, off, engineRegistry)
    const drifted = {
      ...on,
      indicators: { ...on.indicators, vwap: { ...on.indicators.vwap, opacity: 100 } },
      indicatorInstances: on.indicatorInstances.map((i) => (
        i.defId === 'vwap' ? { ...i, inputs: { ...i.inputs, opacity: 25 } } : i
      )),
    }
    expect(vwapRow(drifted).values.opacity, 'the row showed a number nothing renders').toBe(25)
  })

  it('REFUSES a value the definition rejects, by identity, so nothing persists', () => {
    const on = applyRowPatch(vwapRow(off), { enabled: true }, off, engineRegistry)
    expect(applyRowPatch(vwapRow(on), { opacity: 400 }, on, engineRegistry)).toBe(on)
    expect(applyRowPatch(vwapRow(on), { lineStyle: 'squiggly' }, on, engineRegistry)).toBe(on)
  })
})

describe('patchFor — the hand-written path kinds, unchanged', () => {
  const settings = mergeChartSettings(null)

  it('overlay and section rows still write through the patch shape they always did', () => {
    const rows = listIndicators(settings)
    const ov = rows.find((r) => r.path.kind === 'overlay')
    expect(patchFor(ov, { period: 34 }, settings).overlays[ov.path.index].period).toBe(34)
    const vol = rows.find((r) => r.id === 'volume')
    expect(patchFor(vol, { visible: false }, settings).volume.visible).toBe(false)
    // …and through `applyRowPatch`, which returns the whole next blob.
    expect(applyRowPatch(vol, { visible: false }, settings, engineRegistry).volume.visible).toBe(false)
  })
})

describe('chartDefaults — VWAP style keys backfill', () => {
  // mergeChartSettings spreads the defaults FIRST, so a stored blob (or saved
  // template / layout preset) written before these keys existed picks them up
  // without a migration. This is the compatibility rail for that.
  it('a legacy vwap blob keeps its colour and takes the style keys from the DEFINITION', () => {
    // ⭐⭐ B5 TASK 9 MOVED THE BACKFILL. It used to be `mergeChartSettings`
    // spreading `CHART_DEFAULTS.indicators.vwap` under the stored section; that
    // section is DELETED, so a blob written before these keys existed picks them
    // up from the DEFINITION at compute time instead — the fold carries only
    // what the blob actually declared, and an absent input means "the definition
    // default", which is the rule `migrateLegacyToInstances` documents.
    //
    // ⛔ THE COMPATIBILITY CLAIM IS UNCHANGED AND IS WHAT IS ASSERTED: the same
    // old blob still draws the same old look.
    const legacy = JSON.stringify({ indicators: { vwap: { enabled: true, color: '#ff0000' } } })
    const cs = mergeChartSettings(legacy)
    expect(cs.indicators.vwap, 'the legacy section survived the fold').toBeUndefined()
    const inst = cs.indicatorInstances.find((i) => i.defId === 'vwap')
    expect(inst.inputs, 'the fold invented a value the blob never had')
      .toEqual({ color: '#ff0000' })
    // …and the three style keys the blob never had come from the definition.
    const byKey = Object.fromEntries(
      engineRegistry.getDefinition('vwap').inputs.map((i) => [i.key, i.default]))
    expect(byKey).toMatchObject({ opacity: 100, lineStyle: 'solid', lineWidth: 1 })
  })

  it('defaults to fully opaque, solid, 1px — i.e. exactly the old hardcoded look', () => {
    const byKey = Object.fromEntries(
      engineRegistry.getDefinition('vwap').inputs.map((i) => [i.key, i.default]))
    expect(byKey).toMatchObject({ opacity: 100, lineStyle: 'solid', lineWidth: 1 })
  })
})

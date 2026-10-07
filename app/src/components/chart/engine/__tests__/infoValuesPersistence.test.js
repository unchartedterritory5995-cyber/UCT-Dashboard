// P1 info — persistence pins for `header.infoValues` (the one additive key).
//
// ⛔ The allow-list trap (`mergeChartSettings` destroys undeclared top-level keys):
// this key lives under `header`, which the merge SPREADS, and is emitted ONLY when
// stored. These cases pin: round trip, legacy byte-identity, no writer drops it, no
// destructive migration, and the delete doors return the header by identity when
// there is nothing to sever (which is what keeps `perInstanceDoor.test.js`'s literal
// and `alertSets.test.js`'s merged-blob digest unmoved).
import { describe, it, expect } from 'vitest'
import { mergeChartSettings, CHART_DEFAULTS, PRESETS } from '../../chartDefaults'
import { mergeSettingsOverride } from '../../instanceShape'
import { applyThemeToSettings, CHART_THEMES } from '../../chartThemes'
import { BLOB_FIXTURES } from '../__fixtures__'
import * as registry from '../nativeRegistry'
import { removeInstance, setIndicatorEnabled, addInstance, setInstanceHidden } from '../instanceControls'
import { severReferencesTo } from '../sourceRef'
import { INFO_VALUES_KEY, sanitizeInfoValues, addInfoValue, infoValuesOf } from '../infoValues'

const REF = { instanceId: 'inst:rsi:1', plotKey: 'rsi', format: 'auto' }
const blobWith = (extra) => JSON.stringify({ settingsVersion: 2,
  indicatorInstances: [{ instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {}, hidden: false }],
  header: { titleMode: 'ticker', infoValues: [REF], ...extra } })

describe('header.infoValues — persistence', () => {
  it('is NOT declared in CHART_DEFAULTS (absent means none) and no default/preset merge emits it', () => {
    expect(INFO_VALUES_KEY in CHART_DEFAULTS.header).toBe(false)
    for (const p of Object.values(PRESETS)) {
      expect(INFO_VALUES_KEY in mergeChartSettings(p.settings).header).toBe(false)
    }
    expect(INFO_VALUES_KEY in mergeChartSettings('{}').header).toBe(false)
  })

  it('⛔ legacy blobs without the key merge byte-for-byte as before (the key is never conjured)', () => {
    for (const f of BLOB_FIXTURES) {
      const once = mergeChartSettings(JSON.stringify(f.cs))
      expect(INFO_VALUES_KEY in once.header, f.name).toBe(false)
      // idempotent: what a save writes back reads back identically
      expect(JSON.stringify(mergeChartSettings(JSON.stringify(once))), f.name).toBe(JSON.stringify(once))
    }
  })

  it('round-trips through save → read, unchanged, and survives a second merge', () => {
    const a = mergeChartSettings(blobWith())
    expect(a.header.infoValues).toEqual([REF])
    const b = mergeChartSettings(JSON.stringify(a))
    expect(b.header.infoValues).toEqual([REF])
    expect(b.header.titleMode).toBe('ticker')
  })

  it('a stored malformed value is sanitised, never thrown on; a stored [] stays []', () => {
    expect(mergeChartSettings(JSON.stringify({ header: { infoValues: 'x' } })).header.infoValues).toEqual([])
    expect(mergeChartSettings(JSON.stringify({ header: { infoValues: [] } })).header.infoValues).toEqual([])
    expect(sanitizeInfoValues([null, 1, { instanceId: '' }, REF, REF, { ...REF, format: 'weird' }]))
      .toEqual([REF])
  })

  it('no writer drops it: header patches, themes, per-cell overrides, instance writes', () => {
    const cs = mergeChartSettings(blobWith())
    expect({ ...cs, header: { ...cs.header, legendMode: 'off' } }.header.infoValues).toEqual([REF])
    for (const t of CHART_THEMES.slice(0, 3)) {
      expect(applyThemeToSettings(cs, t).header.infoValues, t.id).toEqual([REF])
    }
    // one-level header merge: an override header without the key inherits it; one with it replaces it
    expect(mergeSettingsOverride(cs, { header: { titleMode: 'both' } }).header.infoValues).toEqual([REF])
    expect(mergeSettingsOverride(cs, { header: { infoValues: [] } }).header.infoValues).toEqual([])
    expect(mergeSettingsOverride(cs, { chartType: 'line' }).header.infoValues).toEqual([REF])
    // instance writers spread the stored list and never touch the header
    const added = addInstance(cs, 'macd', registry)
    expect(added.header.infoValues).toEqual([REF])
    expect(setInstanceHidden(cs, 'inst:rsi:1', true, registry).header.infoValues).toEqual([REF])
  })

  it('delete doors return the header BY IDENTITY when no info value points at the deleted instance', () => {
    const plain = setIndicatorEnabled(mergeChartSettings('{}'), 'rsi', true, registry)
    expect(setIndicatorEnabled(plain, 'rsi', false, registry).header).toBe(plain.header)
    expect(removeInstance(plain, 'legacy:rsi', registry).header).toBe(plain.header)
    expect(severReferencesTo(plain, 'legacy:rsi', registry.getDefinition)).toBe(plain)
  })

  it('no destructive migration: a delete severs (keeps) the entry; nothing else in the header moves', () => {
    const cs = mergeChartSettings(blobWith())
    const del = removeInstance(cs, 'inst:rsi:1', registry)
    expect(del.header.infoValues).toEqual([{ ...REF, severed: true }])
    const { infoValues: _a, ...restBefore } = cs.header
    const { infoValues: _b, ...restAfter } = del.header
    expect(restAfter).toEqual(restBefore)
    // and the gravestone persists through a save → read
    expect(infoValuesOf(mergeChartSettings(JSON.stringify(del)))).toEqual([{ ...REF, severed: true }])
  })

  it('an add leaves every pre-existing header key and the instance list by identity', () => {
    const cs = mergeChartSettings(blobWith({ infoValues: undefined }))
    const next = addInfoValue(cs, REF, registry.getDefinition)
    expect(next.indicatorInstances).toBe(cs.indicatorInstances)
    expect(next.header.colors).toBe(cs.header.colors)
    expect(next.header.timeframes).toBe(cs.header.timeframes)
  })
})

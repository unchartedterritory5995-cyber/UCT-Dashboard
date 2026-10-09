// app/src/components/chart/builder/agentSeams.test.js — Agent Milestone 1, Indicators half
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../engine/nativeRegistry'
import { mergeChartSettings } from '../chartDefaults'
import { instancesOf, seedFrom, SEED_MAX, instanceFingerprint, INDICATOR_OWNED_TOP_KEYS } from './agentSeams'
import { OWNED_TOP_KEYS } from '../chartSettingsDescriptors'
import { CHART_DEFAULTS } from '../chartDefaults'
import { STUDIO_PREVIEW_DEF_ID } from './studio/chartPreview'

const base = () => mergeChartSettings(null)
const names = (list) => list.map((x) => x.name)

describe('instancesOf — the indicators on one chart', () => {
  it('⭐ a default chart lists its averages by their legend names, plus Volume as a setting', () => {
    const list = instancesOf(base(), registry)
    const avgs = list.filter((x) => !x.setting)
    expect(avgs.length).toBeGreaterThan(0)
    for (const x of avgs) {
      expect(x.kind).toBe('builtin')
      expect(typeof x.instanceId).toBe('string')
      expect(x.name).not.toMatch(/^(ovl|inst):/)               // a name, not an id
    }
    expect(names(avgs).some((n) => /^(EMA|SMA)\b/.test(n))).toBe(true)
    expect(list.at(-1)).toMatchObject({ instanceId: 'volume', setting: true, name: 'Volume' })
  })

  it('reports enabled state, a custom definition, and the pinned version', () => {
    // a real saved definition (the Batch 2 save-door fixture), installed as the chart would
    const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
    const saved = { ...FIX.styled_markers, id: 'u_aaaaaaaaaaab', version: 3 }
    const res = registry.installUserDefinitions([saved])
    expect(res.errors, JSON.stringify(res.errors)).toEqual([])
    const cs = { ...base(), indicatorInstances: [
      ...(base().indicatorInstances || []),
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: {}, hidden: true },
      { instanceId: 'inst:u_aaaaaaaaaaab:1', defId: 'u_aaaaaaaaaaab', defVersion: 3, inputs: {} },
    ] }
    const list = instancesOf(cs, registry)
    const rsi = list.find((x) => x.instanceId === 'inst:rsi:1')
    expect(rsi).toMatchObject({ defId: 'rsi', kind: 'builtin', hidden: true, enabled: false, placement: 'pane' })
    expect(rsi.name).toMatch(/RSI/)
    expect(list.find((x) => x.defId === 'u_aaaaaaaaaaab')).toMatchObject({ kind: 'custom', version: 3, enabled: true })
  })

  it('⛔ never lists the live preview, a removed instance, or one whose definition is unknown', () => {
    const cs = { ...base(), indicatorInstances: [
      ...(base().indicatorInstances || []),
      { instanceId: `inst:${STUDIO_PREVIEW_DEF_ID}:1`, defId: STUDIO_PREVIEW_DEF_ID, inputs: {} },
      { instanceId: 'inst:macd:1', deleted: true },
      { instanceId: 'inst:u_ffffffffffff:1', defId: 'u_ffffffffffff', inputs: {} },
    ] }
    const ids = instancesOf(cs, registry).map((x) => x.instanceId)
    expect(ids.some((id) => id.includes(STUDIO_PREVIEW_DEF_ID))).toBe(false)
    expect(ids).not.toContain('inst:macd:1')
    expect(ids).not.toContain('inst:u_ffffffffffff:1')
  })

  it('is pure: the blob is not mutated, and junk input is an empty list', () => {
    const cs = base()
    const before = JSON.stringify(cs)
    instancesOf(cs, registry)
    expect(JSON.stringify(cs)).toBe(before)
    expect(instancesOf(null, registry)).toEqual([])
    expect(instancesOf({ indicatorInstances: 'x' }, registry)).toEqual([])
    expect(instancesOf(cs, null).filter((x) => !x.setting)).toEqual([])
  })
})

describe('seedFrom — a request made safe to prefill', () => {
  it('trims, folds whitespace, strips control characters', () => {
    expect(seedFrom('  Help me build\tan RSI\nindicator  ')).toBe('Help me build an RSI indicator')
    expect(seedFrom(`RSI${String.fromCharCode(0)}${String.fromCharCode(7)} 14`)).toBe('RSI 14')
  })
  it('caps at SEED_MAX, at a word boundary when one is near', () => {
    const long = 'word '.repeat(300)
    const s = seedFrom(long)
    expect(s.length).toBeLessThanOrEqual(SEED_MAX)
    expect(s.endsWith('word')).toBe(true)
  })
  it('null for nothing', () => {
    for (const v of [null, undefined, '', '   ', 42, {}]) expect(seedFrom(v)).toBe(null)
  })
})

describe('instanceFingerprint — for an instance-scoped Undo (Milestone 2)', () => {
  const cs = () => ({ ...base(), indicatorInstances: [...(base().indicatorInstances || []), { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 14 } }] })
  it('ignores unrelated chart changes and the live preview; key order does not matter', () => {
    const a = cs()
    const b = { ...cs(), background: '#ffffff', textColor: '#000000', indicatorInstances: [...cs().indicatorInstances,
      { instanceId: `inst:${STUDIO_PREVIEW_DEF_ID}:1`, defId: STUDIO_PREVIEW_DEF_ID, inputs: {} }] }
    expect(instanceFingerprint(b)).toBe(instanceFingerprint(a))
    const c = { ...a, indicatorInstances: a.indicatorInstances.map((i) => (i.instanceId === 'inst:rsi:1' ? { inputs: { period: 14 }, defId: 'rsi', instanceId: 'inst:rsi:1' } : i)) }
    expect(instanceFingerprint(c)).toBe(instanceFingerprint(a))
  })
  it('moves when an instance is added, removed, hidden or re-parameterised', () => {
    const a = instanceFingerprint(cs())
    const variants = [
      (x) => ({ ...x, indicatorInstances: x.indicatorInstances.filter((i) => i.instanceId !== 'inst:rsi:1') }),
      (x) => ({ ...x, indicatorInstances: x.indicatorInstances.map((i) => (i.instanceId === 'inst:rsi:1' ? { ...i, hidden: true } : i)) }),
      (x) => ({ ...x, indicatorInstances: x.indicatorInstances.map((i) => (i.instanceId === 'inst:rsi:1' ? { ...i, inputs: { period: 21 } } : i)) }),
      (x) => ({ ...x, indicatorInstances: [...x.indicatorInstances, { instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }] }),
    ]
    for (const v of variants) expect(instanceFingerprint(v(cs()))).not.toBe(a)
    expect(instanceFingerprint(null)).toBe(instanceFingerprint({ indicatorInstances: [] }))
  })
})

describe('the keys Indicators owns, held equal on the Agent side', () => {
  it('⭐ the Agent OWNED_TOP_KEYS (carried over by its whole-blob writers) is exactly the Indicators list', () => {
    expect([...OWNED_TOP_KEYS].sort()).toEqual([...INDICATOR_OWNED_TOP_KEYS].sort())
  })
  it('every owned key is a real chart setting (a typo cannot hide a key)', () => {
    for (const k of INDICATOR_OWNED_TOP_KEYS) expect(Object.prototype.hasOwnProperty.call(CHART_DEFAULTS, k) || k === 'infoValues', k).toBe(true)
  })
})

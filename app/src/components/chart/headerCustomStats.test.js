// Custom header stats (owner 11-16) — storage: sanitised on read, a place in the row, survives the settings merge.
import { describe, it, expect } from 'vitest'
import {
  sanitizeCustomStat, customStatsOf, addCustomStatPatch, customStatAddRefusal, nextCustomStatId, MAX_CUSTOM_STATS,
} from './headerCustomStats'
import { headerStatKeys, statLabelsOf, withStatLabel, headerStatTogglePatch, headerStatItems, headerStatMetaOf } from './headerStatCatalog'
import { mergeChartSettings } from './chartDefaults'

const ema = { defId: 'movingAverage', plotKey: 'ma', inputs: { maType: 'ema', period: 21 }, name: 'EMA 21' }

describe('headerCustomStats storage', () => {
  it('an entry is rebuilt from its allow-list: nothing smuggled survives', () => {
    const s = sanitizeCustomStat({ ...ema, id: 'c1', ast: { type: 'x' }, value: 5, inputs: { period: 21, bad: { a: 1 }, n: NaN, s: 'x'.repeat(200) } })
    expect(s).toEqual({ id: 'c1', defId: 'movingAverage', plotKey: 'ma', inputs: { period: 21 }, name: 'EMA 21' })
    expect(sanitizeCustomStat({ ...ema, id: 'nope' })).toBeNull()
    expect(sanitizeCustomStat({ ...ema, id: 'c1', defId: '' })).toBeNull()
    expect(sanitizeCustomStat(null)).toBeNull()
  })

  it('the list is unique by id and capped', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ ...ema, id: `c${i % 10}` }))
    const list = customStatsOf({ customStats: raw })
    expect(list.length).toBe(MAX_CUSTOM_STATS)
    expect(new Set(list.map((c) => c.id)).size).toBe(list.length)
  })

  it('adding appends to the row; a duplicate and a full header are refused', () => {
    const header = { fields: ['mcap'] }
    const p = addCustomStatPatch(header, ema, headerStatKeys(header))
    expect(p.fields).toEqual(['mcap', 'cx:c1'])
    expect(p.customStats).toEqual([{ id: 'c1', ...ema }])
    const h2 = { ...header, ...p }
    expect(headerStatKeys(h2)).toEqual(['mcap', 'cx:c1'])
    expect(customStatAddRefusal(h2, ema)).toMatch(/already/)
    expect(addCustomStatPatch(h2, ema, headerStatKeys(h2))).toEqual({})
    expect(nextCustomStatId(h2)).toBe('c2')
    const full = { customStats: Array.from({ length: MAX_CUSTOM_STATS }, (_, i) => ({ ...ema, id: `c${i + 1}`, inputs: { period: i + 2 } })) }
    expect(customStatAddRefusal(full, ema)).toMatch(/at most/)
  })

  it('a legacy header with no `fields` keeps its row when a custom stat is added', () => {
    const header = {}
    const p = addCustomStatPatch(header, ema, headerStatKeys(header))
    expect(p.fields).toEqual(['mcap', 'earn', 'cx:c1'])
  })

  it('a cx key with no stored entry is not a stat (stale keys never print)', () => {
    expect(headerStatKeys({ fields: ['mcap', 'cx:c9'] })).toEqual(['mcap'])
    expect(statLabelsOf({ statLabels: { 'cx:c9': 'x' } })).toEqual({})
  })

  it('rename works like a catalog stat; removing drops the entry, its rename and its colors', () => {
    let h = { fields: ['mcap'] }
    h = { ...h, ...addCustomStatPatch(h, ema, headerStatKeys(h)) }
    h = { ...h, statLabels: withStatLabel(h, 'cx:c1', 'Fast') }
    expect(statLabelsOf(h)).toEqual({ 'cx:c1': 'Fast' })
    expect(withStatLabel(h, 'cx:c1', 'EMA 21')).toEqual({})   // its own name = no rename
    h = { ...h, colors: { 'cx:c1': '#aabbcc', mcap: '#111111' } }
    const p = headerStatTogglePatch(h, 'cx:c1')
    expect(p.fields).toEqual(['mcap'])
    expect(p.customStats).toEqual([])
    expect(p.statLabels).toEqual({})
    expect(p.colors).toEqual({ mcap: '#111111' })
  })

  it('survives the chart-settings merge (the allow-list) byte for byte, and an absent key stays absent', () => {
    const h = { fields: ['mcap', 'cx:c1'], customStats: [{ id: 'c1', ...ema }], statLabels: { 'cx:c1': 'Fast' } }
    const merged = mergeChartSettings(JSON.stringify({ header: h }))
    expect(merged.header.customStats).toEqual(h.customStats)
    expect(merged.header.fields).toEqual(h.fields)
    expect(headerStatKeys(merged.header)).toEqual(['mcap', 'cx:c1'])
    const again = mergeChartSettings(JSON.stringify(merged))
    expect(again.header.customStats).toEqual(h.customStats)
    expect('customStats' in mergeChartSettings(null).header).toBe(false)
  })
})

describe('the info row item for a custom stat', () => {
  const header = { fields: ['cx:c1'], customStats: [{ id: 'c1', ...ema }] }
  it('prints the computed text and name; before the compute answers, the stored name and —', () => {
    const before = headerStatItems(['cx:c1'], {}, {}, { header })
    expect(before[0]).toMatchObject({ key: 'cx:c1', label: 'EMA 21', value: null })
    const custom = { 'cx:c1': { key: 'cx:c1', state: 'value', value: 1.5, text: '1.50', label: 'EMA 21', short: 'EMA 21', signed: false } }
    const after = headerStatItems(['cx:c1'], { 'cx:c1': 'Fast' }, { 'cx:c1': '#abcdef' }, { header, custom })
    expect(after[0]).toMatchObject({ label: 'Fast', value: '1.50', color: '#abcdef', custom: true })
  })
  it('a signed stat is tinted by its sign; a refused one prints n/a', () => {
    const neg = { 'cx:c1': { state: 'value', value: -2, text: '-2.00', label: 'X', signed: true } }
    expect(headerStatItems(['cx:c1'], {}, {}, { header, custom: neg })[0].sign).toBe('neg')
    const ref = { 'cx:c1': { state: 'refused', text: 'n/a', label: 'X', reason: 'why' } }
    const it0 = headerStatItems(['cx:c1'], {}, {}, { header, custom: ref })[0]
    expect(it0.value).toBe('n/a')
    expect(it0.title).toContain('why')
  })
  it('the settings meta falls back to the stored name', () => {
    expect(headerStatMetaOf(header, 'cx:c1').label).toBe('EMA 21')
    expect(headerStatMetaOf(header, 'cx:c1', { 'cx:c1': { label: 'EMA 21', signed: true } }).signed).toBe(true)
    expect(headerStatMetaOf(header, 'cx:c7')).toBeNull()
  })
})

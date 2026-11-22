// Per-stat looks for the chart header (owner 11-17): sanitised on read, defaults never stored, survives the merge,
// travels on the info-row items, and goes with a stat that leaves the header.
import { describe, it, expect } from 'vitest'
import { cleanStatStyle, cleanStatColor, statStylesOf, withStatStyle } from './headerStatStyle'
import { statStylesFor, withHeaderStatStyle, headerStatTogglePatch, headerStatItems } from './headerStatCatalog'
import { mergeChartSettings } from './chartDefaults'

describe('headerStatStyle sanitizer', () => {
  it('keeps only the allow-listed fields with valid values', () => {
    expect(cleanStatStyle({ labelColor: '#abcdef', box: true, boxColor: 'rgba(1, 2, 3, 0.5)', size: 'xl', junk: 1 }))
      .toEqual({ labelColor: '#abcdef', box: true, boxColor: 'rgba(1, 2, 3, 0.5)', size: 'xl' })
    expect(cleanStatStyle({ labelColor: 'url(javascript:x)', box: 'yes', size: 'huge' })).toBeNull()
    expect(cleanStatStyle({ size: 'm', box: false })).toBeNull()          // defaults are never stored
    expect(cleanStatColor('red; background:url(x)')).toBe('')
    expect(cleanStatColor('#f8f7f314')).toBe('#f8f7f314')
  })
  it('reads only known keys and never a prototype key', () => {
    const h = JSON.parse('{"statStyle":{"mcap":{"size":"l"},"__proto__":{"size":"l"},"nope":{"size":"s"}}}')
    expect(statStylesOf(h, (k) => k === 'mcap')).toEqual({ mcap: { size: 'l' } })
    expect(statStylesFor({ ...h, fields: ['mcap'] })).toEqual({ mcap: { size: 'l' } })
  })
  it('a patch back to defaults removes the entry, so the blob returns to its legacy shape', () => {
    let h = { statStyle: withStatStyle({}, 'mcap', { size: 'l', box: true }) }
    expect(h.statStyle).toEqual({ mcap: { size: 'l', box: true } })
    h = { statStyle: withStatStyle(h, 'mcap', { size: 'm', box: false }) }
    expect(h.statStyle).toEqual({})
  })
})

describe('the stat look on the header', () => {
  it('survives mergeChartSettings (the allow-list) and an untouched blob carries no statStyle', () => {
    const header = { fields: ['mcap', 'earn'], statStyle: { mcap: { labelColor: '#123456', box: true, size: 's' } } }
    const merged = mergeChartSettings(JSON.stringify({ header }))
    expect(merged.header.statStyle).toEqual(header.statStyle)
    expect(mergeChartSettings(JSON.stringify(merged)).header.statStyle).toEqual(header.statStyle)
    expect('statStyle' in mergeChartSettings(null).header).toBe(false)
  })
  it('rides the items; an unstyled stat has no `style` at all (renders exactly as before)', () => {
    const header = { fields: ['mcap', 'earn'], statStyle: { mcap: { size: 'xl' } } }
    const items = headerStatItems(['mcap', 'earn'], {}, {}, { header })
    expect(items[0].style).toEqual({ size: 'xl' })
    expect('style' in items[1]).toBe(false)
  })
  it('leaves with the stat it styles; the value color (header.colors) is untouched', () => {
    const header = { fields: ['mcap', 'earn'], colors: { mcap: '#111111' }, statStyle: { mcap: { box: true }, earn: { size: 'l' } } }
    const p = headerStatTogglePatch(header, 'mcap')
    expect(p.fields).toEqual(['earn'])
    expect(p.statStyle).toEqual({ earn: { size: 'l' } })
    expect(p.colors).toBeUndefined()
    expect(withHeaderStatStyle(header, 'zzz', { size: 'l' })).toEqual(header.statStyle)   // not a stat: no write
  })
})

describe('text thickness (owner 11-17)', () => {
  it('keeps a known weight, drops the default and junk', () => {
    expect(cleanStatStyle({ weight: 'bold' })).toEqual({ weight: 'bold' })
    expect(cleanStatStyle({ weight: 'regular' })).toBeNull()
    expect(cleanStatStyle({ weight: '900' })).toBeNull()
    let h = { statStyle: withStatStyle({}, 'mcap', { weight: 'heavy' }) }
    expect(h.statStyle).toEqual({ mcap: { weight: 'heavy' } })
    h = { statStyle: withStatStyle(h, 'mcap', { weight: 'regular' }) }
    expect(h.statStyle).toEqual({})
  })
})

describe('pickedBoxColor (owner 11-17: a picked box color must be visible)', () => {
  it('a new color picked off the faint default becomes an 85% pill', async () => {
    const { pickedBoxColor } = await import('./headerStatStyle')
    expect(pickedBoxColor(null, '#c41f2d14')).toBe('#c41f2dd9')
    expect(pickedBoxColor('#f8f7f314', '#3b82f614')).toBe('#3b82f6d9')
  })
  it('an opacity the member set is kept: slider moves, and picks from a non-faint box', async () => {
    const { pickedBoxColor } = await import('./headerStatStyle')
    expect(pickedBoxColor('#c41f2dd9', '#c41f2d40')).toBe('#c41f2d40')   // slider on the same color
    expect(pickedBoxColor('#c41f2d80', '#3b82f680')).toBe('#3b82f680')   // their 50% carries to the new color
    expect(pickedBoxColor(null, '#f8f7f340')).toBe('#f8f7f340')          // slider on the default color
  })
})

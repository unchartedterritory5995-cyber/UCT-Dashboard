import { expect, test } from 'vitest'
import { setupLine, pivotDetail, activeStructures, structureLabels } from '../setupLine'

test('head of base_render, +N stripped', () => {
  expect(setupLine({ base_render: 'Three Weeks Tight (Stage 2 Breakout) +2', vol_ratio: 1.2 }))
    .toEqual({ text: 'Three Weeks Tight', detail: null, quiet: false, title: 'Three Weeks Tight' })
})
test('null base', () => {
  expect(setupLine({ base_render: null, vol_ratio: 1 }))
    .toEqual({ text: 'Not enough history for a base', detail: null, quiet: true, title: null })
})
test('zero volume says so and is quiet', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 0 }))
    .toEqual({ text: 'No trades today', detail: null, quiet: true, title: null })
})
test('pivot detail only with a finite pivot and price', () => {
  expect(pivotDetail(956.12, 988)).toBe('3.2% below pivot 988')
  expect(pivotDetail(102, 100)).toBe('2.0% above pivot 100')
  expect(pivotDetail(100.1, 100)).toBe('at pivot 100')
  expect(pivotDetail(null, 100)).toBeNull()
  expect(pivotDetail(10, null)).toBeNull()
  expect(pivotDetail(10, 0)).toBeNull()
})
test('pivot detail rides the row when base_pivot_px exists', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 1, price: 97, base_pivot_px: 100 }).detail)
    .toBe('3.0% below pivot 100')
})
test('leading whitespace before a parenthetical keeps the render instead of going blank', () => {
  expect(setupLine({ base_render: ' (Stage 2 Breakout) +2', vol_ratio: 1 }).text).toBe('(Stage 2 Breakout)')
})
test('pivot under 10 keeps two decimals', () => {
  expect(pivotDetail(4.5, 4.75)).toBe('5.3% below pivot 4.75')
})

// The structure library as meta ships it: the filter reading base_matches, its presets the labels.
const META_FILTERS = [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', column: 'rs_rank', presets: [{ label: 'Any' }] },
  { key: 'base_structure', label: 'Base Structure', type: 'enum', column: 'base_matches', presets: [
    { label: 'Any' },
    { label: 'Pocket Pivot', op: 'contains', value: ',pocket-pivot,' },
    { label: 'Three Weeks Tight', op: 'contains', value: ',three-weeks-tight,' },
    { label: 'Cheat (3-C)', op: 'contains', value: ',cheat-3c,', desc: 'A pause inside a cup.' },
  ] },
]
const pocket = activeStructures({ base_structure: { op: 'contains', value: ',pocket-pivot,' } }, META_FILTERS)
const labels = structureLabels(META_FILTERS)
const screened = { matched: pocket, labels }

test('active structures come from the answered filters and the library labels, found by column', () => {
  expect(pocket).toEqual([{ value: ',pocket-pivot,', label: 'Pocket Pivot', title: 'Pocket Pivot' }])
  expect(activeStructures({ rs_rank: { op: 'gte', min: 80 } }, META_FILTERS)).toEqual([])
  expect(activeStructures({ base_structure: { op: 'contains', value: ',nope,' } }, META_FILTERS)).toEqual([])
  expect(activeStructures({ base_structure: { op: 'contains', value: ',pocket-pivot,' } }, null)).toEqual([])
  // a description from the library becomes the tooltip
  expect(activeStructures({ base_structure: { op: 'contains', value: ',cheat-3c,' } }, META_FILTERS)[0].title)
    .toBe('A pause inside a cup.')
})
test('B2: the matched structure leads and the render head follows as "also"', () => {
  const s = setupLine({ base_render: 'Ugly Double Bottom (Pocket Pivot) +1', vol_ratio: 1.1, price: 97, base_pivot_px: 100 }, screened)
  expect(s.text).toBe('Pocket Pivot · also Ugly Double Bottom')
  expect(s.title).toBe('Pocket Pivot')
  // the pivot is the head's, so it never rides beside the lead
  expect(s.detail).toBeNull()
  expect(s.also).toBe('Ugly Double Bottom')
  expect(s.alsoDetail).toBe('3.0% below pivot 100')
})
test('B2: a head that already is the matched structure reads as before, pivot kept', () => {
  const s = setupLine({ base_render: 'Pocket Pivot (Flat Base)', vol_ratio: 1, price: 97, base_pivot_px: 100 }, screened)
  expect(s.text).toBe('Pocket Pivot')
  expect(s.detail).toBe('3.0% below pivot 100')
})
test('B2: with no structure filter the head leads as before', () => {
  expect(setupLine({ base_render: 'Ugly Double Bottom (Pocket Pivot)', vol_ratio: 1 }, { labels }).text).toBe('Ugly Double Bottom')
})
test('B2: zero volume and missing history stay quiet even under a structure screen', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 0 }, screened).text).toBe('No trades today')
  expect(setupLine({ base_render: null, vol_ratio: 1 }, screened).text).toBe('Not enough history for a base')
})
test('plain words: jargon structure names are spelled out, the textbook name stays in the tooltip', () => {
  const s = setupLine({ base_render: 'Cheat (3-C) (Flat Base) +2', vol_ratio: 1 }, { labels })
  expect(s.text).toBe('Early entry inside a cup (3-C)')
  expect(s.title).toBe('Cheat (3-C)')
  // a name that holds " (" is found whole, never cut to "Cheat"
  expect(setupLine({ base_render: 'Cheat (3-C)', vol_ratio: 1 }, { labels }).text).toBe('Early entry inside a cup (3-C)')
})
test('structure labels are the library presets, never the "Any" row or another filter', () => {
  expect(labels).toEqual(['Pocket Pivot', 'Three Weeks Tight', 'Cheat (3-C)'])
})

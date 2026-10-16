import { expect, test } from 'vitest'
import { setupLine, pivotDetail, activeStructures, structureLabels } from '../setupLine'

test('head of base_render, +N stripped, said plainly with the textbook name in the tooltip', () => {
  expect(setupLine({ base_render: 'Three Weeks Tight (Stage 2 Breakout) +2', vol_ratio: 1.2 }))
    .toEqual({ text: 'Three tight weekly closes', detail: null, quiet: false, title: 'Three Weeks Tight' })
})
test('null base: neutral wording, because the payload cannot say WHY the columns are empty', () => {
  const s = setupLine({ base_render: null, vol_ratio: 1 })
  expect(s).toMatchObject({ text: 'No structure read', detail: null, quiet: true })
  // it must not claim the cause: too little history is only one of two reasons
  expect(s.text).not.toMatch(/history/)
  expect(s.title).toMatch(/too little price history, or the structure read did not run/)
})
test('zero volume says so and is quiet', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 0 }))
    .toEqual({ text: 'No trades in the last session', detail: null, quiet: true, title: null })
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
  // ERIC on production 2026-10-16: rounded to the dollar this read "1.3% above pivot 11".
  expect(pivotDetail(10.68, 10.54)).toBe('1.3% above pivot 10.54')
  expect(pivotDetail(33.46, 33.56)).toBe('0.3% below pivot 33.56')
})

// The structure library as meta ships it: the filter reading base_matches, its presets the labels.
const META_FILTERS = [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', presets: [{ label: 'Any' }] },
  { key: 'base_structure', label: 'Base Structure', type: 'enum', presets: [
    { label: 'Any' },
    { label: 'Pocket Pivot', op: 'contains', value: ',pocket-pivot,' },
    { label: 'Three Weeks Tight', op: 'contains', value: ',three-weeks-tight,' },
    { label: 'Cheat (3-C)', op: 'contains', value: ',cheat-3c,', desc: 'A pause inside a cup.' },
  ] },
]
const pocket = activeStructures({ base_structure: { op: 'contains', value: ',pocket-pivot,' } }, META_FILTERS)
const labels = structureLabels(META_FILTERS)
const screened = { matched: pocket, labels }

test('active structures come from the answered filters and the library labels, found by key', () => {
  expect(pocket).toEqual([{ value: ',pocket-pivot,', label: 'Pocket Pivot', title: 'Pocket Pivot' }])
  expect(activeStructures({ rs_rank: { op: 'gte', min: 80 } }, META_FILTERS)).toEqual([])
  expect(activeStructures({ base_structure: { op: 'contains', value: ',nope,' } }, META_FILTERS)).toEqual([])
  expect(activeStructures({ base_structure: { op: 'contains', value: ',pocket-pivot,' } }, null)).toEqual([])
  // a description from the library becomes the tooltip
  expect(activeStructures({ base_structure: { op: 'contains', value: ',cheat-3c,' } }, META_FILTERS)[0].title)
    .toBe('Cheat (3-C): A pause inside a cup.')
})
test('B2: the matched structure leads and the render head follows as "also"', () => {
  const s = setupLine({ base_render: 'Ugly Double Bottom (Pocket Pivot) +1', vol_ratio: 1.1, price: 97, base_pivot_px: 100 }, screened)
  expect(s.text).toBe('Up day on more volume than recent selling · also Double bottom with a higher second low')
  expect(s.title).toBe('Pocket Pivot')
  // the pivot is the head's, so it never rides beside the lead
  expect(s.detail).toBeNull()
  expect(s.also).toBe('Double bottom with a higher second low')
  expect(s.alsoDetail).toBe('3.0% below pivot 100')
})
test('B2: a head that already is the matched structure reads as before, pivot kept', () => {
  const s = setupLine({ base_render: 'Pocket Pivot (Flat Base)', vol_ratio: 1, price: 97, base_pivot_px: 100 }, screened)
  expect(s.text).toBe('Up day on more volume than recent selling')
  expect(s.detail).toBe('3.0% below pivot 100')
})
test('B2: with no structure filter the head leads as before', () => {
  expect(setupLine({ base_render: 'Ugly Double Bottom (Pocket Pivot)', vol_ratio: 1 }, { labels }).text).toBe('Double bottom with a higher second low')
})
test('B2: zero volume and missing history stay quiet even under a structure screen', () => {
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 0 }, screened).text).toBe('No trades in the last session')
  expect(setupLine({ base_render: null, vol_ratio: 1 }, screened).text).toBe('No structure read')
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

// ⭐ THE REAL SHAPE of the Base Structure entry in /api/screener/meta, captured 2026-10-14 from
// `api.services.screener.filters.FILTERS['base_structure']` passed through the same field list
// `_build_shared_filters` ships. It has NO `column` field: an earlier fixture that added one
// restated the contract instead of testing it, and B2 was dead in production behind it.
const REAL_BASE_STRUCTURE_META = {
  key: 'base_structure', label: "Base Structure", category: "pattern", type: "enum",
  allow_custom: false, unit: null,
  presets: [
    {label: "Any"},
    {label: "Volatility Contraction", op: "contains", value: ",vcp,"},
    {label: "Darvas Box", op: "contains", value: ",darvas-box,"},
    {label: "Low Cheat", op: "contains", value: ",low-cheat,"},
    {label: "Cheat (3-C)", op: "contains", value: ",cheat-3c,"},
    {label: "Ascending Base", op: "contains", value: ",ascending-base,"},
    {label: "Base on Base", op: "contains", value: ",base-on-base,"},
    {label: "Double Bottom", op: "contains", value: ",double-bottom,"},
    {label: "Flat Base", op: "contains", value: ",flat-base,"},
    {label: "Square Box", op: "contains", value: ",square-box,"},
    {label: "Buyable Gap-Up", op: "contains", value: ",buyable-gap-up,"},
    {label: "Wyckoff Spring", op: "contains", value: ",wyckoff-spring,"},
    {label: "Green Line Breakout", op: "contains", value: ",green-line-breakout,"},
    {label: "Cup with Handle", op: "contains", value: ",cup-with-handle,"},
    {label: "High Tight Flag", op: "contains", value: ",high-tight-flag,"},
    {label: "Saucer", op: "contains", value: ",saucer,"},
    {label: "Three Weeks Tight", op: "contains", value: ",three-weeks-tight,"},
    {label: "Ugly Double Bottom", op: "contains", value: ",ugly-double-bottom,"},
    {label: "Pocket Pivot", op: "contains", value: ",pocket-pivot,"},
    {label: "Power Play", op: "contains", value: ",power-play,"},
    {label: "Stage 2 Breakout", op: "contains", value: ",stage-2-breakout,"},
    {label: "Climax Top", op: "contains", value: ",climax-top,"},
    {label: "Parabolic Extension", op: "contains", value: ",parabolic-extension,"},
    {label: "Stage 4 Breakdown", op: "contains", value: ",stage-4-breakdown,"},
    {label: "EMA Crossback", op: "contains", value: ",ema-crossback,"},
    {label: "Go Signal", op: "contains", value: ",go-signal,"},
    {label: "Advancing Structure", op: "contains", value: ",advancing-structure,"},
    {label: "Declining Structure", op: "contains", value: ",declining-structure,"},
    {label: "Contracting Range", op: "contains", value: ",contracting-range,"},
    {label: "Expanding Range", op: "contains", value: ",expanding-range,"},
    {label: "Undefined Structure", op: "contains", value: ",undefined-structure,"},
  ],
}

test('B2 against the REAL meta shape (no column field): the structure is found and the head is whole', () => {
  expect('column' in REAL_BASE_STRUCTURE_META).toBe(false)
  const metaFilters = [{ key: 'rs_rank', label: 'RS Rank', category: 'technical', type: 'range', presets: [], allow_custom: true, unit: null }, REAL_BASE_STRUCTURE_META]
  const matched = activeStructures({ base_structure: { op: 'contains', value: ',pocket-pivot,' } }, metaFilters)
  expect(matched.map(m => m.label)).toEqual(['Pocket Pivot'])
  const real = structureLabels(metaFilters)
  expect(real).toContain('Cheat (3-C)')
  expect(real).not.toContain('Any')
  const s = setupLine({ base_render: 'Ugly Double Bottom (Pocket Pivot) +1', vol_ratio: 1 }, { matched, labels: real })
  expect(s.text).toBe('Up day on more volume than recent selling · also Double bottom with a higher second low')
  expect(setupLine({ base_render: 'Cheat (3-C) (Flat Base)', vol_ratio: 1 }, { labels: real }).text).toBe('Early entry inside a cup (3-C)')
})

// ── pivot context: extended, stale, and the line's own title ────────────────
// 2026-10-14 is a Wednesday; ET is UTC-4 in October.
const WED_10AM = Date.parse('2026-10-14T10:00:00-04:00')

test('a price far past the pivot says "extended", never a big percentage', async () => {
  const { EXTENDED_PAST_PIVOT_PCT } = await import('../setupLine')
  expect(EXTENDED_PAST_PIVOT_PCT).toBe(5)
  expect(pivotDetail(147.9, 100)).toBe('extended past pivot 100')
  expect(pivotDetail(105.1, 100)).toBe('extended past pivot 100')
  // inside the buy zone the distance is still measured
  expect(pivotDetail(104.9, 100)).toBe('4.9% above pivot 100')
  expect(pivotDetail(105, 100)).toBe('5.0% above pivot 100')
  // below the pivot is never "extended"
  expect(pivotDetail(80, 100)).toBe('20.0% below pivot 100')
})
test('a stale pivot is dated, not measured against today', () => {
  expect(pivotDetail(147.9, 100, { asOf: 'Oct 8' })).toBe('pivot 100 as of Oct 8')
  expect(pivotDetail(null, 100, { asOf: 'Oct 8' })).toBe('pivot 100 as of Oct 8')
})
test('stale means MORE than two closed sessions behind the row bars_asof', async () => {
  const { pivotIsStale, PIVOT_STALE_SESSIONS } = await import('../setupLine')
  expect(PIVOT_STALE_SESSIONS).toBe(2)
  expect(pivotIsStale({ bars_asof: '20261013' }, WED_10AM)).toBe(false)  // last night's build
  expect(pivotIsStale({ bars_asof: '20261009' }, WED_10AM)).toBe(false)  // 2 behind: Mon, Tue
  expect(pivotIsStale({ bars_asof: '20261008' }, WED_10AM)).toBe(true)   // 3 behind: Fri, Mon, Tue
  expect(pivotIsStale({ bars_asof: null }, WED_10AM)).toBe(false)        // cannot be aged
})
test('the setup line dates a stale pivot and measures a fresh one', () => {
  const row = { base_render: 'Flat Base', vol_ratio: 1, price: 150, base_pivot_px: 100 }
  expect(setupLine({ ...row, bars_asof: '20261008' }, {}, { now: WED_10AM }).detail).toBe('pivot 100 as of Oct 8')
  expect(setupLine({ ...row, bars_asof: '20261013' }, {}, { now: WED_10AM }).detail).toBe('extended past pivot 100')
  expect(setupLine({ ...row, price: 97, bars_asof: '20261013' }, {}, { now: WED_10AM }).detail).toBe('3.0% below pivot 100')
})
test('zero volume names the session it describes; "today" only when bars_asof is today', () => {
  const row = { base_render: 'Flat Base', vol_ratio: 0 }
  expect(setupLine({ ...row, bars_asof: '20261013' }, {}, { now: WED_10AM }).text).toBe('No trades on Oct 13')
  expect(setupLine({ ...row, bars_asof: '20261014' }, {}, { now: WED_10AM }).text).toBe('No trades today')
  expect(setupLine({ ...row, bars_asof: null }, {}, { now: WED_10AM }).text).toBe('No trades in the last session')
})
test('the pivot line is titled for the head structure in plain words, and hidden when stale', async () => {
  const { pivotLine } = await import('../setupLine')
  const row = { base_render: 'Flat Base (Stage 2 Breakout) +1', base_pivot_px: 100, bars_asof: '20261013' }
  expect(pivotLine(row, {}, WED_10AM)).toEqual({ price: 100, title: 'Flat base pivot' })
  expect(pivotLine({ ...row, base_render: 'Cheat (3-C) (Flat Base)' }, { labels: ['Cheat (3-C)'] }, WED_10AM).title)
    .toBe('Early entry inside a cup (3-C) pivot')
  expect(pivotLine({ ...row, base_render: 'Double Bottom' }, {}, WED_10AM).title).toBe('Double bottom pivot')
  expect(pivotLine({ ...row, bars_asof: '20261008' }, {}, WED_10AM)).toBeNull()
  expect(pivotLine({ ...row, base_pivot_px: null }, {}, WED_10AM)).toBeNull()
})
test('the head tooltip is its library description, led by the textbook name when renamed', async () => {
  const { structureDescs } = await import('../setupLine')
  const meta = [{ key: 'base_structure', presets: [
    { label: 'Any' },
    { label: 'Flat Base', op: 'contains', value: ',flat-base,', desc: 'A tight sideways rest.' },
    { label: 'Square Box', op: 'contains', value: ',square-box,', desc: 'A short boxy base.' },
  ] }]
  const descs = structureDescs(meta)
  expect(descs).toEqual({ 'Flat Base': 'A tight sideways rest.', 'Square Box': 'A short boxy base.' })
  expect(setupLine({ base_render: 'Flat Base', vol_ratio: 1 }, { descs }).title).toBe('A tight sideways rest.')
  expect(setupLine({ base_render: 'Square Box', vol_ratio: 1 }, { descs }).title).toBe('Square Box: A short boxy base.')
  // with no description the textbook name is the tooltip
  expect(setupLine({ base_render: 'Square Box', vol_ratio: 1 }, {}).title).toBe('Square Box')
})
test('trend shapes read as trend descriptions, not setups', () => {
  expect(setupLine({ base_render: 'Declining Structure', vol_ratio: 1 }).text).toBe('Downtrend: lower highs and lows')
  expect(setupLine({ base_render: 'Undefined Structure', vol_ratio: 1 }).text).toBe('No clear trend')
})
test('every plain structure name keys a REAL library label (a typo would never match)', async () => {
  const { PLAIN_STRUCTURE_NAMES, TREND_SHAPES } = await import('../plainWords')
  const real = new Set(REAL_BASE_STRUCTURE_META.presets.map(p => p.label))
  for (const k of Object.keys(PLAIN_STRUCTURE_NAMES)) expect(real.has(k), k).toBe(true)
  for (const k of TREND_SHAPES) expect(real.has(k), k).toBe(true)
  // the owner's list is covered
  for (const k of ['Three Weeks Tight', 'Stage 4 Breakdown', 'Square Box', 'Green Line Breakout', 'Saucer',
    'Ugly Double Bottom', 'Darvas Box', 'Pocket Pivot', 'Buyable Gap-Up', 'Climax Top', 'Undefined Structure',
    'Advancing Structure', 'Declining Structure', 'Contracting Range', 'Expanding Range']) {
    expect(PLAIN_STRUCTURE_NAMES[k], k).toBeTruthy()
    expect(PLAIN_STRUCTURE_NAMES[k], k).not.toBe(k)
  }
})

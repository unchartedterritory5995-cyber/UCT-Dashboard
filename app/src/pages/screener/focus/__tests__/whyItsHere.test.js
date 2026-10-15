import { expect, test } from 'vitest'
import { whyItsHere, whyColumns } from '../whyItsHere'

const meta = [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', unit: null, presets: [] },
  { key: 'price', label: 'Price', type: 'range', unit: '$', presets: [] },
  { key: 'above_50sma', label: 'Above 50 SMA', type: 'bool', presets: [] },
  { key: 'sector', label: 'Sector', type: 'enum', presets: [] },
  { key: 'base_structure', label: 'Structure', type: 'enum', presets: [] },
]
const row = { ticker: 'MU', rs_rank: 94, price: 956.12, above_50sma: 1, sector: 'Technology' }

test('checkable thresholds become checks with the row value', () => {
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'check', label: 'RS Rank ≥ 80', value: '94' }])
})
test('money values are formatted', () => {
  const { items } = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: meta, row })
  expect(items[0]).toEqual({ kind: 'check', label: 'Price ≥ $10', value: '$956.12' })
})
test('bool reads Yes', () => {
  const { items } = whyItsHere({ filters: { above_50sma: { op: 'eq', value: 1 } }, metaFilters: meta, row })
  expect(items[0]).toEqual({ kind: 'check', label: 'Above 50 SMA', value: 'Yes' })
})
test('universe is a pool, not a check', () => {
  const { items } = whyItsHere({ filters: { universe: { op: 'eq', value: 'uct', label: 'UCT Universe' } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'pool', label: 'In UCT Universe' }])
})
test('a list pool uses its label', () => {
  const { items } = whyItsHere({ filters: { list: { op: 'in', value: 'wl:3', label: 'Semis' } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'pool', label: 'In Semis' }])
})
test('scan join is a note', () => {
  const { items } = whyItsHere({ filters: { scan: { op: 'in', value: 'abc', label: 'Pocket pivots' } }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'note', label: 'In My Scan Pocket pivots' }])
})
test('logic tree is a note not a check', () => {
  const { items } = whyItsHere({ filters: {}, logic: { any: [{ key: 'rs_rank', op: 'gte', min: 90 }] }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'note', label: 'Matches your custom criteria' }])
})
test('rank is a note', () => {
  const { items } = whyItsHere({ filters: {}, rank: { criteria: [{ key: 'uct_composite' }], top_n: 50 }, metaFilters: meta, row })
  expect(items).toEqual([{ kind: 'note', label: 'Ranked in the top 50 by your weights' }])
})
test('structure contains is a note, never a check', () => {
  const { items } = whyItsHere({ filters: { base_structure: { op: 'contains', value: 'flat-base' } }, metaFilters: meta, row })
  expect(items[0].kind).toBe('note')
})
test('a column comparison op is a note', () => {
  const { items } = whyItsHere({ filters: { price: { op: 'gt_col', value: 'ema20' } }, metaFilters: meta, row })
  expect(items[0].kind).toBe('note')
})
test('missing row value is a note, not a check', () => {
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: { ticker: 'X' } })
  expect(items[0]).toEqual({ kind: 'note', label: 'RS Rank ≥ 80', value: '—' })
})
test('null and NaN row values are notes with a dash', () => {
  const nul = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: { rs_rank: null } })
  const nan = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: { rs_rank: NaN } })
  expect(nul.items[0]).toEqual({ kind: 'note', label: 'RS Rank ≥ 80', value: '—' })
  expect(nan.items[0]).toEqual({ kind: 'note', label: 'RS Rank ≥ 80', value: '—' })
})
test('a bool requiring false reads Not, with the row state', () => {
  const { items } = whyItsHere({ filters: { above_50sma: { op: 'eq', value: 0 } }, metaFilters: meta, row })
  expect(items[0]).toEqual({ kind: 'check', label: 'Not Above 50 SMA', value: 'Yes' })
})
test('bool row strings 0 and false read No, true reads Yes', () => {
  const f = { above_50sma: { op: 'eq', value: 1 } }
  expect(whyItsHere({ filters: f, metaFilters: meta, row: { above_50sma: '0' } }).items[0].value).toBe('No')
  expect(whyItsHere({ filters: f, metaFilters: meta, row: { above_50sma: 'false' } }).items[0].value).toBe('No')
  expect(whyItsHere({ filters: f, metaFilters: meta, row: { above_50sma: 'true' } }).items[0].value).toBe('Yes')
})
test('large money values compact to K, M and B with one decimal', () => {
  const v = p => whyItsHere({ filters: { price: { op: 'gte', min: 1 } }, metaFilters: meta, row: { price: p } }).items[0].value
  expect(v(5000000)).toBe('$5M')
  expect(v(1234567)).toBe('$1.2M')
  expect(v(12500)).toBe('$12.5K')
  expect(v(3200000000)).toBe('$3.2B')
})
test('values under 10000 are never compacted', () => {
  const v = (key, n) => whyItsHere({ filters: { [key]: { op: 'gte', min: 1 } }, metaFilters: meta, row: { [key]: n } }).items[0].value
  expect(v('price', 4500)).toBe('$4500')
  expect(v('price', 1234)).toBe('$1234')
  expect(v('rs_rank', 1234)).toBe('1234')
})
test('compaction picks the unit after rounding and keeps the sign', () => {
  const v = n => whyItsHere({ filters: { rs_rank: { op: 'gte', min: 1 } }, metaFilters: meta, row: { rs_rank: n } }).items[0].value
  expect(v(999999)).toBe('1M')
  expect(v(-2500000)).toBe('-2.5M')
})
test('an in-list label joins its values, a not_in label says not', () => {
  const sector = { op: 'in', values: ['Technology', 'Energy'] }
  const notIn = { op: 'not_in', values: ['Utilities'] }
  expect(whyItsHere({ filters: { sector }, metaFilters: meta, row }).items[0])
    .toEqual({ kind: 'check', label: 'Sector Technology, Energy', value: 'Technology' })
  expect(whyItsHere({ filters: { sector: notIn }, metaFilters: meta, row }).items[0].label)
    .toBe('Sector not Utilities')
})
test('caps at five, reports the rest', () => {
  const filters = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(k => [k, { op: 'gte', min: 1 }]))
  const m = Object.keys(filters).map(k => ({ key: k, label: k, type: 'range', presets: [] }))
  const out = whyItsHere({ filters, metaFilters: m, row: {} })
  expect(out.items).toHaveLength(5)
  expect(out.more).toBe(2)
})
test('whyColumns asks only for checkable keys', () => {
  expect(whyColumns({ rs_rank: { op: 'gte', min: 80 }, universe: { op: 'eq', value: 'uct' },
    scan: { op: 'in', value: 'x' }, price: { op: 'gt_col', value: 'ema20' } })).toEqual(['rs_rank'])
})

test('compact formats 5+ digit numbers', async () => {
  const { compact } = await import('../whyItsHere')
  expect(compact(20000000)).toBe('20M')
  expect(compact(1500000)).toBe('1.5M')
  expect(compact(25000)).toBe('25K')
  expect(compact(999)).toBeNull()
})

test('a large threshold in the strip label reads compactly, like the drawer pill', () => {
  const dv = { key: 'dollar_vol_30d', label: 'Dollar Volume (30d)', type: 'range', unit: '$', presets: [] }
  const { items } = whyItsHere({ filters: { dollar_vol_30d: { op: 'gte', min: 20000000 } }, metaFilters: [dv], row: { dollar_vol_30d: 2.5e9 } })
  expect(items[0].label).toBe('Dollar Volume (30d) ≥ $20M')
  expect(items[0].value).toBe('$2.5B')
})

// -- Task 3 --
test('B5: with a live price the strip checks and shows the live price', () => {
  const live = { price: 961.5, chg: 0.6, live: true }
  const { items } = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: meta, row, live, snapshotDate: '2026-10-12' })
  expect(items[0]).toEqual({ kind: 'check', label: 'Price ≥ $10', value: '$961.50' })
})
test('B5: a live price that no longer passes is never a tick', () => {
  const live = { price: 9.4, chg: -2, live: true }
  const { items } = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: meta, row: { price: 10.2 }, live, snapshotDate: '2026-10-13' })
  expect(items[0]).toEqual({ kind: 'note', label: 'Price ≥ $10', value: '$9.4 now (matched at Oct 12 close)' })
})
test('B5: without a live price the snapshot value says which close it is', () => {
  // snapshot_date is the BUILD date: a Tuesday build describes Monday's close
  const { items } = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: meta, row, live: { price: 956.12, live: false }, snapshotDate: '2026-10-13' })
  expect(items[0]).toEqual({ kind: 'check', label: 'Price ≥ $10', value: '$956.12 at Oct 12 close' })
  // a row's own bars_asof names its close directly
  const own = whyItsHere({ filters: { price: { op: 'gte', min: 10 } }, metaFilters: meta, row: { ...row, bars_asof: '20261009' }, snapshotDate: '2026-10-13' })
  expect(own.items[0].value).toBe('$956.12 at Oct 9 close')
})
test('plain words: a column reads as the list and sort menu name it', () => {
  const m = [...meta, { key: 'vol_ratio', label: 'Volume Ratio', type: 'range', presets: [] }]
  const { items } = whyItsHere({ filters: { vol_ratio: { op: 'gte', min: 1.5 } }, metaFilters: m, row: { vol_ratio: 2.1 } })
  expect(items[0].label).toBe('Volume vs avg ≥ 1.5')
})
test('P10: a structure screen says what the stock has, in plain words', () => {
  const m = [{ key: 'base_structure', label: 'Base Structure', type: 'enum', presets: [
    { label: 'Any' }, { label: 'Pocket Pivot', op: 'contains', value: ',pocket-pivot,' },
    { label: 'Cheat (3-C)', op: 'contains', value: ',cheat-3c,' }, { label: 'Inside Day', op: 'contains', value: ',inside-day,' }] }]
  const one = v => whyItsHere({ filters: { base_structure: { op: 'contains', value: v } }, metaFilters: m, row: {} }).items[0]
  expect(one(',pocket-pivot,')).toEqual({ kind: 'note', label: 'Has a Pocket Pivot' })
  expect(one(',cheat-3c,').label).toBe('Has an Early entry inside a cup (3-C)')
  expect(one(',inside-day,').label).toBe('Has an Inside Day')
  expect(one(',gone,').label).not.toMatch(/^Matches/)
})

test('7: the operator word reads lowercase mid-sentence, with the plain column name', () => {
  const m = [{ key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%', presets: [{ label: 'Over 4%', op: 'gte', min: 4 }] }]
  const { items } = whyItsHere({ filters: { adr_pct: { op: 'gte', min: 4 } }, metaFilters: m, row: { ticker: 'MU', adr_pct: 5.2 } })
  expect(items[0].label).toBe('Avg daily range over 4%')
})

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
test('missing row value shows a dash, still a check', () => {
  const { items } = whyItsHere({ filters: { rs_rank: { op: 'gte', min: 80 } }, metaFilters: meta, row: { ticker: 'X' } })
  expect(items[0]).toEqual({ kind: 'check', label: 'RS Rank ≥ 80', value: '—' })
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

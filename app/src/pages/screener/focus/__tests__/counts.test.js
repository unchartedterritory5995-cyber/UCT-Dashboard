import { expect, test } from 'vitest'
import { capToTopN, poolOf, withPool } from '../counts'

test('S2: a ranked screen shows at most its top_n', () => {
  expect(capToTopN(312, { rank: { top_n: 50 } })).toBe(50)
  expect(capToTopN(12, { rank: { top_n: 50 } })).toBe(12)
  expect(capToTopN(312, { filters: [] })).toBe(312)
  expect(capToTopN(312, { rank: { criteria: [] } })).toBe(312)
})
test('S2: an unknown or failed count is never turned into a number', () => {
  expect(capToTopN(undefined, { rank: { top_n: 50 } })).toBeUndefined()
  expect(capToTopN(null, { rank: { top_n: 50 } })).toBeNull()
})
test('S3: the member pool is added only to a spec that names none', () => {
  const pool = [{ key: 'universe', op: 'eq', value: 'uct', label: 'UCT Universe' }]
  expect(withPool({ filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] }, pool).filters.map(f => f.key)).toEqual(['rs_rank', 'universe'])
  const own = { filters: [{ key: 'list', op: 'in', value: 'wl:3' }] }
  expect(withPool(own, pool)).toBe(own)
  const bare = { filters: [] }
  expect(withPool(bare, [])).toBe(bare)
  expect(withPool(undefined, pool).filters).toEqual(pool)
})
test('poolOf reads the universe and list entries only', () => {
  expect(poolOf({ filters: [{ key: 'universe', value: 'uct' }, { key: 'rs_rank' }, { key: 'list', value: 'wl:1' }] }).map(f => f.key))
    .toEqual(['universe', 'list'])
})

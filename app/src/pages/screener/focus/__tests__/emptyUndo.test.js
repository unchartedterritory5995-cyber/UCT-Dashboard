import { expect, test } from 'vitest'
import { diffOneFilter, describeEmptying } from '../emptyUndo'

const defs = { adr: { key: 'adr', label: '8-wk gain', type: 'range', unit: '%', presets: [] } }

test('one changed key is found', () => {
  expect(diffOneFilter({ a: { op: 'gte', min: 1 } }, { a: { op: 'gte', min: 2 } })).toEqual({ key: 'a' })
  expect(diffOneFilter({}, { a: { op: 'gte', min: 1 } })).toEqual({ key: 'a' })
})
test('two changes or a removal is not one change', () => {
  expect(diffOneFilter({}, { a: {}, b: {} })).toBeNull()
  expect(diffOneFilter({ a: { op: 'gte', min: 1 } }, {})).toBeNull()
})
test('no change at all is not one change', () => {
  expect(diffOneFilter({ a: { op: 'gte', min: 1 } }, { a: { op: 'gte', min: 1 } })).toBeNull()
  expect(diffOneFilter(null, undefined)).toBeNull()
})
test('describes the emptying filter', () => {
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 31, nextSpec: { filters: { adr: { op: 'gte', min: 200 } } }, nextTotal: 0, defs }))
    .toEqual({ label: '8-wk gain: ≥ 200%', from: 31 })
})
test('no description when it was already empty or still has rows', () => {
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 0, nextSpec: { filters: { adr: { op: 'gte', min: 1 } } }, nextTotal: 0, defs })).toBeNull()
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 31, nextSpec: { filters: { adr: { op: 'gte', min: 1 } } }, nextTotal: 4, defs })).toBeNull()
})
test('no description before any list has loaded', () => {
  expect(describeEmptying({ prevSpec: null, prevTotal: null, nextSpec: { filters: { adr: { op: 'gte', min: 1 } } }, nextTotal: 0, defs })).toBeNull()
})
test('a pool change reads as the universe, not a raw key', () => {
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 12,
    nextSpec: { filters: { list: { op: 'in', value: 'wl:3', label: 'Semis' } } }, nextTotal: 0, defs }))
    .toEqual({ label: 'Universe: Semis', from: 12 })
})
test('the emptying filter is named the way its pill names it: plain column, lowercase operator', () => {
  const price = { price: { key: 'price', label: 'Price', type: 'range', unit: '$', presets: [{ label: 'Under $20', op: 'lte', max: 20 }] } }
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 9, nextSpec: { filters: { price: { op: 'lte', max: 20 } } }, nextTotal: 0, defs: price }))
    .toEqual({ label: 'Price: under $20', from: 9 })
  const adr = { adr_pct: { key: 'adr_pct', label: 'ADR %', type: 'range', unit: '%', presets: [{ label: 'Over 4%', op: 'gte', min: 4 }] } }
  expect(describeEmptying({ prevSpec: { filters: {} }, prevTotal: 9, nextSpec: { filters: { adr_pct: { op: 'gte', min: 4 } } }, nextTotal: 0, defs: adr }))
    .toEqual({ label: 'Avg daily range: over 4%', from: 9 })
})

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

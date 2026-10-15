import { expect, test, beforeEach } from 'vitest'
import { pickLanding, sameScreen, readLandingSeed, writeLandingSeed, LANDING_MIN_MATCHES, landingSeedKey } from '../landing'

const items = [{ id: 'a', name: 'A', spec: { filters: [] } }, { id: 'b', name: 'B', spec: { filters: [] } }, { id: 'c', name: 'C', spec: { filters: [] } }]
const by = m => id => m[id]

test('the first screen with enough matches wins', () => {
  expect(LANDING_MIN_MATCHES).toBe(10)
  expect(pickLanding(items, by({ a: 9, b: 10, c: 500 })).hit.id).toBe('b')
  expect(pickLanding(items, by({ a: 0, b: 3, c: 11 })).hit.id).toBe('c')
})
test('none with enough: the first pinned screen', () => {
  expect(pickLanding(items, by({ a: 9, b: 0, c: 1 })).hit.id).toBe('a')
})
test('a failed count is never enough, and is not waited on', () => {
  expect(pickLanding(items, by({ a: null, b: 12, c: 1 })).hit.id).toBe('b')
})
test('waits on an unanswered count before the winner, not after it', () => {
  expect(pickLanding(items, by({ a: 2, c: 50 }))).toEqual({ done: false })
  expect(pickLanding(items, by({ a: 20 })).hit.id).toBe('a')
})
test('once the wait is over, unanswered counts fall back to the first pinned', () => {
  expect(pickLanding(items, by({}), true).hit.id).toBe('a')
  expect(pickLanding(items, by({ b: 30 }), true).hit.id).toBe('b')
})
test('nothing pinned: done, nothing to apply', () => {
  expect(pickLanding([], by({}))).toEqual({ done: true, hit: null })
})
test('sameScreen compares id and spec', () => {
  expect(sameScreen(items[0], { ...items[0] })).toBe(true)
  expect(sameScreen(items[0], { ...items[0], spec: { filters: [{ key: 'x' }] } })).toBe(false)
  expect(sameScreen(items[0], items[1])).toBe(false)
})
beforeEach(() => localStorage.clear())
test('the seed round-trips and drops malformed entries', () => {
  writeLandingSeed('u1', [...items, { id: 'x' }])
  expect(readLandingSeed('u1').map(i => i.id)).toEqual(['a', 'b', 'c'])
  localStorage.setItem(landingSeedKey('u1'), '[1, null]')
  expect(readLandingSeed('u1')).toBeNull()
  localStorage.setItem(landingSeedKey('u1'), '{')
  expect(readLandingSeed('u1')).toBeNull()
})
test('the seed is per member, and there is none without a member', () => {
  writeLandingSeed('u1', items)
  expect(readLandingSeed('u2')).toBeNull()
  expect(readLandingSeed('u1').map(i => i.id)).toEqual(['a', 'b', 'c'])
  writeLandingSeed(undefined, items)
  writeLandingSeed('', items)
  expect(Object.keys(localStorage).filter(k => k.startsWith('uct.screener.landingSeed'))).toEqual([landingSeedKey('u1')])
  expect(readLandingSeed(undefined)).toBeNull()
})

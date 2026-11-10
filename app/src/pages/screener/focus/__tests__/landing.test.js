import { expect, test, beforeEach } from 'vitest'
import { defaultLanding, sameScreen, readLandingSeed, writeLandingSeed, landingSeedKey, readLastScreen, writeLastScreen, lastScreenKey, LAST_SCREEN_KEY } from '../landing'

const items = [{ id: 'a', name: 'A', spec: { filters: [] } }, { id: 'b', name: 'B', spec: { filters: [] } }, { id: 'c', name: 'C', spec: { filters: [] } }]

test('the default landing is the first pinned screen, whatever the counts would say', () => {
  expect(defaultLanding(items).id).toBe('a')
})
test('nothing pinned: no default', () => {
  expect(defaultLanding([])).toBeNull()
  expect(defaultLanding(null)).toBeNull()
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

test('the last-used screen round-trips per member, and there is none without a member', () => {
  writeLastScreen('u1', items[1])
  expect(readLastScreen('u1')).toMatchObject({ id: 'b', name: 'B' })
  expect(readLastScreen('u2')).toBeNull()
  writeLastScreen(undefined, items[0])
  expect(Object.keys(localStorage).filter(k => k.startsWith(LAST_SCREEN_KEY))).toEqual([lastScreenKey('u1')])
  expect(readLastScreen(undefined)).toBeNull()
})
test('a last-used entry that cannot be applied is treated as none', () => {
  localStorage.setItem(lastScreenKey('u1'), '{')
  expect(readLastScreen('u1')).toBeNull()
  localStorage.setItem(lastScreenKey('u1'), JSON.stringify({ id: 'x', name: 'X' }))
  expect(readLastScreen('u1')).toBeNull()
})

import { groupOf, migratePinned, DEFAULT_PINNED } from '../screenGroups'

const starters = [{ id: 'starter_momentum_leaders' }, { id: 'starter_uct_50' }, { id: 'x_new', group: 'Earnings' }]

test('server group wins, then fallback map, then momentum', () => {
  expect(groupOf({ id: 'x_new', group: 'Earnings' })).toBe('earnings')
  expect(groupOf({ id: 'starter_uct_50' })).toBe('momentum')
  expect(groupOf({ id: 'unknown' })).toBe('momentum')
})
test('pattern starters land in bases', () => {
  expect(groupOf({ id: 'p1', group: 'Chart Patterns' })).toBe('bases')
})
test('migration keeps favorites first, dedups, drops unknown ids', () => {
  expect(migratePinned({ favorites: ['starter_uct_50', 'gone'], chipPrefs: ['starter_momentum_leaders', 'starter_uct_50'], starters }))
    .toEqual(['starter_uct_50', 'starter_momentum_leaders'])
})
test('nothing to migrate gives the defaults that exist', () => {
  const out = migratePinned({ favorites: [], chipPrefs: [], starters: DEFAULT_PINNED.map(id => ({ id })) })
  expect(out).toEqual(DEFAULT_PINNED)
})

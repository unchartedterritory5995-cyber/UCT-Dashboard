// RS screens (unit U5), item 1: the picker. A `hidden` starter leaves the group lists and the
// search results but still resolves as a pinned screen; a member with no stored pins gets the RS
// screens first when the payload carries `starter_rs_leaders`.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
// Every spec map the menu asks counts for (the menu's own, and the presence probe's).
const lazy = vi.hoisted(() => ({ counts: {}, asked: [] }))
vi.mock('../useLazyCounts', () => ({ default: specs => { lazy.asked.push(specs); return lazy.counts } }))
import ScreenMenu from '../ScreenMenu'
import { migratePinned, defaultPinned, DEFAULT_PINNED, RS_DEFAULT_PINNED } from '../screenGroups'
import { STARTERS_ON, RS_STARTERS, HIDDEN_IDS, HIDDEN_STARTERS, PLAIN_STARTERS } from './rsScreensFixture'

const props = { currentName: 'UCT RS Leaders', currentId: 'starter_rs_leaders', count: 50, isEdited: false, starters: STARTERS_ON, saved: [],
  pinned: [], onTogglePin: vi.fn(), onApply: vi.fn(), onSaveChanges: null, onSaveAsNew: vi.fn(), onRename: null, onNewScreen: vi.fn(),
  myScans: [], onUseScan: vi.fn() }
const openMenu = (over = {}) => {
  render(<ScreenMenu {...props} {...over} />)
  fireEvent.click(screen.getByRole('button', { name: /Change screen/ }))
  return screen.getByRole('dialog', { name: 'Screens' })
}
const opened = dlg => within(dlg).getAllByRole('button', { name: /^Open / }).map(b => b.querySelector('span').textContent)

beforeEach(() => { vi.clearAllMocks(); lazy.counts = {}; lazy.asked = [] })

test('a hidden starter is not listed in any group, and the five RS screens keep the contract order', () => {
  const dlg = openMenu()
  const names = opened(dlg)
  for (const h of HIDDEN_STARTERS) expect(names).not.toContain(h.name)
  const rs = within(dlg).getByRole('region', { name: 'Relative strength' })
  expect(opened(rs)).toEqual(RS_STARTERS.map(s => s.name))
  // Momentum leaders still lists its own visible starter, without the hidden one.
  expect(opened(within(dlg).getByRole('region', { name: 'Momentum leaders' }))).toEqual(['Power plays'])
})

test('a hidden starter is not a search result', () => {
  const dlg = openMenu()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'quicksand' } })
  expect(within(dlg).queryAllByRole('button', { name: /^Open / })).toHaveLength(0)
  // Control: the same search finds a visible starter by its name.
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search screens' }), { target: { value: 'exit warnings' } })
  expect(opened(dlg)).toEqual(['RS exit warnings'])
})

test('a hidden starter the member pinned still shows under Pinned, and opens', () => {
  const dlg = openMenu({ pinned: ['starter_rs_quicksand_5'] })
  const pinned = within(dlg).getByRole('region', { name: 'Pinned' })
  expect(opened(pinned)).toEqual(['Quicksand in the last 5 sessions'])
  fireEvent.click(within(pinned).getByRole('button', { name: /^Open Quicksand/ }))
  expect(props.onApply).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ id: 'starter_rs_quicksand_5' }))
})

test('a hidden starter that is not listed is not counted either', () => {
  openMenu({ pinned: ['starter_rs_quicksand_5'] })
  const asked = [...new Set(lazy.asked.flatMap(m => Object.keys(m || {})))]
  expect(asked).toContain('starter_rs_quicksand_5')
  expect(asked).toContain('starter_rs_leaders')
  for (const id of HIDDEN_IDS.filter(x => x !== 'starter_rs_quicksand_5')) expect(asked).not.toContain(id)
})

test.each(['RSNHBP', 'blue dot', 'rs new high before price'])('searching "%s" finds RS New High Before Price by its alias', q => {
  const dlg = openMenu()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search screens' }), { target: { value: q } })
  expect(opened(dlg)).toEqual(['RS New High Before Price'])
})

test('a member with no stored pins gets the four RS screens, then the old defaults that are not hidden', () => {
  expect(migratePinned({ favorites: [], chipPrefs: [], starters: STARTERS_ON })).toEqual([
    'starter_rs_leaders', 'starter_rs_new_high', 'starter_rs_nh_before_price', 'starter_rs_top_rating',
    'starter_power_play', 'starter_tight_base', 'starter_three_weeks_tight'])
  expect(defaultPinned(STARTERS_ON).slice(0, 4)).toEqual(RS_DEFAULT_PINNED)
  // starter_momentum_leaders is in the payload but hidden: it leaves the defaults.
  expect(defaultPinned(STARTERS_ON)).not.toContain('starter_momentum_leaders')
})

test('without starter_rs_leaders in the payload the defaults are the old ones, hidden or not', () => {
  const noLeaders = STARTERS_ON.filter(s => s.id !== 'starter_rs_leaders')
  expect(migratePinned({ favorites: [], chipPrefs: [], starters: noLeaders }))
    .toEqual(['starter_momentum_leaders', 'starter_power_play', 'starter_tight_base', 'starter_three_weeks_tight'])
  expect(defaultPinned(DEFAULT_PINNED.map(id => ({ id })))).toEqual(DEFAULT_PINNED)
  expect(defaultPinned(PLAIN_STARTERS)).toEqual(['starter_power_play', 'starter_tight_base', 'starter_three_weeks_tight'])
})

test("a member's own favourites are never replaced by the new defaults, even a hidden one", () => {
  expect(migratePinned({ favorites: ['starter_momentum_leaders', 'starter_tight_base'], chipPrefs: [], starters: STARTERS_ON }))
    .toEqual(['starter_momentum_leaders', 'starter_tight_base'])
})

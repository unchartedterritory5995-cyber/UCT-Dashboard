// U6 (2026-11-07), review finding #12: the seven RS starters carry the server
// group "Relative strength" (`saved_screens.RS_STARTER_GROUP`). Before the fix
// that label was neither a GROUPS label nor a key, so `groupOf` fell back to
// 'momentum' and ScreenMenu filed all seven under "Momentum leaders".
// The Python rail tests/test_rs_fix_u6_screen_groups.py reads every server
// starter group and checks it against this file's GROUPS; this file checks the
// client half by behaviour.
import { expect, test } from 'vitest'
import { GROUPS, groupOf } from '../screenGroups'

const RS_IDS = ['starter_rs_new_high', 'starter_rs_nh_before_price', 'starter_rs_nh_red_day',
  'starter_rs_green_on_red', 'starter_rs_cross_up_21ema', 'starter_rs_mansfield_positive',
  'starter_rs_leaders_equal_weight']

test('the RS starters resolve to their own group, not the momentum fallback', () => {
  expect(GROUPS.some(g => g.key === 'relative_strength')).toBe(true)
  for (const id of RS_IDS) {
    expect(groupOf({ id, group: 'Relative strength' })).toBe('relative_strength')
  }
})

test('every GROUPS label resolves to its own key (no label falls through to the fallback)', () => {
  for (const g of GROUPS) {
    expect(groupOf({ id: 'x', group: g.label })).toBe(g.key)
    expect(groupOf({ id: 'x', group: g.label.toUpperCase() })).toBe(g.key)
  }
})

test('control: an unknown group still falls back to momentum, so the check above can fail', () => {
  expect(groupOf({ id: 'x', group: 'No such group' })).toBe('momentum')
})

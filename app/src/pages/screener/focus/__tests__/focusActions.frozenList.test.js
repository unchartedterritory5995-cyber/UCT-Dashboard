import { vi, expect, test } from 'vitest'
const promote = vi.hoisted(() => ({ out: null }))
vi.mock('../../shell/promoteApi', () => ({ promoteAvailable: vi.fn(), promoteScreen: vi.fn(async () => promote.out) }))
import { saveFrozenList } from '../focusActions'

const ranked = { filters: [], rank: { criteria: [{ key: 'uct_composite', weight: 1 }], top_n: 50 } }
test('a ranked screen saved as a list names the top_n it showed, never the eligible total', async () => {
  promote.out = { truncated: true, taken: 50, matched: 380, added: 50 }
  expect(await saveFrozenList(ranked, 'UCT 50')).toBe('Saved "UCT 50" with 50 names')
})
test('a capped list still says how many it left out when the cap is below what the screen shows', async () => {
  promote.out = { truncated: true, taken: 200, matched: 380, added: 200 }
  expect(await saveFrozenList({ filters: [] }, 'Leaders')).toBe('Saved "Leaders" with the first 200 of 380 matches')
})

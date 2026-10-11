import { describe, it, expect } from 'vitest'
import { groupConversations, whenShort, groupHits } from './historyGroups'

const now = new Date(2026, 9, 10, 23, 0).getTime()
const sec = (y, m, d, h = 12) => new Date(y, m, d, h).getTime() / 1000

describe('History grouping', () => {
  it('pinned first, then Today / Yesterday / Previous 7 / Previous 30 / Older; empty groups hidden', () => {
    const list = [
      { id: 'p', updated_at: sec(2026, 0, 1), pinned_at: 1 },
      { id: 't', updated_at: sec(2026, 9, 10) },
      { id: 'y', updated_at: sec(2026, 9, 9) },
      { id: 'w', updated_at: sec(2026, 9, 5) },
      { id: 'm', updated_at: sec(2026, 8, 20) },
      { id: 'o', updated_at: sec(2026, 5, 1) },
    ]
    expect(groupConversations(list, now).map(g => [g.label, g.items.map(c => c.id)])).toEqual([
      ['Pinned', ['p']], ['Today', ['t']], ['Yesterday', ['y']], ['Previous 7 days', ['w']], ['Previous 30 days', ['m']], ['Older', ['o']],
    ])
    expect(groupConversations([{ id: 't', updated_at: sec(2026, 9, 10) }], now).map(g => g.label)).toEqual(['Today'])
  })
  it('short when: time today, "Yesterday", weekday this week, else the date', () => {
    expect(whenShort(sec(2026, 9, 9), now)).toBe('Yesterday')
    expect(whenShort(sec(2026, 9, 6), now)).toBe(new Date(2026, 9, 6, 12).toLocaleDateString([], { weekday: 'short' }))
    expect(whenShort(sec(2026, 5, 1), now)).toBe(new Date(2026, 5, 1, 12).toLocaleDateString())
  })
  it('search hits sit under their conversation, in the order they came', () => {
    const g = groupHits([{ conversation_id: 'a', title: 'A', id: 3 }, { conversation_id: 'b', title: 'B', id: 2 }, { conversation_id: 'a', title: 'A', id: 1 }])
    expect(g.map(x => [x.id, x.hits.map(h => h.id)])).toEqual([['a', [3, 1]], ['b', [2]]])
  })
})

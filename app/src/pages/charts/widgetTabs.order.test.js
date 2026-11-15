import { describe, it, expect } from 'vitest'
import { orderedWidgetTabList, moveWidgetTab, closeWidgetTab, addWidgetTab } from './widgetTabs'

const base = { id: 'w1', type: 'themes', color: 'A', opts: {}, wtabs: [
  { id: 't1', type: 'watchlist', color: 'A', opts: {} },
  { id: 't2', type: 'notebook', color: 'A', opts: {} },
], activeWtab: 0 }
const ids = (w) => orderedWidgetTabList(w).map(t => t.id)

describe('widget tab strip order (owner 11-14: right-click → Move left / right)', () => {
  it('no order → storage order, each tab carrying its storage index', () => {
    expect(orderedWidgetTabList(base).map(t => [t.id, t.index])).toEqual([['__main__', 0], ['t1', 1], ['t2', 2]])
  })
  it('moves a tab one step and only touches wtabOrder (storage + identity unchanged)', () => {
    const w = moveWidgetTab(base, 't2', -1)
    expect(ids(w)).toEqual(['__main__', 't2', 't1'])
    expect(w.wtabs).toBe(base.wtabs)
    expect(orderedWidgetTabList(w).find(t => t.id === 't2').index).toBe(2)
  })
  it('the base tab can move too', () => {
    expect(ids(moveWidgetTab(base, '__main__', 1))).toEqual(['t1', '__main__', 't2'])
  })
  it('is a no-op at either end', () => {
    expect(moveWidgetTab(base, '__main__', -1)).toBe(base)
    expect(moveWidgetTab(base, 't2', 1)).toBe(base)
  })
  it('a new tab lands at the end; closing prunes the order; the last close clears it', () => {
    let w = moveWidgetTab(base, 't2', -1)
    w = addWidgetTab(w, { type: 'news' })
    expect(ids(w).slice(0, 3)).toEqual(['__main__', 't2', 't1'])
    w = closeWidgetTab(w, 't1')
    expect(w.wtabOrder).not.toContain('t1')
    w = closeWidgetTab(closeWidgetTab(w, 't2'), w.wtabs.find(t => t.type === 'news').id)
    expect(w.wtabOrder).toBeUndefined()
    expect(w.wtabs).toBeUndefined()
  })
})

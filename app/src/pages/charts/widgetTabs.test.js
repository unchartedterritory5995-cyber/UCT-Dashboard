import { describe, it, expect } from 'vitest'
import {
  sanitizeWidgetTabs, widgetTabList, resolveActiveTab, tabLabel,
  addWidgetTab, closeWidgetTab, setActiveWidgetTab, renameWidgetTab,
  patchActiveTabColor, patchActiveTabOpts,
} from './widgetTabs'

const base = { id: 'w1', type: 'profile', color: 'A', x: 0, y: 0, w: 6, h: 12, opts: { foo: 1 } }

describe('widgetTabs — backward compatibility', () => {
  it('a tab-less widget resolves to its base type/color/opts', () => {
    const a = resolveActiveTab(base)
    expect(a).toMatchObject({ isMain: true, index: 0, type: 'profile', color: 'A' })
    expect(a.opts).toEqual({ foo: 1 })
  })

  it('sanitize tolerates missing/garbage tab state', () => {
    expect(sanitizeWidgetTabs(base)).toEqual({ tabs: [], active: 0 })
    expect(sanitizeWidgetTabs({ ...base, wtabs: 'nope', activeWtab: 9 })).toEqual({ tabs: [], active: 0 })
  })

  it('tab list is just the base tab when there are no extras', () => {
    const list = widgetTabList(base)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ isMain: true, type: 'profile' })
  })
})

describe('widgetTabs — add / select / close', () => {
  it('adds an extra tab of a different type and activates it', () => {
    const next = addWidgetTab(base, { type: 'news', color: 'A' })
    expect(next.wtabs).toHaveLength(1)
    expect(next.wtabs[0]).toMatchObject({ type: 'news', color: 'A' })
    expect(next.activeWtab).toBe(1)
    // Base geometry + base type untouched.
    expect(next).toMatchObject({ type: 'profile', x: 0, w: 6 })
    const a = resolveActiveTab(next)
    expect(a).toMatchObject({ isMain: false, index: 1, type: 'news' })
  })

  it('closing the LAST extra tab drops wtabs/activeWtab entirely (clean shape)', () => {
    const withTab = addWidgetTab(base, { type: 'news' })
    const closed = closeWidgetTab(withTab, withTab.wtabs[0].id)
    expect(closed).not.toHaveProperty('wtabs')
    expect(closed).not.toHaveProperty('activeWtab')
    expect(resolveActiveTab(closed).isMain).toBe(true)
  })

  it('closing a middle tab shifts the active pointer to a neighbor', () => {
    let w = addWidgetTab(base, { type: 'news' })    // active -> 1
    w = addWidgetTab(w, { type: 'chart' })          // active -> 2
    const firstExtraId = w.wtabs[0].id
    w = setActiveWidgetTab(w, 1)                     // select the news tab
    w = closeWidgetTab(w, firstExtraId)             // close it
    expect(w.wtabs).toHaveLength(1)
    expect(w.wtabs[0].type).toBe('chart')
    expect(w.activeWtab).toBe(0)                    // fell back to a valid neighbor
  })
})

describe('widgetTabs — labels', () => {
  it('watchlist tab shows the selected list name, or "Flagged" for the flagged list', () => {
    expect(tabLabel('watchlist', { watchName: 'AI Leaders' })).toBe('AI Leaders')
    expect(tabLabel('watchlist', { watchKey: 'flagged', watchName: 'Flagged (Blake Bracco)' })).toBe('Flagged')
    expect(tabLabel('watchlist', {})).toBe('Watchlist')
    expect(tabLabel('news', {})).toBe('News')
  })

  it('a custom (renamed) name always wins over the auto label', () => {
    expect(tabLabel('watchlist', { watchName: 'AI Leaders' }, 'My Tab')).toBe('My Tab')
  })

  it('widgetTabList reflects the watchlist auto-name for the base tab', () => {
    const w = { id: 'w1', type: 'watchlist', color: 'A', opts: { watchKey: 'user:5', watchName: 'Momentum' } }
    expect(widgetTabList(w)[0].label).toBe('Momentum')
  })
})

describe('widgetTabs — rename', () => {
  it('renames the base tab via mainTabName and clears on blank', () => {
    const named = renameWidgetTab(base, '__main__', 'Dossier')
    expect(named.mainTabName).toBe('Dossier')
    expect(widgetTabList(named)[0].label).toBe('Dossier')
    expect(renameWidgetTab(named, '__main__', '  ')).not.toHaveProperty('mainTabName')
  })

  it('renames an extra tab and the label follows', () => {
    const w = addWidgetTab(base, { type: 'news' })
    const id = w.wtabs[0].id
    const renamed = renameWidgetTab(w, id, 'Headlines')
    expect(renamed.wtabs[0].name).toBe('Headlines')
    expect(widgetTabList(renamed)[1].label).toBe('Headlines')
  })
})

describe('widgetTabs — per-active-tab color/opts routing', () => {
  it('patches the BASE widget when the base tab is active', () => {
    expect(patchActiveTabColor(base, 'B')).toMatchObject({ color: 'B' })
    expect(patchActiveTabOpts(base, { foo: 2 }).opts).toEqual({ foo: 2 })
  })

  it('patches only the EXTRA tab when an extra tab is active', () => {
    const w = addWidgetTab(base, { type: 'news', color: 'A' }) // active extra tab
    const recolored = patchActiveTabColor(w, 'C')
    expect(recolored.color).toBe('A')                          // base untouched
    expect(recolored.wtabs[0].color).toBe('C')                // extra changed
    const reopt = patchActiveTabOpts(w, { filter: 'up' })
    expect(reopt.opts).toEqual({ foo: 1 })                     // base opts untouched
    expect(reopt.wtabs[0].opts).toEqual({ filter: 'up' })
  })
})

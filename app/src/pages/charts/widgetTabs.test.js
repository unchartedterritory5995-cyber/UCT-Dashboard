import { describe, it, expect } from 'vitest'
import {
  sanitizeWidgetTabs, widgetTabList, resolveActiveTab,
  addWidgetTab, closeWidgetTab, setActiveWidgetTab,
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

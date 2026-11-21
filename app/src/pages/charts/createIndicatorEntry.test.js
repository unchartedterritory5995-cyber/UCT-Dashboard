// app/src/pages/charts/createIndicatorEntry.test.js
//
// Which chart the top bar's "Create indicator" opens on, and what the member is told when it cannot.
// Pure functions over plain values: no chart, no workspace, no clock.
import { describe, it, expect, vi } from 'vitest'
import { chartForCreateIndicator, openCreateIndicatorOn, CREATE_INDICATOR_ENTRY_MESSAGES } from './createIndicatorEntry'

/** A registered chart as the workspace holds it: `agent.read()` answers its saved widget id. */
const chart = (chartId, open = () => ({ ok: true })) => ({ agent: { read: () => ({ chartId }), openCreateIndicator: open } })
/** A Multi Chart cell registers an `agent` with NO opener. */
const cell = (chartId) => ({ agent: { read: () => ({ chartId }) } })
const board = (...rows) => new Map(rows)
const at = (id, x, y) => ({ id, x, y })

describe('which chart the top bar opens the builder on', () => {
  const left = chart('w-left'); const right = chart('w-right'); const below = chart('w-below')
  const apiById = board(['m3', below], ['m2', right], ['m1', left])           // mount order is NOT reading order
  const widgets = [at('w-left', 0, 0), at('w-right', 12, 0), at('w-below', 0, 10)]

  it('the chart last CLICKED wins over the one last hovered', () => {
    expect(chartForCreateIndicator({ apiById, widgets, selectedWidgetId: 'w-below', activeId: 'm2' })).toBe(below)
  })

  it('with nothing clicked, the chart the member is on', () => {
    expect(chartForCreateIndicator({ apiById, widgets, selectedWidgetId: null, activeId: 'm2' })).toBe(right)
  })

  it('with neither, the first chart in reading order (top row first, then left to right), never mount order', () => {
    expect(chartForCreateIndicator({ apiById, widgets })).toBe(left)
    expect(chartForCreateIndicator({ apiById: board(['m2', right], ['m3', below]), widgets })).toBe(right)
  })

  it('a clicked chart that has left the board, or a hovered id that is gone, falls through to the next rule', () => {
    expect(chartForCreateIndicator({ apiById, widgets, selectedWidgetId: 'w-removed', activeId: 'm2' })).toBe(right)
    expect(chartForCreateIndicator({ apiById, widgets, selectedWidgetId: 'w-removed', activeId: 'm-gone' })).toBe(left)
  })

  it('a chart that cannot open the builder is never chosen, even when it was clicked or hovered', () => {
    const withCell = board(['c1', cell('w-cell')], ['m1', left])
    expect(chartForCreateIndicator({ apiById: withCell, widgets, selectedWidgetId: 'w-cell', activeId: 'c1' })).toBe(left)
    expect(chartForCreateIndicator({ apiById: board(['c1', cell('w-cell')]), widgets })).toBeNull()
  })

  it('a chart the board does not place (a floating one) comes after the placed ones, in a stable order', () => {
    const floating = chart('w-float')
    expect(chartForCreateIndicator({ apiById: board(['f', floating], ['m2', right]), widgets })).toBe(right)
    const a = chart('w-a'); const b = chart('w-b')
    expect(chartForCreateIndicator({ apiById: board(['x', a], ['y', b]), widgets: [] })).toBe(a)   // registration order, every time
  })

  it('no chart on the board, or nothing to look in, answers null and never throws', () => {
    for (const apiById0 of [new Map(), null, undefined, {}, board(['m', null]), board(['m', {}])]) {
      expect(chartForCreateIndicator({ apiById: apiById0, widgets })).toBeNull()
    }
    expect(chartForCreateIndicator()).toBeNull()
    const throwing = { agent: { read: () => { throw new Error('gone') }, openCreateIndicator: () => ({ ok: true }) } }
    expect(chartForCreateIndicator({ apiById: board(['m', throwing]), widgets, selectedWidgetId: 'w-left' })).toBe(throwing)
  })
})

describe('asking that chart to open the builder', () => {
  it('opens with no seed and no definition, once, and says ok', () => {
    const open = vi.fn(() => ({ ok: true, prefilled: false, draft: false, editing: false }))
    expect(openCreateIndicatorOn(chart('w', open))).toEqual({ ok: true })
    expect(open.mock.calls).toEqual([[null]])
  })

  it('every way it can fail is one plain sentence, by reason', () => {
    const M = CREATE_INDICATOR_ENTRY_MESSAGES
    expect(openCreateIndicatorOn(null)).toEqual({ ok: false, reason: 'no-chart', message: M['no-chart'] })
    expect(openCreateIndicatorOn(cell('w'))).toEqual({ ok: false, reason: 'no-chart', message: M['no-chart'] })
    expect(openCreateIndicatorOn(chart('w', () => ({ ok: false, reason: 'access' })))).toEqual({ ok: false, reason: 'access', message: M.access })
    expect(openCreateIndicatorOn(chart('w', () => ({ ok: false, reason: 'readonly' })))).toEqual({ ok: false, reason: 'readonly', message: M.readonly })
    // anything else the chart says, nothing at all, or a throw: "not reachable right now", never a blank and never a crash
    for (const open of [() => ({ ok: false, reason: 'unavailable' }), () => ({ ok: false, reason: 'something-new' }), () => null, () => undefined,
      () => ({ ok: 'yes' }), () => { throw new Error('chart unmounted') }]) {
      expect(openCreateIndicatorOn(chart('w', open))).toEqual({ ok: false, reason: 'unavailable', message: M.unavailable })
    }
  })

  it('the sentences are whole, differ from each other, and name the feature the way the button does', () => {
    const all = Object.values(CREATE_INDICATOR_ENTRY_MESSAGES)
    expect(new Set(all).size).toBe(all.length)
    for (const s of all) {
      expect(s).toMatch(/Create indicator/)
      expect(s.trim().endsWith('.')).toBe(true)
    }
    expect(Object.isFrozen(CREATE_INDICATOR_ENTRY_MESSAGES)).toBe(true)
  })
})

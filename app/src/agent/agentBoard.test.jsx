// BATCH 5 — arranging and configuring the widgets on the board (capabilities/board.js) and
// saving into the open layout (layout.saveCurrent). The host below is the REAL widget source
// (agent/host.js) over a board that uses the product's own geometry: repackAroundMoved (the
// drop), the registry's min sizes, themeAllChartWidgets, and an applyBoard that does exactly
// what ChartsWorkspace's does (remove / set / restore, then clamp).
import { describe, it, expect } from 'vitest'
import { registerBuiltins } from './builtins'
import { getCapability, shapeError } from './capabilities'
import { planOps, collectTargets, prepareOps } from './executor'
import { decideMode } from './policy'
import { commitPlan, undoEntry } from './runtime'
import { fastParse } from './fastPath'
import { buildWidgetSource } from './host'
import { boardProblems } from '../pages/charts/placement/arrange'
import { repackAroundMoved } from '../pages/charts/ChartsWorkspace'
import { WIDGET_REGISTRY } from '../widgets/registry'
import { themeAllChartWidgets, CHART_THEME_BY_ID, CHART_THEMES } from '../components/chart/chartThemes'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { makeBoard } from './__fixtures__/board'

registerBuiltins()
const CTX = { surface: 'charts' }
const COLS = 24, ROWS = 20
const minOf = (w) => ({ minW: WIDGET_REGISTRY[w?.type]?.defaults?.minW || 2, minH: WIDGET_REGISTRY[w?.type]?.defaults?.minH || 3 })

function boardHost(widgets, { lists = [], extraGroups = false, detached = [] } = {}) {
  const state = { widgets: widgets.map(w => ({ color: 'A', opts: {}, ...w })), layoutTheme: undefined, writes: 0 }
  const widgetOps = {
    layout: () => state,
    grid: () => ({ cols: COLS, rows: ROWS }),
    minOf,
    repack: (ws, id, rect) => repackAroundMoved(ws, id, rect, COLS, ROWS),
    themeAll: (ws, themeId) => themeAllChartWidgets(ws, CHART_THEME_BY_ID[themeId], mergeChartSettings(null)),
    applyBoard: (p) => {
      state.writes += 1
      let ws = state.widgets.filter(w => !(p.remove || []).includes(w.id)).map(w => (p.set?.[w.id] ? { ...w, ...p.set[w.id] } : w))
      for (const r of p.restore || []) if (!ws.some(w => w.id === r.id)) ws.push(r)
      state.widgets = ws
      if ('layoutTheme' in p) state.layoutTheme = p.layoutTheme ?? undefined
    },
    groupSyms: () => ({}),
    extraGroups: () => extraGroups,
  }
  return {
    state,
    // the workspace's VISIBLE board leaves floating / popped widgets out (ChartsWorkspace visibleWidgets)
    widgets: buildWidgetSource({ widgetOps, getWidgets: () => state.widgets.filter(w => !detached.includes(w.id)) }),
    watchlists: { snapshot: () => lists.map(l => ({ ...l, items: [], shownIn: [] })) },
    manual(id, patch) { state.widgets = state.widgets.map(w => (w.id === id ? { ...w, ...patch } : w)) },
  }
}
const QUAD = [
  { id: 'tl', type: 'chart', x: 0, y: 0, w: 12, h: 10 }, { id: 'tr', type: 'chart', x: 12, y: 0, w: 12, h: 10 },
  { id: 'bl', type: 'chart', x: 0, y: 10, w: 12, h: 10 }, { id: 'br', type: 'chart', x: 12, y: 10, w: 12, h: 10 },
]
const op = (action, args) => ({ action, target: 'board', args })
async function plan(host, ops) {
  const env = await prepareOps(ops)
  return { p: planOps(collectTargets(host, ['board']), ops, env, CTX), env }
}
const valid = (host) => boardProblems(host.state.widgets, COLS, ROWS, minOf)

describe('widget.remove + widget.arrange — one plan, one board write, one exact Undo', () => {
  it('"remove the bottom-right chart and make the remaining charts fill the space"', async () => {
    const host = boardHost(QUAD)
    const { p, env } = await plan(host, [op('widget.remove', { widget: 'br' }), op('widget.arrange', { widgets: ['tl', 'tr', 'bl'], pattern: 'fill' })])
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Removed the Chart (bottom-right)', 'Grew 1 widget to fill the empty space'])
    expect(decideMode('apply', p)).toBe('apply')                 // ONE target, reversible
    const res = await commitPlan(host, p, { env })
    expect(res.ok).toBe(true)
    expect(host.state.writes).toBe(1)
    expect(host.state.widgets.map(w => w.id).sort()).toEqual(['bl', 'tl', 'tr'])
    expect(valid(host)).toEqual([])
    const covered = host.state.widgets.reduce((n, w) => n + w.w * w.h, 0)
    expect(covered).toBe(COLS * ROWS)                            // no hole left
    // Undo: the removed chart comes back EXACTLY, and the grown one shrinks back.
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.state.widgets.find(w => w.id === 'br')).toMatchObject(QUAD[3])
    for (const q of QUAD) expect(host.state.widgets.find(w => w.id === q.id)).toMatchObject(q)
  })
  it('removing TWO widgets is proposed first; an unknown widget id is refused (never guessed)', async () => {
    const host = boardHost(QUAD)
    const { p } = await plan(host, [op('widget.remove', { widget: 'br' }), op('widget.remove', { widget: 'bl' })])
    expect(decideMode('apply', p)).toBe('propose')
    expect((await plan(host, [op('widget.remove', { widget: 'nope' })])).p.refusals[0].reason).toMatch(/no widget “nope”/)
  })
  it('STALE Undo: a widget this change touched was moved by hand afterwards → Undo refuses, nothing reverted', async () => {
    const host = boardHost(QUAD)
    const { p, env } = await plan(host, [op('widget.remove', { widget: 'br' }), op('widget.arrange', { widgets: null, pattern: 'fill' })])
    const res = await commitPlan(host, p, { env })
    const grown = host.state.widgets.find(w => w.h === 20 || w.w === 24)
    host.manual(grown.id, { h: 12 })
    const before = JSON.stringify(host.state.widgets)
    const u = await undoEntry(host, res.undo)
    expect(u.ok).toBe(false)
    expect(JSON.stringify(host.state.widgets)).toBe(before)
  })
  it('grid / columns tile evenly and never overlap; a pattern that would shrink a widget below its minimum is refused', async () => {
    for (const pattern of ['grid', 'columns']) {
      const host = boardHost(QUAD)
      const { p, env } = await plan(host, [op('widget.arrange', { widgets: null, pattern })])
      expect(p.ok, pattern).toBe(true)
      await commitPlan(host, p, { env })
      expect(valid(host), pattern).toEqual([])
    }
    // four charts stacked as rows would each be 5 rows tall — a chart's minimum is 6
    const host = boardHost(QUAD)
    const { p } = await plan(host, [op('widget.arrange', { widgets: null, pattern: 'rows' })])
    expect(p.refusals[0].reason).toMatch(/isn't room to tile them as rows/)
    expect(host.state.writes).toBe(0)
  })
})

describe('widget.move — a DROP through the product\'s own repack', () => {
  const BOARD = [{ id: 'c1', type: 'chart', x: 0, y: 0, w: 18, h: 20 }, { id: 'wl', type: 'watchlist', x: 18, y: 0, w: 6, h: 20 }]
  it('"move my watchlist to the left and make it narrower": lands at x 0, the chart re-tiles, nothing overlaps; Undo restores both', async () => {
    const host = boardHost(BOARD)
    const minW = minOf({ type: 'watchlist' }).minW
    const { p, env } = await plan(host, [op('widget.move', { widget: 'wl', x: 0, y: 0, w: Math.max(minW, 5), h: null })])
    expect(p.ok).toBe(true)
    expect(p.lines[0]).toMatch(/^Moved and resized the Watchlist .*\(1 other widget re-tiled around it\)/)
    const res = await commitPlan(host, p, { env })
    expect(host.state.widgets.find(w => w.id === 'wl')).toMatchObject({ x: 0, y: 0, w: Math.max(minW, 5) })
    expect(valid(host)).toEqual([])
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    for (const b of BOARD) expect(host.state.widgets.find(w => w.id === b.id)).toMatchObject(b)
  })
  it('outside the board or below the widget\'s minimum size → refused before anything is written', async () => {
    const host = boardHost(BOARD)
    expect((await plan(host, [op('widget.move', { widget: 'wl', x: 22, y: 0, w: 6, h: null })])).p.refusals[0].reason).toMatch(/doesn't fit the board/)
    expect((await plan(host, [op('widget.move', { widget: 'wl', x: 0, y: 0, w: 1, h: null })])).p.refusals[0].reason).toMatch(/can't be smaller than/)
    expect(host.state.writes).toBe(0)
  })
})

describe('widget.setLink / showList / showScan — exactly what the widget\'s own controls write', () => {
  it('"link these two charts using the same color"', async () => {
    const host = boardHost([{ id: 'a', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A' }, { id: 'b', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'N' }])
    const { p, env } = await plan(host, [op('widget.setLink', { widget: 'b', color: 'A' })])
    expect(p.lines).toEqual(['Linked the Chart (right) to the gold group (A)'])
    await commitPlan(host, p, { env })
    expect(host.state.widgets.find(w => w.id === 'b').color).toBe('A')
  })
  it('link colours E–H follow CHARTS_EXTRA_GROUPS_ENABLED exactly as the colour dot does: refused while off, written while on', async () => {
    const two = [{ id: 'a', type: 'chart', x: 0, y: 0, w: 12, h: 20, color: 'A' }, { id: 'b', type: 'chart', x: 12, y: 0, w: 12, h: 20, color: 'N' }]
    const off = boardHost(two)
    expect((await plan(off, [op('widget.setLink', { widget: 'b', color: 'E' })])).p.refusals[0].reason).toMatch(/E–H aren't switched on.*A, B, C, D/)
    expect(off.state.writes).toBe(0)
    const on = boardHost(two, { extraGroups: true })
    const { p, env } = await plan(on, [op('widget.setLink', { widget: 'b', color: 'H' })])

    expect(p.lines).toEqual(['Linked the Chart (right) to the pink group (H)'])
    await commitPlan(on, p, { env })
    expect(on.state.widgets.find(w => w.id === 'b').color).toBe('H')
    expect(shapeError('widget.setLink', { widget: 'b', color: 'Z' }, CTX)).toMatch(/isn't an option/)
  })
  it('a Watchlist widget shows one of your lists: the picker\'s exact opts (watchKey user:<id>, watchName, watchTab mine)', async () => {
    const host = boardHost([{ id: 'wl', type: 'watchlist', x: 0, y: 0, w: 6, h: 20, opts: { settings: { rowH: 'compact' } } }], { lists: [{ id: '7', name: 'Semiconductors' }] })
    const { p, env } = await plan(host, [op('widget.showList', { widget: 'wl', list: '7' })])
    expect(p.lines).toEqual(['The Watchlist now shows “Semiconductors”'])
    const res = await commitPlan(host, p, { env })
    expect(host.state.widgets[0].opts).toEqual({ settings: { rowH: 'compact' }, watchKey: 'user:7', watchName: 'Semiconductors', watchTab: 'mine' })
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.state.widgets[0].opts).toEqual({ settings: { rowH: 'compact' } })
    // not one of your lists, or a UCT-owned source → refused
    expect((await plan(host, [op('widget.showList', { widget: 'wl', list: '99' })])).p.refusals[0].reason).toMatch(/isn't one of your watchlists/)
    host.manual('wl', { opts: { source: { kind: 'breadthDrill' } } })
    expect((await plan(host, [op('widget.showList', { widget: 'wl', list: '7' })])).p.refusals[0].reason).toMatch(/chosen by UCT/)
  })
  it('a Scanner widget shows one of UCT\'s scans (the picker\'s scanKey/scanName)', async () => {
    const host = boardHost([{ id: 'sc', type: 'scanner', x: 0, y: 0, w: 8, h: 20 }])
    const key = getCapability('widget.showScan').args.properties.scan.enum[0]
    const { p, env } = await plan(host, [op('widget.showScan', { widget: 'sc', scan: key })])
    await commitPlan(host, p, { env })
    expect(host.state.widgets[0].opts.scanKey).toBe(key)
    expect(host.state.widgets[0].opts.scanName).toBeTruthy()
    expect((await plan(host, [op('widget.showScan', { widget: 'nope', scan: key })])).p.ok).toBe(false)
  })
})

describe('chart.applyThemeAll — the theme gallery\'s "all charts" result, with Undo', () => {
  it('every chart (and chart tab) gets the theme; the layout remembers it; Undo restores opts and the layout theme', async () => {
    const host = boardHost([...QUAD.slice(0, 2), { id: 'n', type: 'news', x: 0, y: 10, w: 24, h: 10 }])
    const theme = CHART_THEMES.find(t => t.id === 'cream') || CHART_THEMES[1]
    const expected = themeAllChartWidgets(host.state.widgets, theme, mergeChartSettings(null))
    const { p, env } = await plan(host, [op('chart.applyThemeAll', { theme: theme.id })])
    expect(p.lines[0]).toMatch(new RegExp(`Applied the ${theme.name} chart theme to all 2 charts`))
    const res = await commitPlan(host, p, { env })
    expect(host.state.widgets.map(w => w.opts)).toEqual(expected.widgets.map(w => w.opts))
    expect(host.state.layoutTheme).toEqual({ id: theme.id, scope: 'charts' })
    expect((await undoEntry(host, res.undo)).ok).toBe(true)
    expect(host.state.widgets.every(w => JSON.stringify(w.opts) === '{}')).toBe(true)
    expect(host.state.layoutTheme).toBe(undefined)
  })
})

describe('layout.saveCurrent — the Layouts ▾ menu\'s own save, own layouts only, always proposed', () => {
  const lib = (active, entries) => ({ entries, active, boards: {} })
  it('saves the board into the OPEN own layout (proposed first; no Undo)', async () => {
    const { host, state } = makeBoard([], { A: 'AAPL' }, { layouts: lib(5, [{ id: 5, name: 'Swing' }]) })
    const ops = [{ action: 'layout.saveCurrent', target: 'layouts', args: {} }]
    const p = planOps(collectTargets(host, ['layouts']), ops, {}, CTX)
    expect(p.ok).toBe(true)
    expect(p.lines).toEqual(['Saved the current board into your layout “Swing” (replaces its saved copy)'])
    expect(decideMode('apply', p)).toBe('propose')
    const res = await commitPlan(host, p)
    expect(res.ok).toBe(true)
    expect(res.undo).toBe(null)
    expect(state.layouts.calls).toContainEqual(['saveCurrent', 5])
  })
  it('a prebuilt or no open layout → refused with the save-as alternative; a failed save is reported, not claimed', async () => {
    const pre = makeBoard([], {}, { layouts: lib(9, [{ id: 9, name: 'UCT Swing', scope: 'global' }]) })
    expect(planOps(collectTargets(pre.host, ['layouts']), [{ action: 'layout.saveCurrent', target: 'layouts', args: {} }], {}, CTX).refusals[0].reason).toMatch(/can't be overwritten/)
    const none = makeBoard([], {}, { layouts: lib(null, [{ id: 5, name: 'Swing' }]) })
    expect(planOps(collectTargets(none.host, ['layouts']), [{ action: 'layout.saveCurrent', target: 'layouts', args: {} }], {}, CTX).refusals[0].reason).toMatch(/No saved layout is open/)
    const bad = makeBoard([], {}, { layouts: lib(5, [{ id: 5, name: 'Swing' }]) })
    bad.state.layouts.failSaveCurrent = 'failed'
    const p = planOps(collectTargets(bad.host, ['layouts']), [{ action: 'layout.saveCurrent', target: 'layouts', args: {} }], {}, CTX)
    const res = await commitPlan(bad.host, p)
    expect(res.ok).toBe(false)
  })
  it('fast path: "save these changes to my current layout"', () => {
    expect(fastParse('save these changes to my current layout').ops[0]).toEqual({ action: 'layout.saveCurrent', args: {} })
    expect(fastParse('Save this layout').ops[0].action).toBe('layout.saveCurrent')
  })
})

describe('floating / popped-out widgets are not on the grid — the Agent never re-tiles or edits them', () => {
  const BOARD3 = [{ id: 'c', type: 'chart', x: 0, y: 0, w: 12, h: 20 }, { id: 'wl', type: 'watchlist', x: 12, y: 0, w: 12, h: 20 }, { id: 'fl', type: 'scanner', x: 0, y: 0, w: 6, h: 8 }]
  it('move / arrange / resize wait while any widget floats; nothing is written', async () => {
    const host = boardHost(BOARD3, { detached: ['fl'] })
    for (const o of [op('widget.move', { widget: 'c', x: 12, y: 0, w: 12, h: null }), op('widget.arrange', { pattern: 'fill', widgets: null }), op('widget.resize', { widget: 'c', edge: 'right', by: 2 })]) {
      const r = (await plan(host, [o])).p
      expect(r.ok, o.action).toBe(false)
      expect(r.refusals[0].reason).toMatch(/floating or popped out right now — dock it back first/)
    }
    expect(host.state.writes).toBe(0)
  })
  it('an action aimed AT the floating widget refuses; one aimed at an on-grid widget still works', async () => {
    const host = boardHost(BOARD3, { detached: ['fl'] })
    expect((await plan(host, [op('widget.remove', { widget: 'fl' })])).p.refusals[0].reason).toMatch(/That widget is floating or popped out/)
    const { p } = await plan(host, [op('widget.setLink', { widget: 'wl', color: 'B' })])
    expect(p.ok).toBe(true)
  })
  it('with nothing detached, arranging works exactly as before', async () => {
    const host = boardHost(BOARD3.slice(0, 2))
    const rr = (await plan(host, [op('widget.move', { widget: 'wl', x: 0, y: 0, w: 12, h: null })])).p
    expect(rr.refusals || []).toEqual([])
    expect(rr.ok).toBe(true)
  })
})


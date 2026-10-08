// ── BOARD: arranging and configuring the widgets ALREADY on the Charts board (Batch 5) ──
//
// target kind 'board' — the visible board as ONE target, so several changes in one request
// (remove the bottom-right chart AND make the rest fill the space) are planned on one state
// and written ONCE, with one exact Undo.
//
// Every write goes through ChartsWorkspace's own board writer (host.widgets.applyBoard →
// setLayout + clampWidgetsToRows + the autosave), using the board's OWN geometry rules:
//   • widget.move    = a DROP: the product's repackAroundMoved (the moved widget lands where
//                      asked; every other widget re-tiles around it, as when you drag).
//   • widget.arrange = placement/arrange.js (fill gaps, or an even grid / columns / rows).
//   • chart.applyThemeAll = chartThemes.themeAllChartWidgets (the theme gallery's "all charts").
//   • widget.showList / showScan write exactly the opts the widget's own picker writes.
// Before ANY write the resulting board must pass boardProblems (inside the grid, min sizes,
// no overlap). Undo restores the exact widgets touched (a removed widget comes back with its
// id, geometry, link colour, settings and tabs) and refuses if any of them changed since.
//
// ⛔ Not here: floating / popping out / merging widgets (not persisted on the board), widget
// TABS (WidgetHost reducers), adding widgets (widget.add), and the extra link groups E–H.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { labelMap } from '../../widgets/registry'
import { boardProblems, fillGaps, tileWidgets, ARRANGE_PATTERNS } from '../../pages/charts/placement/arrange'
import { BASE_GROUPS, NOT_LINKED } from '../../pages/charts/colorGroups'
import { PRESET_SCANS } from '../../pages/charts/widgets/ScannerPicker'
import { CHART_THEMES, CHART_THEME_BY_ID } from '../../components/chart/chartThemes'
import { positionWord } from '../host'

const LABEL = labelMap('menu')
const label = (t) => LABEL[t] || t
const LINKS = [...BASE_GROUPS, NOT_LINKED]
const LINK_NAME = { A: 'gold', B: 'blue', C: 'green', D: 'purple', N: 'not linked' }
const SCAN_KEYS = PRESET_SCANS.map(s => s.key)
const GEOM = ['x', 'y', 'w', 'h']
const FIELDS = ['x', 'y', 'w', 'h', 'color', 'opts', 'wtabs', 'activeWtab']
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const clone = (o) => JSON.parse(JSON.stringify(o))
const intOk = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

function snapOf(host) {
  const s = host?.widgets?.snapshot?.()
  if (!s?.raw || !s.grid) return null
  // The member's own watchlists (id → name) for widget.showList — the same rows the watchlist
  // capabilities read; prebuilt, flagged and linked-copy lists are not offered there either.
  const lists = new Map((host?.watchlists?.snapshot?.() || []).map(l => [String(l.id), l.name]))
  return { ref: 'board', label: 'Board', raw: s.raw, layoutTheme: s.layoutTheme, grid: s.grid, minOf: s.minOf, repack: s.repack, themeAll: s.themeAll, lists }
}
const nameOf = (w, all) => {
  const pos = positionWord(w, all)
  return `${label(w.type)}${pos ? ` (${pos})` : ''}`
}
const changedIds = (before, after) => {
  const b = new Map(before.map(w => [w.id, w]))
  return after.filter(w => !b.has(w.id) || FIELDS.some(f => !same(w[f], b.get(w.id)[f]))).map(w => w.id)
}

export const boardKind = {
  name: 'board',
  list: (host) => { const s = snapOf(host); return s ? [s] : [] },
  read: (host, ref) => (ref === 'board' ? snapOf(host) : null),
  stateOf: (s) => ({ board: clone(s.raw), layoutTheme: s.layoutTheme ?? null, did: [] }),
  patch(before, after) {
    const removed = before.board.filter(w => !after.board.some(x => x.id === w.id)).map(w => w.id)
    const set = {}
    for (const w of after.board) {
      const o = before.board.find(x => x.id === w.id)
      if (!o) continue
      const d = {}
      for (const f of FIELDS) if (!same(w[f], o[f])) d[f] = w[f] === undefined ? null : clone(w[f])
      if (Object.keys(d).length) set[w.id] = d
    }
    const p = {}
    if (removed.length) p.remove = removed
    if (Object.keys(set).length) p.set = set
    if (!same(before.layoutTheme, after.layoutTheme)) p.layoutTheme = after.layoutTheme
    return Object.keys(p).length ? p : null
  },
  async commit(host, ref, patch) {
    host.widgets.applyBoard(patch)
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    const by = new Map(snap.raw.map(w => [w.id, w]))
    if ((patch.remove || []).some(id => by.has(id))) return false
    if ((patch.restore || []).some(w => !by.has(w.id))) return false
    for (const [id, d] of Object.entries(patch.set || {})) {
      const w = by.get(id)
      if (!w) return false
      for (const [f, v] of Object.entries(d)) if (!same(w[f] ?? null, v)) return false
    }
    if ('layoutTheme' in patch && !same(snap.layoutTheme ?? null, patch.layoutTheme ?? null)) return false
    return true
  },
  // Undo: the touched widgets exactly as they were — a removed one re-inserted whole.
  undoPatch(item) {
    const before = item.before?.raw || []           // the target's snapshot before the commit
    const p = item.patch || {}
    const out = {}
    const restore = before.filter(w => (p.remove || []).includes(w.id))
    if (restore.length) out.restore = clone(restore)
    const set = {}
    for (const id of Object.keys(p.set || {})) {
      const o = before.find(w => w.id === id)
      if (!o) continue
      set[id] = Object.fromEntries(Object.keys(p.set[id]).map(f => [f, o[f] === undefined ? null : clone(o[f])]))
    }
    if (Object.keys(set).length) out.set = set
    if ((p.restore || []).length) out.remove = p.restore.map(w => w.id)
    if ('layoutTheme' in p) out.layoutTheme = item.before?.layoutTheme ?? null
    return Object.keys(out).length ? out : null
  },
  fingerprint: (s) => JSON.stringify(s.raw.map(w => [w.id, ...GEOM.map(k => w[k]), w.color, JSON.stringify(w.opts ?? null)])),
  // Undo is stale only if a widget THIS change touched has changed since (or a removed one is back).
  fingerprintFor(host, s, item) {
    const p = item.patch || {}
    const ids = [...new Set([...(p.remove || []), ...Object.keys(p.set || {}), ...(p.restore || []).map(w => w.id)])]
    return JSON.stringify(ids.map(id => {
      const w = s.raw.find(x => x.id === id)
      return w ? [id, ...FIELDS.map(f => JSON.stringify(w[f] ?? null))] : [id, 'gone']
    }))
  },
}

// ── shared checks ──
function widgetOf(st, id) { return st.board.find(w => w.id === String(id)) || null }
function problemSentence(st, env, board) {
  const s = env?.target
  if (!s) return 'The board is not available.'
  const ps = boardProblems(board, s.grid.cols, s.grid.rows, s.minOf)
  if (!ps.length) return null
  const p = ps[0]
  const w = board.find(x => x.id === p.id)
  const nm = w ? label(w.type) : 'a widget'
  if (p.problem === 'outside') return `That would put the ${nm} outside the board (it is ${s.grid.cols} columns × ${s.grid.rows} rows).`
  if (p.problem === 'too-small') return `That would make the ${nm} smaller than it can be.`
  return `That would overlap the ${nm} with another widget.`
}
const notOnBoard = (id) => `There's no widget “${id}” on this board — use an id from the board entry.`

let registered = false
export function registerBoardCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(boardKind)
  registerContextProvider({
    key: 'board',
    build: (host, refFor) => {
      const s = snapOf(host)
      if (!s) return undefined
      return [{
        ref: refFor('board', 'board'),
        label: 'Board (arrange, remove, link and configure the widgets on it)',
        grid: s.grid,
        widgets: s.raw.map(w => ({
          id: w.id, type: w.type, label: label(w.type), position: positionWord(w, s.raw) || null,
          x: w.x, y: w.y, w: w.w, h: w.h, link: w.color || null,
          ...(w.type === 'watchlist' ? { shows: w.opts?.watchName || (w.opts?.source ? 'a list chosen by UCT' : null) } : {}),
          ...(w.type === 'scanner' ? { shows: w.opts?.scanName || null } : {}),
          ...(Array.isArray(w.wtabs) && w.wtabs.length ? { tabs: w.wtabs.length + 1 } : {}),
        })),
      }]
    },
  })

  const common = { target: 'board', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' }
  const widgetArg = { type: 'string' }

  registerCapability({
    ...common,
    name: 'widget.remove',
    summary: 'Remove a widget from the board (any type). Undo puts it back exactly — same place, size, link colour and settings. The space it leaves stays empty unless widget.arrange fills it.',
    hints: 'target = the ref of the board entry; widget = the id of the widget from the board entry\'s widgets. If several could be meant, clarify — never guess.',
    args: { type: 'object', properties: { widget: widgetArg }, required: ['widget'], additionalProperties: false },
    // Removing two or more widgets in one request is shown as a proposal first.
    confirmIf: (st) => st.did.some(d => d[0] === 'remove'),
    check: (st, { widget }) => (widgetOf(st, widget) ? null : notOnBoard(widget)),
    apply: (st, { widget }) => ({ ...st, board: st.board.filter(w => w.id !== String(widget)), did: [...st.did, ['remove', nameOf(widgetOf(st, widget), st.board)]] }),
    describe: (b, a) => {
      const gone = b.board.filter(w => !a.board.some(x => x.id === w.id))
      return gone.length ? `Removed ${gone.map(w => `the ${nameOf(w, b.board)}`).join(' and ')}` : null
    },
  })

  registerCapability({
    ...common,
    name: 'widget.move',
    summary: 'Move and/or resize ONE widget to a rectangle on the board grid, exactly like dropping it there: the other widgets re-tile around it.',
    hints: 'target = the ref of the board entry; widget = its id; x, y = the new top-left cell (columns from 0 at the left, rows from 0 at the top); '
      + 'w, h = the new width/height in cells, or null to keep the current size. The board entry gives the grid size and every widget\'s x/y/w/h. '
      + '"to the left" = x 0; "narrower" = smaller w; "full height" = y 0 and h = rows.',
    args: { type: 'object', properties: {
      widget: widgetArg, x: { type: 'integer' }, y: { type: 'integer' }, w: { type: ['integer', 'null'] }, h: { type: ['integer', 'null'] },
    }, required: ['widget', 'x', 'y', 'w', 'h'], additionalProperties: false },
    check(st, { widget, x, y, w, h }, env) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      const g = env?.target?.grid
      if (!g) return 'The board is not available.'
      const nw = w ?? t.w, nh = h ?? t.h
      if (!intOk(x, 0, g.cols - 1) || !intOk(y, 0, g.rows - 1) || !intOk(nw, 1, g.cols) || !intOk(nh, 1, g.rows) || x + nw > g.cols || y + nh > g.rows) {
        return `That rectangle doesn't fit the board (${g.cols} columns × ${g.rows} rows).`
      }
      const { minW, minH } = env.target.minOf(t)
      if (nw < minW || nh < minH) return `A ${label(t.type)} can't be smaller than ${minW} × ${minH} cells.`
      const next = env.target.repack(st.board, t.id, { x, y, w: nw, h: nh })
      if (!next) return 'The board could not place that.'
      return problemSentence(st, env, next)
    },
    apply(st, { widget, x, y, w, h }, env) {
      const t = widgetOf(st, widget)
      const rect = { x, y, w: w ?? t.w, h: h ?? t.h }
      if (GEOM.every(k => rect[k] === t[k])) return st
      return { ...st, board: env.target.repack(st.board, t.id, rect) }
    },
    describe(b, a, { widget }) {
      const t0 = b.board.find(w => w.id === String(widget)), t1 = a.board.find(w => w.id === String(widget))
      if (!t0 || !t1 || GEOM.every(k => t0[k] === t1[k])) return null
      const resized = t0.w !== t1.w || t0.h !== t1.h, moved = t0.x !== t1.x || t0.y !== t1.y
      const others = changedIds(b.board, a.board).filter(id => id !== t1.id).length
      return `${moved && resized ? 'Moved and resized' : moved ? 'Moved' : 'Resized'} the ${nameOf(t0, b.board)}${others ? ` (${others} other widget${others === 1 ? '' : 's'} re-tiled around it)` : ''}`
    },
    noop: () => 'It is already there',
  })

  registerCapability({
    ...common,
    name: 'widget.arrange',
    summary: 'Re-arrange widgets: "fill" grows them into the empty space around them (nothing else moves); "grid", "columns" or "rows" re-tile them evenly over the area they cover.',
    hints: 'target = the ref of the board entry; widgets = the ids to arrange, or null for every widget on the board; pattern = fill | grid | columns | rows. '
      + '"make the remaining charts fill the space" = fill on those charts (after a widget.remove in the same plan).',
    args: { type: 'object', properties: {
      widgets: { type: ['array', 'null'], items: { type: 'string' } }, pattern: { type: 'string', enum: ARRANGE_PATTERNS },
    }, required: ['widgets', 'pattern'], additionalProperties: false },
    check(st, { widgets, pattern }, env) {
      const s = env?.target
      if (!s) return 'The board is not available.'
      const ids = widgets ?? st.board.map(w => w.id)
      const missing = ids.find(id => !widgetOf(st, id))
      if (missing) return notOnBoard(missing)
      if (!ids.length) return 'There are no widgets to arrange.'
      if (pattern !== 'fill') {
        const rects = tileWidgets(st.board, ids.map(String), pattern, s.grid.cols, s.grid.rows)
        if (!rects) return `Those widgets can't be re-tiled as ${pattern} without moving other widgets — say which widgets, or use fill.`
        const next = st.board.map(w => (rects[w.id] ? { ...w, ...rects[w.id] } : w))
        const small = next.find(w => rects[w.id] && (w.w < s.minOf(w).minW || w.h < s.minOf(w).minH))
        if (small) return `There isn't room to tile them as ${pattern} — the ${label(small.type)} would be too small.`
        return problemSentence(st, env, next)
      }
      return null
    },
    apply(st, { widgets, pattern }, env) {
      const s = env.target
      const ids = (widgets ?? st.board.map(w => w.id)).map(String)
      const rects = pattern === 'fill' ? fillGaps(st.board, ids, s.grid.cols, s.grid.rows) : tileWidgets(st.board, ids, pattern, s.grid.cols, s.grid.rows)
      if (!rects || !Object.keys(rects).length) return st
      return { ...st, board: st.board.map(w => (rects[w.id] ? { ...w, ...rects[w.id] } : w)) }
    },
    describe(b, a, { pattern }) {
      const ids = changedIds(b.board, a.board).filter(id => a.board.some(w => w.id === id) && b.board.some(w => w.id === id))
      const moved = ids.filter(id => { const o = b.board.find(w => w.id === id), n = a.board.find(w => w.id === id); return GEOM.some(k => o[k] !== n[k]) })
      if (!moved.length) return null
      return pattern === 'fill' ? `Grew ${moved.length} widget${moved.length === 1 ? '' : 's'} to fill the empty space` : `Arranged ${moved.length} widgets as ${pattern}`
    },
    noop: (b, a, { pattern } = {}) => (pattern === 'fill' ? 'There was no empty space next to them to fill' : 'They are already arranged that way'),
  })

  registerCapability({
    ...common,
    name: 'widget.setLink',
    summary: 'Set a widget\'s link colour: widgets with the same colour follow the same symbol; N = not linked.',
    hints: `target = the ref of the board entry; widget = its id; color = ${LINKS.map(c => `${c} (${LINK_NAME[c]})`).join(', ')}. "Link these two charts" = give both the same colour (use one already on one of them).`,
    args: { type: 'object', properties: { widget: widgetArg, color: { type: 'string', enum: LINKS } }, required: ['widget', 'color'], additionalProperties: false },
    check(st, { widget, color }) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (!LINKS.includes(color)) return `Link colours are ${LINKS.join(', ')}.`
      if (Array.isArray(t.wtabs) && t.wtabs.length) return `The ${label(t.type)} has tabs — set the link colour on its tab with the colour dot.`
      return null
    },
    apply: (st, { widget, color }) => {
      const t = widgetOf(st, widget)
      return t.color === color ? st : { ...st, board: st.board.map(w => (w.id === t.id ? { ...w, color } : w)) }
    },
    describe(b, a, { widget }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      if (!o || !n || o.color === n.color) return null
      return n.color === NOT_LINKED ? `Unlinked the ${nameOf(o, b.board)}` : `Linked the ${nameOf(o, b.board)} to the ${LINK_NAME[n.color]} group (${n.color})`
    },
    noop: () => 'It already has that link colour',
  })

  registerCapability({
    ...common,
    name: 'widget.showList',
    summary: 'Make a Watchlist widget show one of the member\'s own watchlists (what picking it in the widget does).',
    hints: 'target = the ref of the board entry; widget = the id of a watchlist widget; list = the ref of the watchlist (from watchlists).',
    args: { type: 'object', properties: { widget: widgetArg, list: { type: 'string' } }, required: ['widget', 'list'], additionalProperties: false },
    argRefs: { list: 'watchlist' },
    check(st, { widget, list }, env) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (t.type !== 'watchlist') return `The ${label(t.type)} isn't a Watchlist widget.`
      if (t.opts?.source || t.opts?.listSub) return 'That watchlist widget shows a list chosen by UCT (or followed from another widget) — it can\'t be switched to a saved list.'
      if (!env?.target?.lists?.has(String(list))) return 'That isn\'t one of your watchlists.'
      return null
    },
    apply(st, { widget, list }, env) {
      const t = widgetOf(st, widget)
      const opts = { ...(t.opts || {}), watchKey: `user:${list}`, watchName: env.target.lists.get(String(list)), watchTab: 'mine' }
      return same(opts, t.opts) ? st : { ...st, board: st.board.map(w => (w.id === t.id ? { ...w, opts } : w)) }
    },
    describe(b, a, { widget }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o.opts, n.opts) ? `The ${nameOf(o, b.board)} now shows “${n.opts.watchName}”` : null
    },
    noop: () => 'It already shows that list',
  })

  registerCapability({
    ...common,
    name: 'widget.showScan',
    summary: 'Make a Scanner widget show one of UCT\'s scans (what picking it in the widget does).',
    hints: `target = the ref of the board entry; widget = the id of a scanner widget; scan = ${PRESET_SCANS.map(s => `${s.key} (${s.name})`).join(', ')}.`,
    args: { type: 'object', properties: { widget: widgetArg, scan: { type: 'string', enum: SCAN_KEYS } }, required: ['widget', 'scan'], additionalProperties: false },
    check(st, { widget, scan }) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (t.type !== 'scanner') return `The ${label(t.type)} isn't a Scanner widget.`
      if (!SCAN_KEYS.includes(scan)) return `UCT's scanner has no “${scan}” scan.`
      return null
    },
    apply(st, { widget, scan }) {
      const t = widgetOf(st, widget)
      const s = PRESET_SCANS.find(x => x.key === scan)
      const opts = { ...(t.opts || {}), scanKey: s.key, scanName: s.name }
      return same(opts, t.opts) ? st : { ...st, board: st.board.map(w => (w.id === t.id ? { ...w, opts } : w)) }
    },
    describe(b, a, { widget }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o.opts, n.opts) ? `The ${nameOf(o, b.board)} now shows the “${n.opts.scanName}” scan` : null
    },
    noop: () => 'It already shows that scan',
  })

  registerCapability({
    ...common,
    name: 'chart.applyThemeAll',
    summary: 'Apply one of UCT\'s chart themes to EVERY chart on the board (and chart tabs), exactly as the theme gallery\'s "all charts" does; new charts on this layout start with it.',
    hints: 'target = the ref of the board entry; theme = a chart theme id (the same ids as chart.applyTheme). For ONE chart use chart.applyTheme.',
    args: { type: 'object', properties: { theme: { type: 'string', enum: CHART_THEMES.map(t => t.id) } }, required: ['theme'], additionalProperties: false },
    check(st, { theme }, env) {
      if (!CHART_THEME_BY_ID[theme]) return `UCT has no chart theme “${theme}”.`
      if (!env?.target?.themeAll) return 'The board is not available.'
      return null
    },
    apply(st, { theme }, env) {
      const r = env.target.themeAll(st.board, theme)
      return r ? { ...st, board: r.widgets, layoutTheme: r.layoutTheme } : st
    },
    describe(b, a, { theme }) {
      const n = changedIds(b.board, a.board).length
      return `Applied the ${CHART_THEME_BY_ID[theme]?.name || theme} chart theme to ${n > 1 ? `all ${n} charts` : n === 1 ? 'the chart' : 'this layout'}`
    },
  })
}

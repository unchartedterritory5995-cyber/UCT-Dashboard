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
//   • chartGrid.set = agent/chartGrid.js (live test 2026-10-28): N tickers as N equal charts — the board's
//                      charts reused in reading order, the rest ADDED (born on their ticker, not linked), the
//                      charts' area re-tiled evenly; every other widget stays put, nothing is removed. ONE
//                      change, ONE exact Undo (new charts closed, cells, links, tickers and timeframes back).
//   • chart.applyThemeAll = chartThemes.themeAllChartWidgets (the theme gallery's "all charts").
//   • widget.showList / showScan write exactly the opts the widget's own picker writes.
// Before ANY write the resulting board must pass boardProblems (inside the grid, min sizes,
// no overlap). Undo restores the exact widgets touched (a removed widget comes back with its
// id, geometry, link colour, settings and tabs) and refuses if any of them changed since.
//
//   • watchlist.open = the product's ?openWatchlist= door (ChartsWorkspace): the board's first
//                      Watchlist widget is pointed at the list through its own opts; with none,
//                      ONE Watchlist widget is added carrying the list (handleAddWidget's seed
//                      opts) — only into empty space, never resizing anything. Undo puts the
//                      old list back, or closes the widget it added.
//
// ⛔ Not here: floating / popping out / merging widgets (not persisted on the board), widget
// TABS (WidgetHost reducers), adding widgets in general (widget.add), and the extra link groups E–H.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { afterRender } from '../frames'
import { lastCreatedList, resolveListByName } from './watchlist'
import { namesAnotherKind } from '../nl/collisions'
import { labelMap } from '../../widgets/registry'
import { boardProblems, fillGaps, tileWidgets, ARRANGE_PATTERNS } from '../../pages/charts/placement/arrange'
import { BASE_GROUPS, EXTRA_GROUPS, NOT_LINKED, isExtraGroup, linkGroups } from '../../pages/charts/colorGroups'
import { PRESET_SCANS } from '../../pages/charts/widgets/ScannerPicker'
import { CHART_THEMES, CHART_THEME_BY_ID } from '../../components/chart/chartThemes'
import { positionWord } from '../host'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { addChartTab, closeChartTab, setActiveChartTab, renameChartTab, patchChartTab, chartTabList, sanitizeChartTabs } from '../../pages/charts/chartTabs'
import { CHART_TIMEFRAMES } from './chart'
import { planChartGrid, GRID_PATTERNS, MAX_GRID_CHARTS } from '../chartGrid'
import { unknownSymbols } from '../agentClient'
import { widgetTabList, setActiveWidgetTab, renameWidgetTab, closeWidgetTab, sanitizeWidgetTabs, addWidgetTab, WIDGET_TAB_TYPES } from '../../pages/charts/widgetTabs'
// a slot holds a handful of widgets as tabs — the Agent stops adding at this many (the header scrolls beyond)
const MAX_WIDGET_TABS = 8

const LABEL = labelMap('menu')
const label = (t) => LABEL[t] || t
// E-H exist only while the extra-groups flag is on (the colour dot's own rule, colorGroups.linkGroups):
// always in the schema, refused by the check while the board says the flag is off.
const LINKS = [...BASE_GROUPS, ...EXTRA_GROUPS, NOT_LINKED]
const LINK_NAME = { A: 'gold', B: 'blue', C: 'green', D: 'purple', E: 'red', F: 'teal', G: 'orange', H: 'pink', N: 'not linked' }
const extraOff = (env, color) => (isExtraGroup(color) && env?.target?.extraGroups !== true
  ? `Link colours E–H aren't switched on in UCT for your account — use ${linkGroups(false).join(', ')}.` : null)
const SCAN_KEYS = PRESET_SCANS.map(s => s.key)
const GEOM = ['x', 'y', 'w', 'h']
const FIELDS = ['x', 'y', 'w', 'h', 'color', 'opts', 'wtabs', 'activeWtab', 'mainTabName']
// ⭐ acceptance 2026-10-29: a chart the GRID ADDED, as it draws — it stores no settings (it reads the defaults); the first
// indicator change writes them out in full and marks the style preset "custom", and that change's own Undo leaves both
// so. Nothing the member sees differs, and the grid's Undo removes the chart whole, so it is not stale for it ("open
// daily charts for …, each with RSI" → undo, undo, …: the board exactly as it was). A removed indicator's tombstone
// draws nothing either. A chart the grid REUSED keeps the exact comparison (its Undo keeps the chart).
function addedChartOpts(w) {
  const o = w?.opts ?? null
  if (!o || typeof o !== 'object' || w.type !== 'chart') return JSON.stringify(o)
  let cs = null
  try { cs = mergeChartSettings(o.settings == null ? null : (typeof o.settings === 'string' ? o.settings : JSON.stringify(o.settings))) } catch { return JSON.stringify(o) }
  const { preset, ...rest } = cs || {}                                    // eslint-disable-line no-unused-vars
  return JSON.stringify({ ...o, settings: { ...rest, indicatorInstances: (cs?.indicatorInstances || []).filter(i => i && !i.deleted) } })
}
// ⭐ PHASE 3: a chart the grid REUSED — its Undo writes back only the cell, the link, the ticker and the timeframe (opts.tf),
// never the chart's settings, so a later change to its settings (an indicator added and removed — whose own Undo leaves
// bookkeeping in the stored settings, see docs/agent/PHASE3-INDICATORS-HANDOFF.md) is no edit the grid's Undo would
// overwrite. Everything it DOES write is still compared exactly: a newer edit of any of those still refuses.
function reusedChartOpts(w) {
  const o = w?.opts ?? null
  if (!o || typeof o !== 'object' || w.type !== 'chart') return JSON.stringify(o)
  const { settings, ...rest } = o                                       // eslint-disable-line no-unused-vars
  return JSON.stringify(rest)
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const clone = (o) => JSON.parse(JSON.stringify(o))
const intOk = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi

function snapOf(host) {
  const s = host?.widgets?.snapshot?.()
  if (!s?.raw || !s.grid) return null
  // The member's own watchlists (id → name) for widget.showList — the same rows the watchlist
  // capabilities read; prebuilt, flagged and linked-copy lists are not offered there either.
  const lists = new Map((host?.watchlists?.snapshot?.() || []).map(l => [String(l.id), l.name]))
  // DETACHED widgets: floating or popped out (ChartsWorkspace floatingWidgetIds / poppedWidgetIds).
  // They stay in layout.widgets with their grid slot, but are not on the grid — the visible board
  // (host `visible`) leaves them out. Nothing here may re-tile or edit one it cannot see.
  const onGrid = new Set((s.visible || s.raw).map(w => String(w.id)))
  const detached = s.raw.filter(w => !onGrid.has(String(w.id))).map(w => String(w.id))
  return { ref: 'board', label: 'Board', raw: s.raw, layoutTheme: s.layoutTheme, grid: s.grid, minOf: s.minOf, repack: s.repack, resize: s.resize, themeAll: s.themeAll, extraGroups: s.extraGroups === true, lists, detached, fitsWatchlist: s.fits?.watchlist === true,
    charts: chartsOf(host), maxWidgets: s.max }
}
// widget id → { ref, symbol, tf } of each chart on the board (the chart a widget shows now: its own ref,
// else its first tab's) — what chartGrid.set reuses. Read only.
function chartsOf(host) {
  const m = new Map()
  let list = []
  try { list = host?.charts?.list?.() || [] } catch { list = [] }
  for (const c of list) {
    const id = String(c?.ref || '').split('~')[0]
    if (!id || (m.has(id) && c.ref !== id)) continue
    m.set(id, { ref: c.ref, symbol: c.symbol ?? null, tf: c.tf ?? null })
  }
  return m
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
  stateOf: (s) => ({ board: clone(s.raw), layoutTheme: s.layoutTheme ?? null, did: [], adds: [], grid: null }),
  patch(before, after) {
    // chartGrid.set: its own write (charts added, cells, links and tickers together), alone
    if (after.grid) return after.grid.noop ? null : { grid: clone(after.grid) }
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
    // A NEW widget (watchlist.open with none on the board): added through handleAddWidget, alone.
    if ((after.adds || []).length) return { add: clone(after.adds) }
    return Object.keys(p).length ? p : null
  },
  async commit(host, ref, patch) {
    if (patch.grid) return commitGrid(host, patch.grid)
    if (patch.gridUndo) return undoGrid(host, patch.gridUndo)
    if (patch.add) {
      const added = []
      for (const a of patch.add) {
        const known = new Set(host.widgets.snapshot().widgets.map(w => w.id))
        host.widgets.add(a.type, null, { opts: a.opts })
        let fresh = null
        const t0 = Date.now()
        while (!fresh && Date.now() - t0 < 5000) {
          await afterRender()
          fresh = host.widgets.snapshot().widgets.find(w => !known.has(w.id) && w.type === a.type) || null
        }
        if (!fresh) {
          host.widgets.cancelPending?.()
          throw new Error('the new Watchlist widget did not appear')
        }
        added.push(fresh.id)
      }
      return { undoData: { added } }
    }
    host.widgets.applyBoard(patch)
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.grid) return gridLanded(snap, patch.grid)
    if (patch.gridUndo) return gridUndone(snap, patch.gridUndo)
    if (patch.add) return patch.add.every(a => snap.raw.some(w => w.type === a.type && same(w.opts?.watchKey, a.opts?.watchKey)))
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
    // chartGrid.set: exactly what its commit recorded (the charts it added, the cells, links and tickers it changed)
    if (p.grid) return item.undoData?.grid ? { gridUndo: clone(item.undoData.grid) } : null
    // A widget this change ADDED: Undo removes exactly it (the board writer's remove).
    if (p.add) return item.undoData?.added?.length ? { remove: [...item.undoData.added] } : null
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
    if (p.grid) {
      // the charts this change touched — their cell, link and settings, and the ticker they show
      const g = item.undoData?.grid
      const gids = [...new Set([...(p.grid.reuse || []).map(r => r.id), ...(g?.added || []), ...(p.grid.railMoved ? [p.grid.railMoved] : [])])]
      return JSON.stringify(gids.map(id => {
        const w = s.raw.find(x => String(x.id) === id)
        let sym = null
        try { sym = host?.widgets?.configOf?.(id)?.symbol ?? null } catch { sym = null }
        const added = (g?.added || []).includes(id)
        return w ? [id, ...FIELDS.map(f => (f !== 'opts' ? JSON.stringify(w[f] ?? null) : added ? addedChartOpts(w) : reusedChartOpts(w))), sym] : [id, 'gone']
      }))
    }
    const ids = [...new Set([...(p.remove || []), ...Object.keys(p.set || {}), ...(p.restore || []).map(w => w.id), ...(p.add ? item.undoData?.added || [] : [])])]
    return JSON.stringify(ids.map(id => {
      const w = s.raw.find(x => x.id === id)
      return w ? [id, ...FIELDS.map(f => JSON.stringify(w[f] ?? null))] : [id, 'gone']
    }))
  },
}


// ── chartGrid.set's writer: ONE change through the board's own doors, in this order, each confirmed on
// the board before the next — unlink (the colour dot's own writer), re-tile the reused charts (applyBoard), add
// each new chart in its planned (now empty) cell, born on its ticker and timeframe (handleAddWidget's exact
// slot + unlinkedSymbol), then the reused charts' ticker / timeframe (each chart's own writer). Any step that
// does not land takes back everything before it (newest first) and the change fails as a whole.
const rectOf = (w) => ({ x: w.x, y: w.y, w: w.w, h: w.h })
const sameRect = (a, b) => !!a && !!b && GEOM.every(k => a[k] === b[k])
async function settle(pred, ms = 5000) {
  const t0 = Date.now()
  while (!pred() && Date.now() - t0 < ms) await afterRender()
  return pred()
}
const rawNow = (host) => host.widgets.snapshot().raw || []
async function commitGrid(host, g) {
  const raw0 = rawNow(host)
  const geom = {}
  for (const id of Object.keys(g.set || {})) { const w = raw0.find(x => String(x.id) === id); if (w) geom[id] = rectOf(w) }
  const colors = {}
  const added = []
  const charts = []
  // ⭐ PHASE 3 acceptance (replace): the widgets this change removes, whole as they were — Undo restores them
  let removed = []
  const undo = () => ({ added: [...added], geom: Object.fromEntries(Object.keys(geom).filter(id => Object.keys(g.set || {}).includes(id)).map(id => [id, geom[id]])), colors: { ...colors }, charts: [...charts], removed: clone(removed) })
  try {
    if ((g.remove || []).length) {
      const gone = raw0.filter(w => g.remove.includes(String(w.id)))
      if (gone.length !== g.remove.length) throw new Error('the board changed before it could be replaced')
      host.widgets.applyBoard({ remove: [...g.remove] })
      removed = gone
      if (!(await settle(() => !rawNow(host).some(w => g.remove.includes(String(w.id)))))) throw new Error('the board did not remove the widgets it was replacing')
    }
    for (const id of g.unlink || []) {
      const w = raw0.find(x => String(x.id) === id)
      colors[id] = w?.color || 'A'
      host.widgets.color(id, 'N')
    }
    if ((g.unlink || []).length && !(await settle(() => g.unlink.every(id => rawNow(host).find(x => String(x.id) === id)?.color === 'N')))) throw new Error('a chart could not be unlinked')
    if (Object.keys(g.set || {}).length) {
      host.widgets.applyBoard({ set: clone(g.set) })
      if (!(await settle(() => Object.entries(g.set).every(([id, r]) => sameRect(rawNow(host).find(x => String(x.id) === id), r))))) throw new Error('the board did not take the new arrangement')
    }
    for (const a of g.add || []) {
      const known = new Set(rawNow(host).map(w => String(w.id)))
      // ⭐ PHASE 3 (board.duplicateChart): a copy is born with the source chart's own opts (its settings — look, indicators —
      // and timeframe), through the same seed handleAddWidget gives a Watchlist widget's list
      // (⭐ PHASE 3: a grid's watchlist rail adds a widget of another type — born with its own seed opts, keeps its colour)
      const type = a.type || 'chart'
      host.widgets.add(type, { ...a.rect }, a.opts ? { opts: clone(a.opts), ...(a.symbol ? { symbol: a.symbol } : {}) } : { symbol: a.symbol, tf: a.tf || null })
      let fresh = null
      await settle(() => !!(fresh = rawNow(host).find(w => !known.has(String(w.id)) && w.type === type) || null))
      if (!fresh) { host.widgets.cancelPending?.(); throw new Error(`a new ${type === 'chart' ? 'chart' : label(type)} did not appear`) }
      added.push(String(fresh.id))
      if (!sameRect(fresh, a.rect)) throw new Error(`a new ${type === 'chart' ? 'chart' : label(type)} did not land in its planned place`)
      if (type === 'chart' && fresh.color !== 'N') { host.widgets.color(fresh.id, 'N'); await afterRender() }
    }
    for (const r of g.reuse || []) {
      const p = {}
      if (r.symbol) p.symbol = r.symbol
      if (r.tf) p.tf = r.tf
      if (!Object.keys(p).length) continue
      const back = {}
      if (r.symbol) back.symbol = r.from?.symbol ?? null
      if (r.tf) back.tf = r.from?.tf ?? null
      if (!host.charts?.commit?.(r.ref, p)) throw new Error('a chart did not take its new ticker')
      charts.push({ ref: r.ref, back })
    }
  } catch (e) {
    try { await undoGrid(host, undo()) } catch { /* the failure below still says so */ }
    throw e
  }
  return { undoData: { grid: undo() } }
}
async function undoGrid(host, u) {
  for (const c of [...(u.charts || [])].reverse()) {
    const back = Object.fromEntries(Object.entries(c.back || {}).filter(([, v]) => v != null))
    if (Object.keys(back).length) host.charts?.commit?.(c.ref, back)
  }
  for (const [id, color] of Object.entries(u.colors || {})) host.widgets.color(id, color)
  for (const id of u.added || []) host.widgets.remove(id)
  if (Object.keys(u.geom || {}).length) {
    // the closed charts' cells are empty again before the reused charts grow back into them
    await settle(() => (u.added || []).every(id => !rawNow(host).some(w => String(w.id) === id)))
    host.widgets.applyBoard({ set: clone(u.geom) })
  }
  // a replaced board: every widget it removed comes back whole, into the space the grid has just given back
  if ((u.removed || []).length) {
    await settle(() => Object.entries(u.geom || {}).every(([id, r]) => sameRect(rawNow(host).find(x => String(x.id) === id), r)))
    host.widgets.applyBoard({ restore: clone(u.removed) })
  }
  return true
}
function gridLanded(snap, g) {
  const by = new Map(snap.raw.map(w => [String(w.id), w]))
  if ((g.remove || []).some(id => by.has(id))) return false
  for (const [id, r] of Object.entries(g.set || {})) if (!sameRect(by.get(id), r)) return false
  for (const id of g.unlink || []) if (by.get(id)?.color !== 'N') return false
  return (g.add || []).every(a => snap.raw.some(w => w.type === (a.type || 'chart') && sameRect(w, a.rect)))
}
function gridUndone(snap, u) {
  const by = new Map(snap.raw.map(w => [String(w.id), w]))
  if ((u.removed || []).some(w => !by.has(String(w.id)))) return false
  if ((u.added || []).some(id => by.has(id))) return false
  for (const [id, r] of Object.entries(u.geom || {})) if (!sameRect(by.get(id), r)) return false
  for (const [id, c] of Object.entries(u.colors || {})) if ((by.get(id)?.color || 'A') !== c) return false
  return true
}
const TF_WORD = { 1: '1-minute', 5: '5-minute', 15: '15-minute', 30: '30-minute', 60: '1-hour', D: 'daily', W: 'weekly', M: 'monthly' }
const NUM_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']
const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
/** "four daily charts for SPY, QQQ, NVDA and TSLA" (new: "two new daily charts for …") — the grid's own words. */
export function gridPhrase(g, { fresh = false } = {}) {
  const n = g.symbols.length
  const tf = g.timeframe ? `${TF_WORD[g.timeframe] || g.timeframe} ` : ''
  return `${NUM_WORD[n] || n} ${fresh ? 'new ' : ''}${tf}chart${n === 1 ? '' : 's'} for ${andList(g.symbols)}`
}

// widget.resize: the dragged-edge rectangle → the product's resolveResize (neighbours shrink).
// The board's own resolver (the drag handles' resolveResize) shrinks each neighbour on its own
// and then clamps the resized widget to the tightest one — so a step a neighbour can only partly
// give leaves a gap beside the others. Ask for the LARGEST step the board grants in full: `by`,
// then `by-1`, … — the first whose result grows the widget by exactly that much (no gap, ever).
function resizeOf(st, env, t, edge, by) {
  for (let step = by; step >= 1; step--) {
    const next = resizeStep(st, env, t, edge, step)
    if (!next) continue
    const a = next.find(w => w.id === t.id)
    const grew = edge === 'left' || edge === 'right' ? a.w - t.w : a.h - t.h
    if (grew === step) return next
  }
  return by >= 1 ? null : resizeStep(st, env, t, edge, by)
}
function resizeStep(st, env, t, edge, by) {
  const r = { x: t.x, y: t.y, w: t.w, h: t.h }
  const handle = { left: 'w', right: 'e', top: 'n', bottom: 's' }[edge]
  if (edge === 'right') r.w += by
  else if (edge === 'left') { r.x -= by; r.w += by }
  else if (edge === 'bottom') r.h += by
  else if (edge === 'top') { r.y -= by; r.h += by }
  const g = env.target.grid
  r.x = Math.max(0, r.x); r.y = Math.max(0, r.y)
  r.w = Math.min(r.w, g.cols - r.x); r.h = Math.min(r.h, g.rows - r.y)
  const { minW, minH } = env.target.minOf(t)
  if (r.w < minW || r.h < minH) return null
  return env.target.resize(st.board, t.id, r, handle)
}
// ── shared checks ──
function widgetOf(st, id) { return st.board.find(w => w.id === String(id)) || null }
// ⭐ PHASE 3 (board.swap): the board with A and B trading places, or null. Adjacent with the same rows → they trade
// sides, each keeping its width (A's left edge becomes the pair's left edge when B was left of it); adjacent with the same
// columns → they trade top/bottom, each keeping its height; otherwise only same-sized widgets trade cells.
// ⭐ PHASE 3: chartGrid.set `watchlist: true` → a Watchlist rail (agent/chartGrid.js planChartGrid `rail`)
const railOf = (watchlist) => (watchlist === true ? { type: 'watchlist', label: label('watchlist'), labelOf: label } : null)
// ⭐ PHASE 3 (board.duplicateChart): the split — the chart keeps the left (top) half, the copy takes the other.
function duplicatePlan(st, s, t) {
  const { minW, minH } = s.minOf ? s.minOf(t) : { minW: 2, minH: 3 }
  let keep = null, copy = null, split = null
  if (t.w >= 2 * minW) { const w1 = Math.ceil(t.w / 2); keep = { x: t.x, y: t.y, w: w1, h: t.h }; copy = { x: t.x + w1, y: t.y, w: t.w - w1, h: t.h }; split = 'side' }
  else if (t.h >= 2 * minH) { const h1 = Math.ceil(t.h / 2); keep = { x: t.x, y: t.y, w: t.w, h: h1 }; copy = { x: t.x, y: t.y + h1, w: t.w, h: t.h - h1 }; split = 'below' }
  if (!keep) return { why: `That chart is too small to split for a copy (a chart needs at least ${minW} × ${minH} cells) — make it bigger first.` }
  const c = s.charts?.get?.(String(t.id)) || {}
  if (!c.symbol) return { why: "I can't read that chart's ticker right now, so I didn't copy it." }
  const opts = { ...(t.opts?.settings != null ? { settings: clone(t.opts.settings) } : {}), ...(c.tf ? { tf: c.tf } : {}) }
  return { set: { [t.id]: keep }, board: st.board.map(w => (w.id === t.id ? { ...w, ...keep } : w)), add: { rect: copy, symbol: String(c.symbol).toUpperCase(), tf: c.tf || null, opts }, split }
}
const DUP_RE = /^(?:please )?(?:duplicate|clone|copy|make (?:a |another )?(?:copy|duplicate|clone) of|give me (?:a |another )?copy of|open (?:a |another )?copy of)\s+(.+?)$/
/** "duplicate this chart", "make a copy of the NVDA chart", "clone the left chart" → { widget, __target } | null. */
function duplicatePhrase(lower, host) {
  const m = DUP_RE.exec(String(lower || '').replace(/[.!]+$/, '').trim())
  if (!m) return null
  const words = m[1].replace(/\s+(?:please|for me)$/, '')
  if (!/\bchart\b|\bit\b|\bthis one\b|\bthat one\b/.test(words)) return null                  // "copy my watchlist" is not this
  const b = boardOf(host)
  if (!b) return null
  const chartsOn = b.all.filter(w => w.type === 'chart')
  let id = null
  if (/^(?:this|this chart|it|this one|that one|the chart|my chart|that chart)$/.test(words)) {
    let sel = null
    try { sel = host?.charts?.selected?.() || null } catch { sel = null }
    const selId = sel ? String(sel).split('~')[0] : null
    id = chartsOn.length === 1 ? chartsOn[0].id : (selId && chartsOn.some(w => String(w.id) === selId) ? selId : null)
  } else {
    const w = widgetNamed(words, b.all)
    if (w?.type === 'chart') id = w.id
    else {
      // "the NVDA chart": the one chart showing that ticker
      const sym = /^(?:the |my )?\$?([a-z][a-z0-9.]{0,9}) chart$/.exec(words)?.[1]
      let list = []
      try { list = host?.charts?.list?.() || [] } catch { list = [] }
      const hits = sym ? list.filter(c => String(c.symbol || '').toLowerCase() === sym) : []
      if (hits.length === 1) id = String(hits[0].ref).split('~')[0]
    }
  }
  return id ? { widget: id, __target: 'board' } : null
}

export function swapped(board, A, B) {
  if (!A || !B) return null
  const put = (m) => board.map(w => (m[w.id] ? { ...w, ...m[w.id] } : w))
  if (A.y === B.y && A.h === B.h && (A.x + A.w === B.x || B.x + B.w === A.x)) {
    const [l, r] = A.x < B.x ? [A, B] : [B, A]
    return put({ [r.id]: { x: l.x }, [l.id]: { x: l.x + r.w } })
  }
  if (A.x === B.x && A.w === B.w && (A.y + A.h === B.y || B.y + B.h === A.y)) {
    const [t, u] = A.y < B.y ? [A, B] : [B, A]
    return put({ [u.id]: { y: t.y }, [t.id]: { y: t.y + u.h } })
  }
  if (A.w === B.w && A.h === B.h) return put({ [A.id]: { x: B.x, y: B.y }, [B.id]: { x: A.x, y: A.y } })
  return null
}

// ── ⭐ PHASE 3: the board's own words — "swap the watchlist and the chart", "move my watchlist to the right", "make the
// watchlist wider". Read against the LIVE board (the widgets on the grid, by type and position); a phrase that names no
// widget, or several, is not read here (→ the model, which sees the board entry, or asks). The ops are the existing
// board.swap / widget.resize, checked and receipted like any other. Pure: reads `host`, never writes.
const POS_WORDS = '(?:top[- ]left|top[- ]right|bottom[- ]left|bottom[- ]right|upper[- ]left|upper[- ]right|lower[- ]left|lower[- ]right|left|right|top|bottom|upper|lower|middle)'
function boardOf(host) {
  let s = null
  try { s = host?.widgets?.snapshot?.() || null } catch { s = null }
  if (!s?.raw || !s.grid) return null
  // the widgets ON the grid (a floating or popped-out one is not), with their geometry
  const onGrid = new Set((s.visible || s.raw).map(w => String(w.id)))
  return { all: s.raw.filter(w => onGrid.has(String(w.id))), grid: s.grid }
}
/** "my watchlist", "the left chart", "the news widget" → the ONE widget on the grid those words mean, else null. */
export function widgetNamed(words, all) {
  let p = String(words || '').toLowerCase().trim().replace(/^(?:my|the|this|that|our)\s+/, '').replace(/\s+(?:widget|panel|window|one)$/, '').trim()
  const pm = new RegExp(`^(${POS_WORDS})\\s+`).exec(p)
  const pos = pm ? pm[1].replace(' ', '-').replace('upper', 'top').replace('lower', 'bottom') : null
  if (pm) p = p.slice(pm[0].length)
  p = p.replace(/^watch list$/, 'watchlist').replace(/s$/, '')
  if (!p) return null
  const types = Object.keys(LABEL).filter(t => t === p || String(LABEL[t]).toLowerCase() === p)
  let hits = all.filter(w => types.includes(w.type))
  if (pos) hits = hits.filter(w => (positionWord(w, all) || '').split('-').concat(positionWord(w, all) || '').includes(pos))
  return hits.length === 1 ? hits[0] : null
}
const SWAP_RE = /^(?:please )?(?:swap|switch|flip|exchange|trade)(?: places of| the places of| the positions of)? (.+?) (?:and|with|for) (.+?)(?: around| over| places)?$/
const MOVE_RE = new RegExp('^(?:please )?(?:move|put|shift|slide|drag|switch) (.+?) (?:to|on|over to|onto|to the other side,? to) the (left|right|top|bottom)(?: side| edge| of the (?:board|screen|workspace))?$')
const SIZE_RE2 = /^(?:please )?make (.+?) (a (?:little|bit|tad) |slightly |much |a lot )?(wider|narrower|taller|shorter|bigger|larger|smaller)(?: by (\d{1,2})(?: cells?| columns?| rows?)?)?$/
/** → { action, args } for the board, or null. */
export function boardPhrase(lower, host) {
  const b = boardOf(host)
  if (!b || b.all.length < 2) return null
  const t = String(lower || '').replace(/[.!]+$/, '').trim()
  let m = SWAP_RE.exec(t)
  if (m) {
    // "swap the top left and bottom right charts": a bare position borrows the other half's noun
    const noun = (s) => (/\b(\S+?)s?$/.exec(String(s).trim()) || [])[1] || ''
    const onlyPos = (s) => new RegExp(`^(?:the |my )?${POS_WORDS}(?: one)?$`).test(String(s).trim())
    const w1 = onlyPos(m[1]) ? `${m[1]} ${noun(m[2])}` : m[1]
    const w2 = onlyPos(m[2]) ? `${m[2]} ${noun(m[1])}` : m[2]
    const A = widgetNamed(w1, b.all), Bw = widgetNamed(w2, b.all)
    return A && Bw && A.id !== Bw.id ? { action: 'board.swap', args: { a: A.id, b: Bw.id } } : null
  }
  m = MOVE_RE.exec(t)
  if (m) {
    const A = widgetNamed(m[1], b.all)
    if (!A) return null
    const side = m[2]
    // the ONE widget beside it on that side, sharing its rows (or columns) — the two trade sides; anything else is the model's
    const by = side === 'right' ? (w) => w.x === A.x + A.w && w.y === A.y && w.h === A.h
      : side === 'left' ? (w) => w.x + w.w === A.x && w.y === A.y && w.h === A.h
        : side === 'bottom' ? (w) => w.y === A.y + A.h && w.x === A.x && w.w === A.w
          : (w) => w.y + w.h === A.y && w.x === A.x && w.w === A.w
    const nb = b.all.filter(w => w.id !== A.id && by(w))
    return nb.length === 1 ? { action: 'board.swap', args: { a: A.id, b: nb[0].id } } : null
  }
  m = SIZE_RE2.exec(t)
  if (m) {
    const A = widgetNamed(m[1], b.all)
    if (!A) return null
    const grow = /wider|taller|bigger|larger/.test(m[3])
    const horiz = /wider|narrower/.test(m[3]) ? true : /taller|shorter/.test(m[3]) ? false
      : b.all.some(w => w.id !== A.id && w.y < A.y + A.h && A.y < w.y + w.h)     // bigger/smaller: toward a neighbour beside it
    const { cols, rows } = b.grid
    // the edge that has a neighbour to give (or take) the space: right before left, bottom before top
    const edge = horiz ? (A.x + A.w < cols ? 'right' : 'left') : (A.y + A.h < rows ? 'bottom' : 'top')
    const dim = horiz ? A.w : A.h
    const share = /little|bit|tad|slightly/.test(m[2] || '') ? 0.15 : /much|a lot/.test(m[2] || '') ? 0.5 : 0.25
    const n = m[4] ? Number(m[4]) : Math.max(1, Math.round(dim * share))
    return { action: 'widget.resize', args: { widget: A.id, edge, by: grow ? n : -n } }
  }
  return null
}
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

// ── widget tabs (the WidgetHost tab strip's own reducers, pages/charts/widgetTabs.js) ──
// Any widget may hold extra tabs (`wtabs`); "main" is its own content, extras are "1", "2"… or
// their label. These are NOT chart tabs (a chart's timeframes / symbols — chart.*Tab).
function wtabsOf(w) {
  const { active } = sanitizeWidgetTabs(w)
  return widgetTabList(w).map((t, i) => ({ key: i === 0 ? 'main' : String(i), id: t.id, label: t.label, type: t.type, index: i, active: i === active }))
}
function findWtab(w, tab) {
  const list = wtabsOf(w)
  const q = String(tab ?? '').trim().toLowerCase()
  const byKey = list.find(t => t.key === q)
  if (byKey) return byKey
  const named = list.filter(t => t.label.toLowerCase() === q)
  return named.length === 1 ? named[0] : null
}

// ── chart tabs (the ChartTabStrip's own reducers, pages/charts/chartTabs.js) ──
// A tab is addressed as "main" (the widget's own chart), its 1-based position among the extra
// tabs ("1", "2"…), or its label. Its link colour is the tab's colour group (main = the widget's).
function tabsOf(w) {
  const { tabs, active } = sanitizeChartTabs(w.opts)
  return chartTabList(w.opts).map((t, i) => ({
    key: i === 0 ? 'main' : String(i), id: t.id, label: t.label, active: i === active,
    color: i === 0 ? (w.color || 'A') : (tabs[i - 1]?.color || 'A'),
  }))
}
function findTab(w, tab) {
  const all = tabsOf(w)
  const q = String(tab ?? '').trim().toLowerCase()
  return all.find(t => t.key === q) || (q === 'main tab' || q === 'first' ? all[0] : null)
    || (all.filter(t => t.label.toLowerCase() === q).length === 1 ? all.find(t => t.label.toLowerCase() === q) : null)
}
const MAX_CHART_TABS = 8

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
        ...(s.extraGroups ? { extraLinkColors: true } : {}),
        widgets: s.raw.map(w => ({
          id: w.id, type: w.type, label: label(w.type), position: positionWord(w, s.raw) || null,
          x: w.x, y: w.y, w: w.w, h: w.h, link: w.color || null,
          ...(w.type === 'watchlist' ? { shows: w.opts?.watchName || (w.opts?.source ? 'a list chosen by UCT' : null) } : {}),
          ...(w.type === 'scanner' ? { shows: w.opts?.scanName || null } : {}),
          // a widget's own tabs (the WidgetHost tab strip, any widget type): main + extras
          ...(sanitizeWidgetTabs(w).tabs.length ? { widgetTabs: wtabsOf(w).map(t => ({ tab: t.key, label: t.label, type: label(t.type), ...(t.active ? { active: true } : {}) })) } : {}),
          ...(w.type === 'chart' && sanitizeChartTabs(w.opts).tabs.length ? { chartTabs: tabsOf(w).map(t => ({ tab: t.key, label: t.label, ...(t.active ? { active: true } : {}), link: t.color })) } : {}),
        })),
      }]
    },
  })

  const common = { target: 'board', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' }
  // Every board action first passes the detached-widget rule: arranging (move / arrange / resize)
  // re-tiles the whole grid, so it waits while ANY widget floats or is popped out; an action aimed
  // at one widget refuses when that widget is detached. Then the action's own check runs.
  const REPACKS = new Set(['widget.move', 'widget.arrange', 'widget.resize', 'chartGrid.set'])
  const detachedWhy = (name, args, env) => {
    const det = env?.target?.detached || []
    if (!det.length) return null
    if (REPACKS.has(name)) return 'A widget is floating or popped out right now — dock it back first, then I can rearrange the board (arranging would move its spot on the grid while you can’t see it).'
    if (args && args.widget != null && det.includes(String(args.widget))) return 'That widget is floating or popped out — dock it back onto the board first.'
    return null
  }
  const reg = (d) => registerCapability({ ...d, check: (st, args, env) => detachedWhy(d.name, args, env) || (d.check ? d.check(st, args, env) : null) })
  const widgetArg = { type: 'string' }

  reg({
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

  reg({
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

  reg({
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

  reg({
    ...common,
    name: 'chartGrid.set',
    summary: 'Show these tickers as that many charts, in equal cells: the charts already on the board are reused (top-left first), any still needed are ADDED, and the charts\' area is re-tiled as an even grid. Other widgets stay where they are; nothing is removed. One change, one Undo.',
    hints: 'Use for "create/open/show N charts for A, B, C…", "put SPY, QQQ, NVDA and TSLA in a 2x2 grid", "show NVDA and AMD side by side" — whenever the member names the tickers for several charts. '
      + 'target = the ref of the board entry. symbols = the tickers in the member\'s order, uppercase. timeframe = the one timeframe they gave for all of them (1|5|15|30|60 minutes, D, W, M), else null. '
      + 'layout = "columns" for side by side, "rows" for stacked, "grid" for a grid, else null. '
      + 'new_charts = true only when they ask for NEW charts ("in new charts", "add four new charts") — the charts already there then keep their tickers; else null. '
      + 'watchlist = true when they also ask for a watchlist beside the charts ("…, and a watchlist") and the board has no Watchlist widget: a column on the right is cleared of charts and a Watchlist widget is added there; else null. '
      + 'replace = true only when the member chose to replace the current board with this workspace; else null. Never widget.add + chart.setSymbol for this.',
    args: { type: 'object', properties: {
      symbols: { type: 'array', items: { type: 'string' } },
      timeframe: { type: ['string', 'null'], enum: [...CHART_TIMEFRAMES, null] },
      layout: { type: ['string', 'null'], enum: [...GRID_PATTERNS, null] },
      new_charts: { type: ['boolean', 'null'] },
      watchlist: { type: ['boolean', 'null'] },
      replace: { type: ['boolean', 'null'] },
    }, required: ['symbols', 'timeframe', 'layout', 'new_charts', 'watchlist', 'replace'], additionalProperties: false },
    // ⭐ PHASE 3 acceptance: replacing the board removes widgets the member did not name one by one — always shown as a
    // proposal first (the same rule as removing two or more widgets), never applied on a pick alone
    confirmIf: (st, args) => args?.replace === true,
    async prepare(ops) {
      const syms = [...new Set(ops.flatMap(o => (Array.isArray(o.args?.symbols) ? o.args.symbols : [])).map(s => String(s || '').trim().toUpperCase()).filter(Boolean))]
      return syms.length ? { unknownSymbols: await unknownSymbols(syms) } : {}
    },
    check(st, { symbols, timeframe, layout, new_charts: newCharts, watchlist, replace }, env) {
      const s = env?.target
      if (!s) return 'The board is not available.'
      if (!Array.isArray(symbols) || !symbols.length) return 'Which tickers?'
      if (symbols.length > MAX_GRID_CHARTS) return `That's more than ${MAX_GRID_CHARTS} charts in one grid — ask for fewer.`
      if (timeframe != null && !CHART_TIMEFRAMES.includes(timeframe)) return `“${timeframe}” is not a timeframe UCT charts.`
      const unknown = symbols.map(x => String(x || '').trim().toUpperCase()).filter(x => env?.unknownSymbols?.has?.(x))
      if (unknown.length) return `UCT has no symbol ${andList(unknown.map(u => `“${u}”`))}, so I didn't change the charts.`
      if (st.grid) return 'One chart grid at a time.'
      const plan = planChartGrid({ board: st.board, charts: s.charts || new Map(), symbols, timeframe, layout, newCharts: newCharts === true, cols: s.grid.cols, rows: s.grid.rows, minOf: s.minOf, maxWidgets: s.maxWidgets ?? 16, detached: s.detached, rail: railOf(watchlist), replace: replace === true })
      return plan.ok ? null : plan.reason
    },
    apply(st, { symbols, timeframe, layout, new_charts: newCharts, watchlist, replace }, env) {
      const s = env.target
      const plan = planChartGrid({ board: st.board, charts: s.charts || new Map(), symbols, timeframe, layout, newCharts: newCharts === true, cols: s.grid.cols, rows: s.grid.rows, minOf: s.minOf, maxWidgets: s.maxWidgets ?? 16, detached: s.detached, rail: railOf(watchlist), replace: replace === true })
      if (!plan.ok) return st
      if (plan.remove.length) plan.removedNames = st.board.filter(w => plan.remove.includes(String(w.id))).map(w => nameOf(w, st.board))
      const board = st.board.filter(w => !plan.remove.includes(String(w.id))).map(w => (plan.set[String(w.id)] ? { ...w, ...plan.set[String(w.id)] } : (plan.unlink.includes(String(w.id)) ? { ...w, color: 'N' } : w)))
      return { ...st, board, grid: plan }
    },
    describe(b, a) {
      const g = a.grid
      if (!g || g.noop) return null
      const shape = g.tiled && g.shape && g.shape.rows > 1 && g.shape.cols > 1 && g.symbols.length === g.shape.rows * g.shape.cols ? ` in a ${g.shape.rows}×${g.shape.cols} grid`
        : g.tiled && g.shape?.rows === 1 && g.symbols.length > 1 ? ' side by side' : g.tiled && g.shape?.cols === 1 && g.symbols.length > 1 ? ' stacked' : ''
      const rail = g.rail ? `, with a new ${label(g.rail)} on the right` : g.railMoved ? ', with your Watchlist on the right' : ''
      // ⭐ PHASE 3 acceptance: a replaced board says exactly what went (and that Undo brings it back)
      const gone = g.remove?.length ? ` — replacing your board: removed ${andList((g.removedNames || []).map(x => `the ${x}`))} (Undo puts ${g.remove.length === 1 ? 'it' : 'them'} back)` : ''
      if (g.newCharts) return `Added ${gridPhrase(g, { fresh: true })}${g.kept ? ` beside your ${g.kept === 1 ? 'chart' : `${g.kept} charts`}, re-tiled evenly` : ''}${rail}`
      const nNew = g.add.filter(a => !a.type || a.type === 'chart').length
      const parts = [g.reuse.length && nNew ? `${g.reuse.length} reused, ${nNew} new` : nNew ? `${nNew} new` : null,
        g.unlink.length ? `${g.unlink.length} unlinked so ${g.unlink.length === 1 ? 'it' : 'each'} can show its own ticker` : null].filter(Boolean)
      return `Set up ${gridPhrase(g)}${shape}${parts.length ? ` (${parts.join('; ')})` : ''}${rail}${gone}`
    },
    noop: () => 'Those charts already show those tickers',
  })

  // ── ⭐ PHASE 3: board.duplicateChart — "duplicate this chart", "make a copy of the NVDA chart" ──
  // The chart's cell is split in two (side by side when it is wide enough, else stacked): the chart keeps the first half,
  // and a NEW chart is born in the other half with the chart's own settings (look, indicators) and timeframe, on its ticker,
  // not linked (so it can show another ticker without moving the first). Nothing else on the board moves. Written by the
  // grid's own writer (set the cell, add into the freed half; a step that doesn't land takes everything back); ONE exact
  // Undo closes the copy and gives the chart its whole cell back.
  reg({
    ...common,
    name: 'board.duplicateChart',
    summary: 'Duplicate one chart: its cell is split in two and a copy (same ticker, timeframe, look and indicators, not linked) appears in the other half. Nothing else moves. One change, one Undo.',
    hints: 'target = the ref of the board entry; widget = the chart widget\'s id.',
    args: { type: 'object', properties: { widget: widgetArg }, required: ['widget'], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower, host }) => duplicatePhrase(lower, host),
    check(st, { widget }, env) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (t.type !== 'chart') return `Only a chart can be duplicated this way — that's a ${label(t.type)}.`
      if (st.grid) return 'One board change of this kind at a time.'
      const s = env?.target
      if (!s) return 'The board is not available.'
      if (st.board.length + 1 > (s.maxWidgets ?? 16)) return `The board already holds ${st.board.length} widgets — the most it can hold. Close one first.`
      const plan = duplicatePlan(st, s, t)
      return plan.why || problemSentence(st, env, [...plan.board, { id: '__copy', type: 'chart', ...plan.add.rect }])
    },
    apply(st, { widget }, env) {
      const t = widgetOf(st, widget)
      const plan = duplicatePlan(st, env.target, t)
      if (plan.why) return st
      return { ...st, board: plan.board, grid: { ok: true, set: plan.set, add: [plan.add], reuse: [], unlink: [], symbols: [plan.add.symbol], dup: { of: nameOf(t, st.board), split: plan.split } } }
    },
    describe(b, a) {
      const d = a.grid?.dup
      return d ? `Duplicated the ${d.of} — the copy (${a.grid.add[0].symbol}, not linked) is ${d.split === 'side' ? 'beside' : 'below'} it, each in half of its old space` : null
    },
  })

  reg({
    ...common,
    name: 'widget.setLink',
    summary: 'Set a widget\'s link colour: widgets with the same colour follow the same symbol; N = not linked.',
    hints: `target = the ref of the board entry; widget = its id; color = ${LINKS.map(c => `${c} (${LINK_NAME[c]})`).join(', ')} — E–H only when the board entry says extraLinkColors: true. "Link these two charts" = give both the same colour (use one already on one of them).`,
    args: { type: 'object', properties: { widget: widgetArg, color: { type: 'string', enum: LINKS } }, required: ['widget', 'color'], additionalProperties: false },
    check(st, { widget, color }, env) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (!LINKS.includes(color)) return `Link colours are ${LINKS.join(', ')}.`
      if (extraOff(env, color)) return extraOff(env, color)
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

  reg({
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

  // ── watchlist.open: "open it in my workspace" (the product's ?openWatchlist= door) ──
  // Which widget: the board's first Watchlist widget the member could switch themselves (not one
  // showing a UCT-chosen or followed list, not floating). None → ONE new Watchlist widget, only
  // into empty space. DEFERRED: in a request that also creates / fills the list it runs AFTER
  // those land, as its own step with its own receipt and Undo — if it can't open the list, the
  // list it just made is kept and the member is told exactly that.
  const switchable = (st, env) => st.board.find(w => w.type === 'watchlist' && !w.opts?.source && !w.opts?.listSub
    && !(env?.target?.detached || []).includes(String(w.id))) || null
  const listName = (list, env) => env?.target?.lists?.get(String(list)) || env?.pendingLists?.[String(list)] || null
  const OPEN_VERB = '(?:open|load|pull up|bring up|put|show)'
  const WHERE = '(?: (?:in|on|into|onto) (?:my|the|this) (?:workspace|board|charts?|watch ?list widget))?'
  reg({
    ...common,
    name: 'watchlist.open',
    deferred: true,
    summary: 'Open one of the member\'s watchlists in their workspace: the Watchlist widget on this board shows it (with none, a Watchlist widget is added in empty space). Use for "open it / show it in my workspace".',
    hints: 'target = the ref of the board entry; list = the ref of the watchlist, or the "as" name of a list created earlier in this request (it opens after that list is created and filled).',
    args: { type: 'object', properties: { list: { type: 'string' } }, required: ['list'], additionalProperties: false },
    argRefs: { list: 'watchlist' },
    fastWhole: true,
    fast: ({ lower, host }) => {
      if (!host?.watchlists) return null
      if (new RegExp(`^(?:please )?${OPEN_VERB}(?: me)? (?:the |my |that )?(?:new )?(?:watch ?list|list) (?:you|i) just (?:made|created|built|set up)${WHERE}$`).test(lower)) {
        const l = lastCreatedList()
        return l ? { list: l.id } : null
      }
      const m = new RegExp(`^(?:please )?${OPEN_VERB} (?:my |the )?(.+?) (?:watch ?list|list)${WHERE}$`).exec(lower)
        || new RegExp(`^(?:please )?${OPEN_VERB} (?:my |the )?(.+?) (?:in|on|into|onto) (?:my|the|this) (?:workspace|board)$`).exec(lower)
        // "open Software Over $10" — the list's EXACT name (a layout or page of the same name also
        // claims the phrase, and an ambiguous phrase goes to the model: fastPath takes one hit only)
        || /^(?:please )?(?:open|load|pull up|bring up) (?:my |the )?(.+)$/.exec(lower)
      if (!m) return null
      const l = resolveListByName(host, m[1])
      // ⛔ Gate B: "open swing" when "swing" ALSO names a layout ("Swing Board") or a saved screen —
      // never picked here; the model path sees both and asks. Saying "watchlist" removes the doubt.
      if (l && !/(?:watch ?list|list)\b/.test(lower) && namesAnotherKind(host, m[1], 'watchlist')) return null
      return l ? { list: l.id } : null
    },
    check(st, { list }, env) {
      if (!listName(list, env)) return 'That isn\'t one of your watchlists.'
      if (!switchable(st, env) && !env?.target?.fitsWatchlist) {
        return 'There\'s no Watchlist widget on this board and no empty space for one — add a Watchlist widget (Widgets ▾) or make room, then ask me to open the list.'
      }
      return null
    },
    apply(st, { list }, env) {
      const name = listName(list, env)
      const key = `user:${list}`
      const w = switchable(st, env)
      if (w) {
        if (w.opts?.watchKey === key) return st
        const opts = { ...(w.opts || {}), watchKey: key, watchName: name, watchTab: 'mine' }
        return { ...st, board: st.board.map(x => (x.id === w.id ? { ...x, opts } : x)), opened: { name, where: `the ${nameOf(w, st.board)}` } }
      }
      return { ...st, adds: [...(st.adds || []), { type: 'watchlist', opts: { watchKey: key, watchName: name, watchTab: 'mine' } }], opened: { name, where: 'a new Watchlist widget' } }
    },
    describe: (b, a) => (a.opened && a.opened !== b.opened ? `Opened “${a.opened.name}” in ${a.opened.where}` : null),
    noop: (st, _a, { list }, env) => `“${listName(list, env) || 'That list'}” is already open in your Watchlist widget`,
  })

  reg({
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

  reg({
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

  // ── widget.resize: the custom resize handles' own resolveResize ──
  reg({
    ...common,
    name: 'widget.resize',
    summary: 'Resize ONE widget by moving one of its edges, exactly like dragging that edge: the widget the edge moves into shrinks (never below its minimum); nothing leaves the board.',
    hints: 'target = the ref of the board entry; widget = its id; edge = left | right | top | bottom; by = cells to move the edge OUTWARD (positive = bigger, negative = smaller). '
      + '"Make my watchlist narrower and give the chart more space" = resize the CHART toward the watchlist (the watchlist shrinks), or the watchlist inward then widget.arrange fill on the chart.',
    args: { type: 'object', properties: {
      widget: widgetArg, edge: { type: 'string', enum: ['left', 'right', 'top', 'bottom'] }, by: { type: 'integer' },
    }, required: ['widget', 'edge', 'by'], additionalProperties: false },
    // ⭐ PHASE 3: "make the watchlist wider", "make the left chart a little taller" (boardPhrase)
    fastWhole: true,
    fast: ({ lower, host }) => { const r = boardPhrase(lower, host); return r?.action === 'widget.resize' ? { ...r.args, __target: 'board' } : null },
    check(st, { widget, edge, by }, env) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (!Number.isInteger(by) || by === 0 || Math.abs(by) > 24) return 'Say how many cells to move the edge (1–24, negative to shrink).'
      if (!env?.target?.resize) return 'The board is not available.'
      const next = resizeOf(st, env, t, edge, by)
      if (!next) return 'The board could not resize that.'
      return problemSentence(st, env, next)
    },
    apply(st, { widget, edge, by }, env) {
      const t = widgetOf(st, widget)
      const next = resizeOf(st, env, t, edge, by)
      return !next || next.every((w, i) => GEOM.every(k => w[k] === st.board[i]?.[k])) ? st : { ...st, board: next }
    },
    describe(b, a, { widget, by }) {
      const t0 = b.board.find(w => w.id === String(widget)), t1 = a.board.find(w => w.id === String(widget))
      if (!t0 || !t1 || GEOM.every(k => t0[k] === t1[k])) return null
      const others = changedIds(b.board, a.board).filter(id => id !== t1.id).length
      const grew = Math.abs((t1.w - t0.w) || (t1.h - t0.h))
      const short = by > grew ? ` — ${grew} of the ${by} asked; a neighbour is at its minimum size` : ''
      return `Resized the ${nameOf(t0, b.board)} to ${t1.w}×${t1.h} cells${others ? ` (${others} neighbour${others === 1 ? '' : 's'} gave up the space)` : ''}${short}`
    },
    noop: () => "It can't grow that way — its neighbour is already at its minimum size, or it is at the board's edge",
  })

  // ── ⭐ PHASE 3: board.swap — two widgets trade places ("swap the watchlist and the chart", "move my watchlist to the
  // right"). Side by side with the same rows (or stacked with the same columns): each keeps its OWN size and they trade
  // sides — the rail stays a rail. Otherwise only two widgets of the same size trade cells. Nothing else moves; the board
  // must pass boardProblems; exact Undo (the board kind's own set patch). Its phrases: boardPhrase (below).
  reg({
    ...common,
    name: 'board.swap',
    summary: 'Swap two widgets\' places on the board. Side by side (same rows) or stacked (same columns): each keeps its own size and they trade sides. Otherwise only two widgets of the same size can trade cells. Nothing else moves.',
    hints: 'target = the ref of the board entry; a, b = the two widgets\' ids. "move my watchlist to the right" when the chart is on the right = swap the watchlist and that chart.',
    args: { type: 'object', properties: { a: widgetArg, b: widgetArg }, required: ['a', 'b'], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower, host }) => { const r = boardPhrase(lower, host); return r?.action === 'board.swap' ? { ...r.args, __target: 'board' } : null },
    check(st, { a, b }, env) {
      const A = widgetOf(st, a), Bw = widgetOf(st, b)
      if (!A) return notOnBoard(a)
      if (!Bw) return notOnBoard(b)
      if (A.id === Bw.id) return 'Those are the same widget.'
      const det = env?.target?.detached || []
      if (det.includes(A.id) || det.includes(Bw.id)) return 'That widget is floating or popped out — dock it back onto the board first.'
      const next = swapped(st.board, A, Bw)
      if (!next) return `The ${label(A.type)} and the ${label(Bw.type)} aren't side by side or stacked, and they aren't the same size — say where each should go instead.`
      return problemSentence(st, env, next)
    },
    apply(st, { a, b }) {
      const next = swapped(st.board, widgetOf(st, a), widgetOf(st, b))
      return next ? { ...st, board: next } : st
    },
    describe(b, a, { a: ia, b: ib }) {
      const A0 = b.board.find(w => w.id === String(ia)), B0 = b.board.find(w => w.id === String(ib))
      const A1 = a.board.find(w => w.id === String(ia))
      if (!A0 || !B0 || !A1 || GEOM.every(k => A0[k] === A1[k])) return null
      return `Swapped the ${nameOf(A0, b.board)} and the ${nameOf(B0, b.board)}`
    },
  })

  // ── widget tabs (non-chart and chart widgets alike: the tab strip in the widget header) ──
  const tabbed = (st, widget, tab) => {
    const t = widgetOf(st, widget)
    if (!t) return { why: notOnBoard(widget) }
    if (!sanitizeWidgetTabs(t).tabs.length) return { why: `The ${label(t.type)} has no tabs.` }
    const x = findWtab(t, tab)
    if (!x) return { why: `That widget has no tab “${tab}” — use main, 1, 2… or a tab's name from the board entry.` }
    return { t, x }
  }
  const setWidget = (st, t, next) => (same(next, t) ? st : { ...st, board: st.board.map(w => (w.id === t.id ? next : w)) })
  const wtabArgs = { widget: widgetArg, tab: { type: 'string' } }
  const wtabHint = 'target = the ref of the board entry; widget = its id; tab = "main" (the widget\'s own content), "1", "2"… or the tab\'s name, from the board entry\'s widgetTabs. NOT chart tabs (those are chart.*Tab).'

  reg({
    ...common,
    name: 'widget.selectTab',
    summary: 'Switch a widget to one of its tabs (clicking the tab in the widget header).',
    hints: wtabHint,
    args: { type: 'object', properties: wtabArgs, required: ['widget', 'tab'], additionalProperties: false },
    check: (st, { widget, tab }) => tabbed(st, widget, tab).why || null,
    apply(st, { widget, tab }) { const { t, x } = tabbed(st, widget, tab); return setWidget(st, t, setActiveWidgetTab(t, x.index)) },
    describe(b, a, { widget, tab }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o, n) ? `Switched the ${nameOf(o, b.board)} to its “${findWtab(n, tab)?.label || tab}” tab` : null
    },
    noop: () => 'That tab is already showing',
  })
  reg({
    ...common,
    name: 'widget.renameTab',
    summary: 'Rename one of a widget\'s tabs (double-click the tab), or clear the name back to the automatic label. At most 24 characters.',
    hints: `${wtabHint} name = the new name, or null to go back to the automatic label.`,
    args: { type: 'object', properties: { ...wtabArgs, name: { type: ['string', 'null'] } }, required: ['widget', 'tab', 'name'], additionalProperties: false },
    check: (st, { widget, tab, name }) => tabbed(st, widget, tab).why || (name != null && String(name).trim().length > 24 ? 'Tab names are at most 24 characters.' : null),
    apply(st, { widget, tab, name }) { const { t, x } = tabbed(st, widget, tab); return setWidget(st, t, renameWidgetTab(t, x.id, name)) },
    describe(b, a, { widget, tab, name }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      if (!o || !n || same(o, n)) return null
      return name ? `Renamed the ${nameOf(o, b.board)}'s “${findWtab(o, tab)?.label || tab}” tab to “${String(name).trim().slice(0, 24)}”` : `Reset the ${nameOf(o, b.board)}'s tab name to its automatic label`
    },
    noop: () => 'That tab already has that name',
  })
  reg({
    ...common,
    name: 'widget.closeTab',
    summary: 'Close one of a widget\'s extra tabs (its ×); the widget\'s own main tab cannot be closed. Undo puts the tab back exactly, settings included.',
    hints: wtabHint,
    args: { type: 'object', properties: wtabArgs, required: ['widget', 'tab'], additionalProperties: false },
    check(st, { widget, tab }) {
      const { x, why } = tabbed(st, widget, tab)
      if (why) return why
      return x.key === 'main' ? 'The main tab is the widget itself — remove the widget instead, or close one of its other tabs.' : null
    },
    apply(st, { widget, tab }) { const { t, x } = tabbed(st, widget, tab); return setWidget(st, t, closeWidgetTab(t, x.id)) },
    describe(b, a, { widget, tab }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o, n) ? `Closed the “${findWtab(o, tab)?.label || tab}” tab of the ${nameOf(o, b.board)}` : null
    },
  })

  // ⭐ Charts operator P1: the widget header's "+" (WidgetHost.handleAddTab → addWidgetTab): another widget as a
  // tab in this slot, coloured like the slot's active tab, and shown. The tab's id is made deterministic here
  // (addWidgetTab mints a random one), so a re-plan of the same request — an approval — writes the same board.
  reg({
    ...common,
    name: 'widget.addTab',
    summary: 'Add another widget as a TAB inside an existing (non-chart) widget — the widget header\'s "+" — and show it. Nothing else on the board moves. Undo closes it.',
    hints: `target = the ref of the board entry; widget = its id; type = one of ${WIDGET_TAB_TYPES.join(', ')}. For a chart's own tabs (symbols, timeframes) use chart.addTab.`,
    args: { type: 'object', properties: { widget: widgetArg, type: { type: 'string', enum: [...WIDGET_TAB_TYPES] } }, required: ['widget', 'type'], additionalProperties: false },
    check(st, { widget, type }) {
      const t = widgetOf(st, widget)
      if (!t) return notOnBoard(widget)
      if (t.type === 'chart') return 'That is a chart — its own tabs are chart tabs (add one with chart.addTab).'
      if (!WIDGET_TAB_TYPES.includes(type)) return `“${type}” can't be added as a tab.`
      if (wtabsOf(t).length >= MAX_WIDGET_TABS) return `The ${label(t.type)} already holds ${MAX_WIDGET_TABS} tabs — close one first.`
      return null
    },
    apply(st, { widget, type }) {
      const t = widgetOf(st, widget)
      const active = widgetTabList(t)[sanitizeWidgetTabs(t).active] || {}
      const next = addWidgetTab(t, { type, color: active.color || t.color || 'A' })
      const ids = new Set(sanitizeWidgetTabs(t).tabs.map(x => x.id))
      let n = ids.size + 1
      while (ids.has(`wta${n}`)) n += 1
      const tabs = next.wtabs.map((x, i) => (i === next.wtabs.length - 1 ? { ...x, id: `wta${n}` } : x))
      return setWidget(st, t, { ...next, wtabs: tabs })
    },
    describe(b, a, { widget, type }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o, n) ? `Added a ${label(type)} tab to the ${nameOf(o, b.board)} (showing it now)` : null
    },
  })

  // ── chart tabs ──
  const chartWidget = (st, widget) => {
    const t = widgetOf(st, widget)
    if (!t) return { why: notOnBoard(widget) }
    if (t.type !== 'chart') return { why: `The ${label(t.type)} isn't a chart widget.` }
    return { t }
  }
  const setOpts = (st, t, opts) => (same(opts, t.opts) ? st : { ...st, board: st.board.map(w => (w.id === t.id ? { ...w, opts } : w)) })
  const tabArg = { type: 'string' }
  const tabHint = 'tab = "main" (the widget\'s own chart), the extra tab\'s position "1", "2"… or its label, from the board entry\'s chartTabs.'

  reg({
    ...common,
    name: 'chart.addTab',
    summary: 'Add a new chart TAB to a chart widget (the tab strip\'s "+"), on the same link colour as the tab showing now, and switch to it.',
    hints: `target = the ref of the board entry; widget = the chart widget's id; timeframe = ${CHART_TIMEFRAMES.join('|')} or null (daily); name = a label for the tab or null. The new tab follows the same symbol until its link colour is changed (chart.linkTab).`,
    args: { type: 'object', properties: { widget: widgetArg, timeframe: { type: ['string', 'null'], enum: [...CHART_TIMEFRAMES, null] }, name: { type: ['string', 'null'] } }, required: ['widget', 'timeframe', 'name'], additionalProperties: false },
    check(st, { widget }) {
      const { t, why } = chartWidget(st, widget)
      if (why) return why
      return sanitizeChartTabs(t.opts).tabs.length >= MAX_CHART_TABS ? `That chart already has ${MAX_CHART_TABS} extra tabs.` : null
    },
    apply(st, { widget, timeframe, name }) {
      const { t } = chartWidget(st, widget)
      const activeColor = tabsOf(t).find(x => x.active)?.color || t.color || 'A'
      let opts = addChartTab(t.opts || {}, { color: activeColor, tf: timeframe || 'D' })
      if (name) { const { tabs } = sanitizeChartTabs(opts); opts = renameChartTab(opts, tabs[tabs.length - 1].id, name) }
      return setOpts(st, t, opts)
    },
    describe(b, a, { widget }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      if (!o || !n || same(o.opts, n.opts)) return null
      const tabs = tabsOf(n)
      return `Added a chart tab “${tabs[tabs.length - 1].label}” to the ${nameOf(o, b.board)} and switched to it`
    },
  })
  reg({
    ...common,
    name: 'chart.selectTab',
    summary: 'Switch a chart widget to one of its tabs (clicking the tab).',
    hints: `target = the ref of the board entry; widget = the chart widget's id; ${tabHint}`,
    args: { type: 'object', properties: { widget: widgetArg, tab: tabArg }, required: ['widget', 'tab'], additionalProperties: false },
    check(st, { widget, tab }) {
      const { t, why } = chartWidget(st, widget)
      if (why) return why
      return findTab(t, tab) ? null : `That chart has no tab “${tab}”.`
    },
    apply(st, { widget, tab }) {
      const { t } = chartWidget(st, widget)
      return setOpts(st, t, setActiveChartTab(t.opts || {}, tabsOf(t).indexOf(tabsOf(t).find(x => x.key === findTab(t, tab).key))))
    },
    describe(b, a, { widget, tab }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o.opts, n.opts) ? `Switched the ${nameOf(o, b.board)} to its “${findTab(n, tab)?.label || tab}” tab` : null
    },
    noop: () => 'That tab is already showing',
  })
  reg({
    ...common,
    name: 'chart.closeTab',
    summary: 'Close one EXTRA tab of a chart widget (its settings go with it; Undo brings it back exactly). The main tab cannot be closed.',
    hints: `target = the ref of the board entry; widget = the chart widget's id; ${tabHint}`,
    args: { type: 'object', properties: { widget: widgetArg, tab: tabArg }, required: ['widget', 'tab'], additionalProperties: false },
    check(st, { widget, tab }) {
      const { t, why } = chartWidget(st, widget)
      if (why) return why
      const x = findTab(t, tab)
      if (!x) return `That chart has no tab “${tab}”.`
      return x.key === 'main' ? "The chart's main tab can't be closed — remove the widget instead." : null
    },
    apply(st, { widget, tab }) {
      const { t } = chartWidget(st, widget)
      return setOpts(st, t, closeChartTab(t.opts || {}, findTab(t, tab).id))
    },
    describe(b, a, { widget, tab }) {
      const o = b.board.find(w => w.id === String(widget))
      return o ? `Closed the “${findTab(o, tab)?.label || tab}” tab of the ${nameOf(o, b.board)}` : null
    },
  })
  reg({
    ...common,
    name: 'chart.renameTab',
    summary: 'Rename a chart widget\'s tab (double-click on the tab).',
    hints: `target = the ref of the board entry; widget = the chart widget's id; ${tabHint} name = the new label (24 characters at most).`,
    args: { type: 'object', properties: { widget: widgetArg, tab: tabArg, name: { type: 'string' } }, required: ['widget', 'tab', 'name'], additionalProperties: false },
    check(st, { widget, tab, name }) {
      const { t, why } = chartWidget(st, widget)
      if (why) return why
      if (!findTab(t, tab)) return `That chart has no tab “${tab}”.`
      return String(name || '').trim() ? null : 'What should the tab be called?'
    },
    apply(st, { widget, tab, name }) {
      const { t } = chartWidget(st, widget)
      return setOpts(st, t, renameChartTab(t.opts || {}, findTab(t, tab).id, name))
    },
    describe(b, a, { widget, name }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      return o && n && !same(o.opts, n.opts) ? `Renamed the tab to “${String(name).trim().slice(0, 24)}”` : null
    },
    noop: () => 'It already has that name',
  })
  reg({
    ...common,
    name: 'chart.linkTab',
    summary: 'Set the link colour of one chart TAB (the tab\'s colour dot): tabs and widgets with the same colour follow the same symbol.',
    hints: `target = the ref of the board entry; widget = the chart widget's id; ${tabHint} color = ${[...BASE_GROUPS, ...EXTRA_GROUPS].map(c => `${c} (${LINK_NAME[c]})`).join(', ')} (E–H only when the board entry says extraLinkColors: true) — a tab is always linked to a colour. "Two tabs with linked symbols" = give both the same colour.`,
    args: { type: 'object', properties: { widget: widgetArg, tab: tabArg, color: { type: 'string', enum: [...BASE_GROUPS, ...EXTRA_GROUPS] } }, required: ['widget', 'tab', 'color'], additionalProperties: false },
    check(st, { widget, tab, color }, env) {
      const { t, why } = chartWidget(st, widget)
      if (why) return why
      if (!findTab(t, tab)) return `That chart has no tab “${tab}”.`
      if (![...BASE_GROUPS, ...EXTRA_GROUPS].includes(color)) return `Tab colours are ${linkGroups(true).join(', ')}.`
      return extraOff(env, color)
    },
    apply(st, { widget, tab, color }) {
      const { t } = chartWidget(st, widget)
      const x = findTab(t, tab)
      if (x.key === 'main') return t.color === color ? st : { ...st, board: st.board.map(w => (w.id === t.id ? { ...w, color } : w)) }
      return setOpts(st, t, patchChartTab(t.opts || {}, x.id, { color }))
    },
    describe(b, a, { widget, tab, color }) {
      const o = b.board.find(w => w.id === String(widget)), n = a.board.find(w => w.id === String(widget))
      if (!o || !n || (same(o.opts, n.opts) && o.color === n.color)) return null
      return `Linked the “${findTab(n, tab)?.label || tab}” tab to the ${LINK_NAME[color]} group (${color})`
    },
    noop: () => 'That tab already has that link colour',
  })}

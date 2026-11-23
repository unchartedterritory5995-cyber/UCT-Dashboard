// ── E2E EVAL: an EXECUTABLE fixture board, its saved copy, and its state snapshot (test-only) ─────────────
//
// The real-model bench's boards (corpus.json / realModelBench / e2eBench `fixtures` format), built so that the REAL
// panel can change them: the product's own chart source (host.buildChartSource — positions, labels "Left chart (MSFT)",
// the clicked chart) over a live board (__fixtures__/board.js makeBoard: placement, applyBoard, layouts, watchlists with
// the real routes' semantics), the real drawing source over the real drawings store, and a SAVED COPY of the board
// behind `host.persist` — the server's charts_workspace_layout, as ChartsWorkspace.persist answers it.
//
//   conflict: null                 every save is accepted (the saved copy follows the screen)
//   conflict: 'paneSizes'          a save that carries a pane-size change is refused as a revision conflict (409
//                                  workspace_conflict), and — as usePreferences does until a reload — EVERY later
//                                  save in that tab is refused too (INV2 §1.3c: the conflict is sticky)
//   conflict: 'always'             every save is refused (a tab that already holds a conflict)
//
// snapshot() is what a turn is scored on: every chart (symbol, timeframe, its stored settings), every widget, the
// layout library, the watchlists on the server, the drawings, and the saved copy. Generated ids (indicator
// instances, drawing ids, timestamps) are renamed / dropped so two runs of the same change compare equal.
import { makeBoard } from '../__fixtures__/board'
import { buildChartSource, buildDrawingSource } from '../host'
import { mergeChartSettings, CHART_DEFAULTS } from '../../components/chart/chartDefaults'
import * as drawingsStore from '../../components/chart/drawingsStore'

// the fixture boards' charts carry NO indicators (fixtureHost.js BARE): the product defaults are tombstoned
export const BARE = { overlays: CHART_DEFAULTS.overlays.map(() => ({ removed: true })) }

/** A board from a fixture spec ({ charts, watchlistWidget?, selected?, drawings? }), with `state` / `libExtra` applied. */
export function buildBoard(spec, fxName, { state = null, libExtra = null, conflict = null } = {}) {
  const base = spec.fixtures[fxName]
  if (!base) throw new Error(`unknown fixture ${fxName}`)
  const lib = {
    ...spec.library,
    watchlists: [...spec.library.watchlists, ...(libExtra?.watchlists || [])],
    layouts: [...spec.library.layouts, ...(libExtra?.layouts || [])],
  }
  const charts = base.charts.map(c => ({ ...c, ...(state?.charts?.[c.id] || {}) }))
  let selected = state && 'selected' in state ? state.selected : (base.selected ?? null)
  const widgets = charts.map(c => ({ id: c.id, type: 'chart', x: c.x, y: c.y, w: c.w, h: c.h, color: 'N', opts: { tf: c.tf, settings: JSON.parse(JSON.stringify({ ...BARE, ...(c.settings || {}) })) } }))
  if (base.watchlistWidget) {
    const w = base.watchlistWidget
    const list = lib.watchlists.find(l => l.id === w.list)
    widgets.push({ id: w.id, type: 'watchlist', x: w.x, y: w.y, w: w.w, h: w.h, color: 'Z', opts: { watchKey: `user:${w.list}`, watchName: list?.name, watchTab: 'mine' } })
  }
  const syms = Object.fromEntries(charts.map(c => [`N:${c.id}`, c.symbol]))
  const b = makeBoard(widgets, syms, { layouts: { entries: lib.layouts, boards: {}, active: lib.activeLayout }, watchlists: lib.watchlists })
  const st = b.state
  const simple = b.host.charts                          // makeBoard's writer: commit(ref, patch) on the live state
  const keyOf = (w) => (w.color === 'N' ? `N:${w.id}` : w.color)
  // one live adapter per chart WIDGET on the board (charts the Agent adds get one too), as ChartWidget registers it
  const apiFor = (id) => ({ agent: {
    read: () => {
      const w = st.widgets.find(x => x.id === id && x.type === 'chart')
      if (!w) return null
      const stored = w.opts.settings ?? null
      return { chartId: id, tabId: null, groupKey: keyOf(w), symbol: st.groupSyms[keyOf(w)] || 'SPY', tf: w.opts.tf || 'D',
        cs: mergeChartSettings(stored), stored, watermarkPos: w.opts.watermarkPos ?? null, dock: w.opts.dock ?? null, dockTabs: 1 }
    },
    view: () => null,
    drawSym: () => { const w = st.widgets.find(x => x.id === id); return w ? (st.groupSyms[keyOf(w)] || 'SPY') : null },
    canDock: () => true,
    commit: (patch) => simple.commit(id, patch),
  } })
  const apis = new Map()
  const chartApiById = { get current() {
    for (const w of st.widgets) if (w.type === 'chart' && !apis.has(`m-${w.id}`)) apis.set(`m-${w.id}`, apiFor(w.id))
    for (const k of [...apis.keys()]) if (!st.widgets.some(w => `m-${w.id}` === k)) apis.delete(k)
    return apis
  } }
  const host = b.host
  host.charts = buildChartSource({ chartApiById, getWidgets: () => st.widgets, selectedChart: () => selected })
  host.charts.canManageIndicators = () => true
  host.charts.canCreateIndicator = () => true
  host.charts.previewHost = () => null
  if (base.drawings) host.drawings = buildDrawingSource(host.charts)
  const snap = host.layouts.snapshot
  host.layouts = { ...host.layouts, snapshot: () => ({ ...snap(), recent: lib.recentLayouts }) }

  // ── the saved copy (charts_workspace_layout) behind host.persist ──
  let mode = conflict
  const save = { copy: savedForm(st), calls: 0, refused: 0, sticky: conflict === 'always' }
  st.save = save
  host.persist = async () => {
    save.calls += 1
    const now = savedForm(st)
    if (mode && (save.sticky || (mode === 'paneSizes' && paneSizesOf(now) !== paneSizesOf(save.copy)))) {
      save.sticky = true
      save.refused += 1
      return { ok: false, conflict: true, reason: 'conflict' }
    }
    save.copy = now
    return { ok: true }
  }
  // the oracle's own turn saves normally (its plan leaves out what the conflict blocks)
  const setConflict = (m) => { mode = m; save.sticky = m === 'always' }
  return { host, board: b, state: st, lib, select: (id) => { selected = id }, setConflict }
}

// what the server stores for the board: the widgets as the workspace saves them (settings included) and the link groups
const savedForm = (st) => JSON.parse(JSON.stringify({ widgets: st.widgets.map(({ id, type, x, y, w, h, color, opts }) => ({ id, type, x, y, w, h, color, opts })), groupSyms: st.groupSyms }))
const paneSizesOf = (saved) => JSON.stringify(saved.widgets.map(w => [w.id, w.opts?.settings?.paneSizes || null]))

// ── snapshot ────────────────────────────────────────────────────────────────────────────────────────────
const VOLATILE = new Set(['createdAt', 'updatedAt', 'at', 'ts', 'savedAt', 'lastModified'])

/** Instance ids (inst:<def>:<n>) renamed by their rank per definition, so a re-run that minted other numbers compares equal. */
function instanceNames(json) {
  const seen = [...new Set(json.match(/inst:[A-Za-z0-9_.-]+:\d+/g) || [])]
  const by = new Map()
  for (const s of seen) {
    const [, def, n] = /^inst:(.+):(\d+)$/.exec(s)
    if (!by.has(def)) by.set(def, [])
    by.get(def).push([s, Number(n)])
  }
  const rename = new Map()
  for (const [def, list] of by) list.sort((a, b) => a[1] - b[1]).forEach(([s], k) => rename.set(s, `inst:${def}#${k + 1}`))
  return rename
}

function canon(v, depth = 0, keepId = false) {
  if (Array.isArray(v)) {
    const xs = v.map(x => canon(x, depth + 1))
    // arrays of objects compare as multisets (an indicator added first or second is the same board)
    return xs.every(x => x && typeof x === 'object' && !Array.isArray(x)) ? xs.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) : xs
  }
  if (v && typeof v === 'object') {
    const out = {}
    for (const k of Object.keys(v).sort()) {
      if (VOLATILE.has(k)) continue
      if (k === 'id' && !keepId) continue
      if (v[k] === undefined) continue
      out[k] = canon(v[k], depth + 1)
    }
    return out
  }
  return v
}

/** The board's state, normalized: { charts: {id: {...}}, widgets: {id: {...}}, layouts, watchlists, drawings, saved }. */
export function snapshot(built) {
  const st = built.state
  const keyOf = (w) => (w.color === 'N' ? `N:${w.id}` : w.color)
  const charts = {}
  const widgets = {}
  for (const w of st.widgets) {
    const { settings, tf, ...rest } = w.opts || {}
    if (w.type === 'chart') {
      charts[w.id] = { symbol: st.groupSyms[keyOf(w)] || 'SPY', tf: tf || 'D', settings: canon(mergeChartSettings(settings ?? null)), opts: canon(rest) }
    }
    widgets[w.id] = { type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, color: w.color, ...(w.type === 'chart' ? {} : { opts: canon({ ...rest, ...(tf ? { tf } : {}) }) }) }
  }
  const lib = st.layouts
  const layouts = lib ? { active: lib.activeId ?? null, entries: lib.entries.map(e => `${e.scope}:${e.name}`).sort(), unsaved: !!lib.unsaved } : null
  const watchlists = st.server ? Object.fromEntries(st.server.lists.map(l => [l.name, l.items.map(i => i.sym)])) : null
  let drawings = null
  try {
    const doc = drawingsStore.exportTracings?.()
    const by = doc?.byTracing ? Object.values(doc.byTracing).reduce((acc, m) => ({ ...acc, ...m }), {}) : {}
    drawings = Object.fromEntries(Object.entries(by).filter(([, ds]) => Array.isArray(ds) && ds.length).map(([sym, ds]) => [sym, canon(ds)]))
  } catch { drawings = null }
  const saved = st.save ? canon(savedChartsOf(st.save.copy, keyOf)) : null
  const screen = st.save ? canon(savedChartsOf(savedForm(st), keyOf)) : null
  const out = { charts, widgets, layouts, watchlists, drawings }
  const json = JSON.stringify(out)
  const rename = instanceNames(json)
  const fix = (s) => { let t = s; for (const [a, b] of rename) t = t.split(a).join(b); return t }
  return {
    ...JSON.parse(fix(json)),
    // residue: the screen and the saved copy disagree (a change on screen that the server refused, or the reverse)
    residue: saved && screen ? fix(JSON.stringify(saved)) !== fix(JSON.stringify(screen)) : false,
    saveRefused: st.save ? st.save.refused : 0,
  }
}

const savedChartsOf = (saved, keyOf) => Object.fromEntries(saved.widgets.map(w => [w.id, { type: w.type, x: w.x, y: w.y, w: w.w, h: w.h,
  ...(w.type === 'chart' ? { symbol: saved.groupSyms[keyOf(w)] || 'SPY', tf: w.opts?.tf || 'D', settings: mergeChartSettings(w.opts?.settings ?? null) } : {}) }]))

// ── entity diff ─────────────────────────────────────────────────────────────────────────────────────────
/** The board's entities, each comparable on its own: chart:<id>, widget:<id>, list:<name>, drawings:<sym>, layouts. */
export function entities(s) {
  const out = {}
  for (const [id, c] of Object.entries(s.charts || {})) out[`chart:${id}`] = c
  for (const [id, w] of Object.entries(s.widgets || {})) out[`widget:${id}`] = w
  for (const [n, l] of Object.entries(s.watchlists || {})) out[`list:${n}`] = l
  for (const [sym, d] of Object.entries(s.drawings || {})) out[`drawings:${sym}`] = d
  if (s.layouts) out.layouts = s.layouts
  return out
}

const J = (v) => (v === undefined ? '∅' : JSON.stringify(v))

/** Leaf paths of a value ("settings.indicatorInstances.0.inputs.period" → value). */
export function leaves(v, at = '', out = {}) {
  if (v && typeof v === 'object') {
    const ks = Object.keys(v)
    if (!ks.length) out[at] = Array.isArray(v) ? '[]' : '{}'
    for (const k of ks) leaves(v[k], at ? `${at}.${k}` : k, out)
  } else out[at] = J(v)
  return out
}

/** The leaf changes from `a` to `b`: { path: [before, after] }. */
export function leafDelta(a, b) {
  const la = a === undefined ? {} : leaves(a), lb = b === undefined ? {} : leaves(b)
  const d = {}
  for (const k of new Set([...Object.keys(la), ...Object.keys(lb)])) if (la[k] !== lb[k]) d[k] = [la[k], lb[k]]
  return d
}

/**
 * Compare a turn's actual board with the oracle's, both from the same `pre` board.
 * → { equal, done: [entity], missing: [entity], wrong: [entity], extra: [entity], destructive: [entity…why] }
 */
export function compareBoards(pre, actual, oracle) {
  const P = entities(pre), A = entities(actual), O = entities(oracle)
  const keys = new Set([...Object.keys(P), ...Object.keys(A), ...Object.keys(O)])
  const r = { done: [], missing: [], wrong: [], extra: [], destructive: [] }
  for (const k of [...keys].sort()) {
    const p = J(P[k]), a = J(A[k]), o = J(O[k])
    if (o !== p) {
      if (a === o) r.done.push(k)
      else if (a === p) r.missing.push(k)
      else r.wrong.push(k)
    } else if (a !== p) r.extra.push(k)
    // a removal the oracle did not make: an entity gone, a leaf the board had that is gone, an item marked removed
    if (a !== o) {
      if (P[k] !== undefined && A[k] === undefined && O[k] !== undefined) r.destructive.push(`${k} removed`)
      else if (P[k] !== undefined && A[k] !== undefined) {
        const lp = leaves(P[k]), la = leaves(A[k]), lo = O[k] === undefined ? {} : leaves(O[k])
        // a leaf the board had that is gone (an empty {} / [] that gained children is not a loss)
        const kept = (x) => Object.keys(la).some(y => y.startsWith(`${x}.`))
        // only things of value count (an indicator, a drawing, a list item); a setting going back to its default does not
        const gone = Object.keys(lp).filter(x => !(x in la) && (x in lo) && !(['{}', '[]'].includes(lp[x]) && kept(x)) && /(^|\.)indicatorInstances\./.test(x))
        const marked = Object.keys(la).filter(x => /(^|\.)(deleted|removed)$/.test(x) && la[x] === 'true' && lp[x] !== 'true' && lo[x] !== 'true')
        if (Array.isArray(P[k]) && Array.isArray(A[k]) && A[k].length < P[k].length && !(Array.isArray(O[k]) && O[k].length < P[k].length)) r.destructive.push(`${k} shrank`)
        else if (gone.length) r.destructive.push(`${k} lost ${gone.slice(0, 2).join(',')}`)
        else if (marked.length) r.destructive.push(`${k} ${marked[0]}`)
      }
    }
  }
  r.equal = !r.missing.length && !r.wrong.length && !r.extra.length
  return r
}

/** Same change, other chart: the actual changes on charts the oracle left alone match the oracle's on the charts it changed. */
export function changeOnOtherChart(pre, actual, oracle, cmp) {
  const P = entities(pre), A = entities(actual), O = entities(oracle)
  const want = [...cmp.missing, ...cmp.wrong].filter(k => k.startsWith('chart:'))
  const got = cmp.extra.filter(k => k.startsWith('chart:'))
  if (!want.length || !got.length) return false
  const shape = (d) => Object.keys(d).map(p => `${p}=${d[p][1]}`).filter(x => !x.startsWith('symbol=')).sort().join('|')
  const wanted = want.map(k => shape(leafDelta(P[k], O[k])))
  return got.some(k => wanted.includes(shape(leafDelta(P[k], A[k]))))
}

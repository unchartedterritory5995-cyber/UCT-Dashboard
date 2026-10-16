// ── NL-1 EVAL: a fixture board as a real host ───────────────────────────────────────────────
//
// The same construction the corpus harnesses use (agentNlCorpus / agentEvalBaseline): the REAL
// buildChartSource (positions, labels, the clicked chart) over the shared __fixtures__/board.js, so
// target refs, labels and planning behave exactly as on a member's board. Test-only module.
//
// A case may adjust its fixture without a new one:
//   state:   { charts: { <id>: { tf?, symbol? } }, selected?: <id>|null }   the board after earlier turns
//   libExtra: { watchlists?: [...], layouts?: [...] }                       extra named things (e.g. an
//                                                                           injection attempt in a name)
import { makeBoard } from '../__fixtures__/board'
import { buildChartSource } from '../host'
import { mergeChartSettings } from '../../components/chart/chartDefaults'

export function hostFor(spec, fxName, { state = null, libExtra = null } = {}) {
  const base = spec.fixtures[fxName]
  if (!base) throw new Error(`unknown fixture ${fxName}`)
  const lib = {
    ...spec.library,
    watchlists: [...spec.library.watchlists, ...(libExtra?.watchlists || [])],
    layouts: [...spec.library.layouts, ...(libExtra?.layouts || [])],
  }
  const charts = base.charts.map(c => ({ ...c, ...(state?.charts?.[c.id] || {}) }))
  const selected = state && 'selected' in state ? state.selected : base.selected
  const widgets = charts.map(c => ({ id: c.id, type: 'chart', x: c.x, y: c.y, w: c.w, h: c.h, color: c.id, opts: { tf: c.tf } }))
  if (base.watchlistWidget) {
    const w = base.watchlistWidget
    const list = lib.watchlists.find(l => l.id === w.list)
    widgets.push({ id: w.id, type: 'watchlist', x: w.x, y: w.y, w: w.w, h: w.h, color: 'Z', opts: { watchKey: `user:${w.list}`, watchName: list?.name, watchTab: 'mine' } })
  }
  const syms = Object.fromEntries(charts.map(c => [c.id, c.symbol]))
  const b = makeBoard(widgets, syms, { layouts: { entries: lib.layouts, boards: {}, active: lib.activeLayout }, watchlists: lib.watchlists })
  const apis = new Map(charts.map(c => [`m-${c.id}`, { agent: {
    read: () => ({ chartId: c.id, tabId: null, groupKey: c.id, symbol: c.symbol, tf: c.tf, cs: mergeChartSettings(null), stored: null }),
    view: () => null, drawSym: () => c.symbol,
  } }]))
  b.host.charts = buildChartSource({ chartApiById: { current: apis }, getWidgets: () => b.state.widgets, selectedChart: () => selected })
  const snap = b.host.layouts.snapshot
  b.host.layouts = { ...b.host.layouts, snapshot: () => ({ ...snap(), recent: lib.recentLayouts }) }
  return { host: b.host, board: b, selected, lib }
}

/** Display names → ids for layouts and watchlists ("Day Trading" → "2"): cases name things the way a member does. */
export function nameToId(lib) {
  return Object.fromEntries([...lib.layouts, ...lib.watchlists].map(e => [String(e.name).toLowerCase(), String(e.id)]))
}

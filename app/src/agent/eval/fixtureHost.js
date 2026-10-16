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
import { mergeChartSettings, CHART_DEFAULTS } from '../../components/chart/chartDefaults'

// The fixture boards' charts carry NO indicators — what the corpus, the dev sets and the blind writer's notes all
// assume. Product defaults draw EMA 9/20 and SMA 50/200; they are removed here (tombstones, as a member's removal is)
// so "add a 50 SMA" is asked on a chart that does not already show one (proxy smoke finding, 2026-10-16).
const BARE = { overlays: CHART_DEFAULTS.overlays.map(() => ({ removed: true })) }

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
    read: () => ({ chartId: c.id, tabId: null, groupKey: c.id, symbol: c.symbol, tf: c.tf, cs: mergeChartSettings(BARE), stored: BARE }),
    view: () => null, drawSym: () => c.symbol,
  } }]))
  b.host.charts = buildChartSource({ chartApiById: { current: apis }, getWidgets: () => b.state.widgets, selectedChart: () => selected })
  // a member's real charts manage indicators (and an admin may create them): without this the indicator
  // actions are not AVAILABLE, and the model would be asked with 81 of the 91 actions (proxy smoke, 2026-10-16)
  b.host.charts.canManageIndicators = () => true
  b.host.charts.canCreateIndicator = () => true
  const snap = b.host.layouts.snapshot
  b.host.layouts = { ...b.host.layouts, snapshot: () => ({ ...snap(), recent: lib.recentLayouts }) }
  return { host: b.host, board: b, selected, lib }
}

/** Display names → ids for layouts and watchlists ("Day Trading" → "2"): cases name things the way a member does. */
export function nameToId(lib) {
  return Object.fromEntries([...lib.layouts, ...lib.watchlists].map(e => [String(e.name).toLowerCase(), String(e.id)]))
}

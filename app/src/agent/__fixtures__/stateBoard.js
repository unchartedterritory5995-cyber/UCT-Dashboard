// The Charts workspace with EXISTING member state of every kind the state rail guards (stateRail.js): two charts with an RSI
// and the four classic averages, drawings on SPY / NVDA (a line, a trendline, a Fibonacci, a position, a text), two Drawing
// Boards, saved watchlists (one with a note), a Flagged list, a Watchlist widget showing a list (with a News tab), a Scanner
// widget showing a scan, two saved layouts pinned on the Layout bar, a saved chart template and an indicator template.
// Shared by agentStateRail.census.test.js and agentStateRail.test.jsx. Drawings live in the module store (reset here).
import { makeBoard } from './board'
import { mergeChartSettings } from '../../components/chart/chartDefaults'
import { buildDrawingSource, buildDrawingBoardSource, buildLayoutDockSource } from '../host'
import * as store from '../../components/chart/drawingsStore'
import { planIndicatorMutation, applyIndicatorMutation } from '../../components/chart/builder/agentMutations'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'

export const T1 = Date.UTC(2026, 0, 5) / 1000, T2 = Date.UTC(2026, 1, 2) / 1000
const MCTX = { canManage: true, ownedDefinitionIds: [], registry: nativeRegistry, chartId: 'c1', volumeOpts: { volumeSeparatePane: true, blankVolume: false } }
/** A chart's settings with an RSI added (the classic averages EMA 9 / EMA 20 / SMA 50 / SMA 200 are there by default). */
export function settingsWithRsi() {
  const cs = mergeChartSettings(null)
  const p = planIndicatorMutation(cs, { op: 'add', defId: 'rsi' }, MCTX)
  return applyIndicatorMutation(cs, p.plan, { ...MCTX, storedSettings: null }).cs
}
export const SCAN = 'highest-volume-1y'
let DRAWING_IDS = []
export const drawingIds = () => DRAWING_IDS
// each chart reports a loaded VIEW (the date navigator's read-out), so view controls and dated drawing anchors can be planned
const VIEW = { firstMs: Date.UTC(2025, 0, 2), lastMs: Date.UTC(2026, 9, 30), rightMs: Date.UTC(2026, 9, 30), activeRange: null, atDefaultView: false, indicatorsHidden: false, priceAuto: true,
  zoomLimits: { minWidth: 1, maxWidth: 2000 }, frame: { fromRight: 100, toRight: 0, activeRange: null, locked: false, lock: null } }
/** The Charts fixture with existing state of every kind. Drawings live in the module store (reset here). */
export function stateFixture() {
  store._reset()
  // the store keeps its boards (and their drawings) across _reset: back to the first board, emptied
  const first = store.listTracings()[0]?.id
  if (first) store.setActiveTracing(first)
  for (const sym of ['SPY', 'NVDA']) store.clearAll(sym)
  // fixed ids, written through the store's own restore (an add of the same payload twice in one task is deduplicated)
  const put = (sym, d) => store.restoreDrawing(sym, d)
  DRAWING_IDS = [
    put('SPY', { id: 'dr-h', type: 'horizontal', points: [{ price: 100 }] }),
    put('SPY', { id: 'dr-t', type: 'trendline', points: [{ time: T1, price: 100 }, { time: T2, price: 110 }] }),
    put('NVDA', { id: 'dr-n', type: 'horizontal', points: [{ price: 50 }] }),
    put('SPY', { id: 'dr-f', type: 'fib', points: [{ time: T1, price: 100 }, { time: T2, price: 120 }] }),
    put('SPY', { id: 'dr-p', type: 'position', side: 'long', points: [{ time: T1, price: 100 }, { time: T2, price: 120 }, { time: T2, price: 90 }] }),
    put('SPY', { id: 'dr-x', type: 'text', text: 'Note', points: [{ time: T1, price: 100 }] }),
  ]
  // a second Drawing Board (the store keeps its boards across _reset: made once)
  const second = store.listTracings().find(t => t.name === 'Swing board')?.id || store.createTracing({ name: 'Swing board' })
  const cs = settingsWithRsi()
  const w = [
    { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 14, color: 'N', opts: { settings: cs } },
    { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 14, color: 'N', opts: { settings: cs } },
    { id: 'wl', type: 'watchlist', x: 16, y: 0, w: 4, h: 20, color: 'A', opts: { watchKey: 'user:wl1', watchName: 'Tech', watchTab: 'mine' }, wtabs: [{ id: 'wt1', type: 'news' }], activeWtab: 0 },
    { id: 'sc', type: 'scanner', x: 20, y: 0, w: 4, h: 20, color: 'A', opts: { scanKey: SCAN, scanName: 'Highest Volume In 1-Year' } },
  ]
  const entries = [{ id: 11, name: 'Mine' }, { id: 12, name: 'Swing' }]
  const b = makeBoard(w, { 'N:c1': 'SPY', 'N:c2': 'NVDA', A: 'SPY' }, {
    layouts: { entries, boards: { 11: w, 12: [] }, active: 11 },
    watchlists: [{ id: 'wl1', name: 'Tech', symbols: ['SPY', 'NVDA', 'AMD'], notes: { SPY: 'core holding' } }, { id: 'wl2', name: 'Swing', symbols: ['TSLA', 'META'] }],
  })
  const base = b.host.charts
  const charts = { ...base, read: (r) => { const x = base.read(r); return x && { ...x, view: VIEW } }, list: () => base.list().map(x => ({ ...x, view: VIEW })),
    canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }
  let prefs = { chart_templates: JSON.stringify([{ id: 't1', name: 'Dark', settings: mergeChartSettings(null) }]),
    indicator_templates: JSON.stringify([{ id: 'it1', name: 'Momentum', instances: [{ instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }] }]) }
  let flags = ['SPY', 'AMD']
  const dock = { snapshot: () => ({ ready: true, hidden: false, pins: [11, 12], names: { 11: 'Mine', 12: 'Swing' }, library: entries.map(e => ({ ...e, scope: 'user' })) }),
    pin: async () => true, unpin: async () => true, shift: async () => true, restore: async () => true }
  const host = {
    ...b.host, charts, drawings: buildDrawingSource(charts), drawingBoards: buildDrawingBoardSource(store), layoutDock: buildLayoutDockSource(() => dock),
    flagged: { read: () => [...flags], write: async (n) => { flags = [...n]; return true } },
    persist: async () => ({ ok: true }),
    prefs: { read: () => prefs, merge: async (p) => { prefs = { ...prefs, ...p }; return true }, write: async (k, v) => { prefs = { ...prefs, [k]: v }; return true } },
  }
  return { b, host, boards: { second }, prefs: () => prefs, flags: () => flags }
}

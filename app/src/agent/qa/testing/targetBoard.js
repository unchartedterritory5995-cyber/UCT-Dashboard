// ⛔ TARGET COVERAGE fixture (AUDIT safety, 2026-11-17) — the state-rail fixture (__fixtures__/stateBoard.js) with 2–3 objects of
// EVERY kind a state-rail effect targets, so a plan can be aimed at the RIGHT object and at a WRONG one of the same kind:
// indicators (EMA 9 / EMA 20 / SMA 50 / SMA 200 / RSI 14 on SPY and NVDA), drawings (SPY: horizontal, trendline, fib,
// position, text “Note”; NVDA: horizontal), Drawing Boards (Swing board, Macro board), watchlists (Tech, Swing, Growth, Value —
// two with a note), the Flagged list (SPY, AMD), two Watchlist widgets (Tech with a News and a Calendar tab; Growth) and a
// Scanner, three saved layouts all pinned (Mine, Swing, Day), two chart templates (Dark, Light), two indicator templates
// (Momentum, Breakout), two UCT News collections (Earnings, Watch). Used only by agentStateRail.targetCoverage.test.js.
import { makeBoard } from '../../__fixtures__/board'
import { settingsWithRsi, SCAN, T1, T2 } from '../../__fixtures__/stateBoard'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { buildDrawingSource, buildDrawingBoardSource, buildLayoutDockSource } from '../../host'
import * as store from '../../../components/chart/drawingsStore'

function newsLibraryStandIn() {
  const st = { status: 'ready', ids: new Set(['ev1']), collections: [{ id: 'k1', name: 'Earnings', count: 1 }, { id: 'k2', name: 'Watch', count: 0 }], notes: { ev1: 'old note' }, member: { ev1: ['k1'] } }
  const ok = async () => ({ ok: true })
  return { getSnapshot: () => st, load: async () => st, isSaved: (id) => st.ids.has(id), save: ok, remove: async () => ({ ok: true, removed: { event_id: 'ev1' } }), undoRemove: ok,
    setNote: ok, createCollection: async () => ({ ok: true, body: { id: 'k3' } }), renameCollection: ok, deleteCollection: ok, setMembership: ok, setMembershipSaving: ok,
    fetchBookmark: async () => ({ ok: true, bookmark: { note: st.notes.ev1, collection_ids: st.member.ev1 } }) }
}
const VIEW = { firstMs: Date.UTC(2025, 0, 2), lastMs: Date.UTC(2026, 9, 30), rightMs: Date.UTC(2026, 9, 30), activeRange: null, atDefaultView: false, indicatorsHidden: false, priceAuto: true,
  zoomLimits: { minWidth: 1, maxWidth: 2000 }, frame: { fromRight: 100, toRight: 0, activeRange: null, locked: false, lock: null } }

export const LISTS = [
  { id: 'wl1', name: 'Tech', symbols: ['SPY', 'NVDA', 'AMD'], notes: { SPY: 'core holding' } },
  { id: 'wl2', name: 'Swing', symbols: ['TSLA', 'META'], notes: { TSLA: 'swing idea' } },
  { id: 'wl3', name: 'Growth', symbols: ['CRWD', 'NET'] },
  { id: 'wl4', name: 'Value', symbols: ['KO', 'PG'] },
]
export const LAYOUTS = [{ id: 11, name: 'Mine' }, { id: 12, name: 'Swing' }, { id: 13, name: 'Day' }]

export function targetFixture() {
  store._reset()
  const first = store.listTracings()[0]?.id
  if (first) store.setActiveTracing(first)
  for (const sym of ['SPY', 'NVDA']) store.clearAll(sym)
  const put = (sym, d) => store.restoreDrawing(sym, d)
  put('SPY', { id: 'dr-h', type: 'horizontal', points: [{ price: 100 }] })
  put('SPY', { id: 'dr-t', type: 'trendline', points: [{ time: T1, price: 100 }, { time: T2, price: 110 }] })
  put('NVDA', { id: 'dr-n', type: 'horizontal', points: [{ price: 50 }] })
  put('SPY', { id: 'dr-f', type: 'fib', points: [{ time: T1, price: 100 }, { time: T2, price: 120 }] })
  put('SPY', { id: 'dr-p', type: 'position', side: 'long', points: [{ time: T1, price: 100 }, { time: T2, price: 120 }, { time: T2, price: 90 }] })
  put('SPY', { id: 'dr-x', type: 'text', text: 'Note', points: [{ time: T1, price: 100 }] })
  const boardId = (name) => store.listTracings().find(t => t.name === name)?.id || store.createTracing({ name })
  const boards = { swing: boardId('Swing board'), macro: boardId('Macro board') }
  const cs = settingsWithRsi()
  const w = [
    { id: 'c1', type: 'chart', x: 0, y: 0, w: 8, h: 14, color: 'N', opts: { settings: cs } },
    { id: 'c2', type: 'chart', x: 8, y: 0, w: 8, h: 14, color: 'N', opts: { settings: cs } },
    { id: 'wl', type: 'watchlist', x: 16, y: 0, w: 4, h: 20, color: 'A', opts: { watchKey: 'user:wl1', watchName: 'Tech', watchTab: 'mine' }, wtabs: [{ id: 'wt1', type: 'news' }, { id: 'wt2', type: 'calendar' }], activeWtab: 0 },
    { id: 'sc', type: 'scanner', x: 20, y: 0, w: 4, h: 10, color: 'A', opts: { scanKey: SCAN, scanName: 'Highest Volume In 1-Year' } },
    { id: 'wg', type: 'watchlist', x: 20, y: 10, w: 4, h: 10, color: 'A', opts: { watchKey: 'user:wl3', watchName: 'Growth', watchTab: 'mine' } },
  ]
  const b = makeBoard(w, { 'N:c1': 'SPY', 'N:c2': 'NVDA', A: 'SPY' }, {
    layouts: { entries: LAYOUTS, boards: { 11: w, 12: [], 13: [] }, active: 11 },
    watchlists: LISTS.map(l => ({ ...l, symbols: [...l.symbols], notes: { ...(l.notes || {}) } })),
  })
  const base = b.host.charts
  const charts = { ...base, read: (r) => { const x = base.read(r); return x && { ...x, view: VIEW } }, list: () => base.list().map(x => ({ ...x, view: VIEW })),
    canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }
  let prefs = { chart_templates: JSON.stringify([{ id: 't1', name: 'Dark', settings: mergeChartSettings(null) }, { id: 't2', name: 'Light', settings: mergeChartSettings(null) }]),
    indicator_templates: JSON.stringify([{ id: 'it1', name: 'Momentum', instances: [{ instanceId: 'inst:macd:1', defId: 'macd', inputs: {} }] }, { id: 'it2', name: 'Breakout', instances: [{ instanceId: 'inst:atr:1', defId: 'atr', inputs: {} }] }]) }
  let flags = ['SPY', 'AMD']
  const dock = { snapshot: () => ({ ready: true, hidden: false, pins: [11, 12, 13], names: { 11: 'Mine', 12: 'Swing', 13: 'Day' }, library: LAYOUTS.map(e => ({ ...e, scope: 'user' })) }),
    pin: async () => true, unpin: async () => true, shift: async () => true, restore: async () => true }
  const host = {
    ...b.host, charts, drawings: buildDrawingSource(charts), drawingBoards: buildDrawingBoardSource(store), layoutDock: buildLayoutDockSource(() => dock),
    flagged: { read: () => [...flags], write: async (n) => { flags = [...n]; return true } },
    persist: async () => ({ ok: true }),
    newsLibrary: newsLibraryStandIn(),
    prefs: { read: () => prefs, merge: async (p) => { prefs = { ...prefs, ...p }; return true }, write: async (k, v) => { prefs = { ...prefs, [k]: v }; return true } },
  }
  // what useAgent hands the rail as its scope (useAgent railOf: the member's watchlists)
  const scope = { watchlists: LISTS.length, lists: LISTS.map(l => ({ ref: l.id, name: l.name, symbols: [...l.symbols] })) }
  return { b, host, boards, scope }
}

// The Screener's scan board (owner direction 2026-11-17): the Screener as a customizable widget
// board, the Charts page's idea made for scanning. A few presets, then the member's own layouts.
// This file is the board's rules and nothing else: pure functions over plain data, no React.
//
//   state = { layoutId, widgets, changed, mine, screens, logos, spark, group, seen, hints, roomy }
//   widget = { id, type, x, y, w, h, opts? }        on a COLS x ROWS grid locked to the window
//
// Owner rulings recorded here so they cannot drift back in: no table and no heat map as options
// (2026-11-17). `sanitize` drops anything a stored layout holds that the board no longer offers.

export const BOARD_PREF = 'screener_scan_board'
export const COLS = 24
export const ROWS = 20
export const MAX_MINE = 12
export const MAX_NAME = 40

export const WIDGETS = {
  results: { name: 'Results', blurb: 'The stocks the screen found', minW: 4, minH: 4, add: [7, 10] },
  chart: { name: 'Chart', blurb: 'The selected stock on the full chart', minW: 8, minH: 8, add: [12, 12] },
  details: { name: 'Why it\'s here', blurb: 'The setup and the rules the stock passed', minW: 5, minH: 5, add: [7, 8] },
  news: { name: 'News & catalysts', blurb: 'Headlines and events for the selected stock', minW: 6, minH: 4, add: [10, 6] },
  screens: { name: 'Screens', blurb: 'Every screen, by group, one click to open', minW: 3, minH: 6, add: [4, 20] },
}
export const WIDGET_TYPES = Object.keys(WIDGETS)

export const ROW_STYLES = [['line', 'One line'], ['compact', 'Compact'], ['two', 'Two lines'], ['cards', 'Cards'], ['chips', 'Chips']]
const ROW_KEYS = ROW_STYLES.map(r => r[0])
export const SCREEN_NAV = [['tabs', 'Tabs'], ['menu', 'Dropdown']]
export const SWITCHES = [
  ['logos', 'Company logos'],
  ['spark', 'Mini charts in rows'],
  ['group', 'Group by setup'],
  ['seen', 'Dim stocks I have looked at'],
  ['hints', 'Keyboard hints'],
  ['roomy', 'Roomier rows'],
]

const W = (type, x, y, w, h, opts) => ({ id: type, type, x, y, w, h, ...(opts ? { opts } : {}) })

// The presets every member starts from (owner: "1-3 presets first"). Each tiles the whole grid.
export const PRESETS = [
  { id: 'board', name: 'Board', blurb: 'Big chart on the left; results and the reasons on the right.',
    widgets: [W('chart', 0, 0, 17, 20), W('results', 17, 0, 7, 12, { rows: 'line' }), W('details', 17, 12, 7, 8)] },
  { id: 'three', name: 'Three columns', blurb: 'Screens always visible, then results, then the chart with news under it.',
    widgets: [W('screens', 0, 0, 4, 20), W('results', 4, 0, 7, 20, { rows: 'line' }), W('chart', 11, 0, 13, 14), W('news', 11, 14, 13, 6)] },
]
export const DEFAULT_PRESET = PRESETS[0]

export const copyWidgets = ws => ws.map(w => ({ ...w, ...(w.opts ? { opts: { ...w.opts } } : {}) }))

export const DEFAULT_STATE = Object.freeze({
  layoutId: DEFAULT_PRESET.id, widgets: copyWidgets(DEFAULT_PRESET.widgets), changed: false, mine: [], screens: 'tabs',
  logos: false, spark: false, group: false, seen: false, hints: false, roomy: false,
})

const int = v => (Number.isFinite(v) ? Math.round(v) : NaN)
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

// One widget, made safe: a known type, whole numbers, inside the grid, at least its minimum size.
// Returns null for anything that cannot be a widget (it is dropped, never guessed at).
function cleanWidget(w) {
  if (!w || typeof w !== 'object' || !WIDGETS[w.type]) return null
  const def = WIDGETS[w.type]
  let x = int(w.x), y = int(w.y), cw = int(w.w), h = int(w.h)
  if ([x, y, cw, h].some(Number.isNaN)) return null
  cw = Math.max(def.minW, Math.min(cw, COLS))
  h = Math.max(def.minH, Math.min(h, ROWS))
  x = Math.max(0, Math.min(x, COLS - cw))
  y = Math.max(0, Math.min(y, ROWS - h))
  const rows = ROW_KEYS.includes(w.opts?.rows) ? w.opts.rows : null
  return { id: w.type, type: w.type, x, y, w: cw, h, ...(w.type === 'results' ? { opts: { rows: rows || 'line' } } : {}) }
}

// A stored widget list, made safe: one widget per type (the first wins), each cleaned, and none
// overlapping an earlier one. Null when nothing usable is left or the list overlaps (a layout that
// cannot be drawn is refused whole: the caller falls back to a preset rather than draw a pile-up).
export function cleanWidgets(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (const raw of list) {
    const w = cleanWidget(raw)
    if (!w || out.some(o => o.type === w.type)) continue
    if (out.some(o => overlaps(o, w))) return null
    out.push(w)
  }
  return out.length ? out : null
}

const cleanName = n => (typeof n === 'string' ? n.trim().slice(0, MAX_NAME) : '')

// Whatever was stored (a string from the preferences, an object, garbage), as a state the board
// can draw. Never throws; anything unreadable is the default preset.
export function sanitize(raw) {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_STATE, widgets: copyWidgets(DEFAULT_PRESET.widgets) }
  const mine = (Array.isArray(v.mine) ? v.mine : []).map(m => {
    const widgets = cleanWidgets(m?.widgets)
    const name = cleanName(m?.name)
    return widgets && name && typeof m.id === 'string' && m.id.startsWith('m-') ? { id: m.id, name, widgets } : null
  }).filter(Boolean).slice(0, MAX_MINE)
  const widgets = cleanWidgets(v.widgets)
  const known = typeof v.layoutId === 'string' && (PRESETS.some(p => p.id === v.layoutId) || mine.some(m => m.id === v.layoutId))
  const out = {
    layoutId: widgets && known ? v.layoutId : widgets ? null : DEFAULT_PRESET.id,
    widgets: widgets || copyWidgets(DEFAULT_PRESET.widgets),
    changed: !!widgets && v.changed === true,
    mine,
    screens: SCREEN_NAV.some(n => n[0] === v.screens) ? v.screens : 'tabs',
  }
  SWITCHES.forEach(([k]) => { out[k] = v[k] === true })
  return out
}
// What is written to the preferences: the state, nothing transient.
export const serialize = state => JSON.stringify({ v: 1, ...sanitize(state) })

export const layoutsOf = state => [...PRESETS, ...(state?.mine || [])]
export const currentLayout = state => layoutsOf(state).find(l => l.id === state?.layoutId) || null

// ── actions: (state, ...) -> state ──
export function pickLayout(state, id) {
  const l = layoutsOf(state).find(x => x.id === id)
  return l ? { ...state, layoutId: id, widgets: copyWidgets(l.widgets), changed: false } : state
}
export const withWidgets = (state, widgets) => ({ ...state, widgets, changed: true })
export function setRows(state, rows) {
  if (!ROW_KEYS.includes(rows)) return state
  return withWidgets(state, state.widgets.map(w => (w.type === 'results' ? { ...w, opts: { ...(w.opts || {}), rows } } : w)))
}
export const rowsOf = state => state?.widgets?.find(w => w.type === 'results')?.opts?.rows || 'line'
export const hasWidget = (state, type) => !!state?.widgets?.some(w => w.type === type)
export const missingWidgets = state => WIDGET_TYPES.filter(t => !hasWidget(state, t))
// The last widget is never removed: an empty board has nothing to drag and nothing to read.
export function removeWidget(state, id) {
  if (state.widgets.length <= 1) return state
  return withWidgets(state, state.widgets.filter(w => w.id !== id))
}
// A new widget takes its room from the biggest widget on the board (its right side when that one
// is wide, its bottom when it is tall), so nothing else moves and nothing is squeezed. When the
// biggest cannot give up enough for both to keep their minimum size, the board is left as it was.
export function addWidget(state, type) {
  const def = WIDGETS[type]
  if (!def || hasWidget(state, type)) return state
  const base = { id: type, type, ...(type === 'results' ? { opts: { rows: 'line' } } : {}) }
  const big = [...state.widgets].sort((p, q) => q.w * q.h - p.w * p.h)[0]
  if (!big) return withWidgets(state, [{ ...base, x: 0, y: 0, w: COLS, h: ROWS }])
  const bigDef = WIDGETS[big.type]
  const wide = Math.max(def.minW, Math.min(def.add[0], Math.floor(big.w / 2)))
  const tall = Math.max(def.minH, Math.min(def.add[1], Math.floor(big.h / 2)))
  const canWide = big.w - wide >= bigDef.minW && big.h >= def.minH
  const canTall = big.h - tall >= bigDef.minH && big.w >= def.minW
  if (canWide && (big.w >= big.h * 0.8 || !canTall)) {
    return withWidgets(state, [...state.widgets.map(x => (x.id === big.id ? { ...x, w: big.w - wide } : x)), { ...base, x: big.x + big.w - wide, y: big.y, w: wide, h: big.h }])
  }
  if (canTall) {
    return withWidgets(state, [...state.widgets.map(x => (x.id === big.id ? { ...x, h: big.h - tall } : x)), { ...base, x: big.x, y: big.y + big.h - tall, w: big.w, h: tall }])
  }
  return state
}
// After a drag or a resize: the arrangement the grid proposes is taken only when every widget is
// still a real widget (inside the grid, at least its minimum, overlapping nothing). Otherwise the
// board stays as it was, so a drop can never squeeze a widget to a sliver or hide one.
export function acceptArrangement(state, proposed) {
  if (!Array.isArray(proposed) || proposed.length !== state.widgets.length) return state
  for (const p of proposed) {
    const def = WIDGETS[p?.type]
    if (!def || p.w < def.minW || p.h < def.minH || p.x < 0 || p.y < 0 || p.x + p.w > COLS || p.y + p.h > ROWS) return state
  }
  const cleaned = cleanWidgets(proposed)
  return cleaned && cleaned.length === state.widgets.length ? withWidgets(state, cleaned) : state
}
export function saveMine(state, name, id) {
  const n = cleanName(name)
  if (!n || state.mine.length >= MAX_MINE) return state
  return { ...state, mine: [...state.mine, { id, name: n, widgets: copyWidgets(state.widgets) }], layoutId: id, changed: false }
}
export function updateMine(state, id) {
  if (!state.mine.some(m => m.id === id)) return state
  return { ...state, mine: state.mine.map(m => (m.id === id ? { ...m, widgets: copyWidgets(state.widgets) } : m)), layoutId: id, changed: false }
}
export function deleteMine(state, id) {
  if (!state.mine.some(m => m.id === id)) return state
  return { ...state, mine: state.mine.filter(m => m.id !== id), ...(state.layoutId === id ? { layoutId: null, changed: true } : {}) }
}
export const setOption = (state, key, value) => {
  if (key === 'screens') return SCREEN_NAV.some(n => n[0] === value) ? { ...state, screens: value } : state
  return SWITCHES.some(sw => sw[0] === key) ? { ...state, [key]: value === true } : state
}

// ── the grid's arithmetic (ScanBoard.jsx draws with these) ──
export const GAP = 8
// The exact row height that makes ROWS rows fill `height` px (no gap under the last row).
export const rowHeightFor = height => (height > 0 ? Math.max(8, (height - GAP * (ROWS - 1)) / ROWS) : 20)
const sameBox = (a, b) => a.length === b.length && a.every(w => { const o = b.find(x => x.id === w.id); return o && o.x === w.x && o.y === w.y && o.w === w.w && o.h === w.h })
// What a finished drag or resize does. `base` is the board as it stood when the drag began, `item`
// the box the widget was let go in, `repack` the Charts board's drop rule, `accept` the board's own
// check (acceptArrangement, through the page's state). 'same': nothing moved. 'accepted': the
// board changed. 'refused': the arrangement would break a widget, and the board is left as it was.
export function settleDrop(base, item, repack, accept) {
  const proposed = repack(base, item.i, { x: item.x, y: item.y, w: item.w, h: item.h }, COLS, ROWS)
  if (sameBox(proposed, base)) return 'same'
  return accept(proposed) ? 'accepted' : 'refused'
}

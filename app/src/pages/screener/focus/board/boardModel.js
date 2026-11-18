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
// A tablet keeps a layout of its own (SCREENER_SCAN_BOARD_TABLET_ENABLED): a desktop arrangement is
// too tight at tablet width, and arranging the tablet must never disturb the desktop.
export const BOARD_PREF_TABLET = 'screener_scan_board_tablet'
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
    widgets: [W('screens', 0, 0, 4, 20), W('results', 4, 0, 7, 20, { rows: 'line' }), W('chart', 11, 0, 13, 15), W('news', 11, 15, 13, 5)] },
  { id: 'list', name: 'List first', blurb: 'A wide list to read down, two lines a stock; the chart and the reasons beside it.',
    widgets: [W('results', 0, 0, 9, 20, { rows: 'two' }), W('chart', 9, 0, 15, 13), W('details', 9, 13, 15, 7)] },
]
export const DEFAULT_PRESET = PRESETS[0]
// The tablet's presets: fewer, bigger widgets. `side` reads best held sideways, `stack` upright.
export const TABLET_PRESETS = [
  { id: 'side', name: 'Side by side', blurb: 'Results on the left; the chart and the reasons on the right.',
    widgets: [W('results', 0, 0, 9, 20, { rows: 'line' }), W('chart', 9, 0, 15, 13), W('details', 9, 13, 15, 7)] },
  { id: 'stack', name: 'Stacked', blurb: 'The chart on top, the results under it, both the full width.',
    widgets: [W('chart', 0, 0, 24, 10), W('results', 0, 10, 24, 10, { rows: 'line' })] },
  { id: 'top', name: 'Chart on top', blurb: 'The chart across the top; results and the reasons side by side under it.',
    widgets: [W('chart', 0, 0, 24, 9), W('results', 0, 9, 13, 11, { rows: 'two' }), W('details', 13, 9, 11, 11)] },
]
// `tier` is 'tablet' on a tablet's board and absent everywhere else (so a desktop state is
// exactly what it always was). It is never stored: the preference key already says which it is.
export const presetsOf = tier => (tier === 'tablet' ? TABLET_PRESETS : PRESETS)
export const tabletStart = landscape => (landscape ? 'side' : 'stack')

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
export function sanitize(raw, tier = null) {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = null } }
  const presets = presetsOf(tier)
  const mark = tier === 'tablet' ? { tier } : {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_STATE, layoutId: presets[0].id, widgets: copyWidgets(presets[0].widgets), ...mark }
  const mine = (Array.isArray(v.mine) ? v.mine : []).map(m => {
    const widgets = cleanWidgets(m?.widgets)
    const name = cleanName(m?.name)
    return widgets && name && typeof m.id === 'string' && m.id.startsWith('m-') ? { id: m.id, name, widgets } : null
  }).filter(Boolean).slice(0, MAX_MINE)
  const widgets = cleanWidgets(v.widgets)
  const known = typeof v.layoutId === 'string' && (presets.some(p => p.id === v.layoutId) || mine.some(m => m.id === v.layoutId))
  const out = {
    layoutId: widgets && known ? v.layoutId : widgets ? null : presets[0].id,
    widgets: widgets || copyWidgets(presets[0].widgets),
    changed: !!widgets && v.changed === true,
    mine,
    screens: SCREEN_NAV.some(n => n[0] === v.screens) ? v.screens : 'tabs',
  }
  SWITCHES.forEach(([k]) => { out[k] = v[k] === true })
  return { ...out, ...mark }
}
// What is written to the preferences: the state, nothing transient (and never the tier).
export const serialize = state => {
  const { tier: _tier, ...kept } = sanitize(state, state?.tier)
  return JSON.stringify({ v: 1, ...kept })
}

export const layoutsOf = state => [...presetsOf(state?.tier), ...(state?.mine || [])]
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
// The board is locked to the window, so empty space on it is wasted. After a move, a resize or a
// removal, every widget but `exceptId` (the one the member just placed: its box is theirs) grows a
// row or a column at a time into whatever free space touches it, until nothing can grow. A hole
// that only the placed widget touches is left alone.
export function fillGaps(widgets, exceptId = null) {
  const ws = widgets.map(w => ({ ...w }))
  const free = (x, y, w, h, self) => x >= 0 && y >= 0 && x + w <= COLS && y + h <= ROWS && !ws.some(o => o !== self && overlaps(o, { x, y, w, h }))
  for (let pass = 0; pass < COLS + ROWS; pass++) {
    let grew = false
    for (const w of ws) {
      if (w.id === exceptId) continue
      if (free(w.x, w.y - 1, w.w, 1, w)) { w.y -= 1; w.h += 1; grew = true }
      if (free(w.x, w.y + w.h, w.w, 1, w)) { w.h += 1; grew = true }
      if (free(w.x - 1, w.y, 1, w.h, w)) { w.x -= 1; w.w += 1; grew = true }
      if (free(w.x + w.w, w.y, 1, w.h, w)) { w.w += 1; grew = true }
    }
    if (!grew) break
  }
  return ws
}
// The last widget is never removed: an empty board has nothing to drag and nothing to read.
export function removeWidget(state, id) {
  if (state.widgets.length <= 1 || !state.widgets.some(w => w.id === id)) return state
  return withWidgets(state, fillGaps(state.widgets.filter(w => w.id !== id)))
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
// board stays as it was, so a drop can never squeeze a widget to a sliver or hide one. The other
// widgets then grow into any space left empty. After a MOVE (`wasMove`) the moved widget takes what
// is still empty, so a widget dropped a little short of an edge reaches it; after a RESIZE it keeps
// exactly the size it was given (a widget made smaller must not spring back).
export function acceptArrangement(state, proposed, movedId = null, wasMove = false) {
  if (!Array.isArray(proposed) || proposed.length !== state.widgets.length) return state
  for (const p of proposed) {
    const def = WIDGETS[p?.type]
    if (!def || p.w < def.minW || p.h < def.minH || p.x < 0 || p.y < 0 || p.x + p.w > COLS || p.y + p.h > ROWS) return state
  }
  const cleaned = cleanWidgets(proposed)
  if (!cleaned || cleaned.length !== state.widgets.length) return state
  const others = fillGaps(cleaned, movedId)
  return withWidgets(state, wasMove ? fillGaps(others) : others)
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
// ── sharing (community layouts) ──
// What leaves the member's board when a layout is shared: the arrangement and the result rows'
// style. Never the screens, the filters or the Show switches (those are the member's own).
export const shareable = state => ({ widgets: cleanWidgets(state?.widgets) || copyWidgets(DEFAULT_PRESET.widgets) })
// A name no layout on the menu already has: "Swing" then "Swing (2)", "Swing (3)".
export function freeName(state, name) {
  const base = cleanName(name)
  const taken = new Set(layoutsOf(state).map(l => l.name.toLowerCase()))
  if (!base || !taken.has(base.toLowerCase())) return base
  for (let n = 2; n < 100; n++) {
    const tail = ` (${n})`
    const next = base.slice(0, MAX_NAME - tail.length) + tail
    if (!taken.has(next.toLowerCase())) return next
  }
  return base
}
// A layout someone else shared, taken as one of the member's own: a copy, so later changes to (or
// the removal of) the shared one change nothing here. Anything that is not a drawable layout, and
// a full list, leave the board as it was.
export function adoptLayout(state, name, widgets, id) {
  const ws = cleanWidgets(widgets)
  const n = freeName(state, name)
  if (!ws || !n || state.mine.length >= MAX_MINE) return state
  return { ...state, mine: [...state.mine, { id, name: n, widgets: ws }], layoutId: id, widgets: copyWidgets(ws), changed: false }
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
export function settleDrop(base, item, repack, accept, wasMove = false) {
  const proposed = repack(base, item.i, { x: item.x, y: item.y, w: item.w, h: item.h }, COLS, ROWS)
  if (sameBox(proposed, base)) return 'same'
  return accept(proposed, item.i, wasMove) ? 'accepted' : 'refused'
}

// ── Customize by keyboard ──
// The box a widget asks for when an arrow key is pressed on its bar; the drop rule and the board's
// own check then decide exactly as they do for a drag (settleDrop). Null when there is nothing to do.
//   move   (arrow): the widget takes the place of the neighbour it touches on that side (the
//          biggest one, when it touches several), which is what dragging it there does.
//   resize (Shift + arrow): right / left make it one column wider / narrower, down / up one row
//          taller / shorter. The edge that moves is the one facing into the board: a widget sitting
//          on the right or bottom edge of the board grows and shrinks from its other side.
export const KEY_DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
const spans = (a0, a1, b0, b1) => a0 < b1 && b0 < a1
export function keyboardTarget(widgets, id, dir, resize = false) {
  const w = (widgets || []).find(x => x.id === id)
  const def = w && WIDGETS[w.type]
  if (!def || !['left', 'right', 'up', 'down'].includes(dir)) return null
  if (resize) {
    const wide = dir === 'left' || dir === 'right'
    const d = dir === 'right' || dir === 'down' ? 1 : -1
    const size = (wide ? w.w : w.h) + d
    if (size < (wide ? def.minW : def.minH) || size > (wide ? COLS : ROWS)) return null
    const atFar = wide ? w.x + w.w === COLS : w.y + w.h === ROWS
    const atNear = wide ? w.x === 0 : w.y === 0
    if (d > 0 && atFar && atNear) return null
    const shift = atFar && !atNear ? -d : 0 // on the far edge: the near side moves instead
    return wide ? { x: w.x + shift, y: w.y, w: size, h: w.h } : { x: w.x, y: w.y + shift, w: w.w, h: size }
  }
  const touching = widgets.filter(o => o.id !== id && (
    dir === 'left' ? o.x + o.w === w.x && spans(w.y, w.y + w.h, o.y, o.y + o.h)
      : dir === 'right' ? w.x + w.w === o.x && spans(w.y, w.y + w.h, o.y, o.y + o.h)
        : dir === 'up' ? o.y + o.h === w.y && spans(w.x, w.x + w.w, o.x, o.x + o.w)
          : w.y + w.h === o.y && spans(w.x, w.x + w.w, o.x, o.x + o.w)))
  const nb = touching.sort((p, q) => q.w * q.h - p.w * p.h)[0]
  if (!nb) return null
  const x = dir === 'left' ? nb.x : dir === 'right' ? nb.x + nb.w - w.w : w.x
  const y = dir === 'up' ? nb.y : dir === 'down' ? nb.y + nb.h - w.h : w.y
  return { x: Math.max(0, Math.min(x, COLS - w.w)), y: Math.max(0, Math.min(y, ROWS - w.h)), w: w.w, h: w.h }
}

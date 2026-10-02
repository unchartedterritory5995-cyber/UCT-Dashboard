/**
 * Wave 11 lane 11D — the trade-plan canvas: the board's MODEL.
 *
 * A canvas is an ordinary Notebook note whose body is one `tradeCanvas` block
 * atom (plus the empty paragraph TipTap's TrailingNode keeps after a non-text
 * last node). The whole board lives in that node's `board` attribute:
 *
 *   { v: 1,
 *     items:  [{ id, kind: 'text'|'sticky'|'chart', x, y, w, h, ... }],
 *     edges:  [{ id, from, to, label }],                      // arrows
 *     levels: [{ id, role, label, price, chartId|null }] }   // entry / stop / target / custom
 *
 * ⛔⛔ ONE WRITE PATH. Every change the board makes is ONE editor transaction on
 * that node (`commitBoard`), so it rides the note's own autosave: the
 * compare-and-set on `updatedAt`, the durable offline copy and its outbox, the
 * schema guard, version history and undo. The board opens no door of its own —
 * the lesson of the five early doors that forked notes by skipping
 * `settleNoteWrite`. The one NEW network call is the create
 * (`tradeCanvasCreate.js`), through the canonical `createNoteViaApi`, and it
 * lands the revision it was answered with.
 *
 * ⛔ THIS FILE IMPORTS NOTHING THAT TOUCHES THE NETWORK: the editor's schema
 * (`tradeCanvasNode.js` → `tiptap.js`) reads it, and the editor must not pull
 * the create path or the offline layer in with it.
 *
 * ⛔ STRUCTURAL SHARING. Every operation returns a new board that REUSES every
 * item object it did not change, so a memoised card re-renders only when it
 * changed — a move of one card never re-renders the other 199.
 *
 * ⛔ A FROZEN CHART STORES NO BARS. It is `{symbol, tf, mode: 'frozen', asOf}`
 * and re-requests bars up to `asOf` (ChartEmbed's `replayCutoff`, the same
 * frozen-evidence semantics a journal chart snapshot already uses), so a plan
 * written last week shows what the member saw and costs ~100 bytes.
 */

export const CANVAS_NODE = 'tradeCanvas'
export const CANVAS_FLAG = 'notebook_trade_canvas_enabled'
export const CANVAS_TAG = 'trade-plan'
export const CANVAS_EVENT = 'uct:notebook-trade-canvas'
export const BOARD_VERSION = 1

/** Bounds that keep a board far under the note's 1 MB body cap (worst case
 *  ≈ 300 cards × 1 KB + the search line ≈ 0.4 MB). */
export const LIMITS = Object.freeze({
  items: 300, edges: 300, levels: 60, text: 1000, label: 60, searchText: 20000, symbol: 12,
})
export const GRID = 8
export const BIG_STEP = 64
export const ZOOM_MIN = 0.2
export const ZOOM_MAX = 2.5
export const ZOOM_STEP = 1.2
/** Below this zoom a chart card shows its label instead of mounting a chart. */
export const CHART_MIN_ZOOM = 0.45

export const SIZES = Object.freeze({
  text: { w: 240, h: 140 }, sticky: { w: 180, h: 110 }, chart: { w: 480, h: 300 },
})
export const MIN_SIZE = Object.freeze({
  text: { w: 120, h: 56 }, sticky: { w: 96, h: 56 }, chart: { w: 240, h: 160 },
})
export const MAX_SIZE = Object.freeze({ w: 1600, h: 1200 })
const COORD_LIMIT = 100000

export const TF_OPTIONS = Object.freeze([
  ['5', '5 min'], ['15', '15 min'], ['30', '30 min'], ['60', '1 hour'], ['D', 'Daily'], ['W', 'Weekly'],
])
const TF_LABELS = Object.freeze({
  1: '1 min', 5: '5 min', 15: '15 min', 30: '30 min', 60: '1 hour', 65: '65 min', D: 'Daily', W: 'Weekly', M: 'Monthly',
})
export const tfLabel = (tf) => TF_LABELS[tf] || String(tf || 'D')

export const LEVEL_ROLES = Object.freeze([
  { id: 'entry', label: 'Entry', color: '#4f8cff' },
  { id: 'stop', label: 'Stop', color: '#ef4444' },
  { id: 'target', label: 'Target', color: '#22c55e' },
  { id: 'custom', label: 'Level', color: '#c9a84c' },
])
const ROLE_BY_ID = Object.fromEntries(LEVEL_ROLES.map((r) => [r.id, r]))
export const roleOf = (role) => ROLE_BY_ID[role] || ROLE_BY_ID.custom
const ROLE_ORDER = { entry: 0, stop: 1, target: 2, custom: 3 }

export const STICKY_COLORS = Object.freeze(['gold', 'blue', 'green', 'red', 'purple'])

// ── flags and small helpers ──────────────────────────────────────────────────

/** Today's date in New York (YYYY-MM-DD) — the trading day a member means by "today". */
export function todayET(now = new Date()) {
  try {
    return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
/** A strict YYYY-MM-DD that is a real calendar day, or null. */
export function strictDay(v) {
  if (typeof v !== 'string') return null
  const m = ISO_DAY.exec(v.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return v.trim()
}

/** "Sep 24, 2026" for a YYYY-MM-DD (read as a calendar day, never as UTC midnight). */
export function dayLabel(day) {
  const ok = strictDay(day)
  if (!ok) return ''
  const [y, m, d] = ok.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,11}$/
export function cleanSymbol(raw) {
  const s = String(raw || '').trim().replace(/^\$/, '').toUpperCase()
  return SYMBOL_RE.test(s) ? s : null
}

export function newId(prefix = 'i') {
  let rand = ''
  try {
    const a = new Uint32Array(2)
    globalThis.crypto.getRandomValues(a)
    rand = a[0].toString(36) + a[1].toString(36)
  } catch {
    rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  }
  return `${prefix}_${rand.slice(0, 10)}`
}

const finite = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const str = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '')
export const snap = (v, grid = GRID) => Math.round(v / grid) * grid
export function fmtPrice(p) {
  const n = finite(p, 0)
  return Math.abs(n) >= 1
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(4)
}

// ── the board ────────────────────────────────────────────────────────────────

export function emptyBoard() {
  return { v: BOARD_VERSION, items: [], edges: [], levels: [] }
}

function normItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const kind = raw.kind
  if (kind !== 'text' && kind !== 'sticky' && kind !== 'chart') return null
  if (typeof raw.id !== 'string' || !raw.id) return null
  const min = MIN_SIZE[kind]
  const base = SIZES[kind]
  const item = {
    ...raw,   // a newer client's extra fields ride along untouched
    id: raw.id.slice(0, 40),
    kind,
    x: Math.round(clamp(finite(raw.x), -COORD_LIMIT, COORD_LIMIT)),
    y: Math.round(clamp(finite(raw.y), -COORD_LIMIT, COORD_LIMIT)),
    w: Math.round(clamp(finite(raw.w, base.w), min.w, MAX_SIZE.w)),
    h: Math.round(clamp(finite(raw.h, base.h), min.h, MAX_SIZE.h)),
  }
  if (kind === 'chart') {
    item.symbol = cleanSymbol(raw.symbol) || 'SPY'
    item.tf = TF_LABELS[raw.tf] ? String(raw.tf) : 'D'
    const asOf = strictDay(raw.asOf)
    item.mode = raw.mode === 'frozen' && asOf ? 'frozen' : 'live'
    item.asOf = item.mode === 'frozen' ? asOf : null
  } else {
    item.text = str(raw.text, LIMITS.text)
    if (kind === 'sticky') item.color = STICKY_COLORS.includes(raw.color) ? raw.color : 'gold'
  }
  return item
}

/** Any stored shape → a valid board. Never throws; anything unreadable reads as less. */
export function normalizeBoard(raw) {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const items = []
  const seen = new Set()
  for (const it of Array.isArray(b.items) ? b.items : []) {
    const n = normItem(it)
    if (!n || seen.has(n.id) || items.length >= LIMITS.items) continue
    seen.add(n.id)
    items.push(n)
  }
  const charts = new Set(items.filter((i) => i.kind === 'chart').map((i) => i.id))
  const edges = []
  const edgeKeys = new Set()
  for (const e of Array.isArray(b.edges) ? b.edges : []) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string') continue
    if (!seen.has(e.from) || !seen.has(e.to) || e.from === e.to) continue
    const key = `${e.from}>${e.to}`
    if (edgeKeys.has(key) || edges.length >= LIMITS.edges) continue
    edgeKeys.add(key)
    edges.push({ id: e.id.slice(0, 40), from: e.from, to: e.to, label: str(e.label, LIMITS.label) })
  }
  const levels = []
  for (const lv of Array.isArray(b.levels) ? b.levels : []) {
    if (!lv || typeof lv !== 'object' || typeof lv.id !== 'string') continue
    const price = finite(lv.price, NaN)
    if (!Number.isFinite(price) || price <= 0 || levels.length >= LIMITS.levels) continue
    const role = ROLE_BY_ID[lv.role] ? lv.role : 'custom'
    levels.push({
      id: lv.id.slice(0, 40), role, label: str(lv.label, LIMITS.label).trim() || roleOf(role).label,
      price, chartId: charts.has(lv.chartId) ? lv.chartId : null,
    })
  }
  return { v: BOARD_VERSION, items, edges, levels }
}

// The identity cache: a board this module produced (or already normalised) is
// read back as the SAME object, so its item objects keep their identity across
// transactions and memoised cards do not re-render.
const normalised = new WeakSet()
const normCache = new WeakMap()
function mark(board) { normalised.add(board); return board }

/** The board a stored attribute holds, normalised once per distinct object. */
export function readStoredBoard(raw) {
  if (raw && typeof raw === 'object') {
    if (normalised.has(raw)) return raw
    const hit = normCache.get(raw)
    if (hit) return hit
    const n = mark(normalizeBoard(raw))
    normCache.set(raw, n)
    return n
  }
  return mark(emptyBoard())
}

// ── operations (pure, structural sharing) ────────────────────────────────────

function withItems(board, items) { return mark({ ...board, items }) }

export function makeTextCard({ x = 0, y = 0, text = '' } = {}) {
  return { id: newId('i'), kind: 'text', x: Math.round(x), y: Math.round(y), ...SIZES.text, text: str(text, LIMITS.text) }
}
export function makeSticky({ x = 0, y = 0, text = '', color = 'gold' } = {}) {
  return { id: newId('i'), kind: 'sticky', x: Math.round(x), y: Math.round(y), ...SIZES.sticky, text: str(text, LIMITS.text), color }
}
export function makeChart({ x = 0, y = 0, symbol = 'SPY', tf = 'D', mode = 'live', asOf = null } = {}) {
  const frozen = mode === 'frozen' && strictDay(asOf)
  return {
    id: newId('i'), kind: 'chart', x: Math.round(x), y: Math.round(y), ...SIZES.chart,
    symbol: cleanSymbol(symbol) || 'SPY', tf: TF_LABELS[tf] ? String(tf) : 'D',
    mode: frozen ? 'frozen' : 'live', asOf: frozen ? strictDay(asOf) : null,
  }
}

/** Add items; anything past the item cap is refused (and reported, never silently kept). */
export function addItems(board, items) {
  const room = Math.max(0, LIMITS.items - board.items.length)
  const take = items.slice(0, room).map(normItem).filter(Boolean)
  return { board: take.length ? withItems(board, [...board.items, ...take]) : board, added: take.map((i) => i.id), refused: items.length - take.length }
}

export function updateItem(board, id, patch) {
  let changed = false
  const items = board.items.map((it) => {
    if (it.id !== id) return it
    const next = normItem({ ...it, ...patch })
    if (!next) return it
    changed = true
    return next
  })
  return changed ? withItems(board, items) : board
}

export function moveItems(board, ids, dx, dy) {
  const set = new Set(ids)
  if (!set.size || (!dx && !dy)) return board
  return withItems(board, board.items.map((it) => (set.has(it.id)
    ? { ...it, x: Math.round(clamp(it.x + dx, -COORD_LIMIT, COORD_LIMIT)), y: Math.round(clamp(it.y + dy, -COORD_LIMIT, COORD_LIMIT)) }
    : it)))
}

export function resizeItem(board, id, w, h) {
  return withItems(board, board.items.map((it) => {
    if (it.id !== id) return it
    const min = MIN_SIZE[it.kind]
    const nw = Math.round(clamp(finite(w, it.w), min.w, MAX_SIZE.w))
    const nh = Math.round(clamp(finite(h, it.h), min.h, MAX_SIZE.h))
    return nw === it.w && nh === it.h ? it : { ...it, w: nw, h: nh }
  }))
}

export function removeItems(board, ids) {
  const set = new Set(ids)
  if (!set.size) return board
  return mark({
    ...board,
    items: board.items.filter((it) => !set.has(it.id)),
    edges: board.edges.filter((e) => !set.has(e.from) && !set.has(e.to)),
    levels: board.levels.map((lv) => (set.has(lv.chartId) ? { ...lv, chartId: null } : lv)),
  })
}

/** Copies offset down-right; arrows BETWEEN copied items are copied too. */
export function duplicateItems(board, ids, offset = GRID * 3) {
  const set = new Set(ids)
  const map = new Map()
  const copies = []
  for (const it of board.items) {
    if (!set.has(it.id)) continue
    const id = newId('i')
    map.set(it.id, id)
    copies.push({ ...it, id, x: it.x + offset, y: it.y + offset })
  }
  const { board: withCopies, added } = addItems(board, copies)
  const addedSet = new Set(added)
  const newEdges = board.edges
    .filter((e) => map.has(e.from) && map.has(e.to) && addedSet.has(map.get(e.from)) && addedSet.has(map.get(e.to)))
    .map((e) => ({ id: newId('e'), from: map.get(e.from), to: map.get(e.to), label: e.label }))
  const out = newEdges.length ? mark({ ...withCopies, edges: [...withCopies.edges, ...newEdges] }) : withCopies
  return { board: out, ids: added }
}

export function addEdge(board, from, to, label = '') {
  if (!from || !to || from === to) return board
  const ids = new Set(board.items.map((i) => i.id))
  if (!ids.has(from) || !ids.has(to)) return board
  if (board.edges.some((e) => e.from === from && e.to === to)) return board
  if (board.edges.length >= LIMITS.edges) return board
  return mark({ ...board, edges: [...board.edges, { id: newId('e'), from, to, label: str(label, LIMITS.label).trim() }] })
}

export function removeEdge(board, id) {
  const edges = board.edges.filter((e) => e.id !== id)
  return edges.length === board.edges.length ? board : mark({ ...board, edges })
}

export function addLevels(board, levels) {
  const charts = new Set(board.items.filter((i) => i.kind === 'chart').map((i) => i.id))
  const room = Math.max(0, LIMITS.levels - board.levels.length)
  const take = []
  for (const lv of levels) {
    if (take.length >= room) break
    const price = finite(Number(lv.price), NaN)
    if (!Number.isFinite(price) || price <= 0) continue
    const role = ROLE_BY_ID[lv.role] ? lv.role : 'custom'
    take.push({
      id: newId('l'), role, label: str(lv.label, LIMITS.label).trim() || roleOf(role).label,
      price, chartId: charts.has(lv.chartId) ? lv.chartId : null,
    })
  }
  return take.length ? mark({ ...board, levels: [...board.levels, ...take] }) : board
}

export function updateLevel(board, id, patch) {
  const charts = new Set(board.items.filter((i) => i.kind === 'chart').map((i) => i.id))
  let changed = false
  const levels = board.levels.map((lv) => {
    if (lv.id !== id) return lv
    const price = patch.price !== undefined ? finite(Number(patch.price), NaN) : lv.price
    if (!Number.isFinite(price) || price <= 0) return lv
    const role = patch.role && ROLE_BY_ID[patch.role] ? patch.role : lv.role
    changed = true
    return {
      ...lv, role, price,
      label: patch.label !== undefined ? (str(patch.label, LIMITS.label).trim() || roleOf(role).label) : lv.label,
      chartId: patch.chartId !== undefined ? (charts.has(patch.chartId) ? patch.chartId : null) : lv.chartId,
    }
  })
  return changed ? mark({ ...board, levels }) : board
}

export function removeLevel(board, id) {
  const levels = board.levels.filter((l) => l.id !== id)
  return levels.length === board.levels.length ? board : mark({ ...board, levels })
}

export const sortedLevels = (levels) => [...levels].sort(
  (a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || b.price - a.price)

/** Reading order (top to bottom, then left to right): the order Tab walks. */
export function readingOrder(items) {
  return [...items].sort((a, b) => (Math.abs(a.y - b.y) > GRID * 2 ? a.y - b.y : a.x - b.x) || a.y - b.y)
}

// ── words: labels and the search line ────────────────────────────────────────

export function chartLabel(item) {
  const head = `${item.symbol} · ${tfLabel(item.tf)}`
  return item.mode === 'frozen' && item.asOf ? `${head} · frozen as of ${item.asOf}` : `${head} · live`
}

export function itemLabel(item) {
  if (!item) return ''
  if (item.kind === 'chart') return `${item.symbol} ${tfLabel(item.tf)} chart`
  const text = (item.text || '').replace(/\s+/g, ' ').trim()
  const short = text.length > 40 ? `${text.slice(0, 39)}…` : text
  if (item.kind === 'sticky') return short ? `Sticky note: ${short}` : 'Sticky note'
  return short ? `Text card: ${short}` : 'Text card'
}

export function levelLine(level, items) {
  const chart = level.chartId ? items.find((i) => i.id === level.chartId) : null
  const base = `${level.label}: ${fmtPrice(level.price)}`
  return chart ? `${base} (on ${chart.symbol} ${tfLabel(chart.tf)})` : base
}

/**
 * ⛔ THE ONE AUTHORITY over what search, Ask and the mentions index read for a
 * canvas: the node's `searchText`, derived here at every commit (the server's
 * `_ATOM_TEXT` / the client's `citationLeafText` read it back verbatim).
 * Cashtags are `$SYM`, so a canvas counts as a mention of its tickers.
 */
export function boardSearchText(board) {
  const parts = ['Trade-plan canvas']
  for (const it of board.items) {
    if (it.kind !== 'chart') continue
    parts.push(it.mode === 'frozen' && it.asOf
      ? `$${it.symbol} ${tfLabel(it.tf)} chart frozen as of ${it.asOf}`
      : `$${it.symbol} ${tfLabel(it.tf)} chart`)
  }
  for (const lv of sortedLevels(board.levels)) parts.push(`${lv.label} ${fmtPrice(lv.price)}`)
  for (const it of board.items) {
    if (it.kind === 'chart') continue
    const t = (it.text || '').replace(/\s+/g, ' ').trim()
    if (t) parts.push(t)
  }
  for (const e of board.edges) if (e.label) parts.push(e.label)
  return parts.join(' · ').slice(0, LIMITS.searchText)
}

// ── the note body ────────────────────────────────────────────────────────────

/** The body a NEW canvas note is created with: the node, then the empty
 *  paragraph TipTap's TrailingNode would add on open anyway (so opening it is
 *  not an edit). */
export function buildCanvasDoc(board = emptyBoard()) {
  const b = normalizeBoard(board)
  return {
    type: 'doc',
    content: [
      { type: CANVAS_NODE, attrs: { board: b, searchText: boardSearchText(b) } },
      { type: 'paragraph' },
    ],
  }
}

/** Is a stored body a canvas? (its FIRST block is the canvas node) */
export function isTradeCanvasDoc(doc) {
  return Boolean(doc && typeof doc === 'object' && Array.isArray(doc.content)
    && doc.content[0] && doc.content[0].type === CANVAS_NODE)
}

/** The canvas node in an editor state: `{node, pos}` or null. */
export function canvasNodeIn(state) {
  const doc = state?.doc
  if (!doc) return null
  let found = null
  doc.forEach((node, offset) => {
    if (!found && node.type.name === CANVAS_NODE) found = { node, pos: offset }
  })
  return found
}

/** Blocks in the note other than the canvas and an empty trailing paragraph. */
export function extraBlockCount(state) {
  const doc = state?.doc
  if (!doc) return 0
  let n = 0
  doc.forEach((node) => {
    if (node.type.name === CANVAS_NODE) return
    if (node.type.name === 'paragraph' && node.content.size === 0) return
    n += 1
  })
  return n
}

/** The board the editor holds right now (the empty board when there is no canvas node). */
export function boardFromEditor(editor) {
  if (!editor || editor.isDestroyed) return readStoredBoard(null)
  const found = canvasNodeIn(editor.state)
  return readStoredBoard(found ? found.node.attrs.board : null)
}

let closeHistoryFn = null
/** Load prosemirror-history's `closeHistory` once (it ships inside @tiptap/pm). */
export function loadHistoryHelpers() {
  if (closeHistoryFn) return Promise.resolve(closeHistoryFn)
  return import('@tiptap/pm/history').then((m) => { closeHistoryFn = m.closeHistory; return closeHistoryFn })
    .catch(() => null)
}

/**
 * ⛔⛔ THE BOARD'S ONE WRITE. A single transaction that replaces the canvas
 * node's attributes; the editor's `onUpdate` schedules the note's autosave.
 * `merge` lets a burst of keyboard nudges share one undo step; every other
 * change is its own step (`closeHistory`). Returns false — and writes nothing —
 * when the editor is gone, read-only, or holds no canvas.
 */
export function commitBoard(editor, board, { merge = false } = {}) {
  if (!editor || editor.isDestroyed || !editor.isEditable) return false
  const found = canvasNodeIn(editor.state)
  if (!found) return false
  const next = normalised.has(board) ? board : mark(normalizeBoard(board))
  if (found.node.attrs.board === next) return false
  let tr = editor.state.tr.setNodeMarkup(found.pos, undefined, {
    ...found.node.attrs, board: next, searchText: boardSearchText(next),
  })
  if (!merge && closeHistoryFn) tr = closeHistoryFn(tr)
  tr.setMeta('uctTradeCanvas', true)
  editor.view.dispatch(tr)
  return true
}

// ── the camera ───────────────────────────────────────────────────────────────

export function clampZoom(z) { return clamp(finite(z, 1), ZOOM_MIN, ZOOM_MAX) }

/** Zoom by `factor` keeping the world point under screen (px, py) still. */
export function zoomAt(cam, factor, px, py) {
  const z = clampZoom(cam.z * factor)
  const wx = (px - cam.x) / cam.z
  const wy = (py - cam.y) / cam.z
  return { x: px - wx * z, y: py - wy * z, z }
}

export function boundsOf(items) {
  if (!items.length) return null
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity
  for (const it of items) {
    x0 = Math.min(x0, it.x); y0 = Math.min(y0, it.y)
    x1 = Math.max(x1, it.x + it.w); y1 = Math.max(y1, it.y + it.h)
  }
  return { x0, y0, x1, y1 }
}

/** The camera that shows every item (never zoomed past 100%). */
export function fitCamera(items, vw, vh, pad = 48) {
  const b = boundsOf(items)
  if (!b || !vw || !vh) return { x: Math.round(vw / 2) || 0, y: 80, z: 1 }
  const bw = Math.max(1, b.x1 - b.x0)
  const bh = Math.max(1, b.y1 - b.y0)
  const z = clampZoom(Math.min(1, (vw - pad * 2) / bw, (vh - pad * 2) / bh))
  return { x: (vw - bw * z) / 2 - b.x0 * z, y: (vh - bh * z) / 2 - b.y0 * z, z }
}

/** Ids of the items inside the screen (plus a margin) — only these are rendered. */
export function visibleIds(items, cam, vw, vh, margin = 240) {
  const x0 = (-cam.x - margin) / cam.z
  const y0 = (-cam.y - margin) / cam.z
  const x1 = (vw - cam.x + margin) / cam.z
  const y1 = (vh - cam.y + margin) / cam.z
  const out = []
  for (const it of items) {
    if (it.x < x1 && it.x + it.w > x0 && it.y < y1 && it.y + it.h > y0) out.push(it.id)
  }
  return out
}

/** Is the whole item on screen? */
export function itemOnScreen(item, cam, vw, vh) {
  const sx = item.x * cam.z + cam.x
  const sy = item.y * cam.z + cam.y
  return sx >= 0 && sy >= 0 && sx + item.w * cam.z <= vw && sy + item.h * cam.z <= vh
}

/** The camera that centres an item, at the current zoom. */
export function centerOn(item, cam, vw, vh) {
  return { ...cam, x: vw / 2 - (item.x + item.w / 2) * cam.z, y: vh / 2 - (item.y + item.h / 2) * cam.z }
}

/** Where a new item lands: the middle of the screen, nudged off any item already there. */
export function placeFor(board, cam, vw, vh, size) {
  let x = snap((vw / 2 - cam.x) / cam.z - size.w / 2)
  let y = snap((vh / 2 - cam.y) / cam.z - size.h / 2)
  for (let i = 0; i < 40 && board.items.some((it) => Math.abs(it.x - x) < GRID && Math.abs(it.y - y) < GRID); i += 1) {
    x += GRID * 3; y += GRID * 3
  }
  return { x, y }
}

/** An arrow from the edge of box `a` to the edge of box `b` (world coordinates). */
export function edgeLine(a, b) {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const clip = (c, box, toward) => {
    const dx = toward.x - c.x
    const dy = toward.y - c.y
    if (!dx && !dy) return c
    const tx = dx ? (box.w / 2) / Math.abs(dx) : Infinity
    const ty = dy ? (box.h / 2) / Math.abs(dy) : Infinity
    const t = Math.min(tx, ty, 1)
    return { x: c.x + dx * t, y: c.y + dy * t }
  }
  const p1 = clip(ca, a, cb)
  const p2 = clip(cb, b, ca)
  return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y }
}

// ── creating a canvas ────────────────────────────────────────────────────────

export function defaultCanvasTitle(ticker, now = new Date()) {
  let day = ''
  try {
    day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
  } catch { /* the title stays without a date */ }
  const head = ticker ? `${ticker} trade plan` : 'Trade plan'
  return day ? `${head} — ${day}` : head
}

/** A new canvas's board: a live daily chart of the ticker when there is one. */
export function starterBoard({ ticker } = {}) {
  const sym = cleanSymbol(ticker)
  if (!sym) return emptyBoard()
  return normalizeBoard({ ...emptyBoard(), items: [makeChart({ x: 0, y: 0, symbol: sym, tf: 'D', mode: 'live' })] })
}

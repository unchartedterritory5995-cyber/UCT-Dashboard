/**
 * The trade-plan canvas's STORED-SHAPE half: what reading, creating and
 * recognising a canvas needs, and nothing that edits one.
 *
 * Follow-up A (first-open bytes): `tradeCanvas.js` was one module, and the
 * editor's schema (`tradeCanvasNode.js`), the editor page and the create door
 * import it statically, so every board operation, the camera and the placement
 * search rode on the Notebook's first open although only the board
 * (`TradeCanvasBoard`, already fetched on demand) runs them. This file is the
 * half those first-open importers need; `tradeCanvas.js` re-exports it and
 * keeps the board's operations, so the board and every existing test still read
 * one module.
 *
 * ⛔ First-open importers (the schema node, `NoteEditorPage`, `SlashMenu`,
 * `tradeCanvasCreate`) import from HERE, never from `tradeCanvas.js`: one static
 * import of that file puts the board's half back on first open (rail:
 * tradeCanvasModel.test.js).
 *
 * ⛔ Like `tradeCanvas.js`, this file imports nothing that touches the network.
 */
import { PLAN_ROLE_VAR } from './planColors'

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

export const SIZES = Object.freeze({
  text: { w: 240, h: 140 }, sticky: { w: 180, h: 110 }, chart: { w: 480, h: 300 },
})
export const MIN_SIZE = Object.freeze({
  text: { w: 120, h: 56 }, sticky: { w: 96, h: 56 }, chart: { w: 240, h: 160 },
})
export const MAX_SIZE = Object.freeze({ w: 1600, h: 1200 })
export const COORD_LIMIT = 100000

export const TF_LABELS = Object.freeze({
  1: '1 min', 5: '5 min', 15: '15 min', 30: '30 min', 60: '1 hour', 65: '65 min', D: 'Daily', W: 'Weekly', M: 'Monthly',
})
export const tfLabel = (tf) => TF_LABELS[tf] || String(tf || 'D')

// VIS-5 (audit 2026-11-05, issue 20): one plan colour language (lib/planColors.js) -- entry gold, stop --loss,
// target --gain. A plain level is the muted ink, so it can never be mistaken for the entry.
export const LEVEL_ROLES = Object.freeze([
  { id: 'entry', label: 'Entry', color: PLAN_ROLE_VAR.entry },
  { id: 'stop', label: 'Stop', color: PLAN_ROLE_VAR.stop },
  { id: 'target', label: 'Target', color: PLAN_ROLE_VAR.target },
  { id: 'custom', label: 'Level', color: 'var(--text-muted)' },
])
export const ROLE_BY_ID = Object.freeze(Object.fromEntries(LEVEL_ROLES.map((r) => [r.id, r])))
export const roleOf = (role) => ROLE_BY_ID[role] || ROLE_BY_ID.custom
const ROLE_ORDER = { entry: 0, stop: 1, target: 2, custom: 3 }

export const STICKY_COLORS = Object.freeze(['gold', 'blue', 'green', 'red', 'purple'])

// ── small helpers ────────────────────────────────────────────────────────────

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

export const finite = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const str = (v, cap) => (typeof v === 'string' ? v.slice(0, cap) : '')
export function fmtPrice(p) {
  const n = finite(p, 0)
  return Math.abs(n) >= 1
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : n.toFixed(4)
}

// ── the board's stored shape ─────────────────────────────────────────────────

export function emptyBoard() {
  return { v: BOARD_VERSION, items: [], edges: [], levels: [] }
}

/** One stored item → a valid item, or null. Never throws. */
export function normItem(raw) {
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

// The identity cache: a board this module (or the board's operations in
// tradeCanvas.js) produced, or already normalised, is read back as the SAME
// object, so its item objects keep their identity across transactions and
// memoised cards do not re-render. ONE set, shared by both files.
const normalised = new WeakSet()
const normCache = new WeakMap()
/** Record a board as already normalised (the board's operations call this on every board they return). */
export function markNormalised(board) { normalised.add(board); return board }
export const isNormalised = (board) => normalised.has(board)

/** The board a stored attribute holds, normalised once per distinct object. */
export function readStoredBoard(raw) {
  if (raw && typeof raw === 'object') {
    if (normalised.has(raw)) return raw
    const hit = normCache.get(raw)
    if (hit) return hit
    const n = markNormalised(normalizeBoard(raw))
    normCache.set(raw, n)
    return n
  }
  return markNormalised(emptyBoard())
}

export function makeChart({ x = 0, y = 0, symbol = 'SPY', tf = 'D', mode = 'live', asOf = null } = {}) {
  const frozen = mode === 'frozen' && strictDay(asOf)
  return {
    id: newId('i'), kind: 'chart', x: Math.round(x), y: Math.round(y), ...SIZES.chart,
    symbol: cleanSymbol(symbol) || 'SPY', tf: TF_LABELS[tf] ? String(tf) : 'D',
    mode: frozen ? 'frozen' : 'live', asOf: frozen ? strictDay(asOf) : null,
  }
}

export const sortedLevels = (levels) => [...levels].sort(
  (a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || b.price - a.price)

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

// Notebook widgets wave 10 (Task 10.21, spec section 8): the ready-made widgets in the / menu.
//
// ⛔ LAZY. Only SlashMenu's background loader (a dynamic import) and the lazy builder chunk import this file. An eager
// import puts it, and the widget client it reads, on the Notebook's first open.
//
// The cards a member can find:
//   * the shelf's examples (`GET /shelf`, per id the newest revision the server's flags allow). One inserts a built
//     widget pinned to the card's revision (`defId`, `defRev`: the rule Task 10.19 reads back);
//   * the seven ready-made dedicated kinds (`WIDGET_KINDS` rows with `dedicated`). One inserts its own snapshot kind
//     through its POST door. Plan vs actual needs a trade first, so its row continues with `/actual ` (the
//     /recap pick grammar, lib/notebookWidgetsFetch.pickRows);
//   * on a bare `/` only, the two phase 1 kinds among the defaults (spec 8: "one card per idea": the phase 1 widget,
//     never a shelf twin). Typed, a phase 1 kind is found by its own snapshot row, never a second one here.
// A search word is a card's own: its name, then the shelf's keywords and the `WIDGET_KINDS` keywords. None is typed
// here. Lowercased, because the menu's query is.
//
// "Most used" is the member's own count, kept in this browser (`uct.nb.widgetUses.<uid>`): a convenience, never a
// fact anything else reads, and a storage that throws or comes back empty leaves the defaults alone.
import { WIDGET_KINDS, widgetKind } from './notebookWidgets'
import { widgetsWaveOn } from './notebookWidgetsFlags'
import { BUILT_KIND, loadShelfIndex, runBuilt, failureText, MARK_EXAMPLE } from './builtWidgets'
import { dedicatedSnapshotKind, ACTUAL_CMD } from './notebookWidgetsFetch'

/** A bare `/` shows at most this many ready-made widgets. */
export const BARE_MAX = 8

/** Spec 8, in order: Equity curve, Win rate, Daily P&L bars, Performance by setup (mySetupEdge), Max drawdown, Risk
 *  left today, Positions near stop (myPositionsRisk), Weekly scorecard. */
export const DEFAULTS = Object.freeze([
  'shelf:equity-curve', 'shelf:win-rate', 'shelf:daily-pnl-bars', 'mySetupEdge', 'shelf:max-drawdown',
  'myRiskLeftToday', 'myPositionsRisk', 'shelf:weekly-scorecard',
])

/** The row after them, which opens every ready-made widget (the builder's examples). */
export const ALL_WIDGETS = 'All widgets…'
export const ALL_WIDGETS_HINT = 'Every ready-made widget'
/** Plan vs actual's row: it goes on to the member's trades. */
export const PICK_TRADE_HINT = 'Pick one of your trades'

const USES_KEY = (uid) => `uct.nb.widgetUses.${uid}`
const USES_KEEP = 40
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** This member's counts, `{id: {n, at}}`; nothing when storage cannot be read. */
export function readUses(uid) {
  if (!uid) return {}
  try {
    const got = JSON.parse(window.localStorage.getItem(USES_KEY(uid)) || '{}')
    return isRecord(got) ? got : {}
  } catch {
    return {}
  }
}

/** Count one insert of `id` (kept to the newest USES_KEEP ids). A storage that throws is left as it is.
 *  m-1: a whole-map read-modify-write, so two tabs inserting at the same instant can lose one count. Accepted: this is a
 *  per-browser convenience (W10-R68), not a record; do not move it server-side under this name. */
export function recordUse(uid, id) {
  if (!uid || typeof id !== 'string' || !id) return
  try {
    const all = readUses(uid)
    const was = isRecord(all[id]) && Number.isInteger(all[id].n) ? all[id].n : 0
    all[id] = { n: was + 1, at: Date.now() }
    const kept = Object.entries(all).filter(([, u]) => isRecord(u) && Number.isInteger(u.n) && u.n > 0)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, USES_KEEP)
    window.localStorage.setItem(USES_KEY(uid), JSON.stringify(Object.fromEntries(kept)))
  } catch { /* a convenience: never in the way of the insert */ }
}

/** The ids this member added most, most first (a tie: the latest first). */
export function mostUsed(uid) {
  return Object.entries(readUses(uid))
    .filter(([, u]) => isRecord(u) && Number.isInteger(u.n) && u.n > 0)
    .sort((a, b) => b[1].n - a[1].n || (b[1].at || 0) - (a[1].at || 0))
    .map(([id]) => id)
}

const lower = (list) => [...new Set((Array.isArray(list) ? list : []).filter((k) => typeof k === 'string' && k)
  .map((k) => k.toLowerCase()))]

/** A shelf example as the one snapshot insert reads it: a built widget, run with the pinned revision. */
export function shelfSnapshotKind(title) {
  return {
    id: BUILT_KIND, title,
    // Offline is the insert's own sentence; anything else in the widget client's words (a 402, busy, a cap).
    capture: (params) => runBuilt(params).then((got) => (got.ok ? { ok: true, payload: got.data }
      : got.code === 'offline' ? { ok: false, reason: 'offline' } : { ok: false, message: failureText(got.code, got.message) })),
  }
}

/** Every card the / menu can offer, by id, from the loaded shelf (`doc`, loadShelfIndex's answer). */
export function builtInCards(doc) {
  const cards = new Map()
  for (const e of Array.isArray(doc?.examples) ? doc.examples : []) {
    if (!e.name) continue
    cards.set(e.id, { id: e.id, title: e.name, description: e.description, keywords: lower(e.keywords), shelf: e })
  }
  const served = new Map((Array.isArray(doc?.dedicated) ? doc.dedicated : []).map((d) => [d.kind, d]))
  for (const k of WIDGET_KINDS) {
    if (k.dedicated !== 1 || !widgetsWaveOn(k.wave)) continue
    cards.set(k.id, { id: k.id, title: k.title, description: k.description, dedicated: k,
      keywords: lower([...(k.keywords || []), ...(served.get(k.id)?.keywords || [])]) })
  }
  return cards
}

/** One card's row. `insert(kind, params)` is SlashMenu's snapshotCommand; a row that inserts counts as used. */
function rowOf(card, insert, uid) {
  const counted = (cmd) => (args) => Promise.resolve(cmd(args)).then((r) => { if (r && r.ok) recordUse(uid, card.id); return r })
  const base = { title: card.title, description: card.description, keywords: card.keywords }
  if (card.shelf) {
    // One of the firm's examples: marked, beside a member's own widget of the same name (the W8.8 walk fix).
    return { ...base, mark: MARK_EXAMPLE,
      command: counted(insert(shelfSnapshotKind(card.title), { defId: card.id, defRev: card.shelf.rev })) }
  }
  if (card.dedicated?.pick) {
    // Plan vs actual: a trade first, through the /actual rows (the /recap pick grammar).
    return { ...base, description: PICK_TRADE_HINT,
      command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertContent(`/${ACTUAL_CMD} `).run() } }
  }
  if (card.dedicated) return { ...base, command: counted(insert(dedicatedSnapshotKind(card.id), {})) }
  return { ...base, command: counted(insert(card.phase1, {})) }
}

/**
 * The ready-made widget rows for one query.
 *   * Bare: at most BARE_MAX, the member's most used first, then DEFAULTS, each once and only when it can be offered
 *     (its revision served, its wave on). The caller adds "All widgets…" after them.
 *   * Typed: every shelf and dedicated card the query matches (a name or a keyword); the caller ranks them with the
 *     menu's blocks (a name match above a keyword match).
 */
export function builtInRows(query, doc, insert, uid) {
  const cards = builtInCards(doc)
  const q = String(query || '').trim().toLowerCase()
  if (q) {
    return [...cards.values()]
      .filter((c) => c.title.toLowerCase().includes(q) || c.keywords.some((k) => k.includes(q)))
      .map((c) => rowOf(c, insert, uid))
  }
  const cardFor = (id) => {
    if (cards.has(id)) return cards.get(id)
    const k = widgetKind(id)
    // A phase 1 default: its own kind, words and wave (it is fetched by the phase 1 GET, like its snapshot row).
    if (DEFAULTS.includes(id) && k && !k.dedicated && !k.pick && !k.built && widgetsWaveOn(k.wave)) {
      return { id, title: k.title, description: k.description, keywords: [], phase1: k }
    }
    return null
  }
  const out = []
  for (const id of [...mostUsed(uid), ...DEFAULTS]) {
    if (out.length >= BARE_MAX) break
    const c = cardFor(id)
    if (c && !out.some((r) => r.id === id)) out.push({ ...c, row: rowOf(c, insert, uid) })
  }
  return out.map((c) => c.row)
}

/** The shelf as this file reads it: loadShelfIndex (one GET per tab). */
export const loadBuiltIn = () => loadShelfIndex()

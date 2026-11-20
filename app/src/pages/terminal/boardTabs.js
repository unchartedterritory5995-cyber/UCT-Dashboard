// UCT Terminal — the open boards as TABS (the pure model; behind TERMINAL_BOARD_TABS_ENABLED).
//
// ⭐ WHAT IS STORED, AND WHERE. ONE new preference key, `terminal_board_tabs`:
//
//   { v: 1, active: '<tab id>', pending: '<tab id>' | null, pendingFrom: '<signature>' | null,
//     tabs: [{ id, kind, ref, name, sym, copy }] }          at most MAX_TABS tabs
//
//   kind  own      the board the member already had when the tabs first appeared, or a board
//                  opened from a list, a share link or a ticker preset
//         starter  a ready-made board (starterBoards.js); `ref` is its id
//         stock    a stock board (stockBoards.js); `ref` is its id, `sym` its ticker
//         saved    one of the member's saved boards; `ref` is its id in `terminal_boards`
//         blank    a new board the member started from "Blank"
//   copy  the tab's WORKING COPY as a board snapshot (`boardModel.boardSnapshot`: panels, groups
//         and each group's ticker). Written when the tab is PARKED, that is when another tab
//         is selected. The selected tab's board is NOT kept here: it is `terminal_layout`,
//         written by the layout hook exactly as before this file existed.
//
// ⛔ NOTHING EXISTING IS RESHAPED. `terminal_layout`, `terminal_boards`, `charts_workspace_groups`
// and the versioned Terminal document keep their keys and shapes. With the switch off this key
// is never read or written, and the board on screen is whatever tab was selected last.
//
// ⭐ THE TWO-KEY GAP, AND WHAT COVERS IT. A tab switch is two writes: this key (the outgoing
// tab's copy, the new `active`) and then `terminal_layout` (the incoming board, debounced by the
// layout hook). If the second is lost (the browser dies in between), the stored board would
// still be the OUTGOING tab's. `pending` names the tab whose copy has been handed to the layout
// hook and not yet seen stored, and `pendingFrom` is the signature of the board that was on
// screen when it was handed over. The hook (useBoardTabs) clears both once the stored board has
// changed; a load that finds them set, with the stored board STILL the outgoing one, opens the
// selected tab's copy again (`needsHeal`). The incoming tab keeps its `copy` until it is next
// parked, so the board is never only in flight.
import { boardSnapshot, defaultLayout, firstVisitLayout, isCompatChannel, panelChannel, sameBoardName } from './boardModel'
import { STARTER_BOARDS, buildStarterBoard, findStarterBoard } from './starterBoards'
import { findStockBoard } from './stockBoards'
import { buildStockBoard, stockTicker } from './stockBoardModel'

/** The preference key. Not a `TERMINAL_*_PREF` export of boardPrefs.js on purpose: those two are
 *  the versioned Terminal document's key set (tests/test_workspace_doc_terminal_board.py), and
 *  this key is not part of that document. */
export const BOARD_TABS_KEY = 'terminal_board_tabs'
export const TABS_VERSION = 1
/** The most boards open at once. The chrome says so when it is reached. */
export const MAX_TABS = 8
export const TAB_KINDS = Object.freeze(['own', 'starter', 'stock', 'saved', 'blank'])
export const OWN_NAME = 'My board'
export const BLANK_NAME = 'New board'
export const TAB_NAME_MAX = 60
/** What the chrome says when the limit is reached (one sentence, one place). */
export const TABS_FULL_TEXT = `You have ${MAX_TABS} boards open, which is the most. Close one to open another.`

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const cleanName = (v, fallback) => String(v ?? '').trim().slice(0, TAB_NAME_MAX) || fallback

function cleanTab(t, seen) {
  if (!isObj(t) || typeof t.id !== 'string' || !t.id || seen.has(t.id)) return null
  if (!TAB_KINDS.includes(t.kind)) return null
  seen.add(t.id)
  return {
    id: t.id,
    kind: t.kind,
    ref: typeof t.ref === 'string' && t.ref ? t.ref : null,
    name: cleanName(t.name, t.kind === 'blank' ? BLANK_NAME : OWN_NAME),
    sym: t.kind === 'stock' ? (stockTicker(t.sym) || null) : null,
    copy: isObj(t.copy) ? t.copy : null,
  }
}

/** `{ status, doc }` for the stored blob. `status` is absent · ok · unreadable · newer, the same
 *  four words the layout and the library use; `doc` is a clean document only when `ok`. A blob
 *  with no usable tab reads as `absent` (the tabs are seeded again from the board on screen). */
export function readTabs(raw) {
  if (raw == null || raw === '') return { status: 'absent', doc: null }
  let v = raw
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) } catch { return { status: 'unreadable', doc: null } }
  }
  if (!isObj(v)) return { status: 'unreadable', doc: null }
  if (Number.isInteger(v.v) && v.v > TABS_VERSION) return { status: 'newer', doc: null }
  if (v.v !== TABS_VERSION || !Array.isArray(v.tabs)) return { status: 'unreadable', doc: null }
  const seen = new Set()
  const tabs = v.tabs.map((t) => cleanTab(t, seen)).filter(Boolean).slice(0, MAX_TABS)
  if (!tabs.length) return { status: 'absent', doc: null }
  const active = tabs.some((t) => t.id === v.active) ? v.active : tabs[0].id
  const pending = v.pending === active && typeof v.pendingFrom === 'string' && v.pendingFrom ? active : null
  return { status: 'ok', doc: { v: TABS_VERSION, active, pending, pendingFrom: pending ? v.pendingFrom : null, tabs } }
}

export function serializeTabs(doc) {
  return JSON.stringify({
    v: TABS_VERSION,
    active: doc.active,
    pending: doc.pending || null,
    pendingFrom: doc.pending ? doc.pendingFrom || null : null,
    tabs: doc.tabs,
  })
}

export const activeTab = (doc) => doc?.tabs.find((t) => t.id === doc.active) || null
export const findTab = (doc, id) => doc?.tabs.find((t) => t.id === id) || null

/** A tab id no open tab uses. */
export function newTabId(doc, now = Date.now()) {
  const used = new Set((doc?.tabs || []).map((t) => t.id))
  for (let n = 0; ; n += 1) {
    const id = `t${now.toString(36)}${n.toString(36)}`
    if (!used.has(id)) return id
  }
}

/**
 * What a board IS, for "did it change": how many panels it shows, and for each of them its tool,
 * its arguments, the group it follows and, for a panel that follows no group, the ticker pinned
 * on it. The ticker a GROUP holds is not part of it: picking a name in a list moves a group all
 * day, and that is using a board, not changing it. Panel ids, focus, density and the undo list
 * are not part of it either. WHICH group letter a panel follows is not part of it: groups are
 * numbered in the order the panels first use them, so four panels on B are the same board as
 * four panels on A (a ready-made board opens on whichever group is active). `own` is the exact
 * form the two-key gap check uses: the real group ids, plus the tickers of the board's own
 * groups (E and later), which is what tells a stock board from the same board for another ticker.
 */
export function boardSignature(snapshot, { own = false } = {}) {
  if (!isObj(snapshot) || !Array.isArray(snapshot.panels)) return ''
  const count = Math.max(1, Math.min(Number(snapshot.count) || 1, snapshot.panels.length))
  const order = []
  const groupOf = (ch) => {
    if (!ch) return ''
    if (own) return ch
    if (!order.includes(ch)) order.push(ch)
    return `g${order.indexOf(ch)}`
  }
  const panels = snapshot.panels.slice(0, count).map((p) => {
    const ch = panelChannel(p)
    return [p.code, (p.args || []).join(' '), groupOf(ch), ch ? '' : String(p.sym || '')]
  })
  if (!own) return JSON.stringify([count, panels])
  const groups = (Array.isArray(snapshot.channels) ? snapshot.channels : [])
    .filter((c) => !isCompatChannel(c.id) && c.sym).map((c) => [c.id, c.sym])
  return JSON.stringify([count, panels, groups])
}

/** The ticker a stock board is showing: its first panel's group. */
export function stockSymOf(snapshot) {
  if (!isObj(snapshot) || !Array.isArray(snapshot.panels) || !snapshot.panels.length) return null
  const ch = panelChannel(snapshot.panels[0])
  const rec = (Array.isArray(snapshot.channels) ? snapshot.channels : []).find((c) => c.id === ch)
  return stockTicker(ch ? rec?.sym : snapshot.panels[0].sym) || null
}

/** The board "Blank" opens: the engine's own default board at one panel. (The engine has no
 *  empty panel: every panel record names a tool, and a board holds at least four records.) The
 *  member's density is kept; the A to D groups' tickers are not written. */
export function blankBoard(layout) {
  return boardSnapshot({ ...defaultLayout(), density: layout?.density || 'comfortable' })
}

/** The saved board a `saved` tab stands for: by id, else by name (a board saved from this tab a
 *  moment ago is found by its name until its id is known). */
export function savedBoardOf(tab, library) {
  const boards = library?.boards || []
  return boards.find((b) => tab.ref && b.id === tab.ref) || boards.find((b) => sameBoardName(b.name, tab.name)) || null
}

/**
 * What a tab was when it was opened or last saved, as a board, or null when there is nothing
 * to compare with (`own`, or a saved board since deleted). `layout` is the tab's own board: a
 * ready-made build keeps the member's groups and density, as opening one does.
 */
export function tabBase(tab, { layout, library } = {}) {
  if (!tab) return null
  if (tab.kind === 'starter') return buildStarterBoard(layout, findStarterBoard(tab.ref))
  if (tab.kind === 'stock') return buildStockBoard(layout, findStockBoard(tab.ref), stockSymOf(layout) || tab.sym)
  if (tab.kind === 'saved') return savedBoardOf(tab, library)?.layout || null
  if (tab.kind === 'blank') return blankBoard(layout)
  return null
}

/** A ready-made (or stock) board that no longer matches the UCT default: "Reset to UCT default"
 *  is offered only then. */
export function differsFromDefault(tab, snapshot, ctx) {
  if (!tab || (tab.kind !== 'starter' && tab.kind !== 'stock')) return false
  const base = tabBase(tab, ctx)
  return !!base && boardSignature(snapshot) !== boardSignature(base)
}

/**
 * Does this tab hold changes that are saved NOWHERE else? That is the question closing it asks.
 *   starter / stock / blank   it no longer matches what it opened as
 *   saved                     it no longer matches the saved board (or that board is gone)
 *   own                       always, unless one of the member's saved boards is the same board
 */
export function tabUnsaved(tab, snapshot, ctx = {}) {
  if (!tab || !snapshot) return false
  const sig = boardSignature(snapshot)
  if (tab.kind === 'own') return !(ctx.library?.boards || []).some((b) => boardSignature(b.layout) === sig)
  const base = tabBase(tab, ctx)
  return !base || boardSignature(base) !== sig
}

/** Is the board on screen the engine's untouched default (what a member who never changed the
 *  Terminal sees)? Tickers are not looked at: the first-visit board shows SPY without storing it. */
export function isUntouchedDefault(layout, layoutStatus) {
  if (layoutStatus === 'absent') return true
  const sig = boardSignature(boardSnapshot(layout))
  return [defaultLayout(), firstVisitLayout()].some((d) => boardSignature(boardSnapshot(d)) === sig)
}

/**
 * The tabs a member sees the first time the new shell draws. Nobody's board moves:
 *   * a member with a board of their own gets it as the first tab, under the name of the saved
 *     board it matches, or "My board";
 *   * a member on the untouched default gets the first ready-made board, under its own name,
 *     and `open` is that board (the caller puts it on screen).
 * Returns `{ doc, open }`; `open` is a board to put on screen, or null.
 */
export function seedTabs({ layout, syms, layoutStatus, library }, now = Date.now()) {
  const id = newTabId(null, now)
  const one = (tab) => ({
    v: TABS_VERSION, active: id, pending: null, pendingFrom: null, tabs: [{ id, ref: null, sym: null, copy: null, ...tab }],
  })
  if (isUntouchedDefault(layout, layoutStatus)) {
    const starter = STARTER_BOARDS[0]
    const open = starter ? buildStarterBoard(layout, starter) : null
    if (open) return { doc: one({ kind: 'starter', ref: starter.id, name: starter.name, copy: boardSnapshot(open) }), open }
  }
  const sig = boardSignature(boardSnapshot(layout, syms))
  const saved = (library?.boards || []).find((b) => boardSignature(b.layout) === sig)
  if (saved) return { doc: one({ kind: 'saved', ref: saved.id, name: saved.name }), open: null }
  return { doc: one({ kind: 'own', name: OWN_NAME }), open: null }
}

/** Tabs for a session that may not write (the stored tabs, or the stored board, could not be
 *  read): one tab for the board on screen, held in memory only. */
export function sessionTabs(now = Date.now()) {
  const id = newTabId(null, now)
  return {
    v: TABS_VERSION, active: id, pending: null, pendingFrom: null,
    tabs: [{ id, kind: 'own', ref: null, name: OWN_NAME, sym: null, copy: null }],
  }
}

/** The open tab that already stands for this board, if any (a ready-made board, a stock board
 *  for the same ticker, or a saved board is opened once; picking it again selects its tab). */
export function tabFor(doc, { kind, ref, sym } = {}) {
  if (!doc || !ref || (kind !== 'starter' && kind !== 'stock' && kind !== 'saved')) return null
  return doc.tabs.find((t) => t.kind === kind && t.ref === ref && (kind !== 'stock' || t.sym === (stockTicker(sym) || null))) || null
}

/** The tabs with the selected one PARKED: `current` (the board on screen) becomes its working
 *  copy, and a stock board's tab takes the ticker that board is showing now. */
function parked(doc, current) {
  return doc.tabs.map((t) => {
    if (t.id !== doc.active || !current) return t
    return { ...t, copy: current, sym: t.kind === 'stock' ? (stockSymOf(current) || t.sym) : t.sym }
  })
}
const fromOf = (current) => boardSignature(current, { own: true }) || null

/**
 * Open `tab` (`{ kind, ref, name, sym }`) as a NEW tab holding `snapshot`, and select it. The
 * tab being left is parked with `current` (the board on screen) as its working copy.
 * `{ ok: false, reason: 'full' }` at MAX_TABS: nothing changes.
 */
export function addTab(doc, tab, snapshot, current, now = Date.now()) {
  if (doc.tabs.length >= MAX_TABS) return { ok: false, reason: 'full', doc }
  const id = newTabId(doc, now)
  const made = cleanTab({ ...tab, id, copy: snapshot }, new Set())
  if (!made) return { ok: false, reason: 'kind', doc }
  return { ok: true, id, doc: { ...doc, active: id, pending: id, pendingFrom: fromOf(current), tabs: [...parked(doc, current), made] } }
}

/** Select `toId`. The tab being left is parked with `current` as its working copy; the tab
 *  selected keeps its own copy (see the header: it is the fallback until the board is stored). */
export function selectTab(doc, toId, current) {
  if (toId === doc.active || !findTab(doc, toId)) return { ok: false, doc }
  return { ok: true, doc: { ...doc, active: toId, pending: toId, pendingFrom: fromOf(current), tabs: parked(doc, current) } }
}

/**
 * Close a tab. The last tab cannot close. Closing the selected tab selects its neighbour (the
 * one to its right, else the one to its left), and `activate` is that tab: the caller puts its
 * copy on screen. `current` is the board on screen (the one going away with the selected tab).
 */
export function closeTab(doc, id, current) {
  const at = doc.tabs.findIndex((t) => t.id === id)
  if (at < 0 || doc.tabs.length < 2) return { ok: false, doc, activate: null }
  const tabs = doc.tabs.filter((t) => t.id !== id)
  if (id !== doc.active) return { ok: true, doc: { ...doc, tabs }, activate: null }
  const next = tabs[Math.min(at, tabs.length - 1)]
  return { ok: true, doc: { ...doc, active: next.id, pending: next.id, pendingFrom: fromOf(current), tabs }, activate: next }
}

/** Can this tab be renamed? A saved board can (the board model renames it); "My board" and a
 *  blank board are the member's own and are only a label here; a ready-made or stock board
 *  keeps the name UCT gave it. */
export const canRename = (tab) => !!tab && (tab.kind === 'saved' || tab.kind === 'own' || tab.kind === 'blank')

export function renameTab(doc, id, name) {
  const n = cleanName(name, '')
  if (!n || !canRename(findTab(doc, id))) return doc
  return { ...doc, tabs: doc.tabs.map((t) => (t.id === id ? { ...t, name: n } : t)) }
}

/** Change what a tab stands for (it was saved to the member's boards). */
export function retargetTab(doc, id, patch) {
  return { ...doc, tabs: doc.tabs.map((t) => (t.id === id ? (cleanTab({ ...t, ...patch, id: t.id }, new Set()) || t) : t)) }
}

/** The stored board has caught up with the selected tab: nothing is in flight any more. */
export function clearPending(doc) {
  return doc.pending || doc.pendingFrom ? { ...doc, pending: null, pendingFrom: null } : doc
}

/**
 * A switch whose second write never landed: the document says a tab was selected, and the
 * STORED board is still the one that was on screen before it (and is not the selected tab's own
 * board). The caller then puts the selected tab's copy on screen again. `stored` is the stored
 * board as a snapshot.
 */
export function needsHeal(doc, stored) {
  const tab = activeTab(doc)
  if (!doc?.pending || doc.pending !== doc.active || !doc.pendingFrom || !tab?.copy) return false
  return boardSignature(stored, { own: true }) === doc.pendingFrom && boardSignature(tab.copy, { own: true }) !== doc.pendingFrom
}

/** What a tab's label reads: a stock board shows its ticker, with "Stock" as a small second word.
 *  `liveSym` is the ticker the board is showing now (the selected tab; a parked one stores it). */
export function tabLabel(tab, liveSym = null) {
  const sym = tab.kind === 'stock' ? (stockTicker(liveSym) || tab.sym) : null
  if (sym) return { text: sym, small: 'Stock' }
  return { text: tab.name, small: null }
}

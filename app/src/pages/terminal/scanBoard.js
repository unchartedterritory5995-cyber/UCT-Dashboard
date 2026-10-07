// UCT Terminal — SCAN-TO-BOARD (feature-gaps-2026-10-06 #9, Bloomberg's launchpad monitors).
// Pure; tests in scanBoard.test.js.
//
// A member takes a LIST of securities (MOST's rows, the screener's results, a watchlist, or names
// typed on the line) and turns it into a board of panels in one action: `BOARD GP` = one price
// chart per name. The board itself is an ordinary boardModel layout, opened by the shell through
// the SAME path a saved or shared board takes (`openSnapshot`), so:
//   * it never overwrites the member's board without a way back: "Back to my layout" (the shell's
//     revert memory, which keeps the member's OWN board across every page of a scan), plus the
//     terminal's Version history wherever the versioned store is armed;
//   * it is saved to the library only when the member asks ("Save to my boards" → `saveBoard`,
//     the existing `terminal_boards` read-modify-write). No new preference key.
//
// ⛔ THE PANEL LIMIT IS boardModel's, NEVER RESTATED. A board shows `MAX_VISIBLE` panels; a longer
// list opens its first page and PAGES through the rest (Next / Previous). Every name that is not on
// screen is named in the notice, never dropped in silence. Repeats are counted once and said.
import parseCommand from './parseCommand'
import { BY_CODE, flagOn } from './functions'
import { URL_OWNING_PANELS, panelNameFor } from './panels'
import { MAX_VISIBLE, isCompatChannel, newPanelId, normalizeLayout, symKey } from './boardModel'

/** Names per page: one per visible panel. */
export const BOARD_PAGE = MAX_VISIBLE

/** The codes the list panels' "Board of" control offers, most useful first. Any other code with
 *  a per-security panel works when TYPED (`BOARD OWN`); this is only the menu. */
export const QUICK_BOARD_CODES = Object.freeze(['GP', 'DES', 'CN', 'MOVE', 'TECH', 'CATS', 'FA', 'EE'])

const TICKER_RE = /^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z]{1,2})?$/

/** Why `code` cannot fill a board (one security per panel), or null when it can. The structural
 *  half (a per-security PANEL, not a door) is checked at parse; this adds the shell's facts: a
 *  URL-owning panel appears at most once on a board, and the member's flags. */
export function boardCodeRefusal(code, auth) {
  const c = String(code || '').toUpperCase()
  const fn = BY_CODE[c]
  if (!fn) return `${c || 'That'} is not a function. HELP lists every function.`
  const v = fn.ticker
  if (!v) return `${c} is market-wide (it shows no single security), so it cannot fill a board with one name per panel. Try BOARD GP or BOARD DES.`
  if (v.door) return `${c} opens a page outside the terminal, one name at a time, so it cannot fill a board. Try BOARD GP or BOARD DES.`
  const name = panelNameFor(v)
  if (!name) return `${c} has no panel on this release.`
  if (URL_OWNING_PANELS.has(name)) return `${c} opens the ${name.toLowerCase()}, which a board can show only once, so it cannot fill a board. Try BOARD GP or BOARD DES.`
  if (!flagOn(auth, v.flag)) return `${c} is not enabled for your account yet.`
  return null
}

/** The menu for the "Board of" control: `[{ code, label }]`, only codes this member can use. */
export function boardableCodes(auth, codes = QUICK_BOARD_CODES) {
  return codes.filter((c) => !boardCodeRefusal(c, auth)).map((c) => ({ code: c, label: BY_CODE[c].label }))
}

/** A list cleaned for a board: upper-cased, `$` dropped, invalid entries and REPEATS set aside
 *  (BRK.B and BRK-B are one security) — both reported, never lost. Order is kept. */
export function cleanSymbols(list) {
  const syms = []
  const repeats = []
  const invalid = []
  const seen = new Set()
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw ?? '').trim().toUpperCase().replace(/^\$/, '')
    if (!s) continue
    if (!TICKER_RE.test(s)) { invalid.push(String(raw)); continue }
    const k = symKey(s)
    if (seen.has(k)) { repeats.push(s); continue }
    seen.add(k)
    syms.push(s)
  }
  return { syms, repeats, invalid }
}

/** The securities a panel's published ROWS name (row <GO>'s list): `$NVDA` (MOST) is NVDA,
 *  `NVDA GP` (RRG) is NVDA, a bare code (HELP's list) names none. In order, repeats kept for
 *  `cleanSymbols` to count. */
export function symbolsFromRows(rows) {
  const out = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const t = String(row ?? '').trim()
    if (!t) continue
    if (/^\$/.test(t) && !/\s/.test(t)) { out.push(t.slice(1).toUpperCase()); continue }
    const cmd = parseCommand(t)
    if (cmd.ok && cmd.type === 'function' && cmd.sym) out.push(cmd.sym)
  }
  return out
}

/** Page `page` (0-based, clamped) of `total` names: `{ page, pages, start, end }`. */
export function pageBounds(total, page = 0) {
  const pages = Math.max(1, Math.ceil(total / BOARD_PAGE))
  const p = Math.min(Math.max(0, Number.isInteger(page) ? page : 0), pages - 1)
  const start = p * BOARD_PAGE
  return { page: p, pages, start, end: Math.min(start + BOARD_PAGE, total) }
}

/**
 * The board for one page of names: one UNLINKED panel per name running `code` (each panel holds
 * its own security, so a group change elsewhere never repaints a scan board), as many visible
 * panels as names (1–4), focus on the first. The member's groups and density are kept; the A–D
 * groups' securities are NOT carried in the snapshot, so opening it never moves /charts' groups.
 * The undo list starts empty: this is a new board, not an edit of the old one.
 */
export function buildScanBoard(layout, code, syms) {
  const cur = normalizeLayout(layout)
  const names = (Array.isArray(syms) ? syms : []).slice(0, BOARD_PAGE)
  const panels = []
  for (const sym of names) panels.push({ id: newPanelId(panels), code, channel: null, sym, args: [] })
  return normalizeLayout({
    ...cur,
    count: Math.max(1, panels.length),
    focus: 0,
    closed: [],
    panels,
    channels: cur.channels.map((c) => ({ ...c, sym: isCompatChannel(c.id) ? null : c.sym })),
  })
}

/** The name a scan board shows on the Boards button, and saves under. */
export function scanBoardName(code, label) {
  return `${code} · ${label || 'list'}`.slice(0, 60)
}

const nameList = (syms, max = 12) => (syms.length > max
  ? `${syms.slice(0, max).join(', ')} and ${syms.length - max} more`
  : syms.join(', '))

/**
 * What the shell says when a scan board opens: which names are on screen, which are not (by
 * name), the page, and any repeats counted once. `{ text, pages, page }`.
 */
export function scanBoardNotice({ code, label, syms, page = 0, repeats = [], total = null }) {
  const b = pageBounds(syms.length, page)
  const shown = syms.slice(b.start, b.end)
  const before = syms.slice(0, b.start)
  const after = syms.slice(b.end)
  const parts = [`Opened ${label || 'the list'} as a board of ${code}: ${shown.join(', ')}.`]
  if (syms.length > BOARD_PAGE) {
    parts.push(`Names ${b.start + 1}-${b.end} of ${syms.length}; a board shows ${BOARD_PAGE} panels at a time.`)
    if (after.length) parts.push(`Not on screen yet: ${nameList(after)}.`)
    if (before.length) parts.push(`Earlier pages: ${nameList(before, 8)}.`)
  }
  if (Number.isFinite(total) && total > syms.length) {
    parts.push(`The list holds ${total} in all; ${syms.length} ${syms.length === 1 ? 'was' : 'were'} loaded, so the board pages through those.`)
  }
  if (repeats.length) {
    parts.push(`${repeats.length} repeated name${repeats.length === 1 ? '' : 's'} counted once (${nameList(repeats, 6)}).`)
  }
  return { text: parts.join(' '), page: b.page, pages: b.pages }
}

// UCT Terminal — READY-MADE STOCK BOARDS: the validator, the builder and the words (2026-11-18).
// Pure; tests in stockBoards.test.js. The list itself is stockBoards.js.
//
// ⛔ OPENING ONE WRITES THE BOARD ON SCREEN AND NOTHING ELSE. The board built here is an ordinary
// boardModel layout, opened by the shell through the SAME path a saved, shared, scan or market
// board takes (`openSnapshot`), so the member's own board is remembered ("Back to my layout"),
// and the library (`terminal_boards`) is written only by "Save to my boards", under a free name.
//
// ⛔ WHERE THE TICKER LIVES: IN THE BOARD, NEVER IN /charts. Groups A to D are the /charts color
// groups; their ticker is ONE value shared with /charts and the app focus
// (`charts_workspace_groups`). A stock board must set a ticker somewhere, and setting it on A to D
// would move a chart on another page. So the board takes a group OF ITS OWN (E or later, named
// "Stock board"), whose ticker is kept in the board's own record (`terminal_layout`):
//   * the /charts groups preference is not written at all, by opening or by a later ticker change
//     on the board (TerminalShell.stockBoards.test.jsx holds it byte for byte);
//   * no other group's ticker or history is touched: A to D are not carried, and every other
//     group the member added keeps its record as it was;
//   * a second stock board (another ticker, another board) reuses that same group, so opening ten
//     in a row adds one group, not ten.
// A board has room for MAX_CHANNELS groups. If every one is taken AND holds a ticker, the stock
// board is refused in words (`stockBoardRefusal`) rather than taking a group the member filled.
import { ABSENT, BY_CODE, RETIRED, isCode } from './functions'
import { RESERVED_WORDS } from './grammar'
import { URL_OWNING_PANELS, panelNameFor } from './panels'
import {
  MAX_CHANNELS, MAX_VISIBLE, activeChannelOf, addChannel, applyChannelSym, isCompatChannel, isLinkable, newPanelId,
  normalizeLayout, panelSym, sameBoardName,
} from './boardModel'
import { STARTER_ABOUT_MAX, STARTER_BOARDS } from './starterBoards'
import { STOCK_BOARDS, STOCK_BOARD_WORD, stockBoardCommand } from './stockBoards'

/** The name of the group a stock board owns (the link menu and the notices show it). */
export const STOCK_GROUP_NAME = 'Stock board'

/** Panels a ready-made board never shows, whatever the registry says: the trader archive is not
 *  put in front of members (owner ruling 2026-10-17). */
const NEVER_ON_A_BOARD = new Set(['TraderArchive'])

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_RE = /^[A-Z]{2,6}$/
const WORD_RE = /^[A-Z]{3,12}$/
const TICKER_RE = /^[A-Z][A-Z0-9]{0,5}(?:[.-][A-Z]{1,2})?$/

/** A ticker as a stock board takes it (`$nvda` is NVDA), or null. */
export function stockTicker(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/^\$/, '')
  return TICKER_RE.test(s) ? s : null
}

/**
 * One code of a stock board, read against the registry: `{ ok: true, code, name }` (`name` is the
 * panel it mounts), or `{ ok: false, why }`. Refused: anything that is not a bare registered code
 * (a ticker or an argument in the data, another spelling of a code), a market-wide code (it takes
 * no ticker, so it could not follow the board's stock), a door, a code with no panel, a flagged
 * code (not every member has it), a panel that owns the address bar, and the trader archive.
 */
export function readStockCode(code) {
  const c = String(code ?? '')
  if (!CODE_RE.test(c)) return { ok: false, why: `"${c}" is not a bare function code (the ticker is given when the board opens, and a stock board takes no arguments)` }
  const fn = BY_CODE[c]
  if (!fn) return { ok: false, why: `${c} is not a registered function` }
  if (fn.code !== c) return { ok: false, why: `${c} is another spelling of ${fn.code}; the list names the code a member sees on the panel` }
  const v = fn.ticker
  if (!v) return { ok: false, why: `${c} is market-wide: it takes no ticker, so it cannot follow the board's stock` }
  if (v.door) return { ok: false, why: `${c} opens a page outside the terminal, not a panel` }
  const name = panelNameFor(v)
  if (!name) return { ok: false, why: `${c} has no panel on this release` }
  if (v.flag) return { ok: false, why: `${c} is behind the ${v.flag} flag, so not every member could open it` }
  if (URL_OWNING_PANELS.has(name)) return { ok: false, why: `${c} opens the ${name.toLowerCase()}, which owns the address bar and opens over the board` }
  if (NEVER_ON_A_BOARD.has(name)) return { ok: false, why: `${c} shows the trader archive, which is never on a ready-made board` }
  return { ok: true, code: c, name }
}

/**
 * Everything wrong with ONE stock board, as plain sentences (empty = it can ship). `others` are
 * the stock boards it must not share an id, a name or a word with; `starters` the market boards
 * whose ids and names it must not repeat (both lists sit in one menu section and save under
 * their names).
 */
export function stockBoardProblems(board, others = [], starters = STARTER_BOARDS) {
  if (!board || typeof board !== 'object') return ['a stock board must be an object']
  const out = []
  const label = board.name || board.id || 'a stock board'
  if (typeof board.id !== 'string' || !ID_RE.test(board.id)) out.push(`${label}: its id must be a lower-case slug`)
  const name = typeof board.name === 'string' ? board.name.trim() : ''
  if (!name || name.length > 60) out.push(`${label}: it needs a name of 1 to 60 characters`)
  const about = typeof board.about === 'string' ? board.about.trim() : ''
  if (!about) out.push(`${label}: it needs one sentence saying what it is for`)
  else {
    if (about.length > STARTER_ABOUT_MAX) out.push(`${label}: its sentence is longer than ${STARTER_ABOUT_MAX} characters`)
    if (!/[.]$/.test(about) || /[.!?]\s/.test(about)) out.push(`${label}: its description must be ONE sentence ending in a full stop`)
  }
  const word = typeof board.word === 'string' ? board.word : ''
  if (!WORD_RE.test(word)) out.push(`${label}: its command word must be 3 to 12 capitals`)
  else if (word === STOCK_BOARD_WORD || RESERVED_WORDS.includes(word)) out.push(`${label}: the word ${word} is a reserved word of the command line`)
  else if (isCode(word) || Object.prototype.hasOwnProperty.call(ABSENT, word) || Object.prototype.hasOwnProperty.call(RETIRED, word)) {
    out.push(`${label}: the word ${word} is a function code; it would be read as that function`)
  }
  for (const o of others) {
    if (o === board) continue
    if (o?.id === board.id) out.push(`${label}: the id ${board.id} is used twice`)
    if (name && sameBoardName(o?.name, name)) out.push(`${label}: the name is used twice`)
    if (word && o?.word === word) out.push(`${label}: the word ${word} is used twice`)
  }
  for (const s of starters) {
    if (s?.id === board.id) out.push(`${label}: the id ${board.id} is a market board's`)
    if (name && sameBoardName(s?.name, name)) out.push(`${label}: the name is a market board's`)
  }
  const codes = Array.isArray(board.codes) ? board.codes : []
  if (codes.length < 1 || codes.length > MAX_VISIBLE) {
    out.push(`${label}: a board holds 1 to ${MAX_VISIBLE} panels, this one names ${codes.length}`)
  }
  const seen = new Set()
  for (const code of codes) {
    const r = readStockCode(code)
    if (!r.ok) { out.push(`${label}: ${r.why}`); continue }
    if (seen.has(r.code)) out.push(`${label}: ${r.code} is on the board twice`)
    seen.add(r.code)
  }
  return out
}

/** Every problem in a list of stock boards (empty = the list can ship). */
export function stockBoardsProblems(boards = STOCK_BOARDS, starters = STARTER_BOARDS) {
  return (Array.isArray(boards) ? boards : []).flatMap((b) => stockBoardProblems(b, boards, starters))
}

/**
 * The ticker a stock board opens for when none is named (the Boards menu, a bare `STOCK`): the
 * focused panel's own security when it shows one, else the security of the board's active group.
 * `null` when neither holds a ticker (the menu then says to pick one first).
 */
export function stockBoardTicker(layout, syms) {
  if (!layout || !Array.isArray(layout.panels)) return null
  const p = layout.panels[Math.min(layout.focus, layout.count - 1)]
  const own = isLinkable(p) ? panelSym(p, syms) : null
  return stockTicker(own) || stockTicker(syms?.[activeChannelOf(layout)]) || null
}

/**
 * The group a stock board's panels join, on a copy of `layout`: `{ layout, id }`, or null when
 * the board has no group to give. In order: the group a stock board already owns (by its name);
 * a NEW group; at the MAX_CHANNELS bound, an added group that holds no ticker (nothing of the
 * member's is replaced). Never one of A to D, never a group that holds a ticker.
 */
export function stockBoardGroup(layout) {
  const cur = normalizeLayout(layout)
  const extra = cur.channels.filter((c) => !isCompatChannel(c.id))
  const named = (id, from = cur) => ({
    id,
    layout: { ...from, channels: from.channels.map((c) => (c.id === id ? { ...c, name: STOCK_GROUP_NAME } : c)) },
  })
  const own = extra.find((c) => c.name === STOCK_GROUP_NAME)
  if (own) return { id: own.id, layout: cur }
  const added = addChannel(cur)
  if (added.id) return named(added.id, added.layout)
  const empty = extra.find((c) => !c.sym)
  return empty ? named(empty.id) : null
}

/**
 * Why `board` cannot open for `sym` on this layout, as the sentence the shell says, or null when
 * it can. Nothing is changed in either case.
 */
export function stockBoardRefusal(layout, board, sym) {
  if (!board || stockBoardProblems(board).length) {
    return `${board?.name || 'That stock board'} could not be opened on this release; your board was not changed.`
  }
  if (!stockTicker(sym)) {
    const typed = String(sym ?? '').trim()
    return `A stock board opens for one ticker${typed ? `, and "${typed}" is not one` : ''}. Type the ticker first, like ${stockBoardCommand(board)}. Your board was not changed.`
  }
  if (!stockBoardGroup(layout)) {
    return `This board already has ${MAX_CHANNELS} color groups, the most it can hold, and each one holds a ticker, so the stock board has no group of its own to use. Your board was not changed.`
  }
  return null
}

/**
 * The board a stock entry opens for `sym`, as an ordinary boardModel layout: one visible panel
 * per code, every one in the board's own group (see the header), that group set to `sym` and made
 * the active group, focus on the first panel, an empty undo list. The member's other groups and
 * density are kept as they are; the A to D groups' securities are NOT carried, so opening it
 * never moves /charts. `null` when `stockBoardRefusal` has something to say.
 */
export function buildStockBoard(layout, board, sym) {
  if (stockBoardRefusal(layout, board, sym)) return null
  const group = stockBoardGroup(layout)
  const panels = []
  for (const code of board.codes) panels.push({ id: newPanelId(panels), code, channel: group.id, sym: null, args: [] })
  const next = normalizeLayout({
    ...group.layout,
    count: panels.length,
    focus: 0,
    closed: [],
    panels,
  })
  // `normalizeLayout` never keeps a ticker on an A to D record (their ticker is the /charts
  // preference), so the snapshot cannot carry one; the ticker goes on the board's own group.
  return normalizeLayout(applyChannelSym(next, group.id, stockTicker(sym)))
}

/** What the shell says when a stock board opens. */
export function stockBoardNotice(board, sym) {
  return `Opened the stock board ${board.name} for ${stockTicker(sym)} (${board.codes.join(', ')}). `
    + 'Its panels share one group, so a new ticker in any of them moves the whole board. Your saved boards were not changed.'
}

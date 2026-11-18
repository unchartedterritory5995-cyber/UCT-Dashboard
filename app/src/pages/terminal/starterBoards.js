// UCT Terminal — READY-MADE BOARDS (2026-11-17). Pure; tests in starterBoards.test.js.
//
// The Terminal has many panels and each one opens by a code (`HILO`, `CONFL`, `PCHG QTD`). A
// ready-made board puts up to four of them on screen in one click, from the Boards menu, so a
// member does not have to learn the codes first (information-architecture.md 13.3: starter
// boards "ship as ordinary editable artefacts").
//
// ⛔ A READY-MADE BOARD IS DATA, NOT CODE. `STARTER_BOARDS` below is the ONE list: a name, one
// plain sentence saying what the board is for, and the COMMANDS a member would type, one per
// panel. Nothing else in the app names these codes a second time. `starterBoardProblems` reads
// every command through the one parser and the function registry, and starterBoards.test.js
// fails by name when a code is renamed, removed, turned into a door, put behind a flag or given
// an argument it no longer takes. A board with a dead panel cannot ship.
//
// ⛔ OPENING ONE NEVER TOUCHES THE MEMBER'S SAVED BOARDS. The board built here is an ordinary
// boardModel layout, opened by the shell through the SAME path a saved, shared or scan board
// takes (`openSnapshot`), so:
//   * the board the member had is remembered and "Back to my layout" returns it;
//   * the library (`terminal_boards`) is written only when the member presses "Save to my
//     boards" (or names it in the Boards menu), and then under a name of theirs that is FREE
//     (`freeBoardName`): a board they already saved as "Leaders" is never replaced;
//   * the A to D groups' securities are NOT carried in the snapshot, so opening it never moves
//     the /charts groups. No new preference key, no server route.
//
// ⛔ THE PANEL LIMIT IS boardModel's (`MAX_VISIBLE`), never restated here.
import parseCommand from './parseCommand'
import { BY_CODE, variantFor } from './functions'
import { applyArgs } from './args'
import { URL_OWNING_PANELS, panelNameFor } from './panels'
import { MAX_VISIBLE, isCompatChannel, newPanelId, normalizeLayout, sameBoardName } from './boardModel'

/** The longest sentence the Boards menu shows under a board's name (it wraps on a phone). */
export const STARTER_ABOUT_MAX = 180

/**
 * THE LIST. Each entry:
 *   id        a stable slug (test ids, the "open now" mark); never shown.
 *   name      what the Boards menu and the Boards button call it. Sentence case.
 *   about     ONE plain sentence a trader would say, shown under the name.
 *   commands  one command per panel, in screen order, exactly as typed on the command line
 *             (`PCHG QTD`). A code that needs a security carries one (`NVDA EXMV`); a market
 *             board uses market-wide codes, so it opens the same for every member.
 */
export const STARTER_BOARDS = Object.freeze([
  {
    id: 'market-open',
    name: 'Market open',
    about: 'The first look at the session, with new highs and lows of the day, sectors ranked, analyst upgrades and downgrades, and themes rotating in and out.',
    commands: ['HILO', 'SCTR', 'UPDG', 'TROT'],
  },
  {
    id: 'leaders',
    name: 'Leaders',
    about: 'The strongest stocks in the market, from long-run leaders and new 52-week highs to the RS screens and the best performers this quarter.',
    commands: ['LEAD', 'H52', 'RSS', 'PCHG QTD'],
  },
  {
    id: 'earnings-season',
    name: 'Earnings season',
    about: 'Who reports next and the move options are pricing, who reported and how each stock moved, the earnings calendar, and a search of what companies said about guidance on their calls.',
    commands: ['ERNS', 'EMOV', 'CAL', 'TSRC guidance'],
  },
  {
    id: 'options-flow',
    name: 'Options flow',
    about: 'Where the options money is going, with the curated flow lists, contracts hit again and again, dark pool size lining up with long-dated flow, and the Top Flow picks.',
    commands: ['FLWL', 'ACCUM', 'CONFL', 'TOPF'],
  },
].map((b) => Object.freeze({ ...b, commands: Object.freeze([...b.commands]) })))

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * One command of a ready-made board, read through the one parser and the registry:
 * `{ ok: true, code, sym, args, name }` (`name` is the panel it mounts), or `{ ok: false, why }`.
 * Refused: anything that is not a function command, an alias instruction, a `@` target, a code
 * that needs a security and has none, a security a market-wide code would drop, a door (it
 * leaves the terminal), a flagged code (not every member has it) and an argument not applied.
 */
export function readStarterCommand(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return { ok: false, why: 'an empty command' }
  const cmd = parseCommand(raw)
  if (!cmd.ok) return { ok: false, why: `"${raw}" does not parse: ${cmd.error}` }
  if (cmd.type !== 'function') return { ok: false, why: `"${raw}" is not a function command (it reads as ${cmd.type})` }
  if (cmd.channel) return { ok: false, why: `"${raw}" aims at a panel or group; a ready-made board places its own panels` }
  // ⛔ THE COMMAND MUST NAME ITS CODE. A word the registry does not know reads as a TICKER
  // (`HILO`, once removed, would parse as the stock HILO and open its overview), so a renamed or
  // removed code would pass every check below as a different panel. An alias is refused the same
  // way: the list names the code a member sees on the panel.
  if (!raw.toUpperCase().split(/\s+/).includes(cmd.code)) {
    return { ok: false, why: `"${raw}" names no function code: it reads as ${[cmd.sym, cmd.code].filter(Boolean).join(' ')}` }
  }
  const fn = BY_CODE[cmd.code]
  if (!fn) return { ok: false, why: `"${raw}": ${cmd.code} is not a registered function` }
  const { variant, reason, ignoredTicker } = variantFor(cmd.code, !!cmd.sym)
  if (!variant) {
    return { ok: false, why: reason === 'needs-ticker'
      ? `"${raw}": ${cmd.code} needs a ticker and the command gives none`
      : `"${raw}": ${cmd.code} opens nothing` }
  }
  if (ignoredTicker) return { ok: false, why: `"${raw}": ${cmd.code} is market-wide, so ${cmd.sym} would not be applied` }
  if (variant.door) return { ok: false, why: `"${raw}": ${cmd.code} opens a page outside the terminal, not a panel` }
  const name = panelNameFor(variant)
  if (!name) return { ok: false, why: `"${raw}": ${cmd.code} has no panel on this release` }
  if (variant.flag) return { ok: false, why: `"${raw}": ${cmd.code} is behind the ${variant.flag} flag, so not every member could open it` }
  const args = cmd.args || []
  const { ignored } = applyArgs(variant, args)
  if (ignored.length) return { ok: false, why: `"${raw}": ${cmd.code} does not take ${ignored.map((t) => `"${t}"`).join(', ')}` }
  return { ok: true, code: cmd.code, sym: cmd.sym || null, args, name }
}

/**
 * Everything wrong with ONE ready-made board, as plain sentences (empty = it can ship).
 * `others` are the boards it must not share an id or a name with.
 */
export function starterBoardProblems(board, others = []) {
  const out = []
  const label = board?.name || board?.id || 'a board'
  if (!board || typeof board !== 'object') return ['a ready-made board must be an object']
  if (typeof board.id !== 'string' || !ID_RE.test(board.id)) out.push(`${label}: its id must be a lower-case slug`)
  const name = typeof board.name === 'string' ? board.name.trim() : ''
  if (!name || name.length > 60) out.push(`${label}: it needs a name of 1 to 60 characters`)
  const about = typeof board.about === 'string' ? board.about.trim() : ''
  if (!about) out.push(`${label}: it needs one sentence saying what it is for`)
  else {
    if (about.length > STARTER_ABOUT_MAX) out.push(`${label}: its sentence is longer than ${STARTER_ABOUT_MAX} characters`)
    if (!/[.]$/.test(about) || /[.!?]\s/.test(about)) out.push(`${label}: its description must be ONE sentence ending in a full stop`)
  }
  for (const o of others) {
    if (o === board) continue
    if (o?.id === board.id) out.push(`${label}: the id ${board.id} is used twice`)
    if (name && sameBoardName(o?.name, name)) out.push(`${label}: the name is used twice`)
  }
  const commands = Array.isArray(board.commands) ? board.commands : []
  if (commands.length < 1 || commands.length > MAX_VISIBLE) {
    out.push(`${label}: a board holds 1 to ${MAX_VISIBLE} panels, this one names ${commands.length}`)
  }
  const seen = new Set()
  let urlOwners = 0
  for (const text of commands) {
    const r = readStarterCommand(text)
    if (!r.ok) { out.push(`${label}: ${r.why}`); continue }
    const key = [r.sym, r.code, ...r.args].filter(Boolean).join(' ')
    if (seen.has(key)) out.push(`${label}: ${key} is on the board twice`)
    seen.add(key)
    if (URL_OWNING_PANELS.has(r.name)) urlOwners += 1
  }
  // The calendar and the screener page read and write the shell's URL: one per board, at most.
  if (urlOwners > 1) out.push(`${label}: it holds ${urlOwners} panels that own the address bar; a board can show one`)
  return out
}

/** Every problem in a list of ready-made boards (empty = the list can ship). */
export function starterBoardsProblems(boards = STARTER_BOARDS) {
  return (Array.isArray(boards) ? boards : []).flatMap((b) => starterBoardProblems(b, boards))
}

/** A ready-made board by id, or null. */
export function findStarterBoard(id, boards = STARTER_BOARDS) {
  return boards.find((b) => b.id === id) || null
}

/**
 * The board a ready-made entry opens, as an ordinary boardModel layout: one visible panel per
 * command, focus on the first, an empty undo list (it is a new board, not an edit of the old
 * one). The member's groups and density are kept. A market-wide panel joins the board's active
 * group, as the default board's panels do, so the first ticker picked in a list gives that group
 * a security the next panel opened can follow; a command that names its own security holds it,
 * unlinked. The A to D groups' securities are NOT carried, so opening never moves /charts.
 * `null` when the entry has a problem (the shell then says so and changes nothing).
 */
export function buildStarterBoard(layout, board) {
  if (starterBoardProblems(board).length) return null
  const cur = normalizeLayout(layout)
  const panels = []
  for (const text of board.commands) {
    const r = readStarterCommand(text)
    panels.push({ id: newPanelId(panels), code: r.code, channel: r.sym ? null : cur.activeChannel, sym: r.sym, args: r.args })
  }
  return normalizeLayout({
    ...cur,
    count: panels.length,
    focus: 0,
    closed: [],
    panels,
    channels: cur.channels.map((c) => ({ ...c, sym: isCompatChannel(c.id) ? null : c.sym })),
  })
}

/** What the shell says when a ready-made board opens. */
export function starterBoardNotice(board) {
  return `Opened the ready-made board ${board.name} (${board.commands.join(', ')}). Your saved boards were not changed.`
}

/**
 * The name "Save to my boards" saves a ready-made board under: its own, or, when the member
 * already has a board of that name, the first free "Name 2", "Name 3" … `saveBoard` REPLACES a
 * board of the same name, and a one-click save must never replace a board the member made.
 */
export function freeBoardName(library, name) {
  const boards = Array.isArray(library?.boards) ? library.boards : []
  const taken = (n) => boards.some((b) => sameBoardName(b.name, n))
  const base = String(name || 'Board').trim().slice(0, 56)
  if (!taken(base)) return base
  for (let n = 2; n <= boards.length + 2; n += 1) {
    if (!taken(`${base} ${n}`)) return `${base} ${n}`
  }
  return `${base} ${boards.length + 2}`
}

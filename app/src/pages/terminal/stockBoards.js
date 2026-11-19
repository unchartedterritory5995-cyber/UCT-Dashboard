// UCT Terminal — READY-MADE STOCK BOARDS: THE LIST (2026-11-18). No imports; tests in
// stockBoards.test.js.
//
// A market board (starterBoards.js) opens the same for every member. A STOCK board opens FOR ONE
// TICKER: up to four per-stock panels, all in one color group set to that ticker, so a new ticker
// in any of them moves the whole board. One click from the Boards menu, or `NVDA STOCK` typed.
//
// ⛔ A STOCK BOARD IS DATA, NOT CODE. `STOCK_BOARDS` below is the ONE list: a name, one plain
// sentence, the word that picks it on the command line, and the CODES of its panels. There is no
// ticker in the data: the ticker is supplied when the board opens. The validator, the builder and
// what the shell says live in stockBoardModel.js, which checks every code against the function
// registry (a code renamed, removed, turned into a door, put behind a flag or made market-wide
// fails by name in stockBoards.test.js).
//
// ⛔ THIS MODULE IMPORTS NOTHING, on purpose. The one parser (parseCommand.js) and the published
// rules (grammar.js) read the board words from here, and both also load in the Ctrl/Cmd-K
// palette's chunk on every page: a list that pulled in the panel table would ride along with it.

/** The command word: `NVDA STOCK`, `NVDA STOCK EARNINGS`, `STOCK` (the ticker the board is on).
 *  A reserved word of the grammar (grammar.js RESERVED_WORDS), not a function code: it opens a
 *  board, never a panel. STOCK is not a listed ticker (api/data/cap_universe.json; railed), and
 *  `$STOCK` would still mean one. SB, the shorter spelling, is Safe Bulkers. */
export const STOCK_BOARD_WORD = 'STOCK'

/**
 * THE LIST. The FIRST entry is the default (`NVDA STOCK` with no word). Each entry:
 *   id     a stable slug (test ids, the "open now" mark); never shown.
 *   word   what follows STOCK on the command line to pick this board (`NVDA STOCK EARNINGS`).
 *          Capitals; not a function code, not a listed ticker.
 *   name   what the Boards menu and the Boards button call it. Sentence case.
 *   about  ONE plain sentence a trader would say, shown under the name.
 *   codes  one per-stock function code per panel, in screen order. No ticker, no argument.
 */
export const STOCK_BOARDS = Object.freeze([
  {
    id: 'stock-glance',
    word: 'GLANCE',
    name: 'Stock at a glance',
    about: 'One stock on one screen, with its price chart, the move options are pricing into earnings, its options flow, and its call wall, put wall and dark pool levels.',
    codes: ['GP', 'EXMV', 'FLOW', 'LVL'],
  },
  {
    id: 'stock-earnings',
    word: 'EARNINGS',
    name: 'Into earnings',
    about: 'One stock before it reports, with its price chart, the move options are pricing against its past reports, analyst earnings estimates, and its earnings calls.',
    codes: ['GP', 'EXMV', 'EE', 'TRAN'],
  },
  {
    id: 'stock-company',
    word: 'COMPANY',
    name: 'Know the company',
    about: 'What one company is and who holds it, with its overview, its latest news, its ownership, and the lessons UCT has on the stock.',
    codes: ['DES', 'CN', 'OWN', 'LEARN'],
  },
].map((b) => Object.freeze({ ...b, codes: Object.freeze([...b.codes]) })))

/** The board `NVDA STOCK` opens when no word follows: the first of the list. */
export function defaultStockBoard(boards = STOCK_BOARDS) {
  return boards[0] || null
}

/** The board a command word names (`EARNINGS`), in any case, or null. */
export function stockBoardByWord(word, boards = STOCK_BOARDS) {
  const w = String(word ?? '').trim().toUpperCase()
  return (w && boards.find((b) => b.word === w)) || null
}

/** A stock board by id, or null. */
export function findStockBoard(id, boards = STOCK_BOARDS) {
  return boards.find((b) => b.id === id) || null
}

/** What a member types to open `board` for `sym`: the default needs no word. */
export function stockBoardCommand(board, sym = 'NVDA', boards = STOCK_BOARDS) {
  const first = defaultStockBoard(boards)
  return [sym, STOCK_BOARD_WORD, board && board !== first ? board.word : null].filter(Boolean).join(' ')
}

/** Every stock board as the command that opens it, for a refusal and for HELP:
 *  "NVDA STOCK (Stock at a glance), NVDA STOCK EARNINGS (Into earnings) or …". */
export function stockBoardUsage(boards = STOCK_BOARDS, sym = 'NVDA') {
  const parts = boards.map((b) => `${stockBoardCommand(b, sym, boards)} (${b.name})`)
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`
}

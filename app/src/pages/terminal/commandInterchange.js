// UCT Terminal: the command string as an interchange format (TERM-056, FB-S2-04).
//
// A command line is already a URL: the shell runs `?cmd=` on arrival (TerminalShell.jsx). This
// module is the one place that turns a PIECE OF TEXT written elsewhere (a Notebook note) into
// that URL, and back. The other direction needs nothing here: a note's address, `N:<id>`, is
// typed straight into the command line, where the ONE parser reads it as an address and the
// shell resolves it through `/api/address/resolve` to the note's door.
//
// ⛔ ONE GRAMMAR. Whether a pasted line IS a command is answered by `parseCommand`, the same
// parser the command line and the palette use. Nothing here re-describes the grammar; it only
// adds the paste-side caution below, which is about prose, not about commands.
//
// ⛔ PROSE IS NOT A COMMAND. A note is mostly words, and the parser is generous on purpose (a
// lone word is a ticker, a question goes to AI Search). So a pasted line becomes a terminal
// link only when it is unmistakably a command a member copied from the terminal:
//   · one short line;
//   · a board address `B:<slug>`, a saved-item address (`L:12`, `N:7`, ...), or
//   · a function the parser accepts, written with an explicit function code and at least two
//     words (`NVDA GRADE`, `GP SPY`), with no lower-case letters (the terminal's own echo is
//     upper case; a lower-case line is far more likely to be a sentence).
// A bare ticker (`NVDA`), HELP, ASK, a pasted list and every refusal stay plain text.
//
// Loaded LAZILY by the Notebook (a dynamic import, only while its gate is on), so the
// terminal's grammar never rides the Notebook's first-open bytes.
import parseCommand, { ADDRESS_RE, normalizeInput } from './parseCommand'
import { BOARD_ADDRESS_RE } from './boardModel'
import { isCode } from './functions'

/** The shell's own route; `?cmd=` on it runs a command on arrival. */
export const TERMINAL_PATH = '/terminal'
const MAX_PASTE_CHARS = 80

/** The in-app URL that opens the terminal at `command`. */
export function terminalCommandHref(command) {
  return `${TERMINAL_PATH}?cmd=${encodeURIComponent(String(command ?? '').trim())}`
}

/** The command a terminal link carries, or null for any other href. */
export function commandOfHref(href) {
  if (typeof href !== 'string' || !href.startsWith(`${TERMINAL_PATH}?`)) return null
  try {
    const cmd = new URLSearchParams(href.slice(TERMINAL_PATH.length + 1)).get('cmd')
    return cmd && cmd.trim() ? cmd.trim() : null
  } catch {
    return null
  }
}

/** Does this token name a function, written as one (not `$`-forced into a ticker)? */
const isExplicitCode = (tok) => !tok.startsWith('$') && isCode(tok)

/**
 * The terminal command a pasted piece of text IS, in the form the command line takes, or null.
 * See the header for why the bar is higher than the parser's.
 */
export function asTerminalCommand(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_PASTE_CHARS || /[\r\n]/.test(trimmed)) return null
  const raw = normalizeInput(trimmed)
  if (!raw) return null
  const board = raw.match(BOARD_ADDRESS_RE)
  if (board) return `B:${board[1]}`
  const addr = raw.match(ADDRESS_RE)
  if (addr) return `${addr[1].toUpperCase()}:${addr[2]}`
  if (/[a-z]/.test(raw)) return null
  const cmd = parseCommand(raw)
  if (!cmd || !cmd.ok) return null
  if (cmd.type === 'address') return cmd.address
  if (cmd.type !== 'function' && cmd.type !== 'board') return null
  if (cmd.code === 'HELP' || cmd.code === 'ASK') return null
  const tokens = raw.split(/\s+/)
  if (tokens.length < 2 || !tokens.some(isExplicitCode)) return null
  return raw
}

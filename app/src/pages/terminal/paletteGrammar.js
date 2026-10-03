// The Ctrl/Cmd-K palette as a SECOND FRONT END of the terminal grammar (lane T3, V4).
//
// ⛔ NO SECOND GRAMMAR. The palette asks `parseCommand` — the shell's own parser — and, when
// the query is a terminal command, offers ONE row that runs it in the shell through the
// shell's URL contract (`/terminal?cmd=`). What the palette did before is untouched:
//   * a bare ticker is still the palette's own "Go to NVDA" research row (no terminal row);
//   * a bare function code (CAL, GP) — which is also a ticker-shaped word — gets the terminal
//     row LAST, so a bare Enter still opens what it always opened;
//   * an explicit command (NVDA GP, @B NVDA, ASK …, NVDA/QQQ) LEADS: two tokens with a
//     function code are unambiguous, and it is what the member typed;
//   * a natural-language fallback goes LAST (a note title can read like a question).
// Aliases, row numbers and alias definitions stay in the shell (an alias link must never
// define an alias for whoever clicks it).
import parseCommand, { formatCommand } from './parseCommand'
import { describeCommand } from './grammar'
import { TERMINAL_PATH } from './terminalGate'

export function terminalCommandRow(query) {
  const q = String(query || '').trim()
  if (!q) return null
  const p = parseCommand(q)
  if (!p.ok) return null
  const tokens = q.split(/\s+/)
  let placement = null
  if (p.type === 'ask') placement = p.fallback ? 'tail' : 'lead'
  else if (p.type === 'function') {
    if (tokens.length >= 2 || p.channel || p.expr) placement = 'lead'
    else if (p.code !== 'DES' || p.sym == null) placement = 'tail'
  }
  if (!placement) return null
  const text = formatCommand(p)
  if (!text) return null
  const echo = describeCommand(p)
  return {
    placement,
    row: {
      kind: 'terminal', id: `run:${text}`, label: echo?.text || text, command: text,
      to: `${TERMINAL_PATH}?cmd=${encodeURIComponent(text)}`,
    },
  }
}

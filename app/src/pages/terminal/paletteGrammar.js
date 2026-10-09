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
import { BY_CODE, codesForWords, isCode } from './functions'
import { TERMINAL_PATH } from './terminalGate'

/** A query that is a plain word for a function ("breakout", "position size", "nvda peers"): the
 *  command it names, read from the registry's own `keywords` (functions.js `codesForWords`), or
 *  null. A leading ticker is kept when the named code takes one. */
export function wordCommand(query) {
  const q = String(query || '').trim()
  if (!q) return null
  // A short single word reads as a ticker first (COMP, HEAT): only an exact keyword names a code.
  const tickerShaped = /^\$?[A-Za-z]{1,5}$/.test(q)
  const [whole] = codesForWords(q, 1, tickerShaped ? 0 : 3)
  if (whole) return whole
  const tokens = q.split(/\s+/)
  const sym = tokens[0].replace(/^\$/, '').toUpperCase()
  if (tokens.length < 2 || !/^[A-Z]{1,5}$/.test(sym) || isCode(sym)) return null
  const code = codesForWords(tokens.slice(1).join(' '), 3).find((c) => BY_CODE[c]?.ticker)
  return code ? `${sym} ${code}` : null
}

function wordRow(q) {
  const text = wordCommand(q)
  if (!text) return null
  const p = parseCommand(text)
  if (!p.ok) return null
  const echo = describeCommand(p)
  return {
    placement: text.includes(' ') ? 'lead' : 'tail',
    row: {
      kind: 'terminal', id: `run:${text}`, label: echo?.text || text, command: text,
      to: `${TERMINAL_PATH}?cmd=${encodeURIComponent(text)}`,
    },
  }
}

export function terminalCommandRow(query) {
  const q = String(query || '').trim()
  if (!q) return null
  const p = parseCommand(q)
  // A word the parser does not take as a command ("breakout") or reads as a made-up ticker
  // ("position size" would be the ticker POSITION) is offered as the function it names.
  // Only where the parser has no command of its own: a refusal, a question it guessed at, or a
  // bare word it would open as a ticker overview. An explicit command always wins.
  const notACommand = !p.ok || (p.type === 'ask' && p.fallback)
    || (p.type === 'function' && p.code === 'DES' && p.sym != null && q.split(/\s+/).length === 1)
  if (notACommand) {
    const words = wordRow(q)
    if (words) return words
  }
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

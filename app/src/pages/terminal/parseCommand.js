// UCT Terminal — the command-line PARSER. Pure; table-driven tests in parseCommand.test.js.
//
// Grammar (Bloomberg's, security first):
//   TICKER                 → TICKER DES
//   TICKER FUNC [args…]    → FUNC on TICKER
//   FUNC                   → FUNC's market variant (CAL, BRD, WIRE, FLOW…), or — for a
//                            security-only code — FUNC on the focused panel's linked security
//   FUNC TICKER [args…]    → accepted too, when TICKER is not itself a code
//   $TICKER …              → `$` forces the token to be read as a ticker (CAL, MA, GAP and
//                            RS are REAL tickers: `lesson_a_symbol_universe_does_not_settle_a_ticker_match`)
//   L:12  W:3  S:7 …       → an address-space address (TERM-038), resolved by the server
//   HELP [FUNC] · ?        → the function list
//
// Never silent: every input yields `{ ok: true, … }` or `{ ok: false, error, suggestions }`.
import { BY_CODE, ABSENT, isCode, suggest } from './functions'
import { normalizeSym } from '../calendar/useEarningsModalRoute'

/** The address prefixes `api/services/address_space.py` publishes (its `_TEXT_ADDRESS_RE`). */
export const ADDRESS_RE = /^([LWNSATFP]):([A-Za-z0-9_-]{1,40})$/i

export default function parseCommand(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'empty', suggestions: [] }

  const addr = raw.match(ADDRESS_RE)
  if (addr) return { ok: true, type: 'address', address: `${addr[1].toUpperCase()}:${addr[2]}` }

  if (raw === '?') return { ok: true, type: 'function', code: 'HELP', sym: null, args: [] }

  const tokens = raw.split(/\s+/)
  const [first, second, ...rest] = tokens
  const forced = first.startsWith('$')
  const firstTok = forced ? first.slice(1) : first
  const FIRST = firstTok.toUpperCase()

  // HELP [FUNC]
  if (!forced && FIRST === 'HELP') {
    return { ok: true, type: 'function', code: 'HELP', sym: null,
      args: second ? [second.toUpperCase()] : [] }
  }

  // TICKER FUNC [args]  — the canonical order; a code in second place makes the first a ticker.
  if (second && isCode(second)) {
    const sym = normalizeSym(firstTok)
    if (!sym) return { ok: false, error: `"${firstTok}" is not a ticker`, suggestions: [] }
    return { ok: true, type: 'function', code: second.toUpperCase(), sym, args: rest }
  }
  if (second && !forced && Object.prototype.hasOwnProperty.call(ABSENT, second.toUpperCase())) {
    return { ok: false, error: ABSENT[second.toUpperCase()], absent: second.toUpperCase(), suggestions: [] }
  }

  // FUNC [TICKER] [args]
  if (!forced && isCode(FIRST)) {
    if (!second) return { ok: true, type: 'function', code: FIRST, sym: null, args: [] }
    const sym = normalizeSym(second)
    if (sym && BY_CODE[FIRST].ticker) {
      return { ok: true, type: 'function', code: FIRST, sym, args: rest }
    }
    return { ok: true, type: 'function', code: FIRST, sym: null, args: [second, ...rest] }
  }
  if (!forced && Object.prototype.hasOwnProperty.call(ABSENT, FIRST)) {
    return { ok: false, error: ABSENT[FIRST], absent: FIRST, suggestions: [] }
  }

  // TICKER alone → DES
  if (!second) {
    const sym = normalizeSym(firstTok)
    if (sym) return { ok: true, type: 'function', code: 'DES', sym, args: [] }
    return { ok: false, error: `Unknown command "${raw}"`, suggestions: suggest(FIRST) }
  }

  // TICKER <not-a-code> — the second token is the unknown part.
  const sym = normalizeSym(firstTok)
  if (sym) {
    return { ok: false, error: `Unknown function "${second.toUpperCase()}" for ${sym}`,
      sym, suggestions: suggest(second) }
  }
  return { ok: false, error: `Unknown command "${raw}"`, suggestions: suggest(FIRST) }
}

/** Canonical text for a parsed command — what history stores and the panel title shows. */
export function formatCommand(cmd) {
  if (!cmd || !cmd.ok) return ''
  if (cmd.type === 'address') return cmd.address
  return [cmd.sym, cmd.code, ...(cmd.args || [])].filter(Boolean).join(' ')
}

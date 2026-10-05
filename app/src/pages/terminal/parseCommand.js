// UCT Terminal — the command-line PARSER. Pure; table-driven tests in parseCommand.test.js.
//
// ⭐ THE ONE PARSER. The shell's command line and the Ctrl/Cmd-K palette both read input
// through `parseCommand` (the palette offers a parsed command as its "Run in Terminal" row),
// so there is one grammar with two front ends, never two grammars.
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
//   ── lane T3 (the rules themselves are published in grammar.js; HELP prints them) ──
//   3                      → row 3 of the focused panel's numbered list (<GO> addressing)
//   @B NVDA · @2 NVDA GP   → channel targeting: group B's panel, or panel 2
//   A/B [CMP]              → a symbol expression in the noun slot: compare A with B
//   TICKER CMP SECTOR      → comparison mode: vs the security's sector ETF
//   ASK <question>         → free text to AI Search; an unparseable line that READS like a
//                            question falls back to the same (never a silent refusal)
//   ALIAS N = cmd · UNALIAS N · ALIAS → member aliases (collisions REFUSED, never shadowed)
//
// Never silent: every input yields `{ ok: true, … }` or `{ ok: false, error, suggestions }`.
import { BY_CODE, ABSENT, isCode, suggest } from './functions'
import { CHANNEL_RE, aliasNameRefusal, compareMode, isTickerCollision, looksLikeQuestion } from './grammar'
import { normalizeSym } from '../calendar/useEarningsModalRoute'

/** The address prefixes `api/services/address_space.py` publishes (its `_TEXT_ADDRESS_RE`). */
export const ADDRESS_RE = /^([LWNSATFP]):([A-Za-z0-9_-]{1,40})$/i

const ROW_RE = /^\d{1,3}$/
const EXPR_RE = /^\$?([A-Za-z][A-Za-z.-]{0,6})\/\$?([A-Za-z][A-Za-z.-]{0,6})$/
const ALIAS_DEF_RE = /^\S+\s+(\S+?)\s*(?:=\s*|\s+)(.+)$/

/** Parse result `type`s that open something a channel can target: a function (every code
 *  resolves to a panel/door/surface) and `ask` (ASK's own panel/door — `ASK <question>` is
 *  refused ONLY when the question itself failed to parse, never because ASK "isn't a panel
 *  command"). `row`, `address` and the `alias-*` types are shell bookkeeping / whole-page
 *  navigations the shell does not (yet) resolve against a channel's target panel. */
const OPENS_A_PANEL = new Set(['function', 'ask'])

/**
 * Parse one command line. `opts.aliases` is the member's `{ NAME: expansion }` map (server-
 * owned; `api/services/terminal_grammar.py`).
 */
export default function parseCommand(input, opts = {}) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, error: 'empty', suggestions: [] }
  const tokens = raw.split(/\s+/)
  const FIRST = tokens[0].toUpperCase()
  const forced = tokens[0].startsWith('$')

  // Row-number <GO>: a bare 1-3 digit number (a ticker never is one).
  if (ROW_RE.test(raw)) return { ok: true, type: 'row', n: Number(raw) }

  // Channel targeting: `@B …` / `@2 …` — the rest is an ordinary command.
  const ch = tokens[0].match(CHANNEL_RE)
  if (ch) {
    const rest = tokens.slice(1).join(' ')
    if (!rest) return { ok: false, error: `${tokens[0]} needs a command after it — e.g. ${tokens[0]} NVDA`, suggestions: [] }
    const inner = parseCommand(rest, opts)
    if (!inner.ok) return inner
    // Channel targeting only makes sense for a command that OPENS something (see
    // OPENS_A_PANEL above for which types qualify, and why `address` does not — yet).
    if (!OPENS_A_PANEL.has(inner.type)) {
      return { ok: false, error: `${tokens[0]} targets a panel; "${rest}" does not open one.`, suggestions: [] }
    }
    return { ...inner, channel: ch[1].toUpperCase() }
  }

  // Member aliases: define, delete, list, expand.
  if (FIRST === 'ALIAS') {
    if (tokens.length === 1) return { ok: true, type: 'alias-list' }
    const m = raw.match(ALIAS_DEF_RE)
    if (!m) return { ok: false, error: 'ALIAS needs a name and a command — e.g. ALIAS SEMIS = SMH GP', suggestions: [] }
    const name = m[1].toUpperCase()
    const refusal = aliasNameRefusal(name)
    if (refusal) return { ok: false, error: refusal, suggestions: [] }
    const expansion = m[2].trim()
    const check = parseCommand(expansion, { ...opts, aliases: {} })
    if (!check.ok) return { ok: false, error: `An alias must expand to a command: ${check.error}`, suggestions: [] }
    if (check.type !== 'function' && check.type !== 'address' && check.type !== 'ask') {
      return { ok: false, error: 'An alias must expand to a command, not another alias instruction.', suggestions: [] }
    }
    return { ok: true, type: 'alias-define', name, expansion }
  }
  if (FIRST === 'UNALIAS') {
    if (tokens.length !== 2) return { ok: false, error: 'UNALIAS needs exactly one alias name', suggestions: [] }
    return { ok: true, type: 'alias-delete', name: tokens[1].toUpperCase() }
  }
  const aliases = opts.aliases || {}
  if (!forced && Object.prototype.hasOwnProperty.call(aliases, FIRST)) {
    const expanded = [aliases[FIRST], ...tokens.slice(1)].join(' ')
    const inner = parseCommand(expanded, { ...opts, aliases: {} })   // one level: never recursive
    return inner.ok ? { ...inner, alias: FIRST } : { ...inner, error: `Alias ${FIRST}: ${inner.error}` }
  }

  // ASK <question> — free text to AI Search. `ASK NVDA` (one ticker) stays the Ask-AI panel.
  if (!forced && FIRST === 'ASK' && tokens.length >= 2) {
    const rest = tokens.slice(1)
    const oneTicker = rest.length === 1 && /^\$?[A-Za-z][A-Za-z.-]{0,6}$/.test(rest[0])
    if (!oneTicker) return { ok: true, type: 'ask', question: rest.join(' ') }
  }

  // A symbol expression in the noun slot: `NVDA/QQQ [CMP]`.
  const ex = tokens[0].match(EXPR_RE)
  if (ex) {
    const a = normalizeSym(ex[1])
    const b = normalizeSym(ex[2])
    const code = tokens[1] ? tokens[1].toUpperCase() : 'CMP'
    if (!a || !b) return { ok: false, error: `"${tokens[0]}" is not a pair of tickers`, suggestions: [] }
    if (code !== 'CMP') {
      return { ok: false, error: `A symbol expression (${a}/${b}) works with CMP; ${code} takes one security.`,
        suggestions: ['CMP'] }
    }
    return { ok: true, type: 'function', code: 'CMP', sym: a, args: [b, ...tokens.slice(2)],
      expr: `${a}/${b}`, compareMode: compareMode(a, b) }
  }

  const r = parseCore(raw)
  if (r.ok && r.type === 'function') {
    if (r.code === 'ASK' && r.sym && r.args.length) {
      return { ok: true, type: 'ask', question: `$${r.sym} ${r.args.join(' ')}` }
    }
    if (r.code === 'CMP' && r.sym && r.args[0]) {
      const mode = compareMode(r.sym, r.args[0])
      return { ...r, args: mode === 'sector' ? ['SECTOR', ...r.args.slice(1)] : r.args, compareMode: mode }
    }
    // V5: a bare code that is ALSO a ticker is annotated, so the echo says so before Enter.
    if (!forced && FIRST === r.code && r.sym == null && isTickerCollision(r.code)) return { ...r, collision: r.code }
    return r
  }
  // V16: a line that is not a command but reads like a question goes to AI Search.
  if (!r.ok && r.error !== 'empty' && !r.absent && looksLikeQuestion(raw)) {
    return { ok: true, type: 'ask', question: raw, fallback: true }
  }
  return r
}

function parseCore(raw) {
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

/** Canonical text for a parsed command — what history stores, the panel title shows and the
 *  URL carries (`?cmd=`). Only a command that opens something has one. */
export function formatCommand(cmd) {
  if (!cmd || !cmd.ok) return ''
  if (cmd.type === 'address') return cmd.address
  if (cmd.type === 'ask') {
    const text = `ASK ${cmd.question}`
    return cmd.channel ? `@${cmd.channel} ${text}` : text
  }
  if (cmd.type !== 'function') return ''
  const text = [cmd.sym, cmd.code, ...(cmd.args || [])].filter(Boolean).join(' ')
  return cmd.channel ? `@${cmd.channel} ${text}` : text
}

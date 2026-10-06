// UCT Terminal — THE PUBLISHED RULES of the command grammar (lane T3).
//
// `parseCommand.js` is the ONE parser. This module holds the rules it applies that a member
// must be able to read: which codes collide with real tickers and how that is resolved, the
// ranking order of suggestions, the channel and alias rules, the comparison modes, and the
// interpreted-parse echo the command line shows BEFORE Enter. HELP renders these same
// constants, so the page that documents the grammar cannot drift from the grammar.
//
// ⛔ PURE. No React, no fetch. Everything here is table-driven-tested in grammar.test.js.
import { BY_CODE, ABSENT, isCode } from './functions'
import { applyArgs, argsEcho } from './args'

// ── V5: codes that are ALSO real tickers ───────────────────────────────────────
/** Function codes that are ALSO ticker symbols (the TERMINAL-NEXT scope audit's list,
 *  2026-10-02; e.g. CF = CF Industries, DASH = DoorDash). `grammar.test.js` pins every
 *  entry to a registered code, so this list cannot name a code the registry dropped.
 *  Cross-checked against `api/data/cap_universe.json` (2026-10-05 collision-list audit):
 *  GP, MB, LIVE, DP and COMM were removed — none is a tracked symbol, so warning on them
 *  was a false collision. CAL, TECH, FA, EE, PPL, CMP, NB and EXP were added — each IS a
 *  tracked symbol (Caleres, Bio-Techne-class tickers, etc.) and was missing a warning. */
export const TICKER_COLLISIONS = Object.freeze(['DASH', 'CF', 'FORM', 'RES', 'CAL', 'TECH', 'FA', 'EE', 'PPL', 'CMP', 'NB', 'EXP'])

/** THE RULE, as one sentence HELP prints verbatim. */
export const COLLISION_RULE = 'A bare word that is a function code runs the function. '
  + 'To mean the ticker, put $ in front of it ($CF, $DASH) or follow it with a function '
  + '(CF DES). When a code is also a real ticker, the line above the input says so before '
  + 'you press Enter: it is never resolved silently.'

export function isTickerCollision(code) {
  return TICKER_COLLISIONS.includes(String(code || '').toUpperCase())
}

// ── V6b: channels ─────────────────────────────────────────────────────────────
/** `@A NVDA` targets the panel(s) linked to group A; `@2 NVDA GP` targets panel 2. A–D are the
 *  /charts groups; E … Z (then C27, C28 …) are the groups a board adds (boardModel
 *  `nextChannelId`), so every group the board can create is addressable. Whether THIS board
 *  has the group is the shell's answer (`channelTarget`), never a parse refusal. */
export const CHANNEL_RE = /^@([A-Za-z]|[Cc]\d{2,3}|[1-4])$/
export const CHANNEL_RULE = '@A … @D sends the command to the panel linked to that colour '
  + 'group (and so to every panel in it), @E and later to a group your board added; @1 … @4 '
  + 'sends it to that panel number.'

// ── V6b: member aliases ───────────────────────────────────────────────────────
/** Words the grammar itself owns: never usable as an alias name. */
export const RESERVED_WORDS = Object.freeze(['HELP', 'ASK', 'ALIAS', 'UNALIAS', 'SECTOR'])
export const ALIAS_NAME_RE = /^[A-Z][A-Z0-9_]{1,11}$/
export const ALIAS_RULE = 'ALIAS NAME = command saves a shortcut (ALIAS SEMIS = SMH GP). '
  + 'A name that is a function code, a reserved word, or a real ticker is refused, never '
  + 'shadowed. UNALIAS NAME removes it.'

/** Client half of the collision refusal: codes, ABSENT codes and reserved words. The server
 *  refuses a name that is a real ticker (it owns the symbol universe). `null` = allowed. */
export function aliasNameRefusal(name) {
  const n = String(name || '').toUpperCase()
  if (!ALIAS_NAME_RE.test(n)) return `"${name}" is not a valid alias name (2-12 letters, digits or _ , starting with a letter).`
  if (isCode(n)) return `${n} is already a function (${BY_CODE[n].label}); an alias may not shadow it.`
  if (Object.prototype.hasOwnProperty.call(ABSENT, n)) return `${n} is a reserved function code; pick another name.`
  if (RESERVED_WORDS.includes(n)) return `${n} is a reserved word of the command line.`
  return null
}

// ── V6c: ranking ──────────────────────────────────────────────────────────────
/** The published suggestion order. Ties inside a class break on personal frecency
 *  (your own command counts, server-side, decayed by recency), then alphabetically. */
export const RANKING_ORDER = Object.freeze([
  { key: 'alias', label: 'Exact alias' },
  { key: 'verb', label: 'Exact function code' },
  { key: 'symbol', label: 'Exact ticker' },
  { key: 'prefix', label: 'Prefix match' },
  { key: 'fuzzy', label: 'Close spelling' },
  { key: 'frecency', label: 'Your most-used (tie-break)' },
  { key: 'popular', label: 'Widely traded ticker, then A-Z (tie-break)' },
])

// ── V16: natural language ─────────────────────────────────────────────────────
const QUESTION_WORDS = new Set(['what', 'why', 'how', 'which', 'who', 'when', 'where', 'is',
  'are', 'does', 'do', 'should', 'can', 'show', 'find', 'list', 'compare', 'explain', 'tell'])
export const ASK_RULE = 'ASK <question> sends free text to AI Search. A line that is not a '
  + 'command but reads like a question (it ends in ?, starts with a question word, or is four '
  + 'or more words) is offered to AI Search instead of being refused.'

/** Does text that failed to parse read as a natural-language question? */
export function looksLikeQuestion(raw) {
  const t = String(raw || '').trim()
  if (!t) return false
  if (t.endsWith('?')) return true
  const words = t.split(/\s+/)
  if (words.length >= 4) return true
  return words.length >= 2 && QUESTION_WORDS.has(words[0].toLowerCase())
}

// ── V18: comparison modes ─────────────────────────────────────────────────────
/** Index and broad-market ETFs: two of these compared is "index vs index". */
export const INDEX_SYMBOLS = Object.freeze(['SPY', 'QQQ', 'IWM', 'DIA', 'MDY', 'RSP', 'QQQE',
  'SMH', 'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLY', 'XLP', 'XLB', 'XLRE', 'XLU', 'XLC',
  'SPX', 'NDX', 'RUT', 'VIX'])
export const COMPARE_RULE = 'CMP compares: NVDA CMP AMD (security vs security), NVDA CMP '
  + 'SECTOR (vs its sector ETF), SPY CMP QQQ or SPY/QQQ (index vs index). A ratio in the noun '
  + 'slot (NVDA/QQQ) opens the same comparison.'

export function compareMode(sym, comparator) {
  const a = String(sym || '').toUpperCase()
  const b = String(comparator || '').toUpperCase()
  if (b === 'SECTOR') return 'sector'
  if (INDEX_SYMBOLS.includes(a) && INDEX_SYMBOLS.includes(b)) return 'index'
  return 'security'
}

// ── HELP: the address space ───────────────────────────────────────────────────
/** The `X:id` prefixes `api/services/address_space.py::KINDS` publishes. `grammar.test.js`
 *  reads that Python file and pins this table (and ADDRESS_RE's letter class) to it. */
export const ADDRESS_PREFIXES = Object.freeze([
  { prefix: 'L', label: 'Chart layout' },
  { prefix: 'W', label: 'Watchlist' },
  { prefix: 'N', label: 'Note' },
  { prefix: 'S', label: 'Saved screen' },
  { prefix: 'A', label: 'AI conversation' },
  { prefix: 'T', label: 'Theme set' },
  { prefix: 'F', label: 'Floor post' },
  { prefix: 'P', label: 'Playbook entry' },
])
export const ROW_RULE = 'A bare number (3, then Enter) opens row 3 of the numbered list in '
  + 'the focused panel.'

// ── V5 / P10: the interpreted-parse echo and the argument shape ───────────────
/** The shape of a code's arguments, derived from the registry's own variants. */
export function argShape(code) {
  const fn = BY_CODE[String(code || '').toUpperCase()]
  if (!fn) return null
  const t = fn.ticker
  const m = fn.market
  const tail = t?.needsArg ? ` <${t.needsArg.split(',')[0]}>` : ''
  if (fn.code === 'CMP') return 'TICKER CMP <TICKER | SECTOR>  ·  A/B'
  if (fn.code === 'ASK') return 'ASK <question>  ·  TICKER ASK'
  if (fn.code === 'HELP') return 'HELP [FUNC]'
  if (t && m) return `[TICKER] ${fn.code}${tail}`
  if (t) return `TICKER ${fn.code}${tail}`
  return fn.code
}

/**
 * What a parse will DO, in words, before Enter (IA §7.4). Never empty for a non-empty line:
 * a failure echoes its own error, so the echo and the notice say the same thing.
 * Returns { text, tone: 'ok'|'warn'|'error'|'ask', shape }.
 */
export function describeCommand(cmd) {
  if (!cmd) return null
  if (!cmd.ok) {
    if (cmd.error === 'empty') return null
    return { text: cmd.error, tone: 'error', shape: null }
  }
  const via = cmd.alias ? ` (alias ${cmd.alias})` : ''
  const ch = cmd.channel ? ` → ${/^\d$/.test(cmd.channel) ? `panel ${cmd.channel}` : `group ${cmd.channel}`}` : ''
  switch (cmd.type) {
    case 'address':
      return { text: `Open saved item ${cmd.address}${via}`, tone: 'ok', shape: 'X:id' }
    case 'row':
      return { text: `Open row ${cmd.n} of the focused panel's list`, tone: 'ok', shape: 'N <GO>' }
    case 'ask':
      return { text: `Ask AI Search: “${cmd.question}”${cmd.fallback ? ' (not a command)' : ''}`,
        tone: 'ask', shape: 'ASK <question>' }
    case 'alias-define':
      return { text: `Save alias ${cmd.name} = ${cmd.expansion}`, tone: 'ok', shape: 'ALIAS NAME = command' }
    case 'alias-delete':
      return { text: `Remove alias ${cmd.name}`, tone: 'ok', shape: 'UNALIAS NAME' }
    case 'alias-list':
      return { text: 'List your aliases', tone: 'ok', shape: 'ALIAS' }
    default: break
  }
  const fn = BY_CODE[cmd.code]
  const label = fn ? fn.label : cmd.code
  const shape = argShape(cmd.code)
  // A door-command that NAVIGATES AWAY (leaves the multi-panel Terminal entirely) must read
  // differently from a normal panel-opening command — the member should see the jump coming
  // rather than being silently ejected. The variant selected mirrors the shell's own choice
  // (ticker variant when a security is present and the code has one, else market).
  const variant = cmd.sym && fn?.ticker ? fn.ticker : fn?.market
  const leaves = variant?.door && variant?.leavesTerminal ? ' (leaves Terminal)' : ''
  if (cmd.code === 'CMP' && cmd.sym) {
    const other = cmd.args?.[0]
    const mode = cmd.compareMode || compareMode(cmd.sym, other)
    const what = !other ? `${cmd.sym} vs …` : mode === 'sector' ? `${cmd.sym} vs its sector ETF`
      : `${cmd.sym} vs ${String(other).toUpperCase()}${mode === 'index' ? ' (index vs index)' : ''}`
    // The same leftover check the shell refuses on (SECTOR is the mode marker; AMD is {arg0}).
    const leftover = mode === 'sector' ? (cmd.args || []).slice(1) : applyArgs(fn?.ticker, cmd.args || []).ignored
    if (other && leftover.length) {
      return { text: `Compare ${what}${via}${ch}${leaves}. ${argsEcho(cmd.code, { applied: [], ignored: leftover, takes: [] })}`,
        tone: 'warn', shape }
    }
    return { text: `Compare ${what}${via}${ch}${leaves}`, tone: other ? 'ok' : 'warn', shape }
  }
  // A market-wide code given a ticker (`NVDA DASH`): the shell drops the ticker, so say so.
  const marketOnly = !!(cmd.sym && fn && !fn.ticker)
  const on = cmd.sym && !marketOnly ? ` on ${cmd.sym}` : (fn?.ticker && !fn?.market ? ' on the linked security' : '')
  const extra = cmd.args?.length && cmd.code !== 'HELP' ? ` · ${cmd.args.join(' ')}` : ''
  const base = `${cmd.code}: ${label}${on}${extra}${via}${ch}${leaves}`
  const notes = []
  let tone = 'ok'
  if (marketOnly) { notes.push(`${cmd.code} is market-wide; ${cmd.sym} is ignored.`); tone = 'warn' }
  if (cmd.collision) { notes.push(`${cmd.collision} is also a ticker: type $${cmd.collision} for the stock.`); tone = 'warn' }
  if (cmd.argNotTicker) {
    notes.push(`${cmd.argNotTicker} is read as ${cmd.code}'s argument; type $${cmd.argNotTicker} for the ticker.`)
  }
  // The SAME argument check Enter runs (args.js applyArgs): a token the code cannot take is
  // said here, before Enter, never only after it.
  // HELP included (round 3): `HELP FOO` is refused at Enter, so it is said here too.
  if (fn && cmd.args?.length) {
    // (CMP returned above; its comparator is the door's own {arg0}.)
    const variant = cmd.sym && fn.ticker ? fn.ticker : (fn.market || fn.ticker)
    const applied = applyArgs(variant, cmd.args)
    if (applied.ignored.length) { notes.push(argsEcho(cmd.code, { ...applied, applied: [] })); tone = 'warn' }
  }
  if (notes.length) return { text: `${base}. ${notes.join(' ')}`, tone, shape }
  return { text: base, tone, shape }
}

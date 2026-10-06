// app/src/components/chart/engine/runtime/runtimeRepaint.js
//
// ─── ⭐⭐ RT2 — THE REPAINT CLASS OF A RUNTIME DOCUMENT ─────────────────────────
//
// A runtime document (`memberPaneDefinition.js::runtimeLaneDefinition`) draws a
// member's Pine by running it bar by bar. The member pane labels repainting, so
// the document must STATE its class, in the host linter's vocabulary
// (`ast/lint.js::REPAINT_MODES`) and by the host linter's rule: a value repaints
// iff its value at bar i depends on a bar after i, and the class is
// `modeFromReach(forward reach)` — the host's three lines, called, not copied.
//
// ⭐ WHAT THE RUN CAN KNOW ABOUT A LATER BAR is only what it is HANDED: a clock
// leaf computed from the fetch's right edge, the wall clock, other bars through
// a request, per-tick state, the viewer's range. `runtimeRepaint.json` names
// those reads; everything else the lane runs is its own per-bar computation over
// bars at or before the one it writes. So the class is the WORST reach over the
// reads the program makes — the host lane's own aggregation for a document that
// draws every plot at once (`nativeRegistry.validateAstLane`'s worst tree).
//
// ⛔ ONE AUTHORITY PER READ. A clock leaf's reach is the HOST LINTER's answer for
// that leaf (`astReach` over the shared `closedTable.json`) and nothing else;
// nothing here restates a window the shared table declares. ⭐ RT4: the nine
// right-edge leaves RT2 found declare their `forward` in that table now
// (`_clock_right_edge`), so RT2's second table and its join are gone — its rails
// (`runtimeRepaintEdge.test.js`) now hold the SHARED declaration to the measurement.
//
// ⛔ CODE, NEVER PROSE, AND IDENTICAL IN TWO LANGUAGES. The reads are taken off a
// token stream (comments and strings dropped) by the small lexer below, which is
// mirrored line for line in `api/services/runtime_repaint.py` — the store's save
// door re-derives the class from the source it is sent and never trusts the
// client's. `runtimeRepaintParity.test.js` and `tests/test_runtime_repaint.py`
// hold both to one committed answer per corpus script.
//
// ⛔ FAIL CLOSED: a source this lexer cannot read (an unterminated string) has no
// stated class, and the member door declines it (`runtime:repaint-unstated`).

import RULES from './runtimeRepaint.json'
import { astReach, modeFromReach, UNBOUNDED, UNKNOWN } from '../ast/lint.js'

const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)
const entries = (o) => Object.entries(o || {}).filter(([k]) => !k.startsWith('_'))

/** `max` over the reach lattice, the host's order: UNKNOWN > UNBOUNDED > n. */
function joinReach(a, b) {
  if (a === UNKNOWN || b === UNKNOWN) return UNKNOWN
  if (a === UNBOUNDED || b === UNBOUNDED) return UNBOUNDED
  return Math.max(a, b)
}

const IDENT_START = /[A-Za-z_]/
const IDENT_PART = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

/** The tokens the classifier reads: `{k: 'id'|'str'|'num'|'p', v}`.
 *
 *  ⛔ MIRRORED BY `runtime_repaint.py::lex`, rule for rule. Dotted names join
 *  across horizontal whitespace around the dot, as `pine.js::lexPine` joins them,
 *  and never across a newline. Throws on an unterminated string. */
export function lexRepaint(src) {
  const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n')
  const out = []
  const n = text.length
  let i = 0
  while (i < n) {
    const ch = text[i]
    if (ch === ' ' || ch === '\t' || ch === '\n') { i += 1; continue }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? n : end
      continue
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < n && text[j] !== ch) j += text[j] === '\\' ? 2 : 1
      if (j >= n) throw new Error(`an unterminated string opens at offset ${i}`)
      out.push({ k: 'str', v: text.slice(i + 1, j) })
      i = j + 1
      continue
    }
    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(text[i + 1] || ''))) {
      let j = i
      while (j < n && (DIGIT.test(text[j]) || text[j] === '.')) j += 1
      if ((text[j] === 'e' || text[j] === 'E')) {
        let k = j + 1
        if (text[k] === '+' || text[k] === '-') k += 1
        if (DIGIT.test(text[k] || '')) { while (k < n && DIGIT.test(text[k])) k += 1; j = k }
      }
      out.push({ k: 'num', v: text.slice(i, j) })
      i = j
      continue
    }
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < n && IDENT_PART.test(text[j])) j += 1
      for (;;) {
        let k = j
        while (text[k] === ' ' || text[k] === '\t') k += 1
        if (text[k] !== '.') break
        let m = k + 1
        while (text[m] === ' ' || text[m] === '\t') m += 1
        if (!IDENT_START.test(text[m] || '')) break
        j = m
        while (j < n && IDENT_PART.test(text[j])) j += 1
      }
      out.push({ k: 'id', v: text.slice(i, j).replace(/[ \t]+/g, '') })
      i = j
      continue
    }
    if (ch === '#') {
      let j = i + 1
      while (j < n && /[0-9A-Fa-f]/.test(text[j])) j += 1
      i = j
      continue
    }
    out.push({ k: 'p', v: ch })
    i += 1
  }
  return out
}

const isP = (t, v) => !!t && t.k === 'p' && t.v === v

/** The top-level arguments of the call whose `(` is at `open`, each a token list,
 *  or null when the parenthesis never closes. */
function argsAt(tokens, open) {
  const args = []
  let cur = []
  let depth = 0
  for (let j = open + 1; j < tokens.length; j += 1) {
    const t = tokens[j]
    if (isP(t, '(') || isP(t, '[')) depth += 1
    if (isP(t, ')') || isP(t, ']')) {
      if (depth === 0) { args.push(cur); return args }
      depth -= 1
    }
    if (depth === 0 && isP(t, ',')) { args.push(cur); cur = []; continue }
    cur.push(t)
  }
  return null
}

/** `name = value` → `{name, value}`; a positional argument → `{name: null, value}`. */
function namedOf(arg) {
  if (arg.length >= 2 && arg[0].k === 'id' && isP(arg[1], '=') && !isP(arg[2], '=')) {
    return { name: arg[0].v, value: arg.slice(2) }
  }
  return { name: null, value: arg }
}

const oneOf = (value, allowed) => value.length === 1
  && (value[0].k === 'id' || value[0].k === 'str') && allowed.includes(value[0].v)

/** Is the request whose name token is at `at` THIS chart at THIS chart's period? */
function identityRequest(tokens, at) {
  if (!isP(tokens[at + 1], '(')) return false
  const args = argsAt(tokens, at + 1)
  if (!args) return false
  const req = RULES.requests
  let symbol = null
  let timeframe = null
  let pos = 0
  for (const arg of args) {
    const { name, value } = namedOf(arg)
    if (name === null) {
      if (pos === 0) symbol = value
      else if (pos === 1) timeframe = value
      pos += 1
    } else if (name === 'symbol') symbol = value
    else if (name === 'timeframe' || name === 'resolution') timeframe = value
  }
  return !!symbol && !!timeframe
    && oneOf(symbol, req.identitySymbol) && oneOf(timeframe, req.identityTimeframe)
}

const HOST_CLOCK_MEMO = new Map()
/** The HOST linter's reach for one clock leaf — `astReach`, over the shared
 *  table (or a rail's own copy of it, never memoised). */
function hostClockReach(key, table) {
  if (table) return astReach({ type: 'series', name: key }, { table }).forward
  if (!HOST_CLOCK_MEMO.has(key)) HOST_CLOCK_MEMO.set(key, astReach({ type: 'series', name: key }).forward)
  return HOST_CLOCK_MEMO.get(key)
}

/** The reach of one clock leaf on a runtime document: the host linter's, and
 *  only the host linter's. Exported for the rails; `table` is a rail's copy of
 *  the shared manifest. */
export function clockLeafReach(key, table) {
  return hostClockReach(key, table)
}

/**
 * The repaint class of a runtime document's source.
 *
 * @param {string} source the member's Pine
 * @returns {{ok: true, mode: string, forward: number|string,
 *            reads: {name: string, forward: number|string, why: string}[]}
 *          | {ok: false, why: string}}
 *   `reads` lists every read that reaches past its own bar, by Pine name,
 *   sorted, one entry per name — the sentence a member is shown.
 */
export function runtimeRepaintOf(source) {
  let tokens
  try {
    tokens = lexRepaint(source)
  } catch (err) {
    return { ok: false, why: `the script could not be read to state its repaint behaviour (${err.message})` }
  }
  const found = new Map()
  const note = (name, forward, why) => {
    if (forward === 0) return
    const prev = found.get(name)
    found.set(name, prev ? { ...prev, forward: joinReach(prev.forward, forward) } : { name, forward, why })
  }
  const clockReads = Object.fromEntries(entries(RULES.clockReads))
  const reads = Object.fromEntries(entries(RULES.reads))
  const flags = Object.fromEntries(entries(RULES.namedFlags))
  const req = RULES.requests
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    if (t.k !== 'id') continue
    const v = t.v
    if (own(clockReads, v)) {
      const key = clockReads[v]
      note(v, clockLeafReach(key), `\`${v}\` reads the chart's newest bar, which moves when a later bar arrives`)
    } else if (own(reads, v)) {
      note(v, reads[v][0], reads[v][1])
    } else if (req.calls.includes(v) && isP(tokens[i + 1], '(')) {
      if (!identityRequest(tokens, i)) {
        note(v, UNBOUNDED, `\`${v}\` reads another symbol or timeframe, whose bars this pane does not hold`)
      }
    } else if (v.startsWith(req.prefix)) {
      note(v, UNBOUNDED, `\`${v}\` reads data this pane does not hold`)
    } else if (own(flags, v) && isP(tokens[i + 1], '=') && !isP(tokens[i + 2], '=')) {
      const value = []
      let depth = 0
      for (let j = i + 2; j < tokens.length; j += 1) {
        const u = tokens[j]
        if (isP(u, '(') || isP(u, '[')) depth += 1
        if (isP(u, ')') || isP(u, ']')) { if (depth === 0) break; depth -= 1 }
        if (depth === 0 && isP(u, ',')) break
        value.push(u)
      }
      if (!oneOf(value, flags[v])) note(v, UNBOUNDED, `\`${v}\` is set to something other than ${flags[v].map((x) => `\`${x}\``).join(' or ')}`)
    }
  }
  let forward = 0
  for (const r of found.values()) forward = joinReach(forward, r.forward)
  const list = [...found.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { ok: true, mode: modeFromReach(forward), forward, reads: list }
}

/** The rule table, for the rails. */
export const RUNTIME_REPAINT_RULES = RULES

// app/src/components/chart/engine/runtime/runtimeInputs.js
//
// ─── ⭐⭐ UIE PHASE 2 (M4) — A RUNTIME SCRIPT'S OWN SETTINGS, AS ORDINARY UCT INPUTS ─
//
// A document the runtime lane draws ran only at its AUTHOR'S defaults: it declared no
// `inputs`, and the lane handed the front end `inputs: {}` on every run. The front end
// has applied a member's values all along (`pineRuntimeFrontend.js`: the resolver's
// `inputValues`, `admitTextInput`), with the author's own `minval`/`maxval` and
// `options` refusing anything outside them BY NAME. What was missing was the two ends:
//
//   * `runtimeInputSpecsOf(source)` — the script's `name = input.*(…)` bindings as
//     `defSchema` inputs (`key` = the Pine name the front end binds by), so the ONE
//     settings system every UCT indicator uses (instance values, persistence, version
//     history) carries them. No second settings system;
//   * `runtimeInputValues(def, given)` — the values a run is handed: only the ones that
//     DIFFER from the declared default, so an untouched document builds exactly the
//     program it built before this module existed.
//
// ⭐ WHY EVERY LITERAL INPUT CAN BE A KNOB HERE, unlike the columnar lane: that lane
// folds an input into a tree once, and a length folded into a window cannot move
// (`builderInputs.inputsFromFolded`). This lane REBUILDS the program from the source on
// every run, so the member's value is the literal the author would have typed.
//
// ⛔ ONLY WHAT IS READ EXACTLY: a literal default (number, `true`/`false`, text) and
// literal bounds. An input whose default is an expression, `input.timeframe`,
// `input.session`, `input.symbol`, `input.time`, `input.price`, `input.text_area` and a
// name the schema cannot key are SKIPPED, by name, and keep the author's default —
// never a knob that moves half a script.
//
// ⭐⭐ UIE PHASE 3 (M4) — COLOUR AND SOURCE INPUTS, THROUGH THE SAME SETTINGS:
//   * `input.color` (and v4's `input(…, type = input.color)`) → a `color` input, its
//     default the author's colour as `#RRGGBB` (a hex literal or a Pine colour name, read
//     at the script's version). ⛔ A default with a TRANSPARENCY (`#RRGGBBAA` below FF,
//     `color.new(…)`) is skipped by name: the settings' colour picker sets an opaque
//     colour, and offering it would silently drop the author's transparency;
//   * `input.source` (and v4's `input(close, type = input.source)`) → an `enum` input
//     over the chart's own bar series (`RUNTIME_SOURCES`), its default the author's. An
//     `enum`, not the schema's `source` type, because a source here is only ever a bar
//     series — never another indicator's plot (TradingView's menu offers those; this
//     pane is handed no other indicator's values) — and an enum is what the settings
//     dialog already draws as a menu;
//   * the run is handed them apart from the numbers (`runtimeBuildInputs`): the front end
//     puts the member's colour or source where the author's default was
//     (`pineRuntimeFrontend.js::applyMemberDefault`).
//   ⛔ `input.timeframe` stays SKIPPED, by name: a timeframe setting changes which bars a
//   script reads, and this pane is handed only the chart's own (`request.*` is refused
//   here, `runtime:request`) — another timeframe's bars are not fabricated.
import { lexPine, blockStatements, parseWholeExpression, findTop, isPunct, boundName } from '../ast/pine.js'
import { KEY_RE } from '../ast/parse.js'
import { pineColourHex } from '../pinePalette.js'
import { isSessionString, TIME_INPUT_MAX_ABS_MS } from '../defSchema.js'

/** The bar series a member may pick for a source input. */
export const RUNTIME_SOURCES = Object.freeze(new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3',
  'ohlc4', 'hlcc4']))
const SOURCE_MENU = Object.freeze(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'])

const TYPE_OF_CALL = Object.freeze({
  'input.int': 'int', 'input.float': 'float', 'input.bool': 'bool', 'input.string': 'string',
  // ⭐ PHASE 3 WS-D — `input.price` is a float setting (TradingView: "input float"); the
  // resolver already folds it as a number, member value included (`pine.js::resolveInput`).
  'input.price': 'float',
})
// ⭐ PHASE 3 WS-D — `input.time`, `input.session` and `input.price` are served now (below).
// ⛔ `input.enum` still is not: its default is a field of an `enum` DECLARATION, and this
// lane has no `enum` statement yet (WS-A's statement grammar), so there is no value to key.
const UNSERVED = new Set(['input.symbol', 'input.text_area', 'input.enum'])
const TIMEFRAME_SKIP = 'a timeframe setting changes which bars the script reads, and this pane is handed only '
  + "the chart's own — another timeframe's bars are not made up; its default stays"
// ⭐ PHASE 3 WS-D — the same ruling, for the same reason, read for a symbol: a symbol setting
// changes WHICH INSTRUMENT the script reads, and this pane is handed only the chart's own.
const SYMBOL_SKIP = 'a symbol setting changes which instrument the script reads, and this pane is handed only '
  + "the chart's own — another symbol's bars are not made up; its default stays"

/** The author's colour default as `#RRGGBB`, or `{ skip }`. */
function colourDefaultOf(def, version) {
  if (def && def.type === 'colour' && typeof def.value === 'string') {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(def.value)
    if (!m) return { skip: 'its default is not a colour written as #RRGGBB' }
    if (m[2] && m[2].toUpperCase() !== 'FF') {
      return { skip: 'its default is see-through, and the colour picker sets an opaque colour — the '
        + "author's transparency would be dropped" }
    }
    return { hex: `#${m[1].toUpperCase()}` }
  }
  if (def && def.type === 'name' && typeof def.name === 'string') {
    const hex = pineColourHex(def.name, version)
    if (hex) return { hex: hex.toUpperCase() }
  }
  return { skip: 'its default is not a fixed colour (a #RRGGBB or a Pine colour name)' }
}

/** The author's source default (a bar series), or `{ skip }`. */
function sourceDefaultOf(def) {
  if (def && def.type === 'name' && RUNTIME_SOURCES.has(def.name)) return { name: def.name }
  return { skip: 'its default is not one of the bar series (open, high, low, close, volume, hl2, hlc3, '
    + 'ohlc4, hlcc4) — another series cannot be offered as a menu' }
}

/** A literal number node (`14`, `-3`, `2.5`), or null. */
function literalNumber(v) {
  if (v && v.type === 'number' && Number.isFinite(v.value)) return v.value
  if (v && v.type === 'unary' && v.op === '-' && v.arg && v.arg.type === 'number' && Number.isFinite(v.arg.value)) {
    return -v.arg.value
  }
  return null
}

const argOf = (node, name, index) => {
  const args = node.args || []
  const named = args.find((a) => a && a.name === name)
  if (named) return named.value
  const positional = args.filter((a) => a && !a.name)
  return index !== null && positional[index] ? positional[index].value : undefined
}

/** Is the first argument written as `true` / `false`? The parser reads both as 1 / 0,
 *  so the TOKEN is the only witness of a legacy `input(true)` being a switch. */
function firstArgWord(toks) {
  const open = toks.findIndex((t) => isPunct(t, '('))
  const t = open >= 0 ? toks[open + 1] : null
  return t && t.kind === 'ident' && (t.value === 'true' || t.value === 'false') ? t.value : null
}

// ─── ⭐⭐ PHASE 3 WS-D — INPUT KINDS AS RUNTIME VALUES ───────────────────────────
//
// One reader per question, shared by the front end (`pineRuntimeFrontend.js`, which RUNS the
// value) and `runtimeInputSpecsOf` below (which OFFERS it as a setting), so the value a member
// sees in the dialog and the value the run computes with cannot be two answers.

/** v4's `input(…, type = input.X)` (named, or the THIRD positional argument), or null. */
export function legacyInputType(node) {
  if (!node || node.type !== 'call' || node.name !== 'input') return null
  const t = argOf(node, 'type', 2)
  return t && t.type === 'name' && typeof t.name === 'string' ? t.name : null
}

const TEXT_KIND_OF_CALL = Object.freeze({
  'input.string': 'string', 'input.text_area': 'text_area', 'input.session': 'session',
  'input.timeframe': 'timeframe', 'input.symbol': 'symbol',
})
const TEXT_KIND_OF_LEGACY_TYPE = Object.freeze({
  'input.string': 'string', 'input.resolution': 'timeframe', 'input.timeframe': 'timeframe',
  'input.session': 'session', 'input.symbol': 'symbol',
})

/** Which TEXT input this call is (`string`, `text_area`, `session`, `timeframe`, `symbol`),
 *  or null. A v4 `input(…)` is text when its `type` says so, or — with no type — when its
 *  default is a quoted string (Pine infers the input's type from `defval`). */
export function textInputKindOf(node) {
  if (!node || node.type !== 'call' || typeof node.name !== 'string') return null
  if (Object.prototype.hasOwnProperty.call(TEXT_KIND_OF_CALL, node.name)) return TEXT_KIND_OF_CALL[node.name]
  if (node.name !== 'input') return null
  const legacy = legacyInputType(node)
  if (legacy) return TEXT_KIND_OF_LEGACY_TYPE[legacy] || null
  const d = argOf(node, 'defval', 0)
  return d && d.type === 'string' ? 'string' : null
}

/** ⛔ WHICH TEXT INPUTS MUST NEVER BE FOLDED BY THE COLUMNAR LANE: the ones a member can SET.
 *  That lane folds a text comparison from the AUTHOR'S default, so a member's value would be
 *  ignored with nothing on screen (measured 2026-10-31 on a v4 `input("EMA", options=[…])`:
 *  the member's "SMA" drew the EMA column). A timeframe and a symbol are not member settings
 *  in this pane (`TIMEFRAME_SKIP`, `SYMBOL_SKIP`), and in a timeframe POSITION the columnar
 *  lane folds a timeframe default correctly (`timeframeLiteralOf`) — so those two take the
 *  text path only where that lane says it has no text for them. */
export function textInputIsMemberSet(kind) {
  return kind === 'string' || kind === 'text_area' || kind === 'session'
}

/** ⭐ A time input's VALUE: whole milliseconds inside the JS Date range — the one reader the run
 *  uses for a member's value (`defSchema.validateInputValue` asks the same of a stored one). */
export function isTimeValue(x) {
  return Number.isInteger(x) && Math.abs(x) <= TIME_INPUT_MAX_ABS_MS
}

/** Is this a time input: `input.time(…)`, or v4's `input(…, type = input.time)`? */
export function isTimeInputCall(node) {
  if (!node || node.type !== 'call') return false
  return node.name === 'input.time' || legacyInputType(node) === 'input.time'
}

/** ⭐ A session string (`defSchema.isSessionString`, the ONE reader — the settings dialog's
 *  validator, the run and this module answer one question). */
export { isSessionString }

const MONTHS = Object.freeze(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct',
  'nov', 'dec'])

/** A zone written after a date: `Z`/`UTC`/`GMT`/`UT`, `±hhmm`, `±hh:mm`, `±h`, optionally
 *  prefixed `GMT`/`UTC` (`GMT+10`, `UTC-5`). Minutes EAST of UTC, or null. */
function zoneMinutes(z) {
  if (z === undefined || z === null || z === '') return 0
  const t = String(z).trim()
  if (/^(?:Z|UTC|GMT|UT)$/i.test(t)) return 0
  const m = /^(?:(?:GMT|UTC)\s*)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(t)
  if (!m) return null
  const h = Number(m[2])
  const mi = m[3] ? Number(m[3]) : 0
  if (h > 14 || mi > 59) return null
  return (m[1] === '-' ? -1 : 1) * (h * 60 + mi)
}

function utcMs(y, mo, d, h, mi, sec, zone) {
  if (zone === null) return null
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || sec < 0 || sec > 59) return null
  const ms = Date.UTC(y, mo - 1, d, h, mi, sec)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return ms - zone * 60000
}

/** ⭐ `timestamp(dateString)` — UNIX milliseconds, or null for a string this cannot read
 *  EXACTLY. The reference (v6): the string is IETF RFC 2822 or ISO 8601 ("DD MMM YYYY
 *  hh:mm:ss ±hhmm" or "YYYY-MM-DDThh:mm:ss±hh:mm"); no time means 00:00; **no zone means
 *  GMT+0** — unlike every other `timestamp` form, which reads the exchange's zone.
 *  ⚠️ `GMT+10` / `UTC-5` after the date is not RFC 2822 grammar; TradingView compiles it
 *  (the corpus writes it) and it is read here as an offset EAST of UTC — NEEDS CAPTURE. */
export function timestampOfDateString(str) {
  if (typeof str !== 'string') return null
  const s = str.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(s)
  if (m) {
    return utcMs(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, zoneMinutes(m[7]))
  }
  m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?(?:\s+(.+))?$/.exec(s)
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase())
    if (mo < 0) return null
    return utcMs(+m[3], mo + 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, m[6] ? +m[6] : 0, zoneMinutes(m[7]))
  }
  return null
}

/** ⭐ A time input's DEFAULT as UNIX milliseconds (`{ ms }`), or `{ skip }` saying why not.
 *  Pine requires a `const int`: a literal, a `timestamp("…")` over a const date string, or a
 *  name bound to one of those (`lookup(name)` hands back that binding's node, or null).
 *  ⛔ `timestamp(year, month, …)` is REFUSED BY NAME: it reads the exchange's time zone
 *  (`syminfo.timezone`), which this pane is not handed — a guess would move every bar's
 *  window by hours. */
export function timeInputDefaultOf(node, lookup) {
  return constTimeOf(argOf(node, 'defval', 0), lookup, 0)
}

const OUT_OF_RANGE = 'its default is outside the dates a chart can hold (±8.64e15 ms, about 271,821 years either side of 1970)'

function constTimeOf(v, lookup, depth) {
  if (!v || depth > 8) return { skip: 'its default is not a fixed date and time' }
  const n = literalNumber(v)
  if (n !== null) {
    if (!Number.isInteger(n)) return { skip: 'its default is not a whole number of milliseconds' }
    // ⛔ The JS Date range (`defSchema.TIME_INPUT_MAX_ABS_MS`, the server's twin bound): a
    // default outside it would mint a document `validateDefinition` refuses, so it never installs.
    return Math.abs(n) <= TIME_INPUT_MAX_ABS_MS ? { ms: n } : { skip: OUT_OF_RANGE }
  }
  if (v.type === 'call' && v.name === 'timestamp') {
    const args = (v.args || []).filter((a) => a && !a.name)
    if (args.length === 1 && args[0].value && args[0].value.type === 'string') {
      const ms = timestampOfDateString(args[0].value.value)
      return ms === null
        ? { skip: `\`timestamp("${args[0].value.value}")\` is not a date this pane reads exactly` }
        : { ms }
    }
    // ⭐ `timestamp(timezone, year, month, day, hour, minute[, second])` NAMES its zone, so it is
    // exact when that zone is a fixed offset (`UTC`, `GMT+10`, `UTC-5`, `+0530`, the date-string
    // forms `zoneMinutes` reads). A named zone (`America/New_York`) moves with DST: refused by name.
    const tz = argOf(v, 'timezone', 0)
    if (tz && tz.type === 'string') {
      const zone = zoneMinutes(tz.value)
      if (zone === null) {
        return { skip: `its default is \`timestamp("${tz.value}", …)\`, a named time zone this pane does not read` }
      }
      const parts = ['year', 'month', 'day', 'hour', 'minute', 'second'].map((k, i) => {
        const a = argOf(v, k, i + 1)
        if (!a) return i >= 3 ? 0 : null // hour/minute/second default to 0 (Pine); year/month/day are required
        const x = literalNumber(a)
        return x !== null && Number.isInteger(x) ? x : null
      })
      if (parts.some((x) => x === null)) return { skip: 'its default is not a fixed date and time' }
      const ms = utcMs(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5], zone)
      if (ms === null) return { skip: `its default \`timestamp("${tz.value}", ${parts.join(', ')})\` is not a date` }
      return Math.abs(ms) <= TIME_INPUT_MAX_ABS_MS ? { ms } : { skip: OUT_OF_RANGE }
    }
    return { skip: "its default is `timestamp(year, month, …)`, which reads the exchange's time zone — "
      + 'not handed to this pane' }
  }
  if (v.type === 'name' && typeof lookup === 'function') {
    const bound = lookup(v.name)
    if (bound) return constTimeOf(bound, lookup, depth + 1)
  }
  return { skip: 'its default is not a fixed date and time' }
}

const isLiteralNode = (v) => !!v && (v.type === 'string' || v.type === 'colour' || literalNumber(v) !== null)

/** Every name a `:=` or a compound assignment (`+=` …) writes, anywhere in the script. */
function scanReassigned(stmts) {
  const out = new Set()
  const visit = (list) => {
    for (const st of list || []) {
      const toks = st.header || []
      const walrus = findTop(toks, (t) => isPunct(t, ':='))
      if (walrus > 0 && toks[walrus - 1] && toks[walrus - 1].kind === 'ident') out.add(toks[walrus - 1].value)
      const compound = findTop(toks, (t) => t.kind === 'punct' && t.value.length === 2 && t.value.endsWith('=')
        && '+-*/%'.includes(t.value[0]))
      if (compound > 0 && toks[compound - 1] && toks[compound - 1].kind === 'ident') out.add(toks[compound - 1].value)
      if (st.sub && st.sub.length) visit(st.sub)
    }
  }
  visit(stmts)
  return out
}

/** ⭐⭐ `var NAME = <literal>` that NOTHING reassigns — a constant spelled with `var`.
 *
 *  The v4 idiom `var string MD1 = "Columns"` … `input(MD1, options = [MD1, MD2])`: the input's
 *  default READS A `var`, which this lane holds as a mutable slot, so the input was refused
 *  (`runtime:input-state`). A `var` whose only write is its literal initialiser holds that
 *  literal on every bar — it IS the literal. Exactly: declared ONCE (top level), never the
 *  target of `:=` or a compound assignment anywhere, never bound a second time.
 *  `Map<name, literal node>`. */
export function constantVarsOf(stmts) {
  const decl = new Map()
  const count = new Map()
  const reassigned = scanReassigned(stmts)
  const visit = (list, top) => {
    for (const st of list || []) {
      const toks = st.header || []
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      if (nameTok) {
        count.set(nameTok.value, (count.get(nameTok.value) || 0) + 1)
        if (top && toks[0] && toks[0].kind === 'ident' && toks[0].value === 'var') {
          let node = null
          try { node = parseWholeExpression(toks.slice(eq + 1)) } catch { node = null }
          if (isLiteralNode(node)) decl.set(nameTok.value, node)
        }
      }
      if (st.sub && st.sub.length) visit(st.sub, false)
    }
  }
  visit(stmts, true)
  const out = new Map()
  for (const [k, node] of decl) if (count.get(k) === 1 && !reassigned.has(k)) out.set(k, node)
  return out
}

/** ⭐ Replace, IN PLACE, every argument of an input call that names a constant `var`
 *  (`constantVarsOf`) — its default and the elements of its `options` list — by that literal,
 *  so every reader of the call (the resolver, `admitTextInput`, the settings) reads the value
 *  the author wrote. Input calls nested anywhere in `node` are visited. Idempotent. */
export function foldConstantVarsIntoInputs(node, consts) {
  if (!consts || !consts.size || !node || typeof node !== 'object') return node
  const swap = (v) => (v && v.type === 'name' && consts.has(v.name)
    ? { ...consts.get(v.name), tok: v.tok || consts.get(v.name).tok } : v)
  const walk = (n, depth) => {
    if (!n || typeof n !== 'object' || depth > 64) return
    if (n.type === 'call' && typeof n.name === 'string' && (n.name === 'input' || n.name.startsWith('input.'))
        && Array.isArray(n.args)) {
      n.args = n.args.map((a) => {
        if (!a) return a
        const v = a.value !== undefined ? a.value : a
        if (v && v.type === 'collection' && Array.isArray(v.elements)) {
          if (!v.elements.some((x) => swap(x) !== x)) return a
          const els = v.elements.map(swap)
          return a.value !== undefined ? { ...a, value: { ...v, elements: els } } : { ...v, elements: els }
        }
        const sv = swap(v)
        if (sv === v) return a
        return a.value !== undefined ? { ...a, value: sv } : sv
      })
    }
    for (const k of ['left', 'right', 'test', 'yes', 'no', 'arg', 'value']) walk(n[k], depth + 1)
    if (Array.isArray(n.args)) for (const a of n.args) walk(a && a.value !== undefined ? a.value : a, depth + 1)
  }
  walk(node, 0)
  return node
}

function specOf(name, node, rhsToks, version, lookup) {
  const call = node.name
  const legacyType = call === 'input' ? argOf(node, 'type', 2) : undefined
  const legacy = legacyType && legacyType.type === 'name' ? legacyType.name : null
  // ⭐ PHASE 3 WS-D — a symbol setting is skipped for the timeframe ruling's reason, by name.
  if (call === 'input.symbol' || legacy === 'input.symbol') return { skip: SYMBOL_SKIP }
  if (UNSERVED.has(call)) return { skip: `\`${call}\` is not a setting this pane can carry yet` }
  let type = TYPE_OF_CALL[call]
  const def = argOf(node, 'defval', 0)
  if (call === 'input.timeframe' || legacy === 'input.resolution' || legacy === 'input.timeframe') {
    return { skip: TIMEFRAME_SKIP }
  }
  const titleOf = () => {
    const t = argOf(node, 'title', 1)
    return t && t.type === 'string' && t.value ? t.value : name
  }
  // ⭐⭐ PHASE 3 WS-D — A TIME INPUT: UNIX milliseconds, the value Pine's `input.time` returns,
  // read by the SAME reader the run uses (`timeInputDefaultOf`), so the dialog's default is the
  // run's default. A default this cannot read exactly is skipped by name (and the run refuses it).
  if (isTimeInputCall(node)) {
    const r = timeInputDefaultOf(node, lookup)
    return r.skip ? { skip: r.skip } : { spec: { key: name, type: 'time', default: r.ms, label: titleOf() } }
  }
  // ⭐⭐ PHASE 3 WS-D — A SESSION INPUT: the author's session string; with `options`, a menu of
  // them. A default that is not a session string TradingView writes is skipped by name.
  if (call === 'input.session' || legacy === 'input.session') {
    if (!def || def.type !== 'string') return { skip: 'its default is not literal text' }
    if (!isSessionString(def.value)) return { skip: `its default "${def.value}" is not a session (HHMM-HHMM)` }
    const opts = argOf(node, 'options', null)
    if (opts && opts.type === 'collection' && Array.isArray(opts.elements)) {
      const strs = opts.elements.filter((x) => x && x.type === 'string').map((x) => x.value)
      if (strs.length !== opts.elements.length || !strs.length) return { skip: 'its options are not literal text' }
      if (!strs.includes(def.value)) return { skip: "its default is not one of its author's options" }
      return { spec: { key: name, type: 'enum', default: def.value, label: titleOf(), options: strs } }
    }
    return { spec: { key: name, type: 'session', default: def.value, label: titleOf() } }
  }
  if (call === 'input.color' || legacy === 'input.color' || call === 'input.source' || legacy === 'input.source') {
    const titleArg = argOf(node, 'title', 1)
    const label = titleArg && titleArg.type === 'string' && titleArg.value ? titleArg.value : name
    if (call === 'input.color' || legacy === 'input.color') {
      const c = colourDefaultOf(def, version)
      return c.skip ? { skip: c.skip } : { spec: { key: name, type: 'color', default: c.hex, label } }
    }
    const s = sourceDefaultOf(def)
    if (s.skip) return { skip: s.skip }
    const options = SOURCE_MENU.includes(s.name) ? [...SOURCE_MENU] : [...SOURCE_MENU, s.name]
    return { spec: { key: name, type: 'enum', default: s.name, options, label, source: true } }
  }
  let value
  if (call === 'input') {
    const word = firstArgWord(rhsToks)
    if (word) { type = 'bool'; value = word === 'true' }
    else if (def && def.type === 'string') { type = 'string'; value = def.value }
    else {
      const n = literalNumber(def)
      if (n === null) return { skip: 'its default is not a literal value' }
      type = Number.isInteger(n) ? 'int' : 'float'
      value = n
    }
  } else if (!type) {
    return { skip: `\`${call}\` is not a setting this pane knows` }
  } else if (type === 'bool') {
    const word = firstArgWord(rhsToks)
    const n = literalNumber(def)
    if (!word && n === null) return { skip: 'its default is not `true` or `false`' }
    value = word ? word === 'true' : n !== 0
  } else if (type === 'string') {
    if (!def || def.type !== 'string') return { skip: 'its default is not literal text' }
    value = def.value
  } else {
    const n = literalNumber(def)
    if (n === null) return { skip: 'its default is not a literal number' }
    if (type === 'int' && !Number.isInteger(n)) return { skip: 'its default is not a whole number' }
    value = n
  }
  const spec = { key: name, type, default: value }
  const title = argOf(node, 'title', 1)
  spec.label = title && title.type === 'string' && title.value ? title.value : name
  if (type === 'int' || type === 'float') {
    for (const [k, arg] of [['min', 'minval'], ['max', 'maxval'], ['step', 'step']]) {
      const v = literalNumber(argOf(node, arg, null))
      if (v !== null) spec[k] = v
    }
    if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
      return { skip: 'its author bounds are reversed' }
    }
  }
  if (type === 'string') {
    const opts = argOf(node, 'options', null)
    if (opts && opts.type === 'collection' && Array.isArray(opts.elements)) {
      const strs = opts.elements.filter((x) => x && x.type === 'string').map((x) => x.value)
      if (strs.length !== opts.elements.length || !strs.length) return { skip: 'its options are not literal text' }
      if (!strs.includes(value)) return { skip: "its default is not one of its author's options" }
      spec.type = 'enum'
      spec.options = strs
    }
  }
  return { spec }
}

/** The script's literal `name = input.*(…)` settings, in source order, as `defSchema`
 *  inputs, plus every one skipped with its reason. Never throws: a source this cannot
 *  read declares nothing. */
export function runtimeInputSpecsOf(source) {
  const specs = []
  const skipped = []
  let stmts
  let version = null
  try {
    const lexed = lexPine(String(source || ''))
    version = Number.isFinite(lexed.version) ? lexed.version : null
    stmts = blockStatements(lexed.tokens, lexed.indents, 0)
  } catch {
    return { specs, skipped }
  }
  const seen = new Set()
  // ⭐ PHASE 3 WS-D — the same two readers the run uses: a constant `var` folded into an
  // input's arguments (`foldConstantVarsIntoInputs`), and a time default followed through a
  // top-level binding bound once (`timeInputDefaultOf`'s `lookup`).
  const consts = constantVarsOf(stmts)
  const topBindings = new Map()
  const bindCount = new Map()
  for (const st of stmts || []) {
    const toks = st.header || []
    const eq = findTop(toks, (t) => isPunct(t, '='))
    const nameTok = eq > 0 ? boundName(toks, eq) : null
    if (!nameTok) continue
    bindCount.set(nameTok.value, (bindCount.get(nameTok.value) || 0) + 1)
    if (toks[0] && toks[0].kind === 'ident' && (toks[0].value === 'var' || toks[0].value === 'varip')) continue
    try { topBindings.set(nameTok.value, parseWholeExpression(toks.slice(eq + 1))) } catch { /* unreadable */ }
  }
  const written = scanReassigned(stmts)
  const reassigned = (n) => written.has(n)
  const lookup = (n) => (consts.has(n) ? consts.get(n)
    : bindCount.get(n) === 1 && !reassigned(n) && topBindings.has(n) ? topBindings.get(n) : null)
  const visit = (list) => {
    for (const st of list || []) {
      const toks = st.header || []
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      if (nameTok) {
        const rhs = toks.slice(eq + 1)
        let node = null
        try { node = parseWholeExpression(rhs) } catch { node = null }
        if (node) foldConstantVarsIntoInputs(node, consts)
        if (node && node.type === 'call' && typeof node.name === 'string'
          && (node.name === 'input' || node.name.startsWith('input.'))) {
          const name = nameTok.value
          if (seen.has(name)) skipped.push({ key: name, reason: 'it is declared more than once' })
          else if (!KEY_RE.test(name)) skipped.push({ key: name, reason: 'its name cannot key a setting' })
          else {
            seen.add(name)
            const r = specOf(name, node, rhs, version, lookup)
            if (r.spec) specs.push(r.spec)
            else skipped.push({ key: name, call: node.name, reason: r.skip })
          }
        }
      }
      if (st.sub && st.sub.length) visit(st.sub)
    }
  }
  visit(stmts)
  return { specs, skipped }
}

/** The values a run is HANDED: a declared input whose value differs from its default,
 *  in the front end's own shape (a switch as 1 / 0, text as text). An unknown key, an
 *  undeclared input and a value equal to the default hand nothing — the author's
 *  program, exactly. */
export function runtimeInputValues(def, given) {
  const out = {}
  if (!given || typeof given !== 'object') return out
  for (const spec of (def && Array.isArray(def.inputs) ? def.inputs : [])) {
    if (!spec || typeof spec.key !== 'string' || !Object.prototype.hasOwnProperty.call(given, spec.key)) continue
    const v = given[spec.key]
    if (v === undefined || v === spec.default) continue
    // a colour picked as the same colour in another case is the author's colour
    if (spec.type === 'color' && typeof v === 'string' && typeof spec.default === 'string'
      && v.toUpperCase() === spec.default.toUpperCase()) continue
    out[spec.key] = spec.type === 'bool' ? (v === true ? 1 : v === false ? 0 : v) : v
  }
  return out
}

/** ⭐ UIE PHASE 3 (M4) — a run's values split the way the front end takes them: numbers
 *  and text as `inputs` (the resolver's and `admitTextInput`'s), a colour or a source as
 *  `inputDefaults` (`pineRuntimeFrontend.js::applyMemberDefault`, which puts it where the
 *  author's default was). `values` is `runtimeInputValues`' answer. */
export function runtimeBuildInputs(def, values) {
  const inputs = {}
  const inputDefaults = {}
  const byKey = new Map((def && Array.isArray(def.inputs) ? def.inputs : []).map((s) => [s && s.key, s]))
  for (const [k, v] of Object.entries(values || {})) {
    const spec = byKey.get(k)
    if (spec && (spec.type === 'color' || spec.source === true)) inputDefaults[k] = v
    else inputs[k] = v
  }
  return { inputs, inputDefaults }
}

/** ⭐ UIE PHASE 3 (M4) — the colour input a `plot(…)` call on `line` names as its FIXED
 *  colour (`color = c`, or the third positional argument), when `c` is one of `keys`;
 *  else null. Only a bare name: `color = cond ? c : d` is a per-bar colour the run
 *  computes, and `color = color.new(c, 50)` is not the member's colour as picked. */
export function plotColourInputAt(source, line, keys) {
  let stmts
  try {
    const lexed = lexPine(String(source || ''))
    stmts = blockStatements(lexed.tokens, lexed.indents, 0)
  } catch { return null }
  const find = (list) => {
    for (const st of list || []) {
      const toks = st.header || []
      if (toks.length && toks[0].line === line) return toks
      const sub = find(st.sub)
      if (sub) return sub
    }
    return null
  }
  const toks = find(stmts)
  if (!toks) return null
  const eq = findTop(toks, (t) => isPunct(t, '='))
  let node = null
  try { node = parseWholeExpression(eq > 0 && boundName(toks, eq) ? toks.slice(eq + 1) : toks) } catch { return null }
  if (!node || node.type !== 'call' || node.name !== 'plot') return null
  const c = argOf(node, 'color', 2)
  return c && c.type === 'name' && keys.has(c.name) ? c.name : null
}

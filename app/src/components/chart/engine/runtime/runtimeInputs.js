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
//   ⛔ `input.timeframe` stays SKIPPED, by name, in what the member door MINTS
//   (`runtimeInputSpecsOf(source)`): a timeframe setting changes which bars a script
//   reads, and a stored document does not change for it.
//
// ⭐⭐ SETTINGS PARITY (timeframe, Engine 77, #1831) — A TIMEFRAME INPUT IS A SETTING OF A
// RUNTIME DOCUMENT, DECLARED ON LOAD. Since RS RATING L5 the run IS handed other bars: the
// request supply (`runtime/requestSupply.js`) serves the chart's own symbol at a weekly or
// monthly merge above the chart, and refuses every other timeframe BY NAME. So:
//   * on load, a runtime document declares each `name = input.timeframe(…)` whose default is a
//     timeframe written as text as an `enum` setting (`withTimeframeInputs`, `fromTimeframe`:
//     never stored, `paramInputs.stripParamInputs`): its menu is the author's `options = […]`,
//     else TradingView's own list (`TIMEFRAME_MENU`); the stored document is byte-identical;
//   * a member's value replaces the input's DEFAULT NODE in the run
//     (`pineRuntimeFrontend.js::applyMemberDefault`), so the request's host reader
//     (`Resolver.requestTargetOf`) reads it exactly as it reads a literal, and the supply applies
//     its rules unchanged: a timeframe it does not serve is refused with its own sentence;
//   * at the default nothing is handed, and the run builds the author's program, exactly.
import { lexPine, blockStatements, parseWholeExpression, findTop, isPunct, boundName } from '../ast/pine.js'
import { KEY_RE } from '../ast/parse.js'
import { pineColourHex } from '../pinePalette.js'
import { isSessionString, TIME_INPUT_MAX_ABS_MS } from '../defSchema.js'
import { instantField } from './clockFns.js'

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
// ⭐ W6-T10 — `input.enum` RUNS at its DEFAULT field now (`pineRuntimeFrontend.js::lowerInputEnum`).
// ⛔ It is still NOT OFFERED as a setting: the menu of an enum's titles is the member input
// UI's work (W2), and which value a member's choice carries is uncaptured (W6-E1). A run handed
// a member's value for it refuses by name; with no knob, none is handed, and the default serves.
const UNSERVED = new Set(['input.symbol', 'input.text_area', 'input.enum'])
const ENUM_SKIP = 'an enum menu is not offered here yet (the member input menu, and capture W6-E1); its default '
  + 'field stays'
const TIMEFRAME_SKIP = 'a timeframe setting changes which bars the script reads, and this pane is handed only '
  + "the chart's own — another timeframe's bars are not made up; its default stays"
/** ⭐ SETTINGS PARITY (timeframe) — TradingView's own timeframe menu, `[value, label]` as the settings form
 *  draws an enum option, the value spelled as TradingView records it in a capture (`'1W'`, `'1M'`). */
export const TIMEFRAME_MENU = Object.freeze([
  ['1', '1 minute'], ['3', '3 minutes'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'],
  ['45', '45 minutes'], ['60', '1 hour'], ['120', '2 hours'], ['180', '3 hours'], ['240', '4 hours'],
  ['1D', '1 day'], ['1W', '1 week'], ['1M', '1 month'],
].map((p) => Object.freeze(p)))
/** A timeframe as Pine writes one in text: the chart's own (`''`), a count of minutes, or a count of
 *  seconds / days / weeks / months (`'1S'`, `'D'`, `'1D'`, `'2W'`, `'3M'`). */
const TIMEFRAME_TEXT_RX = /^(?:[1-9]\d{0,3}[SDWM]?|[DWM])$/
/** Is `v` a timeframe written as text (the default a timeframe setting may have, and the value a member may
 *  give one)? The ONE reader: the settings and the run (`pineRuntimeFrontend.js::applyMemberDefault`). */
export function isTimeframeText(v) {
  return typeof v === 'string' && (v === '' || TIMEFRAME_TEXT_RX.test(v))
}
const timeframeLabel = (v) => {
  if (v === '') return 'Chart'
  const hit = TIMEFRAME_MENU.find((p) => p[0] === v)
  return hit ? hit[1] : v
}

/** A timeframe input's setting: an `enum` over the author's `options`, else TradingView's menu (with the
 *  author's default first when the menu does not hold it), `timeframe: true`; or `{ skip }`. */
function timeframeSpecOf(name, node, def, label) {
  if (!def || def.type !== 'string' || !isTimeframeText(def.value)) {
    return { skip: 'its default is not a timeframe written as text' }
  }
  const opts = argOf(node, 'options', null)
  let values
  if (opts && opts.type === 'collection' && Array.isArray(opts.elements)) {
    const strs = opts.elements.filter((x) => x && x.type === 'string').map((x) => x.value)
    if (strs.length !== opts.elements.length || !strs.length) return { skip: 'its options are not literal text' }
    if (!strs.every(isTimeframeText)) return { skip: 'its options are not timeframes written as text' }
    if (!strs.includes(def.value)) return { skip: "its default is not one of its author's options" }
    values = strs
  } else {
    const menu = TIMEFRAME_MENU.map((p) => p[0])
    values = menu.includes(def.value) ? menu : [def.value, ...menu]
  }
  return { spec: { key: name, type: 'enum', default: def.value, label,
    options: values.map((v) => [v, timeframeLabel(v)]), timeframe: true } }
}

// ⭐ PHASE 3 WS-D — the same ruling, for the same reason, read for a symbol: a symbol setting
// changes WHICH INSTRUMENT the script reads, and this pane is handed only the chart's own.
const SYMBOL_SKIP = 'a symbol setting changes which instrument the script reads, and this pane is handed only '
  + "the chart's own — another symbol's bars are not made up; its default stays"

/** `#RRGGBB` at a Pine TRANSPARENCY (0 = opaque, 100 = invisible): itself when opaque, else `#RRGGBBAA` with
 *  the alpha byte `round((1 - t / 100) * 255)` (TradingView's `rgba(r, g, b, a)`, `a = 1 - t / 100`). */
function atTransparency(hex6, t) {
  if (t === 0) return hex6
  const byte = Math.round((1 - t / 100) * 255)
  return `${hex6}${byte.toString(16).padStart(2, '0').toUpperCase()}`
}
const isTransparency = (t) => typeof t === 'number' && Number.isFinite(t) && t >= 0 && t <= 100

/** The author's colour default as `#RRGGBB`, or `#RRGGBBAA` when it is see-through (the colour picker sets a
 *  colour AND its opacity, as TradingView's does), or `{ skip }`.
 *  ⭐ SETTINGS PARITY (see-through colours, 2026-11-17): a see-through default was skipped ("the picker sets
 *  an opaque colour") after the picker had learnt opacity, so RS Rating's dot and area colours were missing
 *  from its settings while TradingView offers all four. */
function colourDefaultOf(def, version) {
  if (def && def.type === 'colour' && typeof def.value === 'string') {
    const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(def.value)
    if (!m) return { skip: 'its default is not a colour written as #RRGGBB' }
    const hex6 = `#${m[1].toUpperCase()}`
    return { hex: m[2] && m[2].toUpperCase() !== 'FF' ? `${hex6}${m[2].toUpperCase()}` : hex6 }
  }
  if (def && def.type === 'name' && typeof def.name === 'string') {
    const hex = pineColourHex(def.name, version)
    if (hex) return { hex: hex.toUpperCase() }
  }
  // ⭐ SETTINGS PARITY (2c, colours) — `color.rgb(r, g, b[, t])`: literal channels and a literal transparency
  // are an exact colour (RS Rating's line `color.rgb(0, 0, 255, 0)`, its dots `color.rgb(121, 213, 242, 62)`)
  if (def && def.type === 'call' && def.name === 'color.rgb' && Array.isArray(def.args)) {
    const pos = def.args.filter((a) => a && !a.name).map((a) => literalNumber(a.value))
    const [r, g, b, t] = pos
    const channel = (v) => Number.isInteger(v) && v >= 0 && v <= 255
    if (pos.length >= 3 && pos.length <= 4 && channel(r) && channel(g) && channel(b)) {
      if (pos.length === 4 && !isTransparency(t)) return { skip: 'its transparency is not a literal 0 to 100' }
      const h = (v) => v.toString(16).padStart(2, '0').toUpperCase()
      return { hex: atTransparency(`#${h(r)}${h(g)}${h(b)}`, pos.length === 4 ? t : 0) }
    }
  }
  // `color.new(<fixed colour>, t)`: a fixed colour at a literal transparency (`input(color.new(#b2b5be, 0))`)
  if (def && def.type === 'call' && def.name === 'color.new' && Array.isArray(def.args)) {
    const pos = def.args.filter((a) => a && !a.name).map((a) => a.value)
    const named = (n) => { const a = def.args.find((x) => x && x.name === n); return a ? a.value : undefined }
    const base = named('color') !== undefined ? named('color') : pos[0]
    const tr = named('transp') !== undefined ? named('transp') : pos[1]
    if (base && (base.type === 'colour' || base.type === 'name') && def.args.length === 2) {
      const inner = colourDefaultOf(base, version)
      if (inner.skip) return inner
      const t = literalNumber(tr)
      if (!isTransparency(t)) return { skip: 'its transparency is not a literal 0 to 100' }
      return { hex: atTransparency(inner.hex.slice(0, 7), t) }
    }
  }
  return { skip: 'its default is not a fixed colour (a #RRGGBB or a Pine colour name)' }
}

/** Is an input's default node a colour (so a plain `input(…)` is a colour input)? */
function isColourDefaultNode(def, version) {
  if (!def) return false
  if (def.type === 'colour') return true
  if (def.type === 'name' && typeof def.name === 'string') return !!pineColourHex(def.name, version)
  return def.type === 'call' && (def.name === 'color.rgb' || def.name === 'color.new')
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
// W4 T3: v1-v3 spelled the type with a bare word (`input("0930-1600", "S", type = session)`,
// `type = resolution`, `type = string`); v4 renamed them `input.session` / `input.resolution` /
// `input.string`. Same inputs, same values, so one table reads both spellings.
const TEXT_KIND_OF_LEGACY_TYPE = Object.freeze({
  'input.string': 'string', 'input.resolution': 'timeframe', 'input.timeframe': 'timeframe',
  'input.session': 'session', 'input.symbol': 'symbol',
  string: 'string', resolution: 'timeframe', session: 'session',
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
export function timeInputDefaultOf(node, lookup, opts = {}) {
  // ⭐⭐ RULING-0927 r1 (2026-11-07) — ONLY THE CAPTURED FORM IS SERVED, on every lane that reads
  // a time default (this function is the one reader: the run, the settings dialog and the
  // translator all call it). T16 of `vw-time-tf-spy-1d-2026-09-27.json` witnesses exactly
  // `input.time(timestamp("18 May 2022 00:00 +0000"))` with no `confirm`. Every other form refuses
  // by name and has a probe row in `docs/pine/capture-queue-2026-09-27.md` (RULING-0927 r1).
  // r2 (B3): `confirm` is positional index 5 in BOTH signatures — v5/v6 `input.time(defval, title,
  // tooltip, inline, group, confirm)` and v4 `input(defval, title, type, minval, maxval, confirm)`.
  const confirm = argOf(node, 'confirm', 5)
  if (confirm !== undefined && literalNumber(confirm) !== 0) return { skip: TIME_CONFIRM_SKIP }
  const def = argOf(node, 'defval', 0)
  const r = constTimeOf(def, lookup, 0, opts)
  if (r.skip) return r
  const why = unwitnessedTimeDefault(terminalTimeNode(def, lookup))
  return why ? { skip: why } : r
}

/** The one default form a capture holds: an RFC 2822 date string, minutes, zone written `+0000`. */
export const WITNESSED_TIME_DEFAULT = /^\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2} \+0000$/
const TIME_NEEDS_CAPTURE = ' — no capture holds this form yet (RULING-0927 r1, '
  + '`docs/pine/capture-queue-2026-09-27.md`); the one captured form is `timestamp("D MMM YYYY hh:mm +0000")`'
export const TIME_CONFIRM_SKIP = 'it asks the member to pick the time on the chart (`confirm = true`), so the '
  + "author's default is not what TradingView runs" + TIME_NEEDS_CAPTURE

/** The node a default finally names, through name bindings (the same walk `constTimeOf` makes). */
function terminalTimeNode(v, lookup) {
  for (let depth = 0; v && v.type === 'name' && typeof lookup === 'function' && depth <= 8; depth += 1) {
    const bound = lookup(v.name)
    if (!bound) break
    v = bound
  }
  return v
}

/** ⭐⭐ ENGINE 84 (C1) — THE ZONES `timestamp(timezone, …)` NAMES THAT ARE UTC ITSELF: no offset, so
 *  no sign to read (the sign of `GMT+N` is CR-S1's, queued). */
const UTC_ZONE_NAMES = /^(?:UTC|GMT)$/

/** Why a READABLE default is still not served (null when it is the captured form, or a form the reference
 *  alone settles).
 *  ⭐⭐ ENGINE 84 (C1, coordinator ruling 2026-11-19) — three forms need no capture, because nothing is
 *  read in them that the Pine reference does not state exactly (v6 `input.time`: "defval (const int)";
 *  `timestamp`: "Returns: UNIX time", its numeric form reading `timezone`, "The default is syminfo.timezone"):
 *    · a literal count of milliseconds IS the UNIX time the input returns;
 *    · `timestamp("UTC" | "GMT", year, month, day, hour, minute[, second])` names UTC itself;
 *    · `timestamp(year, month, day, hour, minute[, second])` reads the exchange's zone, so it is read only where
 *      the run is told a New York symbol (the clock rule every other exchange-zone read on this lane follows,
 *      `pineRuntimeFrontend.js::requireNewYorkExchange`), and never in New York's clock-change hours
 *      (`constTimeOf`). Every other spelling waits for Q-D2 / CR-S1. */
function unwitnessedTimeDefault(v) {
  if (literalNumber(v) !== null) return null
  const args = v && v.type === 'call' && v.name === 'timestamp' ? (v.args || []).filter((a) => a && !a.name) : []
  if (args.length >= 6 && args[0].value && args[0].value.type === 'string' && UTC_ZONE_NAMES.test(args[0].value.value.trim())) {
    return null
  }
  if (args.length >= 5 && literalNumber(args[0].value) !== null) return null
  if (args.length === 1 && args[0].value && args[0].value.type === 'string') {
    const text = args[0].value.value
    return WITNESSED_TIME_DEFAULT.test(text)
      ? null
      : `its default \`timestamp("${text}")\` is not written in the captured form` + TIME_NEEDS_CAPTURE
  }
  return 'its default is `timestamp(timezone, year, …)`' + TIME_NEEDS_CAPTURE
}

/** A New York wall time `[y, mo, d, h, mi, s]` as UNIX milliseconds when exactly ONE instant reads it back
 *  (`clockFns.instantField` over the exchange zone, the lane's one New York clock), else null: a time in the
 *  spring-forward gap reads back from neither candidate, one in the fall-back hour from both. */
function newYorkWallMs([y, mo, d, h, mi, s]) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const back = new Date(wall)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  const reads = [4, 5].map((off) => wall + off * 3600000).filter((c) => instantField('year', c, 'exchange') === y
    && instantField('month', c, 'exchange') === mo && instantField('dayofmonth', c, 'exchange') === d
    && instantField('hour', c, 'exchange') === h && instantField('minute', c, 'exchange') === mi)
  return reads.length === 1 ? reads[0] : null
}

const OUT_OF_RANGE = 'its default is outside the dates a chart can hold (±8.64e15 ms, about 271,821 years either side of 1970)'

function constTimeOf(v, lookup, depth, opts = {}) {
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
    // ⭐⭐ C1 — `timestamp(year, month, day, hour, minute[, second])` reads the EXCHANGE's zone: read where the run
    // is told a New York symbol (`opts.exchangeZone`, the clock rule of the rest of this lane), as New York wall
    // time. ⛔ Not in the hour New York's clock skips or repeats (both readings are NEEDS CAPTURE, `clockFns.js`).
    if (args.length >= 5 && literalNumber(args[0].value) !== null && opts && opts.exchangeZone === 'America/New_York') {
      const parts = [0, 1, 2, 3, 4, 5].map((i) => {
        if (!args[i]) return i >= 5 ? 0 : null
        const x = literalNumber(args[i].value)
        return x !== null && Number.isInteger(x) ? x : null
      })
      if (parts.some((x) => x === null)) return { skip: 'its default is not a fixed date and time' }
      const ms = newYorkWallMs(parts)
      if (ms === null) {
        return { skip: `its default \`timestamp(${parts.slice(0, 5).join(', ')})\` falls in the hour New York's clock `
          + 'skips or repeats, where which instant TradingView reads is not captured' }
      }
      return Math.abs(ms) <= TIME_INPUT_MAX_ABS_MS ? { ms } : { skip: OUT_OF_RANGE }
    }
    return { skip: "its default is `timestamp(year, month, …)`, which reads the exchange's time zone — "
      + 'known here only on a New York symbol (NYSE, NASDAQ, NYSE Arca) the run is told' }
  }
  if (v.type === 'name' && typeof lookup === 'function') {
    const bound = lookup(v.name)
    if (bound) return constTimeOf(bound, lookup, depth + 1, opts)
  }
  return { skip: 'its default is not a fixed date and time' }
}

const isLiteralNode = (v) => !!v && (v.type === 'string' || v.type === 'colour' || literalNumber(v) !== null)

/** W4 T3: the names a TUPLE statement binds (`[a, b] = f()`), and the operator that follows the
 *  closing bracket; `null` when the statement is not a tuple. (`[a, b] := f()` is refused by name
 *  by the front end, `runtime:tuple`, so nothing reads it as a write here.) Every identifier between the brackets counts (a type word too: over-counting only makes
 *  a `var` less likely to be called constant, never more). */
function tupleTargetsOf(toks) {
  if (!toks || !toks[0] || !isPunct(toks[0], '[')) return null
  const names = []
  let close = -1
  for (let k = 1; k < toks.length; k += 1) {
    if (isPunct(toks[k], ']')) { close = k; break }
    if (toks[k].kind === 'ident') names.push(toks[k].value)
  }
  if (close < 0 || !toks[close + 1] || toks[close + 1].kind !== 'punct') return null
  return { names, op: toks[close + 1].value }
}

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
  return onceVarsOf(stmts, isLiteralNode)
}

/** `var NAME = <initialiser>` declared ONCE at the top level and never reassigned, whose initialiser
 *  `keep` accepts: `Map<name, parse node>`. The one walk `constantVarsOf` and `textInputVarsOf` share. */
function onceVarsOf(stmts, keep) {
  const decl = new Map()
  const count = new Map()
  const reassigned = scanReassigned(stmts)
  const visit = (list, top) => {
    for (const st of list || []) {
      const toks = st.header || []
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      // W4 T3: `[a, b] = f()` binds `a` and `b` (a second binding of a name, in any block, means
      // the name is not one constant): count each, exactly as a plain `a = …` is counted
      const tup = tupleTargetsOf(toks)
      if (tup && tup.op === '=') for (const n of tup.names) count.set(n, (count.get(n) || 0) + 1)
      if (nameTok) {
        count.set(nameTok.value, (count.get(nameTok.value) || 0) + 1)
        if (top && toks[0] && toks[0].kind === 'ident' && toks[0].value === 'var') {
          let node = null
          try { node = parseWholeExpression(toks.slice(eq + 1)) } catch { node = null }
          if (keep(node, nameTok.value)) decl.set(nameTok.value, node)
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

/** ⭐⭐ PINE DATA UNIT S4-1 (2026-11-19) — `var NAME = <text input>` that NOTHING reassigns.
 *
 *  `var anchor = input.string(defval = "Session", …)` (TradingView's own VWAP): a `var` is set once,
 *  on the first bar, to the input's value, and never written again, so it holds the input's value on
 *  every bar. This lane holds a `var` as a mutable slot, so a `switch anchor` read it as per-bar text.
 *  `Map<name, input call node>`, each node stamped with its bound name (`boundName`), so a reader of
 *  it (`admitTextInput`) takes the MEMBER'S value when one is set, exactly as for `anchor = input.string(…)`.
 *  Same rule as `constantVarsOf`: declared once at the top level, never the target of `:=` or a
 *  compound assignment, never bound a second time. */
export function textInputVarsOf(stmts) {
  return onceVarsOf(stmts, (node, name) => {
    if (textInputKindOf(node) === null) return false
    node.boundName = name
    return true
  })
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

function specOf(name, node, rhsToks, version, lookup, opts = {}) {
  const call = node.name
  const legacyType = call === 'input' ? argOf(node, 'type', 2) : undefined
  const legacy = legacyType && legacyType.type === 'name' ? legacyType.name : null
  // ⭐ PHASE 3 WS-D — a symbol setting is skipped for the timeframe ruling's reason, by name.
  if (call === 'input.symbol' || legacy === 'input.symbol') return { skip: SYMBOL_SKIP }
  if (call === 'input.enum') return { skip: ENUM_SKIP }
  if (UNSERVED.has(call)) return { skip: `\`${call}\` is not a setting this pane can carry yet` }
  let type = TYPE_OF_CALL[call]
  const def = argOf(node, 'defval', 0)
  const titleOf = () => {
    const t = argOf(node, 'title', 1)
    return t && t.type === 'string' && t.value ? t.value : name
  }
  if (call === 'input.timeframe' || legacy === 'input.resolution' || legacy === 'input.timeframe') {
    // ⭐ SETTINGS PARITY (timeframe) — a setting only where it is asked for (the load-time projection,
    // `withTimeframeInputs`); what the door mints keeps the skip, byte for byte
    return opts.timeframes === true ? timeframeSpecOf(name, node, def, titleOf()) : { skip: TIMEFRAME_SKIP }
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
  // ⭐ SETTINGS PARITY (2c, colours) — a plain `input(…)` with a colour default is a colour input
  if (call === 'input' && !legacy && isColourDefaultNode(def, version)) {
    const c = colourDefaultOf(def, version)
    return c.skip ? { skip: c.skip } : { spec: { key: name, type: 'color', default: c.hex, label: titleOf() } }
  }
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
 *  read declares nothing. `{ timeframes: true }` (the load-time projection only,
 *  `withTimeframeInputs`) reads a timeframe input as a setting instead of skipping it. */
export function runtimeInputSpecsOf(source, opts = {}) {
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
            const r = specOf(name, node, rhs, version, lookup, opts)
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
    // ⭐ SETTINGS PARITY (symbol) — a TEXT setting's value is ALSO its input's default node, so every reader
    // that reads the call statically sees the member's text: `request.security(lineTicker, …)` resolves its
    // symbol from it (`Resolver.otherSymbolOf`), as the resolver's value serves every comparison
    if (spec && spec.type === 'string' && typeof v === 'string') inputDefaults[k] = v
    // ⭐ SETTINGS PARITY (timeframe) — and a TIMEFRAME setting's, for the same reason: the request's host reader
    // reads the timeframe off the input's default node (the front end also takes it from `inputs` alone,
    // for a caller that hands no declared inputs: `applyMemberDefault`)
    if (spec && spec.timeframe === true && typeof v === 'string') inputDefaults[k] = v
  }
  return { inputs, inputDefaults }
}

// ⭐⭐ SETTINGS PARITY (timeframe) — A MOVED TIMEFRAME IS DRAWN ONLY ON RECORDED EVIDENCE, the rule a run
// half's moved settings follow (`runHalfSettingsAdmitted`). The first captures at a moved timeframe
// (PA ZigZag at 1W / 1M, run rozz-2026-11-18) DIVERGE on 9 of 10 items, so no script is admitted: a member
// who moves one is refused by name (`pineRuntimeFrontend.js::applyMemberDefault`), never shown an
// unwitnessed picture. The runtime-on harness lane grades them anyway (`__serveEveryTimeframeSettingForTests`),
// so the evidence that would admit one is measured on every run.
let _serveMovedTimeframes = false
/** Is a timeframe setting moved off its author's default drawn? Never on a member surface yet. */
export function movedTimeframeServed() { return _serveMovedTimeframes }
/** Rails / the runtime-on harness lane only. */
export function __serveEveryTimeframeSettingForTests() { _serveMovedTimeframes = true }
/** Rails only. */
export function __resetTimeframeSettingForTests() { _serveMovedTimeframes = false }
/** ⭐ The line a member reads beside a timeframe setting while no evidence admits a move (coordinator UI
 *  ruling 2026-11-18): the setting is shown READ-ONLY at its default, never as a control that refuses. */
export const TIMEFRAME_LOCKED_SENTENCE = "Changing this script's timeframe isn't available yet: our weekly and "
  + "monthly results for it don't match TradingView yet."

/** The one sentence a member reads when they move a timeframe setting. */
export function movedTimeframeRefusal(name, value) {
  return '`' + name + '` is set to ' + JSON.stringify(value) + ": a timeframe setting moved off its author's default "
    + 'is drawn only where a TradingView capture at that timeframe grades MATCH, and none does yet for this script, '
    + 'so nothing is drawn rather than an unwitnessed picture (its default draws as before)'
}

const _timeframeSpecs = new Map()
const TIMEFRAME_SPECS_MEMO = 64

/** The timeframe settings a runtime document's script declares (`runtimeInputSpecsOf` with
 *  `{ timeframes: true }`), memoised per source text (a bounded map: a chart installs few sources). */
function timeframeSpecsOf(source) {
  let hit = _timeframeSpecs.get(source)
  if (!hit) {
    hit = runtimeInputSpecsOf(source, { timeframes: true }).specs.filter((s) => s.timeframe === true)
    if (_timeframeSpecs.size >= TIMEFRAME_SPECS_MEMO) _timeframeSpecs.delete(_timeframeSpecs.keys().next().value)
    _timeframeSpecs.set(source, hit)
  }
  return hit
}

/** ⭐⭐ SETTINGS PARITY (timeframe) — a RUNTIME document with its timeframe settings declared on load
 *  (`fromTimeframe: true`, never stored: `paramInputs.stripParamInputs`). Idempotent; a key the document
 *  already declares is left alone. ⛔ A host (`ast`) document, and a run half, declare nothing: the host
 *  lane folds a timeframe into its trees and reads no member value for it. */
export function withTimeframeInputs(def) {
  const compute = def && def.compute
  if (!compute || compute.kind !== 'runtime' || typeof compute.source !== 'string' || !compute.source) return def
  const have = Array.isArray(def.inputs) ? def.inputs : []
  if (have.some((i) => i && i.fromTimeframe === true)) return def
  const specs = timeframeSpecsOf(compute.source)
  if (!specs.length) return def
  const taken = new Set(have.map((i) => i && i.key))
  // ⛔ while no evidence admits a move, the setting is READ-ONLY at its default with one line saying why
  // (`locked`, read by `indicatorRegistry.fieldFromInput`; the same line is its visible tip)
  const lock = movedTimeframeServed() ? {} : { locked: TIMEFRAME_LOCKED_SENTENCE, tooltip: TIMEFRAME_LOCKED_SENTENCE }
  const add = specs.filter((s) => !taken.has(s.key))
    .map((s) => ({ ...s, options: s.options.map((p) => [...p]), fromTimeframe: true, ...lock }))
  if (!add.length) return def
  return { ...def, inputs: [...have, ...add] }
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

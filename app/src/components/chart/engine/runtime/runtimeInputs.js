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

/** The bar series a member may pick for a source input. */
export const RUNTIME_SOURCES = Object.freeze(new Set(['open', 'high', 'low', 'close', 'volume', 'hl2', 'hlc3',
  'ohlc4', 'hlcc4']))
const SOURCE_MENU = Object.freeze(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'])

const TYPE_OF_CALL = Object.freeze({
  'input.int': 'int', 'input.float': 'float', 'input.bool': 'bool', 'input.string': 'string',
})
const UNSERVED = new Set(['input.session', 'input.symbol',
  'input.time', 'input.price', 'input.text_area', 'input.enum'])
const TIMEFRAME_SKIP = 'a timeframe setting changes which bars the script reads, and this pane is handed only '
  + "the chart's own — another timeframe's bars are not made up; its default stays"

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

function specOf(name, node, rhsToks, version) {
  const call = node.name
  if (UNSERVED.has(call)) return { skip: `\`${call}\` is not a setting this pane can carry yet` }
  let type = TYPE_OF_CALL[call]
  const def = argOf(node, 'defval', 0)
  const legacyType = call === 'input' ? argOf(node, 'type', 2) : undefined
  const legacy = legacyType && legacyType.type === 'name' ? legacyType.name : null
  if (call === 'input.timeframe' || legacy === 'input.resolution' || legacy === 'input.timeframe') {
    return { skip: TIMEFRAME_SKIP }
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
  const visit = (list) => {
    for (const st of list || []) {
      const toks = st.header || []
      const eq = findTop(toks, (t) => isPunct(t, '='))
      const nameTok = eq > 0 ? boundName(toks, eq) : null
      if (nameTok) {
        const rhs = toks.slice(eq + 1)
        let node = null
        try { node = parseWholeExpression(rhs) } catch { node = null }
        if (node && node.type === 'call' && typeof node.name === 'string'
          && (node.name === 'input' || node.name.startsWith('input.'))) {
          const name = nameTok.value
          if (seen.has(name)) skipped.push({ key: name, reason: 'it is declared more than once' })
          else if (!KEY_RE.test(name)) skipped.push({ key: name, reason: 'its name cannot key a setting' })
          else {
            seen.add(name)
            const r = specOf(name, node, rhs, version)
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

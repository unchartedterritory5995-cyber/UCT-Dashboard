// app/src/components/chart/engine/runHalfInputs.js
//
// ─── ⭐⭐ SETTINGS PARITY (2c): A RUN HALF'S OWN SETTINGS ─────────────────────────────
//
// A host document with a run half (`compute.runtimeObjects`: the drawings a member's script
// makes that the host program cannot) draws its plots on the host lane and its drawings from a
// runtime run of the same script. The host declares the inputs its plots read (and, since 2a,
// the folded lengths as `param<N>`). An input that ONLY the drawings read (RS Rating's "Hide
// Rating", "Plot RS New Highs", "Look-back", ...) was declared nowhere, so it could not be set:
// the run always ran the author's program, `inputs: {}`.
//
// Three pure pieces:
//   * `hostReadNames(source)`: every name the script's PLOTS can depend on, by a conservative
//     static closure over the statements (assignment right-hand sides, the conditions a
//     statement sits under, a call statement's arguments as possibly mutated, a function's
//     whole body). Over-reading is safe (a setting is just not offered); under-reading is the
//     danger, and `runHalfInputs.test.js` checks the closure contains every input the
//     translator folded into a plot, across the committed corpus.
//   * `runHalfInputSpecs(def)` / `withRunHalfInputs(def)`: the script's literal settings
//     (`runtimeInputSpecsOf`, the reader the runtime pane already uses) that no plot reads and
//     the host does not declare, declared on the in-memory document as ordinary inputs keyed by
//     their Pine name, `fromRunHalf: true`. A load-time projection like `param<N>`: never
//     stored (`paramInputs.stripParamInputs` takes both off).
//   * `runHalfRunInputs(def, inputs)`: the instance's values in the run's own vocabulary (Pine
//     names): a host input keyed by its Pine name, a `param<N>` by its `sourceName`, a
//     run-half setting by its key. Plot style keys (widths) do not reach the run. A moved
//     setting the run cannot be handed (a plot colour, whose Pine input the run reads but this
//     map does not carry) makes the answer `{ok: false}`, and the run half is refused by name:
//     never drawings computed at settings other than the chart's.

import { lexPine, blockStatements, findTop, isPunct } from './ast/pine.js'
import { runtimeInputSpecsOf } from './runtime/runtimeInputs.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const _rtSpecsMemo = new Map()
/** `runtimeInputSpecsOf(source).specs`, memoised per source text. */
function rtSpecsOf(source) {
  const src = String(source || '')
  let hit = _rtSpecsMemo.get(src)
  if (!hit) {
    hit = runtimeInputSpecsOf(src).specs
    if (_rtSpecsMemo.size > 64) _rtSpecsMemo.clear()
    _rtSpecsMemo.set(src, hit)
  }
  return hit
}

/** The calls that make a HOST output (a plot, a fill, a colour of the chart's bars). */
const OUTPUT_CALLS = new Set(['plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar',
  'fill', 'bgcolor', 'barcolor', 'hline', 'alertcondition'])
const ASSIGN_OPS = new Set(['=', ':=', '+=', '-=', '*=', '/=', '%='])

// ⛔ Keywords and builtin namespaces are lexed as identifiers. As a dependency NODE they would
// link unrelated statements (`if` was reached from one block and read in another: RS Rating's
// "Rating Only" was counted as read by the second average), so they are never a target, and a
// member name (`label.delete`'s `delete`) is never one either.
const KEYWORDS = new Set(['if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'and', 'or', 'not', 'var', 'varip',
  'true', 'false', 'na', 'import', 'export', 'method', 'type', 'enum', 'return', 'break', 'continue', 'series', 'simple',
  'const', 'int', 'float', 'bool', 'string'])
// a namespace word is a namespace only when a member follows it (`size.tiny`); standing alone it may
// be a member's own variable (`size = input.int(…)`), which IS a target
const NAMESPACES = new Set(['ta', 'math', 'array', 'matrix', 'map', 'str', 'label', 'line', 'box', 'table', 'linefill',
  'polyline', 'chart', 'color', 'request', 'syminfo', 'timeframe', 'barstate', 'strategy', 'input', 'plot', 'size',
  'shape', 'location', 'position', 'text', 'font', 'xloc', 'yloc', 'extend', 'display', 'format', 'currency',
  'session', 'dayofweek', 'ticker', 'runtime', 'log', 'alert', 'hline', 'scale', 'adjustment', 'order', 'earnings',
  'dividends', 'splits'])
// the bar's own series and the like: never a member's variable, so never written
const BUILTIN_VALUES = new Set(['time', 'timenow', 'bar_index', 'last_bar_index', 'open', 'high', 'low', 'close',
  'volume', 'hl2', 'hlc3', 'ohlc4', 'hlcc4', 'nz', 'fixnan'])
// ⛔ THE LEXER KEEPS A DOTTED NAME AS ONE TOKEN (`label.new`, `arr.push`, `q.field`, `barstate.islast`).
// Read as a whole, `arr.push(x)` would write a name nobody reads and `q.field` would read a name
// nobody writes, so every dotted name is split into its parts: each part is a READ, and the FIRST
// part (the object itself: `arr` in `arr.push(x)`) is what a statement can WRITE.
const partsOf = (v) => String(v).split('.').filter(Boolean)
const identsOf = (toks) => (toks || []).filter((t) => t && t.kind === 'ident').flatMap((t) => partsOf(t.value))
/** The names a statement can WRITE: user names only, never a keyword, a namespace, a builtin value or a member. */
const targetsOf = (toks) => (toks || []).flatMap((t, i) => {
  if (!t || t.kind !== 'ident' || (i > 0 && isPunct(toks[i - 1], '.'))) return []
  // a named argument (`color = fillCol` inside `fill(…)`) names a parameter, never a variable:
  // read as a target it linked every `color =` argument in the script to every other
  if (isPunct(toks[i + 1], '=')) return []
  const parts = partsOf(t.value)
  const head = parts[0]
  const member = parts.length > 1 || isPunct(toks[i + 1], '.')
  if (!head || KEYWORDS.has(head) || BUILTIN_VALUES.has(head) || (NAMESPACES.has(head) && member)) return []
  return [head]
})
const CONTROL = new Set(['if', 'else', 'for', 'while', 'switch'])
function subtreeIdents(st, out = []) {
  out.push(...identsOf(st.header), ...identsOf(st.body))
  for (const s of st.sub || []) subtreeIdents(s, out)
  return out
}
/** A call to an output builtin anywhere at the top of this statement (`plot(`, not `plot.style_x`). */
function callsOutput(toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (!t || t.kind !== 'ident' || !OUTPUT_CALLS.has(t.value)) continue
    if (i > 0 && isPunct(toks[i - 1], '.')) continue
    if (isPunct(toks[i + 1], '(')) return true
  }
  return false
}

// the drawing namespaces: a statement making or changing a drawing (`label.new(`, `line.set_x2(`)
const DRAWING_NAMESPACES = new Set(['label', 'line', 'box', 'table', 'polyline', 'linefill'])
/** A statement that makes or changes a drawing: `label.new(`, `box.set_right(`, or a method call
 *  on a drawing (`lbl.set_text(`, `l.delete(`). */
function callsDrawing(toks) {
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (!t || t.kind !== 'ident') continue
    const parts = partsOf(t.value)
    // `label.new`, `box.set_right`, `table.cell` (a namespace with a member, whole or split)
    if (DRAWING_NAMESPACES.has(parts[0]) && (parts.length > 1 || isPunct(toks[i + 1], '.'))) return true
    // a method call on a drawing (`lbl.set_text(`, `l.delete(`)
    const last = parts[parts.length - 1]
    if ((parts.length > 1 || (i > 0 && isPunct(toks[i - 1], '.'))) && /^(set_|delete$|copy$)/.test(last)
      && isPunct(toks[i + 1], '(')) return true
  }
  return false
}

const _readMemo = new Map()

/** Every name the script's host outputs (plots, fills, bar colours) can depend on: a
 *  conservative closure, or null when the source cannot be read (then nothing is offered).
 *  Memoised per source text. */
export function hostReadNames(source) {
  return readNamesFrom(source, 'host', callsOutput)
}

/** Every name the script's DRAWINGS can depend on (the same closure, rooted at the statements
 *  that make or change a drawing). A moved setting outside it cannot change a drawing, so the
 *  run half's evidence at the defaults stands for it. */
export function drawingReadNames(source) {
  return readNamesFrom(source, 'drawing', callsDrawing)
}

function readNamesFrom(source, kind, isRoot) {
  const src = String(source || '')
  const memoKey = `${kind}\u0000${src}`
  if (_readMemo.has(memoKey)) return _readMemo.get(memoKey)
  if (_readMemo.size > 128) _readMemo.clear()
  let stmts
  try {
    const lexed = lexPine(src)
    stmts = blockStatements(lexed.tokens, lexed.indents, 0)
  } catch {
    _readMemo.set(memoKey, null)
    return null
  }
  const deps = new Map()
  const roots = new Set()
  const add = (name, ids) => {
    let s = deps.get(name)
    if (!s) { s = new Set(); deps.set(name, s) }
    for (const x of ids) s.add(x)
  }
  const visit = (list, cond) => {
    // ⭐ AN `else` IS THE SAME STATEMENT CONTINUED. `x = if c` / `else if d` / `else` reach the lexer
    // as sibling statements, so an `else` arm's value would belong to nobody: the targets of the
    // statement that opened the chain read every arm (found by the soundness rail on
    // implied-volatility-suite, whose `Len = if …` / `else` hid `modelIV_ranklen` from its plot).
    // ...and an `else` arm of a CONTROL `if c` runs under `c` too: `chainCond` carries the
    // conditions of every earlier arm of the chain into each later arm's block.
    let chain = null
    let chainCond = new Set()
    for (const st of list || []) {
      const toks = st.header || []
      const ids = identsOf(toks)
      const sub = st.sub && st.sub.length ? st.sub : null
      const isElse = toks[0] && toks[0].kind === 'ident' && toks[0].value === 'else'
      if (isElse) {
        if (chain) {
          const reads = new Set([...ids, ...cond, ...chainCond, ...(sub ? subtreeIdents({ sub }) : [])])
          for (const t of chain) add(t, reads)
        }
        for (const x of ids) chainCond.add(x)
        if (sub) visit(sub, new Set([...cond, ...chainCond]))
        continue
      }
      chain = null
      chainCond = new Set(ids)
      const isFn = findTop(toks, (t) => isPunct(t, '=>')) > 0 && toks[0] && toks[0].kind === 'ident'
        && (isPunct(toks[1], '(') || toks[0].value === 'method')
      if (isFn) {
        // a function (or method) depends on its whole body; its name is what a caller reads
        const name = toks[0].value === 'method' ? (toks[1] && toks[1].value) : toks[0].value
        if (name) add(String(name), subtreeIdents(st))
        continue
      }
      // a control statement (`if c`, `for i = 0 to n`, `while c`, `switch x`) writes nothing itself:
      // its names are the condition its block runs under
      const control = toks[0] && toks[0].kind === 'ident' && CONTROL.has(toks[0].value)
      const op = control ? -1 : findTop(toks, (t) => t.kind === 'punct' && ASSIGN_OPS.has(t.value))
      const right = op >= 0 ? identsOf(toks.slice(op + 1)) : ids
      // a call statement (`array.push(a, x)`, `a.push(x)`) may write any user name it mentions
      const targets = control ? [] : op >= 0 ? targetsOf(toks.slice(0, op)) : targetsOf(toks)
      const reads = new Set([...right, ...cond])
      // an assignment whose value is a block (`x = if c`, `x = switch y`) reads the whole block
      if (op >= 0 && sub) for (const x of subtreeIdents({ sub })) reads.add(x)
      for (const t of targets) add(t, reads)
      // an assignment whose value is a block opens a chain its `else` arms continue
      if (op >= 0 && sub && targets.length) chain = targets
      if (isRoot(toks)) for (const x of [...ids, ...cond]) roots.add(x)
      if (sub) visit(sub, new Set([...cond, ...ids]))
    }
  }
  visit(stmts, new Set())
  const seen = new Set()
  // `seen` doubles as the explanation: each name maps (non-enumerably) to the name it was reached from
  const via = new Map()
  const stack = [...roots]
  for (const r of roots) via.set(r, null)
  while (stack.length) {
    const n = stack.pop()
    if (seen.has(n)) continue
    seen.add(n)
    for (const d of deps.get(n) || []) {
      if (!seen.has(d)) { if (!via.has(d)) via.set(d, n); stack.push(d) }
    }
  }
  Object.defineProperty(seen, 'via', { value: via, enumerable: false })
  _readMemo.set(memoKey, seen)
  return seen
}

/** Why a name is host-read: the chain of names from a plot to it (diagnostics), or null. */
export function hostReadPath(source, name) {
  const seen = hostReadNames(source)
  if (!seen || !seen.has(name)) return null
  const out = [name]
  let n = name
  while (seen.via.get(n) != null && out.length < 64) { n = seen.via.get(n); out.push(n) }
  return out.reverse()
}

/** The run half of a host document, or null. */
export function runHalfOfDef(def) {
  const ro = isObj(def) && isObj(def.compute) ? def.compute.runtimeObjects : null
  return isObj(ro) && typeof ro.source === 'string' && ro.source ? ro : null
}

const specsMemo = new WeakMap()

/** The settings only a document's run half reads, in source order, `fromRunHalf: true`. */
export function runHalfInputSpecs(def) {
  const ro = runHalfOfDef(def)
  if (!ro) return []
  const hit = specsMemo.get(def)
  if (hit) return hit
  const host = hostReadNames(ro.source)
  if (!host) { specsMemo.set(def, []); return [] }
  const declared = new Set((Array.isArray(def.inputs) ? def.inputs : [])
    .filter((i) => i && !i.fromRunHalf).map((i) => i.key))
  const manifest = isObj(def.compute.paramManifest) ? def.compute.paramManifest : {}
  const params = new Set(Object.values(manifest).map((e) => e && e.sourceName).filter(Boolean))
  const out = []
  for (const spec of rtSpecsOf(ro.source)) {
    if (!spec || host.has(spec.key) || declared.has(spec.key) || params.has(spec.key)) continue
    out.push({ ...spec, fromRunHalf: true })
  }
  specsMemo.set(def, out)
  return out
}

/** The document with its run half's own settings declared (unchanged when none). */
export function withRunHalfInputs(def) {
  const specs = runHalfInputSpecs(def)
  if (!specs.length) return def
  if ((def.inputs || []).some((i) => i && i.fromRunHalf)) return def
  return { ...def, inputs: [...(Array.isArray(def.inputs) ? def.inputs : []), ...specs] }
}

/** Plot style keys the run never reads (a line's width). */
const STYLE_ONLY = /^(lineWidth|out\d+Width)$/

// ─── ⭐⭐ SETTINGS PARITY (2c, colours): A PLOT'S COLOUR SETTING IS THE SCRIPT'S COLOUR INPUT ─────
//
// The host declares a plot's colour as a styling input (`color`, `out2Color`, ...: `plots[].color` is
// `$<key>`), but on TradingView that colour is the script's own input (`colorRS`), and the DRAWINGS
// may read it too (RS Rating's rating label is written in `textcolor = colorRS`). So a moved line
// colour must reach the run as that input, or the label keeps the author's blue beside a red line.
// The link: the host plot's key -> the run's output index (`ro.outputs`) -> the output call at that
// index in the source -> its `color = <name>` argument, when <name> is one of the script's literal
// colour inputs. ⛔ Accepted only when both sides state the SAME default colour; anything else is no
// link, and a moved colour without one still refuses the run half by name.
const OUTPUT_ORDER = new Set(['plot', 'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar', 'fill',
  'bgcolor', 'barcolor', 'hline'])
const _colourArgMemo = new Map()

/** Per output call in source order, the bare name its `color` argument reads (or null). */
function outputColourNames(source) {
  const src = String(source || '')
  if (_colourArgMemo.has(src)) return _colourArgMemo.get(src)
  const out = []
  try {
    const lexed = lexPine(src)
    const visit = (list) => {
      for (const st of list || []) {
        const toks = st.header || []
        for (let i = 0; i < toks.length; i++) {
          const t = toks[i]
          if (!t || t.kind !== 'ident' || !OUTPUT_ORDER.has(t.value) || !isPunct(toks[i + 1], '(')) continue
          if (i > 0 && isPunct(toks[i - 1], '.')) continue
          // the call's own argument tokens, to its matching close paren
          let depth = 0
          let j = i + 1
          const args = []
          for (; j < toks.length; j++) {
            if (isPunct(toks[j], '(') || isPunct(toks[j], '[')) depth += 1
            else if (isPunct(toks[j], ')') || isPunct(toks[j], ']')) { depth -= 1; if (depth === 0) break }
            if (depth >= 1 && j > i + 1) args.push(toks[j])
          }
          let name = null
          for (let k = 0; k + 2 < args.length; k++) {
            if (args[k].kind === 'ident' && args[k].value === 'color' && isPunct(args[k + 1], '=')
              && args[k + 2].kind === 'ident' && (isPunct(args[k + 3], ',') || k + 3 >= args.length)) {
              name = String(args[k + 2].value)
            }
          }
          out.push(name)
          break   // one output call per statement
        }
        if (st.sub && st.sub.length) visit(st.sub)
      }
    }
    visit(blockStatements(lexed.tokens, lexed.indents, 0))
  } catch {
    _colourArgMemo.set(src, [])
    return []
  }
  _colourArgMemo.set(src, out)
  return out
}

/** `{hostKey: pineColourInputName}` for every host colour setting linked to a script colour input. */
export function hostColourLinks(def) {
  const ro = runHalfOfDef(def)
  if (!ro || !isObj(ro.outputs)) return {}
  const rt = new Map(rtSpecsOf(ro.source).filter((s) => s.type === 'color').map((s) => [s.key, s]))
  const names = outputColourNames(ro.source)
  const links = {}
  for (const spec of Array.isArray(def.inputs) ? def.inputs : []) {
    if (!spec || spec.type !== 'color' || spec.fromRunHalf || rt.has(spec.key)) continue
    // a stored plot names its colour setting as `$<key>`; an installed one resolves it and keeps the
    // reference in `$refs.color`
    const plot = (def.plots || []).find((p) => p && (p.color === `$${spec.key}`
      || (p.$refs && p.$refs.color === spec.key)))
    const index = plot ? ro.outputs[plot.key] : undefined
    const name = Number.isInteger(index) ? names[index] : null
    const pine = name ? rt.get(name) : null
    if (pine && typeof spec.default === 'string' && typeof pine.default === 'string'
      && pine.default.toUpperCase() === spec.default.toUpperCase()) links[spec.key] = name
  }
  return links
}

/**
 * The instance's values in the run's vocabulary (Pine names): `{ok: true, values, moved}` with
 * `moved` the Pine names off their defaults, or `{ok: false, key}` naming the first moved
 * setting the run cannot be handed.
 */
export function runHalfRunInputs(def, inputs) {
  const values = {}
  const moved = []
  if (!isObj(inputs)) return { ok: true, values, moved, needsEvidence: [] }
  const manifest = isObj(def && def.compute && def.compute.paramManifest) ? def.compute.paramManifest : {}
  const ro = runHalfOfDef(def)
  const rtSpecs = ro ? rtSpecsOf(ro.source) : []
  const pineNames = new Set(rtSpecs.map((s) => s.key))
  for (const spec of Array.isArray(def && def.inputs) ? def.inputs : []) {
    if (!spec || typeof spec.key !== 'string' || !Object.prototype.hasOwnProperty.call(inputs, spec.key)) continue
    const v = inputs[spec.key]
    if (v === undefined || Object.is(v, spec.default)) continue
    if (spec.type === 'color' && typeof v === 'string' && typeof spec.default === 'string'
      && v.toUpperCase() === spec.default.toUpperCase()) continue
    let name = null
    if (spec.fromParam) {
      const e = manifest[spec.fromParam]
      name = e && typeof e.sourceName === 'string' ? e.sourceName : null
    } else if (spec.fromRunHalf || pineNames.has(spec.key)) {
      name = spec.key
    } else if (STYLE_ONLY.test(spec.key)) {
      continue
    } else if (spec.type === 'color') {
      name = hostColourLinks(def)[spec.key] || null   // a plot's colour is the script's colour input
    }
    if (!name || !pineNames.has(name)) return { ok: false, key: spec.key, label: spec.label || spec.key }
    // a switch the host keeps as 1 / 0 is a Pine bool
    const want = rtSpecs.find((s) => s.key === name)
    values[name] = want && want.type === 'bool' && (v === 0 || v === 1) ? v === 1 : v
    moved.push(name)
  }
  // the moved settings a drawing can read: only these need evidence of their own
  const drawing = ro && moved.length ? drawingReadNames(ro.source) : null
  const needsEvidence = moved.filter((n) => !drawing || drawing.has(n))
  return { ok: true, values, moved, needsEvidence }
}

/** ⛔ Has the member moved a setting only the run half reads? Then the HOST object program (which
 *  folded that setting at its default) cannot draw this chart's drawings: `objectReaderFor` reads
 *  nothing, so only the run's drawings (served on evidence) or none are drawn, never the
 *  author's-default drawings beside a chart set otherwise. */
export function runHalfOnlySettingMoved(def, inputs) {
  if (!isObj(inputs) || !Array.isArray(def && def.inputs)) return false
  for (const s of def.inputs) {
    if (!s || !s.fromRunHalf || !Object.prototype.hasOwnProperty.call(inputs, s.key)) continue
    const v = inputs[s.key]
    if (v !== undefined && !Object.is(v, s.default)) return true
  }
  return false
}

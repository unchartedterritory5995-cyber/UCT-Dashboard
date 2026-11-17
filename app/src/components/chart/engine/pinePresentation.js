// app/src/components/chart/engine/pinePresentation.js
//
// ─── ⭐⭐ A PINE SCRIPT'S SETTINGS, LAID OUT THE WAY TRADINGVIEW LAYS THEM OUT ─────────────────────
//
// TradingView's Inputs tab shows a script's inputs IN SOURCE ORDER, under the headers its `group = …`
// arguments name, side by side where they share an `inline = …`, with the `tooltip = …` beside each, and
// titled by `title = …`. Our member document reaches the settings form as the translator declared it:
// style inputs first, host inputs in the translator's order, folded lengths and the run half's settings
// appended, no groups, no tooltips, a v4 `input(false, …)` switch as a 0/1 number, a plot colour on the
// Style tab although it is one of the script's inputs, and an untitled plot's style keys labelled with its
// column key ("out2 colour"). Measured on RS Rating (2026-11-17) against its TradingView capture.
//
// ⭐ READ-ONLY, AT FORM TIME. Everything here is derived from the INSTALLED document and its own Pine source
// when the settings form is built (`indicatorRegistry.fieldsFromDefinition` / `fieldsForInstance`); the
// stored document is never touched, so nothing is saved back and every lane computes exactly as before.
//   * a setting that stands for a Pine input (keyed by its Pine name; a folded length by
//     `paramManifest[…].sourceName`; a plot colour by `runHalfInputs.hostColourLinks`) takes that input's
//     source position, `group`, `inline` and `tooltip` (a setting's own declared ones win);
//   * a plot colour that IS the script's colour input is titled as the script titles it and shown on the
//     Inputs tab (`onInputs`); an untitled plot's own style keys are labelled from what the plot draws;
//   * a 0/1 number that is a Pine `bool` is a switch writing 1 / 0 (`switches`).

import { lexPine, blockStatements, findTop, isPunct, boundName, parseWholeExpression } from './ast/pine.js'
import { hostColourLinks } from './runHalfInputs.js'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const INPUT_CALL = (v) => v === 'input' || (typeof v === 'string' && v.startsWith('input.'))

/** The Pine source a member document carries (its run half's, or a runtime document's own), or null. */
export function pineSourceOf(def) {
  const c = def && def.compute
  if (!c) return null
  if (c.runtimeObjects && typeof c.runtimeObjects.source === 'string') return c.runtimeObjects.source
  if (c.kind === 'runtime' && typeof c.source === 'string') return c.source
  return null
}

const _declMemo = new Map()

/** Every `name = input*(…)` declaration in source order: `{name, index, title, group, inline, tooltip, kind}`
 *  (`kind` 'bool' for `input.bool` or a plain `input(true|false, …)`). [] when the source does not lex. */
export function pineInputDeclarations(source) {
  const src = String(source || '')
  if (_declMemo.has(src)) return _declMemo.get(src)
  const out = []
  try {
    const lexed = lexPine(src)
    const visit = (list) => {
      for (const st of list || []) {
        const toks = st.header || []
        const eq = findTop(toks, (t) => isPunct(t, '='))
        const nameTok = eq > 0 ? boundName(toks, eq) : null
        if (nameTok && toks[eq + 1] && toks[eq + 1].kind === 'ident' && INPUT_CALL(toks[eq + 1].value) && isPunct(toks[eq + 2], '(')) {
          let node = null
          try { node = parseWholeExpression(toks.slice(eq + 1)) } catch { node = null }
          if (node && node.type === 'call' && INPUT_CALL(node.name)) {
            const args = node.args || []
            const named = (n) => { const a = args.find((x) => x && x.name === n); return a ? a.value : undefined }
            const positional = args.filter((x) => x && !x.name)
            const str = (v) => (v && v.type === 'string' ? String(v.value) : null)
            const title = str(named('title')) ?? str(positional[1] && positional[1].value)
            const first = toks[eq + 3]
            const kind = node.name === 'input.bool' || (node.name === 'input' && first && first.kind === 'ident'
              && (first.value === 'true' || first.value === 'false')) ? 'bool' : null
            out.push({ name: String(nameTok.value), index: out.length, title, group: str(named('group')),
              inline: str(named('inline')), tooltip: str(named('tooltip')), kind })
          }
        }
        if (st.sub && st.sub.length) visit(st.sub)
      }
    }
    visit(blockStatements(lexed.tokens, lexed.indents, 0))
  } catch {
    _declMemo.set(src, [])
    return []
  }
  _declMemo.set(src, out)
  return out
}

const COLUMN_LABEL = /^out\d+$/
/** The member door's generic labels for a plot's own style keys. */
const GENERIC_STYLE_LABEL = /^(Line width|Color|Colour)$/
const EMPTY = Object.freeze({ onInputs: new Set(), switches: new Set(), order: new Map(), extra: new Map() })
const _presMemo = new WeakMap()
const _plotTitleMemo = new WeakMap()

/** The input key a plot's `color` / `width` reads, from `$refs` or a `$key` value. */
const refOf = (p, field) => (p && p.$refs && typeof p.$refs[field] === 'string' ? p.$refs[field]
  : p && typeof p[field] === 'string' && p[field].startsWith('$') ? p[field].slice(1) : null)

/** ONE plot's OWN title: its label, never a column key `outN`, never the import's stand-in (below); else
 *  null, an untitled plot. */
function ownTitleOfPlot(p, standIn = null) {
  return p && typeof p.label === 'string' && p.label && !COLUMN_LABEL.test(p.label)
    && !(standIn && standIn(p.label)) ? p.label : null
}

/** ONE plot's name: its own title (`ownTitleOfPlot`), else the group of the script colour it draws in,
 *  else TradingView's `Plot`. */
function titleOfPlot(p, links, byName, standIn = null) {
  const colourKey = refOf(p, 'color')
  const linked = colourKey && links[colourKey] ? byName.get(links[colourKey]) : null
  const own = ownTitleOfPlot(p, standIn)
  return own || (linked && linked.group) || 'Plot'
}

const PLOT_CALL = /\bplot(?:shape|char|arrow|candle|bar)?\s*\(/
const STRING_LIT = /(["'])((?:\\.|(?!\1).)*)\1/g
/**
 * ⭐ THE IMPORT'S STAND-IN: an untitled first plot is labelled with the INDICATOR's name when a Pine
 * script is imported, which is not a title the script gave it (TradingView's Style tab calls it `Plot`).
 * A label is that stand-in when it is the document's name and no `plot*(…)` line of the source writes it
 * as a string. Null for a document with no Pine source: an author's document, and ⚠️ a Pine import that
 * kept only its formula (no run half), where nothing can tell the stand-in from a title equal to the name,
 * so the label is kept (it names the plot, it is never a column key).
 */
function importStandIn(def) {
  const src = pineSourceOf(def)
  const meta = isObj(def) && isObj(def.meta) ? def.meta : {}
  const name = typeof meta.name === 'string' && meta.name ? meta.name
    : isObj(def) && typeof def.name === 'string' ? def.name : null
  if (!src || !name) return null
  const written = new Set()
  for (const line of String(src).split('\n')) {
    if (!PLOT_CALL.test(line)) continue
    for (const m of line.matchAll(STRING_LIT)) written.add(m[2])
  }
  return (label) => label === name && !written.has(label)
}

/**
 * ⭐⭐ A PLOT'S NAME ON THE SETTINGS FORM, plot key -> name, by the rule its own style settings are
 * named by (`pineFieldPresentation`'s `<name> colour` / `<name> width`): its own title, else the group
 * of the script colour it draws in, else `Plot`, which is what TradingView's Style tab calls an untitled
 * plot. ⚰️ The host's plot-style row printed the column key instead ("out2 style"). Memoised per
 * document; a document with no Pine source has no colour links, so it reads title-or-`Plot`.
 */
export function plotTitlesOf(def) {
  if (!isObj(def)) return new Map()
  if (_plotTitleMemo.has(def)) return _plotTitleMemo.get(def)
  const decls = Array.isArray(def.inputs) ? pineInputDeclarations(pineSourceOf(def)) : []
  const byName = new Map(decls.map((d) => [d.name, d]))
  let links = {}
  if (decls.length) { try { links = hostColourLinks(def) } catch { links = {} } }
  const standIn = importStandIn(def)
  const out = new Map()
  for (const p of (Array.isArray(def.plots) ? def.plots : [])) {
    if (isObj(p) && typeof p.key === 'string') out.set(p.key, titleOfPlot(p, links, byName, standIn))
  }
  _plotTitleMemo.set(def, out)
  return out
}

/**
 * ⭐ HEADLESS (Studio R6) — each plot's OWN title, plot key -> title or null, by the same rule
 * `plotTitlesOf` names a titled plot by (`ownTitleOfPlot`): what a headless output carries as its
 * `title` (`headlessCompute.js`), where an untitled plot is `null`, never the form's stand-in (a
 * colour group, or `Plot`). ⚠️ A Pine import that kept no script cannot tell the import's stand-in from
 * a title equal to its name (`importStandIn`), so that label is kept, as the form keeps it.
 */
export function plotOwnTitlesOf(def) {
  const out = new Map()
  if (!isObj(def)) return out
  const standIn = importStandIn(def)
  for (const p of (Array.isArray(def.plots) ? def.plots : [])) {
    if (isObj(p) && typeof p.key === 'string') out.set(p.key, ownTitleOfPlot(p, standIn))
  }
  return out
}

/**
 * What the settings FORM shows for a Pine document, read off the (installed) document, memoised per document:
 *   `order`    key -> the Pine input's source position (a setting no input stands for has none);
 *   `extra`    key -> `{group, inline, tooltip, label}` the form uses where the setting declares none
 *              (`label` only where the stored one is a column key or a generic style label);
 *   `onInputs` a plot colour that IS the script's colour input: shown on the Inputs tab;
 *   `switches` a 0/1 number whose Pine input is a `bool`: a switch writing 1 / 0.
 * Empty for any document that carries no Pine source.
 */
export function pineFieldPresentation(def) {
  if (!isObj(def) || !Array.isArray(def.inputs)) return EMPTY
  if (_presMemo.has(def)) return _presMemo.get(def)
  const decls = pineInputDeclarations(pineSourceOf(def))
  if (!decls.length) { _presMemo.set(def, EMPTY); return EMPTY }
  const byName = new Map(decls.map((d) => [d.name, d]))
  const manifest = def.compute && isObj(def.compute.paramManifest) ? def.compute.paramManifest : {}
  let links = {}
  try { links = hostColourLinks(def) } catch { links = {} }
  const onInputs = new Set(Object.keys(links))
  const switches = new Set()
  const order = new Map()
  const extra = new Map()
  // an untitled plot's own style keys: titled from the group of the script colour that plot draws in
  const plotTitle = new Map()
  const standIn = importStandIn(def)
  for (const p of (Array.isArray(def.plots) ? def.plots : [])) {
    const title = titleOfPlot(p, links, byName, standIn)
    for (const field of ['color', 'width']) {
      const k = refOf(p, field)
      if (k) plotTitle.set(k, { title, field })
    }
  }
  for (const spec of def.inputs) {
    if (!isObj(spec) || typeof spec.key !== 'string') continue
    const e = spec.fromParam ? manifest[spec.fromParam] : null
    const name = spec.fromParam ? (e && typeof e.sourceName === 'string' ? e.sourceName : null)
      : byName.has(spec.key) ? spec.key : (links[spec.key] || null)
    const d = name ? byName.get(name) : null
    const label = String(spec.label || '')
    if (d) {
      order.set(spec.key, d.index)
      extra.set(spec.key, { group: d.group, inline: d.inline, tooltip: d.tooltip,
        label: links[spec.key] && d.title ? d.title : null })
      if (d.kind === 'bool' && (spec.type === 'int' || spec.type === 'float')) switches.add(spec.key)
    } else if (plotTitle.has(spec.key) && (COLUMN_LABEL.test(label.split(' ')[0]) || GENERIC_STYLE_LABEL.test(label))) {
      const { title, field } = plotTitle.get(spec.key)
      extra.set(spec.key, { label: field === 'color' ? `${title} colour` : `${title} width` })
    }
  }
  const out = { onInputs, switches, order, extra }
  _presMemo.set(def, out)
  return out
}

/** Fields in the form's order: those standing for a Pine input in source order, every other in its own
 *  relative order after them (a stable sort; a document without a Pine source is returned as given). */
export function inPineOrder(fields, presentation) {
  if (!presentation || !presentation.order.size) return fields
  return fields.map((f, at) => ({ f, at, o: presentation.order.has(f.key) ? presentation.order.get(f.key) : Infinity }))
    .sort((a, b) => (a.o - b.o) || (a.at - b.at)).map((x) => x.f)
}

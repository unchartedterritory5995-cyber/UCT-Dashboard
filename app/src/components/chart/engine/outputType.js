// app/src/components/chart/engine/outputType.js
//
// ─── ⭐⭐ P1 — WHAT KIND OF THING EACH OUTPUT OF A DEFINITION IS: ONE AUTHORITY ──
//
// ONE definition → TYPED OUTPUTS → MANY SAFE CONSUMERS. This module is the ONE
// place an output's TYPE is decided, and it decides it from the only thing that
// can carry it honestly: the output's own tree (or, for a shipped native, the
// registry definition's own declaration). It is DERIVED, never stored, never
// read from a client, an authoring intent, an import label, an AI claim or any
// saved UI metadata — none of those are inputs to these functions.
//
// THE TAXONOMY (P1-DESIGN.md §2) — only the types the engine genuinely produces:
//
//   SERIES     one number per bar. Any tree whose manifest `yields` settles to
//              `num` (`sentence.js::yieldsOf`, the one `yields` resolver), and
//              every data plot of a shipped native / server definition.
//   CONDITION  one {1, 0, unknown} per bar: a tree whose `yields` settles to
//              `bool` — a comparison, `&&`/`||`/`!`, a bool function
//              (`crossOver`, `rising`…), a bool clock leaf, a `?:` whose arms
//              are both bool, or the literal 0/1 (the manifest's own rule).
//              A plot drawn with `style: 'markers'` is STILL a CONDITION (or a
//              SERIES): a marker is presentation of a column, not a type.
//   EVENTS     a native's declared `events[]` column — `{0, 1, NaN}`, "it
//              happened on this bar", domain-checked at registration
//              (`nativeRegistry.validateEventColumns`). An `ast` document cannot
//              declare one (its events are refused at that same door), so a
//              user formula never types EVENTS.
//   SCALAR     a value with NO bar history: any tree that reads a manifest
//              `scalars` entry (`market_cap`, `rs_rank`, … — 137 names, one
//              number per symbol from the nightly snapshot), found by the same
//              walk `chartScalars.js` refuses with (`freshness.scalarsIn`). It
//              carries the `yields` it would have (`market_cap > 1e9` is a
//              current-only yes/no) but it is NEVER a SERIES or a CONDITION:
//              there is no per-bar column to have.
//
//   null       no type can be derived: a runtime (bar-by-bar Pine VM) output,
//              whose value is the VM's and not a tree's; a guide (`hlines`);
//              an undeclared key. Consumers that need a type refuse a null
//              one (`evaluability.js`); the chart still draws what it draws.
//
// ⛔ PER OUTPUT, NEVER PLOT 1. A multi-tree document types every plot from its
// OWN tree (`compute.trees[key]`); a single-tree document types its one data
// plot from `compute.ast`. There is no `authoredResult` and no "the" type of a
// definition.

import { yieldsOf, SENTENCE_RULES } from './ast/sentence.js'
import { scalarsIn } from './ast/freshness'

export const OUTPUT_TYPES = Object.freeze({
  SERIES: 'series',
  CONDITION: 'condition',
  EVENTS: 'events',
  SCALAR: 'scalar',
})

/** Why an output carries no type (`type: null`). */
export const UNTYPED = Object.freeze({
  RUNTIME: 'untyped:runtime-output',
  GUIDE: 'untyped:guide',
  UNDECLARED: 'untyped:undeclared-output',
  NO_TREE: 'untyped:no-tree',
  SHAPE: 'untyped:single-tree-shape',
})

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/** The type of ONE TREE: `{type, yields, scalars}`. `scalars` is the sorted list
 *  of current-only scalar names it reads (empty for any history-bearing tree). */
export function treeOutputType(tree) {
  const yields = yieldsOf(tree, SENTENCE_RULES) === 'bool' ? 'bool' : 'num'
  const scalars = [...scalarsIn(tree)].sort()
  if (scalars.length) return { type: OUTPUT_TYPES.SCALAR, yields, scalars }
  return { type: yields === 'bool' ? OUTPUT_TYPES.CONDITION : OUTPUT_TYPES.SERIES, yields, scalars }
}

/** The data plots a definition declares (guides excluded) — the same read
 *  `nativeRegistry.astPlotKey` computes columns from. */
function dataPlotKeys(def) {
  const plots = Array.isArray(def && def.plots) ? def.plots : []
  return plots.filter((p) => p && p.style !== 'hlines' && typeof p.key === 'string').map((p) => p.key)
}

/** The tree an `ast` output is computed from, or undefined. Same branch as
 *  `nativeRegistry.astTrees` / `astColumnsUnstopped`. */
export function outputTreeOf(def, key) {
  const compute = (def && def.compute) || {}
  if (isObj(compute.trees)) return own(compute.trees, key) ? compute.trees[key] : undefined
  const keys = dataPlotKeys(def)
  return keys.length === 1 && keys[0] === key ? compute.ast : undefined
}

function untyped(key, why, origin) {
  return Object.freeze({ key, type: null, yields: null, scalars: Object.freeze([]), origin, untyped: why })
}

/**
 * ⭐⭐ THE ONE AUTHORITY: the type of output `key` of `def`.
 *
 * @returns {{key, type: string|null, yields: 'num'|'bool'|null, scalars: string[],
 *   origin: 'tree'|'native-plot'|'native-event'|'runtime'|'guide'|'none', untyped?: string}}
 */
export function outputTypeOf(def, key) {
  const compute = (def && def.compute) || {}
  const plots = Array.isArray(def && def.plots) ? def.plots : []
  const plot = plots.find((p) => p && p.key === key)
  const events = Array.isArray(def && def.events) ? def.events : []
  if (plot && plot.style === 'hlines') return untyped(key, UNTYPED.GUIDE, 'guide')
  if (compute.kind === 'ast') {
    if (!plot) return untyped(key, UNTYPED.UNDECLARED, 'none')
    if (!isObj(compute.trees) && dataPlotKeys(def).length !== 1) return untyped(key, UNTYPED.SHAPE, 'none')
    const tree = outputTreeOf(def, key)
    if (!tree || typeof tree !== 'object') return untyped(key, UNTYPED.NO_TREE, 'none')
    const t = treeOutputType(tree)
    return Object.freeze({ key, type: t.type, yields: t.yields, scalars: Object.freeze(t.scalars), origin: 'tree' })
  }
  if (compute.kind === 'runtime') {
    return untyped(key, plot || own(compute.outputs || {}, key) ? UNTYPED.RUNTIME : UNTYPED.UNDECLARED,
      plot ? 'runtime' : 'none')
  }
  // `native` / `server` (and any kind that names a compute handle): the
  // registry definition's own declaration is the type — a data plot is a
  // number per bar, a declared event a {0, 1, NaN} column.
  if (plot) return Object.freeze({ key, type: OUTPUT_TYPES.SERIES, yields: 'num', scalars: Object.freeze([]), origin: 'native-plot' })
  if (events.some((e) => e && e.key === key)) {
    return Object.freeze({ key, type: OUTPUT_TYPES.EVENTS, yields: 'bool', scalars: Object.freeze([]), origin: 'native-event' })
  }
  return untyped(key, UNTYPED.UNDECLARED, 'none')
}

/** Every output of `def`, each typed on its own: data plots in declaration
 *  order, then declared events. Guides are not outputs and are omitted. */
export function outputsOf(def) {
  const keys = dataPlotKeys(def)
  const events = (Array.isArray(def && def.events) ? def.events : [])
    .filter((e) => e && typeof e.key === 'string').map((e) => e.key)
  return [...keys, ...events.filter((k) => !keys.includes(k))].map((k) => outputTypeOf(def, k))
}

/** Is this a truth-valued output (one a signal can be)? CONDITION or EVENTS only:
 *  ⛔ a SERIES never becomes a signal without an explicit conversion rule, and a
 *  SCALAR has no bars to be true on. */
export function isTruthType(type) {
  return type === OUTPUT_TYPES.CONDITION || type === OUTPUT_TYPES.EVENTS
}

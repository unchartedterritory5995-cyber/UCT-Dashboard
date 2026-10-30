// app/src/components/chart/engine/memberDocumentMigration.js
//
// ─── ⭐⭐ A SAVED MEMBER DOCUMENT GETS TODAY'S BEHAVIOUR ON LOAD ─────────────
//
// Applied where every document enters a chart — `nativeRegistry.validateUserDefinitions`
// — as a PURE, DETERMINISTIC, IDEMPOTENT repair of the document in hand (member data
// is never rewritten server-side). It repairs exactly two defects, the ones a
// document's own bytes PROVE:
//
//   ⚰️ A STALE HANDLE. `applyParamEdit` used to rewrite the scan tree and leave
//   `compute.fn` at the UNEDITED tree's hash, which `defSchema` refuses — the edited
//   document could not install. The handle is set back to the hash of the tree the
//   document holds, ONLY for a param-edited `ast` document whose trees are otherwise
//   self-consistent (`treesHash`). A handle that disagrees for any other reason is
//   still refused, by `defSchema`.
//
//   ⚰️ A WIDTH CONTROL THAT STOPS AT 4. Until #526 every plot's width control was
//   minted `{type: 'int', min: 1, max: 4, step: 1}` — the Builder's own constant
//   (`builderInputs.chromeInputsFor`), never an author's or a member's choice: the
//   control is CHROME, its key is reserved (a member input with that key is refused
//   as a duplicate, and the Pine door folds a colliding script input back to its
//   literal), and every door re-mints it from the constant on every save. TradingView
//   paints a Pine `linewidth` 1..10 unclamped (set F), so today's control reaches
//   `widthControlMax(default)` (10, or the row's own width when larger), and the
//   settings dialog clamped an old document's member at "Maximum is 4". The max is
//   raised ONLY on an input a plot's `width` names (`$key`) whose key is that
//   plot's chrome key (`lineWidth` / `<plotKey>Width`) and whose spec is exactly
//   the old constant. ⛔ The DEFAULT (the author's / member's width) is never
//   touched, nor any member instance value (those live on the instance), nor any
//   other input — a member's own `input.int(…, maxval = 4)` keeps its 4.
//
// ⛔⛔ WHAT A SAVED DOCUMENT CANNOT PROVE, AND SO IS NOT CLAIMED (#513 / #526; the
// full table is in `tests/fixtures/saved_document_upgrade_cases.json`'s `_about`):
//   • a band's `fillOpacity` the old door TRUNCATED (`color.new(c, 87.5)` stored as
//     0.13) is byte-identical to an author's `color.new(c, 87)`;
//   • a static band stored with NO `fillOpacity` drew at 0.15; today's door states
//     1 (v5/v6) or 0.1 (v1–v4). The document does not carry the Pine version
//     (`meta.naConditionFalse` says only ">= 4", and only since 2026-10-02), and an
//     authoring `set_fill` with no opacity writes the very same shape;
//   • a row width (absent before #513, clamped to 4 from #513 to #526) is the
//     author's `linewidth` or a clamp of a larger one — the source is not stored;
//   • a positional v4 `fill(p1, p2, color.red)` colour was never stored at all.
//
// ⛔⛔ IT DOES NOT PLACE PARAMETERS IN CONDITION COLUMNS, AND CANNOT. Round 2 did, by
// matching call shape, and claimed constants the author hard-coded: in
// `len = input.int(21)` beside a colour rule's literal `ta.ema(close, 21)`, the 21 was
// given to `len`, so an edit rewrote the colour. A saved document does not carry
// the Pine source or the translator's tags, and the old door never moved a condition
// column, so in an old document:
//   • a column literal at the parameter's DEFAULT is byte-identical whether it came
//     from the parameter or was typed by the author — unprovable, skipped;
//   • a column literal at the CURRENT (edited, non-default) value can only have been
//     typed by the author — provably NOT the parameter, skipped.
// Nothing is provable, so nothing is claimed. A document gets today's placements when
// it is next built from its source through the door, which places only TAGGED
// literals (`memberPaneDefinition.noGuess.test.js`).
//
// ⛔ A document that needs nothing comes back as the SAME object, and the answer is
// memoised per document object (a pane rebuild calls this on every keystroke).

import { astHash } from './ast/parse.js'
import { treesHash } from './ast/trees.js'
import { widthControlMax } from '../builder/builderInputs.js'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function migrateStaleHandle(def) {
  const c = def.compute
  if (!c || c.kind !== 'ast' || !isObj(c.paramManifest) || typeof c.fn !== 'string' || !c.ast) return def
  let now
  try { now = astHash(c.ast) } catch { return def }
  if (now === c.fn) return def
  // ⛔ only a self-consistent document: its trees still hash to its `treesHash`
  if (isObj(c.trees)) {
    try { if (typeof c.treesHash === 'string' && treesHash(c.trees) !== c.treesHash) return def } catch { return def }
  }
  return { ...def, compute: { ...c, fn: now } }
}

/** The width control every door minted before #526 — the Builder's constant. */
export const OLD_WIDTH_CONTROL = Object.freeze({ type: 'int', min: 1, max: 4, step: 1 })

const isOldWidthControl = (spec) => isObj(spec) && spec.type === OLD_WIDTH_CONTROL.type
  && spec.min === OLD_WIDTH_CONTROL.min && spec.max === OLD_WIDTH_CONTROL.max
  && spec.step === OLD_WIDTH_CONTROL.step

/** The input keys a plot's width control may carry: row 0's `lineWidth`, or
 *  `<plotKey>Width` (`builderInputs.chromeInputKeys`). */
const isChromeWidthKey = (plot, key) => key === 'lineWidth'
  || (typeof plot.key === 'string' && plot.key !== '' && key === `${plot.key}Width`)

function migrateWidthControlMax(def) {
  if (!Array.isArray(def.inputs) || !Array.isArray(def.plots)) return def
  const keys = new Set()
  for (const p of def.plots) {
    if (!isObj(p) || typeof p.width !== 'string' || p.width[0] !== '$') continue
    const key = p.width.slice(1)
    if (isChromeWidthKey(p, key)) keys.add(key)
  }
  if (!keys.size) return def
  let inputs = null
  def.inputs.forEach((spec, i) => {
    if (!isObj(spec) || !keys.has(spec.key) || !isOldWidthControl(spec)) return
    if (!inputs) inputs = def.inputs.slice()
    inputs[i] = { ...spec, max: widthControlMax(spec.default) }
  })
  return inputs ? { ...def, inputs } : def
}

const memo = new WeakMap()

/** One saved document → the same document with today's behaviour. Pure; memoised
 *  per document object (documents are treated as immutable everywhere they flow). */
export function migrateMemberDocument(def) {
  if (!isObj(def)) return def
  const hit = memo.get(def)
  if (hit) return hit
  // ⭐ the cheap identity path for the handle: only a param-edited `ast` document
  const c = def.compute
  const handle = (c && c.kind === 'ast' && isObj(c.paramManifest) && typeof c.fn === 'string')
    ? migrateStaleHandle(def) : def
  const out = migrateWidthControlMax(handle)
  memo.set(def, out)
  if (out !== def) memo.set(out, out)
  return out
}

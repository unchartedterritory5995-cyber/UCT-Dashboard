// app/src/components/chart/builder/pineParamManifest.js
//
// ─── PINE INPUT METADATA → `compute.paramManifest` (TRACK F, DEC-006) ───────
//
// ⭐⭐ THE SEAM: `pine.js` records raw facts (per-declaration immutable
// metadata in `translatePine(...).inputParams`, and a non-enumerable
// `__uctParamId` tag on whichever literal node its fold actually returns);
// THIS module turns those raw facts into the `{treeIndex, astPath}` locator
// shape `api/services/param_manifest.py` expects on a save. Same layering
// `builderInputs.js` already uses for `usedInputs`/`inputsFolded` — the
// translator never knows about "trees" or "which outputs a caller kept",
// and this module never re-derives what `pine.js` already decided (which
// kind is eligible, what the default/min/max/step are).
//
// ⛔ NOT IMPORTED BY `pine.js`, and importing `pine.js` here is fine (unlike
// `builderInputs.js`, which injects `translate` to avoid a reverse edge from
// the ENGINE layer into the BUILDER layer) — this module already sits in
// `builder/`, so reading `pine.js`'s output is the same direction every
// other file here already depends in. It does not import `pine.js` itself,
// only operate on values a caller already produced by calling it.
//
// ⛔ AN ENTRY WITH NOWHERE TO POINT IS NEVER ADVERTISED. If every occurrence
// of an eligible input folded into a larger expression (`len * 2`) or lived
// only in a refused/hidden output the caller did not keep, its manifest
// entry is dropped entirely — never shown stuck at `detached` forever.
// `builderInputs.js`'s parallel door calls this the same way: "skipped, with
// a reason", never "offered as a control that doesn't work".
//
// ⭐ VERIFIED, NOT ASSUMED: THE TAG SURVIVES ARITHMETIC WRAPPING. This
// translator does not constant-fold pure-literal sub-expressions —
// `length * 2` stays `{type:'op', name:'*', args:[<tagged 14>, 2]}`, never
// collapsing to a bare `28` — so `resolveInput`'s tagged node keeps its
// identity through `close + length * 2` just as it does through a bare
// `sma(close, length)`. Confirmed by direct probe before writing this
// module: the inner literal carries `__uctParamId` and the wrapping `op`
// node does not. This is why `collectParamLocators` is a plain, untargeted
// recursive walk rather than a "only look at direct call arguments" one —
// the tag can be arbitrarily nested and is still found correctly.
//
// ⚠️ THE TAG CAN STILL BE LOST, always safely. A handful of existing folds
// build a genuinely NEW node discarding whatever fed it — e.g.
// `foldLogicalIdentity`'s boolean-identity collapse (`len > 0 || true` →
// a fresh `cNum(1)`, `len` gone) — and any such loss is silent and SAFE:
// the worst case is one fewer occurrence offered as adjustable, never an
// incorrect computed value, because nothing here ever puts an identifier
// where a literal was (contrast `builderInputs.js`'s own `declareInputs`
// mechanism, whose header calls the equivalent shape "the half-applied
// trap" for exactly that reason — that door risks a MIXED, wrong computed
// value; this one only ever risks under-offering a control).

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Every `astPath` (list of string keys / numeric indices from the tree
 *  root) where `id` survived inside one already-built tree, appended to
 *  `out`. Pure JSON walk — `__uctParamId` is non-enumerable so `Object.
 *  keys()` never sees it as something to recurse INTO, but direct property
 *  access still reads it, exactly the `declared`-leaf idiom `pine.js` already
 *  documents for `inputName`/`inputDefault`. */
function collectParamLocators(root, id, path, out) {
  if (Array.isArray(root)) {
    root.forEach((child, i) => collectParamLocators(child, id, [...path, i], out))
    return
  }
  if (!isPlainObject(root)) return
  if (root.__uctParamId === id) out.push([...path])
  for (const key of Object.keys(root)) {
    collectParamLocators(root[key], id, [...path, key], out)
  }
}

/**
 * `translatePine({ paramManifest: true }).inputParams` (per-declaration
 * IMMUTABLE metadata only, no locators — see that function's own comment on
 * why) + the trees a caller actually decided to KEEP as saved output →
 * the final `compute.paramManifest` shape.
 *
 * @param {Array} inputParams `translatePine(...).inputParams`.
 * @param {Array<{treeIndex: string|null, ast: object}>} trees the outputs
 *        the CALLER is about to save, each paired with the `treeIndex` key
 *        it will occupy in `compute.trees` (`null` for a single-tree v1
 *        document's own `compute.ast`). Deliberately NOT `translatePine`'s
 *        raw `outputs[]` — a refused or hidden output is never saved, and an
 *        astPath into it would point at a tree nobody submits.
 * @returns {object} `compute.paramManifest`-shaped, `{}` if nothing eligible
 *        survived into any kept tree.
 */
export function buildParamManifest(inputParams, trees) {
  const manifest = {}
  const keep = Array.isArray(trees) ? trees : []
  for (const p of (Array.isArray(inputParams) ? inputParams : [])) {
    const locators = []
    for (const t of keep) {
      if (!t || !t.ast) continue
      const found = []
      collectParamLocators(t.ast, p.id, [], found)
      for (const astPath of found) locators.push({ treeIndex: t.treeIndex, astPath })
    }
    if (locators.length === 0) continue
    manifest[p.id] = {
      sourceName: p.sourceName,
      title: p.title,
      type: p.type,
      default: p.default,
      min: p.min,
      max: p.max,
      step: p.step,
      options: p.options,
      locators,
    }
  }
  return manifest
}

/** Exported for `pine.paramManifest.test.js` only — asserting the exact
 *  astPath shape a given tag lands at, without going through a whole
 *  `buildParamManifest` call. Not part of the module's real API surface. */
export { collectParamLocators as __collectParamLocatorsForTest }

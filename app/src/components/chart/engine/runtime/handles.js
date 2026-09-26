// app/src/components/chart/engine/runtime/handles.js
//
// ─── ⭐⭐ A DRAWING HANDLE IS A VALUE THIS LANE CARRIES AND CANNOT READ ──────
//
// ⛔⛔ THE VALUE RUNTIME STILL DOES NOT DRAW, AND NOTHING HERE TEACHES IT TO.
// The object program owns every `line|label|box|table|polyline|linefill` call:
// it decides what is created, what it looks like and where it goes. What this
// file adds is the one thing the value lane was missing to COMPOSE with that
// ownership — a representation for the RESULT of a create that the object pass
// has already taken responsibility for.
//
// ⚰️ THE GAP THIS CLOSES, MEASURED. `array.push(zones, box.new(…))` is the
// corpus idiom for a script that keeps a LIST of drawings — 19 of 266 committed
// scripts write it. The object pass collects it (`nestedCreate` in
// `pineObjects.js`) and refers to the result as `{r:'site', id}`, "what THIS
// bar's create at that site made". The runtime lane refused the same line at
// `runtime:object-op`, because the two shapes that legitimately mention a
// drawing under ownership — the handle binding and the bare drawing statement —
// are both SKIPPED before lowering, so anything reaching an expression position
// was a drawing used as a VALUE with no value to be.
//
// ⛔⛔ AND IT IS OPAQUE ON PURPOSE — THAT IS THE WHOLE SAFETY ARGUMENT.
// `collections.js` already wrote down why `na` is the wrong answer for a drawing
// element: it would make the standard emptiness test `na(array.get(zones, i))`
// read TRUE for a box the object program had already drawn. A NUMBER is worse
// still — `collections.js` and `objectLane.js` both say it, in the same words —
// because zero is a coordinate, a row number and a colour. So the handle is
// NEITHER: `kindOf` answers `'drawing'`, which is not `'number'`, not
// `'string'` and not `'array'`, so every declared-kind check in the VM that
// wanted one of those refuses it BY NAME instead of coercing it.
//
// ⛔ THE `site` HERE IS THIS LANE'S OWN ORDINAL AND IS **NOT** THE OBJECT
// PROGRAM'S SITE ID. `pineObjects.js` numbers its creates over its own walk
// (`siteSeq`), this front end numbers them over its own lowering, and NOTHING
// joins the two. Naming the field the same thing in both places would invite
// exactly the unverified identity join `lesson_an_identity_join_is_not_a_
// correctness_check` is about, so the field is documented as what it is: a way
// to tell two creates apart within one runtime program, and nothing more.
// Nothing in this lane reads it; it exists so two handles are not `===`.

/** The namespaces whose `.new` makes a drawing. ⭐ The same list
 *  `pineRuntimeFrontend.js`'s `OBJECT_NS` matches, spelled as data so the
 *  admission rule and the value can be checked against one roster. */
export const DRAWING_FAMILIES = Object.freeze(
  ['line', 'label', 'box', 'table', 'polyline', 'linefill'],
)

const TAG = Symbol.for('uct.pine.drawingHandle')

/**
 * One opaque drawing handle.
 *
 * ⛔ FROZEN, so nothing downstream can decorate it into something that looks
 * readable. A handle that grew a `.y1` would be a drawing property answered by
 * the lane that does not hold the drawing.
 *
 * @param {string} family  one of `DRAWING_FAMILIES`
 * @param {number} site    THIS LANE's ordinal — see the header, it is not the
 *                         object program's site id
 */
export function drawingHandle(family, site) {
  if (!DRAWING_FAMILIES.includes(family)) {
    throw new Error(`drawingHandle: \`${family}\` is not a drawing family`)
  }
  if (!Number.isInteger(site) || site < 0) {
    throw new Error(`drawingHandle: a site is a non-negative ordinal, got ${site}`)
  }
  return Object.freeze({ [TAG]: true, family, site })
}

/** ⭐ ASKED BY THE SYMBOL, NOT BY A DUCK-TYPED FIELD. A member's own object
 *  cannot reach this lane today, but a `{family, site}` test would start
 *  answering true for one the day a UDT can — and a value model that widens
 *  itself by accident is how a drawing handle becomes whatever was nearby. */
export const isDrawingHandle = (v) => (
  typeof v === 'object' && v !== null && v[TAG] === true)

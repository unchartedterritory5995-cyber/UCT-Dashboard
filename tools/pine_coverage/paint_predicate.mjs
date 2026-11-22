// tools/pine_coverage/paint_predicate.mjs
//
// THE CENSUS'S PAINT RULE, in one place (both measuring tests import it):
//
//   a per-bar paint (`bgcolor` / `barcolor`) counts as WITHHELD only when the document the
//   member gets does not draw it.
//
// INSTRUMENT CORRECTION, 2026-11-16 (coordinator ruling C). The census used to count every paint
// the TRANSLATION marked `withheld`. But the member door can still draw such a paint: with the
// runtime pane on it reads a `barcolor` whose colour the host lane could not carry from the
// per-bar run (`memberPaneDefinition.js::runtimeReadPaints`, DIV-4), and a runtime-lane document
// carries the paints its run colours. Those scripts were counted "paint withheld" although the
// document draws the paint. This is a change to the MEASUREMENT, not to the engine: both counts
// are written on every row (`withheldPaints` = this rule, `withheldPaintsTranslated` = the old
// one), so a headline can be stated under either definition from one run.
//
// A paint is identified by `kind@line`, which is what the door writes on a document paint and
// what its disclosure names it by. A translation paint with no line can only be matched by kind
// and order, so it is matched to an unclaimed document paint of its kind with no line.

const keyOf = (p) => `${p && p.kind}@${p && Number.isInteger(p.line) ? p.line : '?'}`

/** How many paints the TRANSLATION marked withheld (the rule before 2026-11-16). */
export function paintsWithheldByTranslation(translation) {
  const paints = (((translation || {}).presentation || {}).paints) || []
  return paints.filter((p) => p && p.withheld).length
}

/** How many paints the translation marked withheld that the DOCUMENT does not draw.
 *  `definition` is the door's document, or null when the door did not attach (then nothing is
 *  drawn and every withheld paint counts, as before). */
export function paintsWithheldFromDocument(translation, definition) {
  const paints = ((((translation || {}).presentation || {}).paints) || []).filter((p) => p && p.withheld)
  if (!paints.length) return 0
  const drawn = new Map()
  for (const p of ((definition && Array.isArray(definition.paints)) ? definition.paints : [])) {
    if (!p || typeof p.kind !== 'string') continue
    drawn.set(keyOf(p), (drawn.get(keyOf(p)) || 0) + 1)
  }
  let n = 0
  for (const p of paints) {
    const k = keyOf(p)
    const left = drawn.get(k) || 0
    if (left > 0) drawn.set(k, left - 1)
    else n += 1
  }
  return n
}

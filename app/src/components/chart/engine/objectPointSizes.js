// app/src/components/chart/engine/objectPointSizes.js
//
// ⭐⭐ ENGINE 52 — PINE v6's INTEGER TEXT SIZE, IN TYPOGRAPHIC POINTS: the sizes the Pine v6
// reference EQUATES with a `size.*` word (`docs/pine/pine-presentation-spec.md` 4.3.1 and
// C115, verbatim from the reference), one table per family:
//   · labels (`size`):                 auto 0, tiny ~7, small ~10, normal 12, large 18, huge 24
//   · boxes and table cells (`text_size`): auto 0, tiny 8, small 10, normal 14, large 20, huge 36
// ⛔ Only these ints are served (each IS its word, so it is drawn exactly as the word). No
// capture records the pixels of any other point size, so both lanes withhold one by name
// (`pine:text-size-points-unwitnessed`) rather than draw an interpolated guess.
export const POINT_SIZE_ANCHORS = Object.freeze({
  label: Object.freeze({ tiny: 7, small: 10, normal: 12, large: 18, huge: 24 }),
  boxTable: Object.freeze({ tiny: 8, small: 10, normal: 14, large: 20, huge: 36 }),
})

/** A point size → the `size.*` word the reference equates it with, or null (unwitnessed). */
export function pointSizeWord(pt, kind = 'label') {
  if (pt === 0) return 'auto'
  const anchors = POINT_SIZE_ANCHORS[kind] || POINT_SIZE_ANCHORS.label
  for (const [word, p] of Object.entries(anchors)) if (p === pt) return word
  return null
}

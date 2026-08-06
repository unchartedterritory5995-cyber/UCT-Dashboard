// app/src/components/research-kit/testing/restraint.js
//
// TEST HELPER — never import this from runtime code.
//
// §3.1's restraint rules are normative but were only prose: "gold borders
// appear only on the banner, the ONE hero widget per canvas, and the active
// rail item; maximum one gold data-highlight per canvas". This turns it into
// something a composition test can assert, so decoration creep fails a test
// instead of shipping.
//
// I6 — HOW IT WORKS NOW: the accented surface and the gold data-highlights
// self-report via explicit data attributes — `data-rk-accent` (GlassCard,
// when `accent` is set) and `data-rk-gold` (ReactionBars' implied bracket
// group, VerdictChip when `tone="gold"`, RangeSlider when `tone="gold"`) —
// rather than being inferred from a CSS-module-scoped class name. The
// previous version of this file matched the accent surface by class SHAPE
// (`_accent_<hash>`, NOT the literal string "accent" — confirmed by probing
// GlassCard's rendered output) via `ACCENT_TOKEN_RE`. That coupling to Vite's
// module-scoping scheme is gone now that the components report themselves
// directly; `ACCENT_TOKEN_RE` is retired.
//
// LIMITATION — canvas-drawn gold is invisible to this audit. This helper
// walks the rendered DOM, so it can only see gold that IS DOM (SVG rects/lines
// and HTML elements). `Histogram.jsx`'s analyst-price-target marker line is
// drawn by ECharts onto a `<canvas>` (`CHART_INK.gold` in its `markLine`
// style) — a `<canvas>` has no queryable children, so that highlight is
// structurally invisible here and this audit cannot catch a second one
// appearing on the same canvas as a DOM-based highlight. Today that is a
// non-issue (no view composes Histogram's marker with another gold element),
// but it means a canvas-drawn gold addition needs a manual review, or its own
// non-DOM assertion (e.g. asserting on the built ECharts `option`) — this
// helper cannot see it.

/** Count elements (including `container` itself) carrying the given data attribute. */
function countByAttr(container, attr) {
  if (!container) return 0
  let n = container.hasAttribute?.(attr) ? 1 : 0
  for (const el of container.querySelectorAll?.(`[${attr}]`) ?? []) n += 1
  return n
}

/** How many accented surfaces (`data-rk-accent`) are inside (or are) `container`. */
export function countAccentSurfaces(container) {
  return countByAttr(container, 'data-rk-accent')
}

/** How many gold data-highlights (`data-rk-gold`) are inside (or are) `container`. */
export function countGoldHighlights(container) {
  return countByAttr(container, 'data-rk-gold')
}

/**
 * Throws when a rendered canvas carries more than one accented surface.
 *
 * If you are about to accent a second card in the same canvas, one of them is
 * not the hero (§3.1). Contract unchanged by I6 — only the counting mechanism
 * underneath (`countAccentSurfaces`) moved from class-shape to data-attribute.
 */
export function expectOneAccentPerCanvas(container) {
  const n = countAccentSurfaces(container)
  if (n > 1) {
    throw new Error(
      `Restraint violation (spec §3.1): ${n} accent surfaces in one canvas; at most 1 is permitted (the hero).`,
    )
  }
  return n
}

/**
 * Throws when a rendered canvas breaks the §3.1 gold budget.
 *
 * READING (documented per this task's instruction to implement the GlassCard
 * JSDoc's rule VERBATIM): that JSDoc states the accent-border placement rule
 * and the gold-data-highlight cap as TWO SEPARATE bullets —
 *
 *   • `accent` (the gold border) appears ONLY on: the pinned banner, the ONE
 *     hero widget per canvas, and the active rail item. Nothing else.
 *   • Maximum ONE gold data-highlight per canvas.
 *
 * Nothing in that text sums the two channels into one shared number. A canvas
 * showing its one accented hero card AND its one gold RICH/CHEAP chip is
 * exactly the intended, fully-spent state described by the spec — not a
 * violation. So this asserts the two budgets SEPARATELY, each capped at
 * `max`, rather than their sum; summing them would falsely fail that common,
 * correct case.
 */
export function expectGoldBudget(container, { max = 1 } = {}) {
  const accents = countAccentSurfaces(container)
  const golds = countGoldHighlights(container)
  if (accents > max) {
    throw new Error(
      `Restraint violation (spec §3.1): ${accents} accent surfaces in one canvas; at most ${max} permitted.`,
    )
  }
  if (golds > max) {
    throw new Error(
      `Restraint violation (spec §3.1): ${golds} gold data-highlights in one canvas; at most ${max} permitted.`,
    )
  }
  return { accents, golds }
}

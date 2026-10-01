// app/src/components/chart/technicalCategories.js
//
// ─── THE TECHNICAL LIBRARY'S CATEGORIES, IN THEIR ORDER (2026-10-01) ────────
//
// Chart Settings → Indicators → Add Indicator → Technical groups its rows under
// these seven headings, ALWAYS in this order. Before this module the headings
// were each row's free-text `meta.category`, ordered by FIRST APPEARANCE in the
// catalogue — so the tab opened on "Volume" only because the built-in Volume row
// happened to be first, and the order moved whenever a row did.
//
// ⭐ EVERY TECHNICAL ROW NAMES EXACTLY ONE OF THESE (`indicatorCatalog.test.js`
// enforces it for every shipped definition, built-in and carved-out row). A
// member's own formula keeps its own heading (`My formulas`), and non-technical
// tabs (Fundamentals, Breadth, Symbols, …) keep theirs.

export const TECH_CATEGORY = Object.freeze({
  TREND: 'Trend & Moving Averages',
  MOMENTUM: 'Momentum & Oscillators',
  VOLATILITY: 'Volatility & Bands',
  VOLUME: 'Volume & Money Flow',
  VWAP: 'VWAP',
  RELATIVE_STRENGTH: 'Relative Strength',
  LEVELS: 'Levels & Statistics',
})

/** The fixed heading order. */
export const TECH_CATEGORY_ORDER = Object.freeze([
  TECH_CATEGORY.TREND,
  TECH_CATEGORY.MOMENTUM,
  TECH_CATEGORY.VOLATILITY,
  TECH_CATEGORY.VOLUME,
  TECH_CATEGORY.VWAP,
  TECH_CATEGORY.RELATIVE_STRENGTH,
  TECH_CATEGORY.LEVELS,
])

/**
 * Order a list of heading names: the Technical categories first, in their fixed
 * order; every other heading after them, in the order it was given (stable).
 */
export function orderCategories(categories) {
  const list = Array.isArray(categories) ? categories : []
  const rank = (c) => {
    const i = TECH_CATEGORY_ORDER.indexOf(c)
    return i < 0 ? TECH_CATEGORY_ORDER.length : i
  }
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (rank(a.c) - rank(b.c)) || (a.i - b.i))
    .map(({ c }) => c)
}

/**
 * Wave 13 lane 13A — the CLIENT half of the plan-level write interface.
 *
 * The server's `api/services/journal_two/plan_extract.py` is the ONE reader of plan levels
 * (entry, stop, target, shares) in a note. This file is how a client WRITES a level into a
 * note so that reader sees it. ⛔ It builds values only: a level reaches the note through the
 * member's own editor transaction (autosave, compare-and-set, the offline outbox, version
 * history) — never through a route of its own (R-12, no second writer into notes).
 *
 * Shapes (the reader's docstring is the contract; this file must produce exactly them):
 *   - a chart-drawn level (lane 13H): a drawing in a widgetEmbed's `annotations` carrying
 *     `{ role: 'entry'|'stop'|'target', price }` — `planAnnotation(role, price, drawing)`;
 *   - planned shares and a setup tag ride 13H's `ta` attr — `planBlock({ shares })`;
 *   - a trade-plan canvas level — `canvasLevel(role, price)`.
 *
 * ⛔ ONE FACT IN TWO FILES: PLAN_ROLES here and `PLAN_ROLES` in plan_extract.py, pinned by
 * tests/test_notebook_plan_extract.py, which parses this file.
 */

export const PLAN_ROLES = Object.freeze(['entry', 'stop', 'target', 'shares'])
export const PRICE_ROLES = Object.freeze(['entry', 'stop', 'target'])

const finitePositive = (v) => {
  const n = typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : v
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null
}

/** A chart drawing that carries a plan role. `drawing` defaults to a horizontal line. */
export function planAnnotation(role, price, drawing = { type: 'horizontal' }) {
  if (!PRICE_ROLES.includes(role)) throw new Error(`not a price role: ${role}`)
  const p = finitePositive(price)
  if (p == null) throw new Error('a plan level needs a positive price')
  return { ...drawing, role, price: p }
}

/** The plan block 13H keeps in the chart's `ta` attr (shares only; prices are drawings). */
export function planBlock({ shares } = {}) {
  const n = finitePositive(shares)
  return n == null ? {} : { shares: n }
}

/** A trade-plan canvas level (the 11D board's own shape). */
export function canvasLevel(role, price, id = `lv-${role}`, chartId = null) {
  if (!PRICE_ROLES.includes(role)) throw new Error(`not a price role: ${role}`)
  const p = finitePositive(price)
  if (p == null) throw new Error('a plan level needs a positive price')
  return { id, role, label: '', price: p, chartId }
}

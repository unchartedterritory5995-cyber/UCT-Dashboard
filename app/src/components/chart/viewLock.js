/**
 * The view lock's arithmetic, as pure functions.
 *
 * ⭐ WHY THIS FILE EXISTS. The vertical half of the view lock is two numbers —
 * `top` and `bottom`, the empty fractions above and below the candles — and
 * getting them wrong does not throw, does not log, and does not look wrong in
 * the frame it happens. It is PERSISTED and re-applied on every later load, so
 * the failure surfaces as "my chart came back squashed and never recovered",
 * hours later, in storage. That is the shape of bug that needs a unit test more
 * than a careful reader, and a closure inside a 15,000-line component cannot
 * have one. So the arithmetic lives here and `StockChart` supplies the
 * measurements.
 *
 * ⛔⛔ THE INVARIANT BOTH FUNCTIONS EXIST TO PROTECT: every length fed to
 * `verticalBand` must be measured in the SAME pane — the one the candles are
 * actually in. `yHi`/`yLo` come from `series.priceToCoordinate()`, which answers
 * in that series' own pane, so `paneH` has to be that pane's height too. It was
 * `chart.paneSize().height` (and `chart.panes()[0]` at the axis-drag pin), which
 * means PANE 0 — correct only while the candles were guaranteed to be pane 0,
 * and an indicator that can sit ABOVE Price ends that guarantee. Measured live
 * on a chart with RSI on top: `yHi 39.96` against a `paneH` of 98 gave a top
 * margin of 0.408 where the candle pane was 333px tall and the honest answer was
 * 0.12 — and `bottom` came out negative and clamped to 0.
 */

/** Margins are clamped into this range, so a stored pair outside it is corrupt. */
export const MAX_MARGIN = 0.9
/** …and the pair may never take more than this much of the pane between them,
 *  or the candles have no rectangle left to draw in. */
export const MAX_MARGIN_SUM = 0.95
/** How far the measured band must sit from the layout's own margins before it
 *  counts as something the USER did rather than the layout doing its job. */
export const LOCK_EPSILON = 0.03

/**
 * Where the visible candles sit inside their pane, as top/bottom fractions.
 *
 * ⭐ THIS IS ALSO THE WHOLE "pane resize vs. deliberate zoom" DISTINCTION, and it
 * costs no branch. A fraction of the candle pane's own height is INVARIANT to
 * that pane's height, so dragging a pane divider leaves `top`/`bottom` where
 * they were, they stay inside `LOCK_EPSILON` of `base`, `locked` comes back
 * false and the caller writes nothing. A real vertical zoom moves them well
 * outside it and is captured exactly as before. Nothing here needs to know which
 * gesture happened — measuring the right rectangle is what tells the two apart.
 *
 * @param {object} m
 * @param {number} m.yHi    y of the highest visible price, in the CANDLE pane
 * @param {number} m.yLo    y of the lowest visible price, in the CANDLE pane
 * @param {number} m.paneH  the CANDLE pane's own height — never pane 0's
 * @param {{top: number, bottom: number}} m.base  the layout's own margins
 * @returns {{top: number|null, bottom: number|null, locked: boolean}}
 */
export function verticalBand({ yHi, yLo, paneH, base }) {
  const none = { top: null, bottom: null, locked: false }
  if (!Number.isFinite(yHi) || !Number.isFinite(yLo)) return none
  if (!Number.isFinite(paneH) || !(paneH > 8)) return none
  if (!base || !Number.isFinite(base.top) || !Number.isFinite(base.bottom)) return none

  let top = Math.min(MAX_MARGIN, Math.max(0, yHi / paneH))
  let bottom = Math.min(MAX_MARGIN, Math.max(0, (paneH - yLo) / paneH))
  // Both ends clamp independently, so the pair can still sum past the point
  // where nothing is left between them. Scale them together rather than picking
  // one to sacrifice — the candles stay where the user put them, just thinner.
  if (top + bottom > MAX_MARGIN_SUM) {
    const k = MAX_MARGIN_SUM / (top + bottom)
    top *= k
    bottom *= k
  }
  const atBase = Math.abs(top - base.top) < LOCK_EPSILON
    && Math.abs(bottom - base.bottom) < LOCK_EPSILON
  if (atBase) return none
  return { top: +top.toFixed(4), bottom: +bottom.toFixed(4), locked: true }
}

/**
 * Is a stored vertical band one this code could have written?
 *
 * ⛔ A PURE SAFETY NET, NOT A REPAIR. `verticalBand` clamps each margin into
 * [0, MAX_MARGIN] and scales the pair to sum at most MAX_MARGIN_SUM, so anything
 * outside that was not produced here — a hand-edited value, a foreign key, a
 * future schema. Applying it would leave the candles in a rectangle with no room
 * to draw in, and falling back to the layout's own margins is always a readable
 * chart. It deliberately does NOT try to detect a band that is merely WRONG:
 * the bad values this file's header describes are all inside the legal range and
 * indistinguishable from a deliberate zoom, which is exactly why the fix had to
 * be at the measurement and not here.
 */
export function isStorableVerticalBand(top, bottom) {
  return typeof top === 'number' && typeof bottom === 'number'
    && Number.isFinite(top) && Number.isFinite(bottom)
    && top >= 0 && top <= MAX_MARGIN
    && bottom >= 0 && bottom <= MAX_MARGIN
    && (top + bottom) <= MAX_MARGIN_SUM
}

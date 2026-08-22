// app/src/components/chart/crosshairMode.js — WHO DECIDES WHEN THE HOVER CROSSHAIR SHOWS
//
// ⭐ ONE AUTHORITY, MIRRORING `legendMode.js`. `cs.crosshair.mode` is the only key
// anything WRITES for the three-way choice; every surface that needs the answer
// calls `crosshairModeOf(cs)` rather than reading a field. StockChart and the
// settings modal both go through here, so they can't disagree about whether a
// chart's crosshair is on.
//
// ⚠️ `crosshair.enabled` (boolean) shipped first and sits in every stored blob
// (it is even declared in `CHART_DEFAULTS.crosshair`, so it is ALWAYS present).
// It is a READ-ONLY FALLBACK now — consulted only when `mode` is absent, never
// written by the three-way control. Keeping both writable and "syncing" them is
// the second-authority-over-one-value defect this repo keeps paying for (see
// `legendMode.js` and `youtube_client.upload_unlisted` in CLAUDE.md).

/** The three states, in the order the control lists them. */
export const CROSSHAIR_MODES = ['always', 'hold', 'off']

/**
 * What a chart does when its settings say nothing.
 *
 * ⭐ THE DEFAULT LIVES HERE, AND `CHART_DEFAULTS` DELIBERATELY DOES NOT DECLARE
 * `crosshair.mode`. A schema entry would be spread into every merged blob, and
 * the merge output is what every settings write persists — so the default would
 * be written back as though the user had chosen it, and no later default could
 * ever outrank it. Exactly the trap `legendMode.js` documents.
 *
 * `'always'` = the long-standing behaviour: the crosshair follows the cursor on
 * hover. `hold` and `off` are one click away for anyone who wants a clean chart.
 */
export const DEFAULT_CROSSHAIR_MODE = 'always'

const _VALID = new Set(CROSSHAIR_MODES)

/**
 * The mode the user EXPLICITLY chose, or `undefined` when they never did.
 * The one validity rule, and the one thing a settings write may persist.
 */
export function explicitCrosshairMode(cs) {
  const ch = (cs && typeof cs === 'object' && cs.crosshair && typeof cs.crosshair === 'object')
    ? cs.crosshair : null
  const raw = ch?.mode
  return _VALID.has(raw) ? raw : undefined
}

/**
 * The mode this chart's settings ask for.
 *
 * - `always` — crosshair on, following the cursor on hover (the classic look)
 * - `hold`   — chart stays clean; PRESS AND HOLD shows the crosshair under the
 *              cursor, releasing hides it again
 * - `off`    — never drawn (lines AND the price/date axis labels that track the mouse)
 *
 * An unrecognised stored `mode` falls through to the legacy answer rather than
 * changing a chart out from under the user.
 */
export function crosshairModeOf(cs) {
  const ch = (cs && typeof cs === 'object' && cs.crosshair && typeof cs.crosshair === 'object')
    ? cs.crosshair : null
  const mode = explicitCrosshairMode(cs)
  if (mode) return mode
  // ── LEGACY FALLBACK: only an explicit `enabled === false` carries a decision ──
  // (somebody deliberately turning the crosshair OFF via the old boolean toggle).
  // Everything else — `true`, or absent — takes the current default.
  return ch?.enabled === false ? 'off' : DEFAULT_CROSSHAIR_MODE
}

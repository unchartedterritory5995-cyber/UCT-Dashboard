/**
 * TERM-029 — the dealer-positioning assumption behind every GEX number, as copy.
 *
 * WHY THIS FILE EXISTS AND WHY IT IS HERE. The GEX tab's Total GEX figure, its
 * Ceiling/Floor/Danger-Line set and its Summary all rest on an assumption about
 * dealer positioning that CHANGES THEIR SIGN. Today that assumption is disclosed
 * only as a native `title=` on the Naive/Trade-Aware toggle, which is somewhere
 * else on the page and — the part that matters — NEVER OPENS ON TOUCH. So a
 * member reading the number has no way to reach what it assumes.
 *
 * ⛔ `app/src/pages/OptionsFlow.jsx` IS PARTNER-OWNED (Ravi co-edits it). This
 * module is the non-partner lane `docs/OPTIONS-FLOW-NOTE-FOR-RAVI.md` points at:
 * the copy and its rail live here, so commit one changes zero partner bytes and
 * the eventual render is className hooks plus the additive mobile CSS layer,
 * never an edit to that file's inline `style={{}}` objects.
 *
 * ⚠️ AND THERE IS A REASON TO KEEP AS LITTLE AS POSSIBLE IN THAT FILE:
 * `app/src/pages/optionsFlow/wiring.guard.test.js` records that OptionsFlow.jsx
 * is edited through the GitHub web UI, and that twice on 2026-07-25 a save from
 * a long-open browser tab landed as a stale-buffer commit which silently
 * reverted committed work. Copy held HERE survives that; copy inlined there does
 * not, and nothing goes red when it disappears.
 */

/**
 * The long form, LIFTED VERBATIM from the toggle's `title=` in OptionsFlow.jsx.
 *
 * ⛔ DO NOT REWORD THIS. `gexAssumption.test.js` asserts it is byte-identical to
 * the string in the partner file, so the two cannot drift into disagreeing about
 * what the product claims. If that rail goes red, the PARTNER FILE moved: update
 * this constant to match it. Never edit OptionsFlow.jsx to satisfy this test.
 */
export const GEX_ASSUMPTION_LONG =
  "Naive: assumes dealers are short all OI. Trade-Aware: signs each strike from " +
  "your Massive bought/sold flow (est_dealer_net).";

/**
 * Per-mode short forms, for the label that sits AT the number.
 *
 * ⭐ THE RULING, because it was an open question: a label at the number states
 * ONLY THE MODE THAT PRODUCED THAT NUMBER. Stating both there would leave the
 * reader unable to tell which assumption the figure in front of them rests on,
 * which is the whole defect this ticket exists to close. The toggle is a
 * different case — it CHOOSES between the two, so both belong in its own title,
 * and `GEX_ASSUMPTION_LONG` stays exactly as it is.
 *
 * Keyed by the boolean `gexAdjusted` state (OptionsFlow.jsx: `false` = naive OI
 * GEX, `true` = trade-aware), so a caller passes the state it already holds and
 * cannot invent a third mode.
 */
export const GEX_ASSUMPTION_BY_MODE = Object.freeze({
  naive: "Assumes dealers are short all open interest.",
  tradeAware: "Signs each strike from bought/sold flow, not open interest.",
});

/** The mode name for the `gexAdjusted` boolean. */
export function gexModeName(gexAdjusted) {
  return gexAdjusted ? "tradeAware" : "naive";
}

/** The human label for the mode, matching the toggle's own button text. */
export function gexModeLabel(gexAdjusted) {
  return gexAdjusted ? "Trade-Aware" : "Naive";
}

/**
 * The assumption to show beside a GEX number, given the live toggle state.
 *
 * ⚠️ Returns the ACTIVE mode's sentence only — see the ruling above. Anything
 * that wants both modes wants `GEX_ASSUMPTION_LONG`, which is the toggle's copy.
 */
export function gexAssumptionFor(gexAdjusted) {
  return GEX_ASSUMPTION_BY_MODE[gexModeName(gexAdjusted)];
}

/**
 * The accessible name for the reach affordance, so the control announces what it
 * reveals rather than "more info".
 */
export function gexAssumptionAriaLabel(gexAdjusted) {
  return `What ${gexModeLabel(gexAdjusted)} GEX assumes`;
}

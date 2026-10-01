// app/src/components/chart/engine/runtimeErrorText.js
//
// ─── ⭐ C43 — THE WORDS FOR A REACHED `runtime.error`, IN ONE PLACE ──────────────
//
// Two lanes can learn that a script stopped itself: the host lane, from the
// conditions the translation stamped on the document (`runtimeErrorStop.js`), and
// the per-bar runtime lane, when its run throws `PineRuntimeError`
// (`nativeRegistry.runtimeColumnsOrReasons`). They must tell a member the same
// thing, so the wording lives here and both read it. No import, no state: the
// plot lane can carry it without reaching the object lane.
//
// TradingView's own text is MEASURED (`tests/fixtures/vendor/runtime/
// vw-runtime-error-reached-spy-1d-2026-09-30.json`): status title
// "User-defined error", message "Error on bar {bar_index}: <the script's message>".

/** TradingView's status title for a script's own `runtime.error`. */
export const RUNTIME_ERROR_TITLE = 'User-defined error'

/** TradingView's sentence: `Error on bar {bar_index}: <the script's message>`. */
export const tradingViewErrorText = (bar, message) => `Error on bar ${bar}: ${message}`

/**
 * What a member reads where the indicator would have been.
 *
 * ⛔ THE BAR NUMBER IS SAID ONLY WHERE IT IS TRADINGVIEW'S (`barKnown`): this
 * chart's bar 0 is TradingView's only when the series starts at the listing bar,
 * and a number that might be another bar is a wrong text, not a detail.
 * ⛔ A MESSAGE THIS LANE COULD NOT READ IS NOT INVENTED (`message === null`).
 *
 * @param {{message: string|null, bar: number, barKnown: boolean}} stop
 * @returns {{title: string, tradingViewText: string|null, sentence: string}}
 */
export function runtimeErrorWords({ message, bar, barKnown }) {
  const known = typeof message === 'string'
  const tradingViewText = known && barKnown ? tradingViewErrorText(bar, message) : null
  const said = !known
    ? 'the script raised an error of its own (`runtime.error`) whose message is built from values this chart does not read as text'
    : (tradingViewText || message)
  return {
    title: RUNTIME_ERROR_TITLE,
    tradingViewText,
    sentence: `${RUNTIME_ERROR_TITLE}: ${said} — the script stopped itself, so nothing of it is drawn (TradingView shows this error and an empty pane).`,
  }
}

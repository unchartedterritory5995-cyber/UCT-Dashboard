/**
 * ⭐⭐ IS A MODAL DIALOG ON SCREEN RIGHT NOW?
 *
 * The chart binds keys in two places that are deliberately NOT scoped to the
 * chart's own DOM: `StockChart`'s shortcut handler is on `document`, and
 * `ChartPane`'s type-to-search fires whenever the pane holds focus. Both guard on
 * "is the event target an input?" — which is the wrong question the moment a
 * DIALOG is open over the chart.
 *
 * ⚰️ MEASURED IN PRODUCTION 2026-08-10: with the New-formula builder open, text
 * typed at the dialog landed in the CHART'S TICKER BOX — a screenshot caught the
 * builder rendered on top and `SMA(CLOSE,` sitting in the symbol search behind
 * it. The dialog's own focus trap did not prevent it, because the leak does not
 * need focus to be inside the chart: a `document` listener fires wherever focus
 * is, and `SymbolSearch` deliberately RETURNS focus to the chart when its
 * dropdown closes. So the guard cannot live in the dialog — every keybinding that
 * is not scoped to the chart has to ask this question itself.
 *
 * ⛔ IT ASKS THE DOM, NOT A STORE. There is no single modal registry in this app —
 * `Sheet`, `IndicatorLibraryDialog`, `ChartSettingsModal` and the builder each
 * render their own panel — so a flag would need every one of them to opt in and
 * would be wrong for whichever one forgot. The rendered `role="dialog"` is the one
 * thing they already all have, and a dialog that stops rendering one has an
 * accessibility bug anyway.
 */

/** Every selector that means "a modal is on screen". */
const MODAL_SELECTOR = '[role="dialog"],[aria-modal="true"],dialog[open]'

/**
 * True when a modal dialog is open.
 *
 * @param {Element|null} [target] the event target, when there is one. An event
 *   raised INSIDE the dialog is the dialog's own business and this still answers
 *   true — the point is only ever to keep the CHART from acting.
 */
export function isModalOpen(target = null) {
  if (typeof document === 'undefined') return false
  // A target inside a dialog is decisive on its own and costs one walk up.
  if (target && typeof target.closest === 'function' && target.closest(MODAL_SELECTOR)) {
    return true
  }
  return !!document.querySelector(MODAL_SELECTOR)
}

export default isModalOpen

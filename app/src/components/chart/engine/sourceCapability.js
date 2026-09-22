// app/src/components/chart/engine/sourceCapability.js
//
// ─── WHAT MAY THIS SOURCE BE DRAWN AS, AND AS WHAT BY DEFAULT? ──────────────
//
// ⭐⭐ THE CONTRACT THIS WHOLE FILE EXISTS TO STATE:
//
//        SOURCE SEMANTICS → PRESENTATION CAPABILITIES → DEFAULT → USER CHOICE
//
// and never `ticker → chart style`. A candlestick is a claim that four numbers
// describe one auction period. A survey produces ONE number a week. So "can this
// wear candles" is a question about what the source MEANS, it is answered from
// catalogue metadata the backend already publishes, and no part of the renderer
// is allowed to learn that `NAAIM` or `AAII:BULLS` is special.
//
// ⛔⛔ THIS MODULE DOES NOT REPLACE `ohlcCapability.js` AND MUST NOT BE CONFUSED
// WITH IT. That one answers the CANDLE question and is fail-closed across three
// dimensions (identity / structural / semantic); it is the authority, it stays the
// authority, and `allowedStyles` here takes the candle answer as an INPUT rather
// than recomputing it. What this adds is the other half nobody had a seam for: the
// scalar styles, and which one a source starts as.
//
// ⛔ AND IT IS NOT A SECOND STYLE REGISTRY. The vocabulary lives in
// `presentation.js` (`PLOT_STYLES`); these are SUBSETS of it, named by what the
// data can mean. A style added there and forgotten here is caught by
// `sourceCapability.test.js`, which asserts the two stay in step.

import { PLOT_STYLES } from './presentation'

/**
 * Every style a ONE-NUMBER-PER-PERIOD source may wear.
 *
 * ⭐ THIS IS THE WHOLE LIST MINUS `candles`, BY CONSTRUCTION RATHER THAN BY HAND.
 * Writing the six out would be a list to forget to update; deriving it means a
 * seventh scalar style added to `PLOT_STYLES` is automatically offered to every
 * scalar source, and the only thing this file ever has to decide is candles.
 */
export const SCALAR_STYLES = Object.freeze(PLOT_STYLES.filter((s) => s !== 'candles'))

/** Every style a source with a genuine auction period may wear. */
export const OHLC_STYLES = Object.freeze([...SCALAR_STYLES, 'candles'])

/**
 * A catalogue `presentation` → the style a newly added series STARTS as.
 *
 * ⛔⛔ `step` MAPS TO `line`, AND THAT IS A PRODUCT RULING RATHER THAN AN
 * OVERSIGHT. The backend marks a weekly survey `presentation: 'step'` because that
 * describes its DATA HONESTLY — one reading stands until the next, and
 * `series.step_to_daily` serves flat carried bars saying exactly that. But the
 * owner's ruling (2026-09-21) is that NAAIM and the AAII survey DEFAULT TO A LINE,
 * and `step` stays offered as an alternative. Those two facts are not in tension:
 * the metadata describes the observations, this table decides the first impression,
 * and the member owns it after that.
 *
 * ⚠️ AN UNKNOWN OR ABSENT PRESENTATION FALLS TO `line`, never to nothing. A source
 * whose catalogue row has not arrived must still draw.
 */
export const PRESENTATION_DEFAULT_STYLE = Object.freeze({
  line: 'line',
  // A signed count — net advancers, Net New High-Low — reads as bars around zero.
  histogram: 'histogram',
  step: 'line',
})

/** The style anything falls back to when its source says nothing at all. */
export const FALLBACK_DEFAULT_STYLE = 'line'

/**
 * The presentation capability of ONE source.
 *
 * ⚠️ `ohlcCapable` IS AN INPUT, NOT A DERIVATION. Only `ohlcCapabilityOf` may
 * decide the candle question — it is the one that knows about passthrough identity
 * and about whether bars are actually loaded — so this takes its answer and does
 * not second-guess it. Passing `false` (or omitting it) is the fail-closed
 * direction and is what every caller that has not been taught yet gets.
 *
 * @param {object|null} meta  the source's catalogue row, or null when the source
 *                            is an ordinary security / not yet classified
 * @param {boolean} [ohlcCapable=false]  `ohlcCapabilityOf(...).ok`
 * @returns {{defaultStyle: string, allowedStyles: string[]}}
 */
export function sourceCapabilityOf(meta, ohlcCapable = false) {
  const declared = meta && typeof meta.presentation === 'string'
    ? meta.presentation : null
  const defaultStyle = (declared && PRESENTATION_DEFAULT_STYLE[declared])
    || FALLBACK_DEFAULT_STYLE
  return {
    // ⛔ AN ORDINARY SECURITY KEEPS DEFAULTING TO `line`, DELIBERATELY. Candles are
    // ALLOWED for it and always were; making them the DEFAULT would silently redraw
    // every secondary symbol members have already added to their charts. Capability
    // and default are different questions — that is §4 of this project — and this is
    // the line where confusing them would have been a visible regression.
    defaultStyle,
    allowedStyles: ohlcCapable ? OHLC_STYLES : SCALAR_STYLES,
  }
}

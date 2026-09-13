// app/src/components/chart/engine/ohlcCapability.js
//
// ─── MAY THIS OUTPUT BE DRAWN AS CANDLES? ───────────────────────────────────
//
// ⭐⭐ THREE DIMENSIONS, AND THE TWO THAT ARE NOT "does it have o/h/l/c" ARE
// WHERE BOTH MEASURED DEFECTS HAVE LIVED.
//
//   IDENTITY   — is this ROW the instrument, or a CALCULATION over it? A moving
//                average of QQQ declares the same source string QQQ does.
//   STRUCTURAL — are there usable `o`/`h`/`l`/`c` numbers in the bars we hold?
//   SEMANTIC   — does this source's PROVIDER FAMILY mean an auction period by
//                those fields, or merely store four numbers in a bar-shaped row?
//
// ⛔⛔ FIELD PRESENCE ALONE IS THE WRONG GATE, AND IT WOULD BE A *PLAUSIBLE*
// WRONG GATE — which is why this module exists rather than four `Number.isFinite`
// calls at a call site. `breadth_symbols.py` builds a breadth day as
// `o, c = (prev, v); h, l = max(o, c), min(o, c)` with `v: 0`: the "open" is
// YESTERDAY'S VALUE and the wick is derived from the pair, not observed. Those
// bars pass every structural test there is and would render a tidy candlestick
// whose body means "change since yesterday" and whose range means nothing at all.
// A member cannot tell that by looking, which is exactly what makes it worth a
// gate. `sourceRef.SYMBOL_SOURCE_FIELDS` already refuses `hl2`/`hlc3`/`ohlc4` for
// this same reason and says so in the same words.
//
// ⛔ NO TICKER LIST, NO PREFIX TEST. The family comes from the breadth registry —
// the SAME authority `api/routers/bars.py` routes on — injected as `familyOf` so
// this module is pure and so the engine does not reach into a React hook.
//
// ⚠️ AND IT FAILS CLOSED. An unknown family is NOT candle-capable. The registry
// arrives over the network, so "we have not been told yet" must never read as
// "it is an ordinary security": that is the one direction of error that puts a
// misleading candle on a member's chart.

/** What kind of thing a canonical symbol is, as far as presentation cares. */
export const OHLC_FAMILY = Object.freeze({
  SECURITY: 'security',
  BREADTH: 'breadth',
  UNKNOWN: 'unknown',
})

/** Why a source may not be drawn as candles. One string per reason, so a caller
 *  can say something true rather than "unsupported". */
export const OHLC_REFUSAL = Object.freeze({
  NOT_PASSTHROUGH: 'this row draws a calculation over the instrument, not the '
    + 'instrument itself',
  NOT_SYMBOL: 'only a canonical symbol can be drawn as candles',
  FAMILY_UNKNOWN: 'this symbol has not been classified yet',
  FAMILY_NOT_OHLC: 'this source has no real open, high and low — its bars are '
    + 'derived from one value per period',
  NO_BARS: 'no bars are loaded for this symbol yet',
  FIELDS_MISSING: 'the bars carry no usable open, high and low',
})

/**
 * Does this definition's OUTPUT equal its source, unchanged?
 *
 * ⭐⭐ THE DIMENSION A SOURCE CANNOT ANSWER. `MA(sym:QQQ:close)` and a direct QQQ
 * series declare the SAME source string; one of them IS QQQ and the other is a
 * five-bar average of it. Asking the source therefore says yes to both — which
 * is exactly what shipped as far as a browser and drew QQQ's own bars in the
 * moving average's pane, legend and all. See `nativeRegistry.js`, `passthrough`.
 *
 * ⛔ THE DEFINITION DECLARES IT; THIS DOES NOT GUESS. No defId list, no name
 * test — the same posture the family gate takes below, and for the same reason:
 * a list is a thing to forget to update, and forgetting is the unsafe direction.
 */
export function outputIsSource(def) {
  return !!(def && def.passthrough === true)
}

/**
 * The families whose bars are a genuine auction period.
 *
 * ⭐ AN ALLOW LIST, NOT A DENY LIST, and that is the fail-closed direction. A
 * family nobody has classified — a future provider, a data source added next
 * quarter — is refused until somebody decides what its bars MEAN. Denying only
 * `breadth` would silently admit the next synthetic family the day it appears.
 */
const OHLC_FAMILIES = Object.freeze(new Set([OHLC_FAMILY.SECURITY]))

/** Is `v` a real number we could draw? */
const num = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Does this bar carry a complete, drawable OHLC?
 *
 * ⚠️ ALL FOUR, because a candlestick needs all four. A bar with a close and no
 * high is not half a candle; it is whitespace.
 */
export function barHasOhlc(bar) {
  return !!bar && typeof bar === 'object'
    && num(bar.o) && num(bar.h) && num(bar.l) && num(bar.c)
}

/**
 * The STRUCTURAL half: do the bars we hold contain anything drawable?
 *
 * ⚠️ "AT LEAST ONE", DELIBERATELY. A symbol whose early history is close-only and
 * whose recent bars are complete is drawable — the incomplete bars become
 * whitespace, which is the same answer the scalar lane gives for a missing bar.
 * Requiring every bar would refuse a chart that would have drawn correctly.
 */
export function barsCarryOhlc(bars) {
  const list = Array.isArray(bars) ? bars : []
  for (let i = 0; i < list.length; i++) if (barHasOhlc(list[i])) return true
  return false
}

/**
 * May THIS OUTPUT of this definition be presented as candles?
 *
 * ⚠️ THE DEFINITION COMES FIRST BECAUSE IT IS THE FIRST QUESTION, and because a
 * required leading argument is the shape that fails closed: a call site that has
 * not been taught about identity passes `undefined` here and is refused, rather
 * than silently keeping the old source-only answer.
 *
 * @param {object|null} def      the instance's definition; must declare
 *                               `passthrough` to be eligible at all
 * @param {object|null} parsed   `sourceRef.parseSource` output
 * @param {object|null} entry    the supplier's cache entry — `{bars, status}`
 * @param {Function} [familyOf]  `(symbol) => OHLC_FAMILY[...]`; absent means
 *                               nothing has been classified, which refuses
 * @returns {{ok: boolean, family: string, reason: string|null}}
 */
export function ohlcCapabilityOf(def, parsed, entry, familyOf) {
  // ⛔ IDENTITY FIRST. "This row is an average" is a truer and more durable
  // reason than anything about the instrument behind it, and answering about
  // the SYMBOL's business would send the next reader to the wrong module.
  if (!outputIsSource(def)) {
    return { ok: false, family: OHLC_FAMILY.UNKNOWN, reason: OHLC_REFUSAL.NOT_PASSTHROUGH }
  }
  if (!parsed || parsed.kind !== 'symbol' || !parsed.symbol) {
    return { ok: false, family: OHLC_FAMILY.UNKNOWN, reason: OHLC_REFUSAL.NOT_SYMBOL }
  }
  // ⛔ SEMANTIC FIRST, AND ON PURPOSE. A breadth symbol whose bars are fully
  // populated must be refused for what it MEANS, not for what it lacks — and
  // reporting "no usable open" about a row that has one would send the next
  // reader looking for a data bug instead of finding this decision.
  const family = (typeof familyOf === 'function' && familyOf(parsed.symbol)) || OHLC_FAMILY.UNKNOWN
  if (family === OHLC_FAMILY.UNKNOWN) {
    return { ok: false, family, reason: OHLC_REFUSAL.FAMILY_UNKNOWN }
  }
  if (!OHLC_FAMILIES.has(family)) {
    return { ok: false, family, reason: OHLC_REFUSAL.FAMILY_NOT_OHLC }
  }
  const bars = entry && Array.isArray(entry.bars) ? entry.bars : null
  if (!bars || !bars.length) return { ok: false, family, reason: OHLC_REFUSAL.NO_BARS }
  if (!barsCarryOhlc(bars)) return { ok: false, family, reason: OHLC_REFUSAL.FIELDS_MISSING }
  return { ok: true, family, reason: null }
}

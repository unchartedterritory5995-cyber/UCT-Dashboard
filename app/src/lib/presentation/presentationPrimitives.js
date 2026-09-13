// app/src/lib/presentation/presentationPrimitives.js
//
// ─── S10 — PRESENTATION PRIMITIVES ──────────────────────────────────────────
//
// product-architecture.md's S10 block, built for the first time. Five pure
// functions — number, percent, currency, date/time-with-session, freshness —
// and nothing else. No React, no DOM, no clock, no locale detection, no
// network: every one is a total function from (value, options) to a string or
// a caller-chosen absent sentinel.
//
// ⭐ THIS RATIFIES A FORM THE CODEBASE ALREADY HAD; IT DOES NOT INVENT ONE.
// Three of the five are lifted VERBATIM — same arguments, same rounding, same
// sentinels — from helpers that already shipped:
//
//   formatNumber   <- `provenance/CoverageLine.jsx`'s `n()`
//   formatCurrency <- `provenance/presentationFormat.js`'s `formatPrice`
//   formatTimeEt   <- `presentationFormat.js`'s `formatEtTime` (seconds: true)
//                     AND `FreshnessBadge.jsx`'s `formatAsOf` (seconds: false),
//                     which were the SAME formatter differing by one field
//
// `presentationFormat.js`'s own header has said since 2026-09-02 that this is
// how it ends: "When S10 ships, <Provenance>/<FreshnessBadge> swap onto it
// (SPEC-S8 §19 Step 2's own stated migration)." This module is that swap.
//
// ⛔ AN EXPLICIT LOCALE, ALWAYS — never a bare `toLocaleString()`. The rule is
// `CoverageLine.jsx`'s, kept in its own words: a bare call formats to whatever
// the browser is set to, so the same screen reads `3,742` for one member and
// `3.742` for another, and the second one reads as a decimal.
// `presentationSingleFormatter.test.js` is the rail that holds the line.
//
// ⛔ THE ABSENT SENTINEL IS A PARAMETER, NOT A CONSTANT. The four S8 components
// do not agree today and must not be made to agree by this commit: `n()` and
// `formatPrice` return the em dash, `formatEtTime` and `formatAsOf` return
// `null` so their caller can omit a whole element. Both are correct for their
// call site, and hard-coding one would have been a member-visible change
// smuggled in under a refactor. `absent` carries the difference explicitly.
//
// ⚠️ WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE: whether a value IS stale,
// what session the market is in, or what a freshness class MEANS. S11
// (`lib/marketClock/`) owns the session model and
// `provenance/freshnessContract.js` owns D1's FreshnessClass mapping. S10
// renders what it is handed.

/** The one absent-value glyph this app already uses, in the one place it is
 *  now declared. An em dash, not a hyphen: `CoverageLine.jsx` and
 *  `presentationFormat.js` both shipped the em dash and the tables align on it. */
export const ABSENT = '—'

/** The one locale tag. Named so a reader can see there is exactly one, and so
 *  the single-formatter rail can pin it by import rather than by grep. */
export const LOCALE = 'en-US'

/** The market's timezone. S11 owns the session MODEL; this is only the zone
 *  every S8 timestamp is already rendered in. */
export const MARKET_TIME_ZONE = 'America/New_York'

// --------------------------------------------------------------------------
// 1. NUMBER
// --------------------------------------------------------------------------

/**
 * Grouped decimal number.
 *
 * `formatNumber(v)` is byte-identical to `CoverageLine.jsx`'s retired `n(v)`.
 *
 * @param {*} value
 * @param {{decimals?: number|null, absent?: *}} [options]
 */
export function formatNumber(value, { decimals = null, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  if (decimals == null) return Number(value).toLocaleString(LOCALE)
  return Number(value).toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// --------------------------------------------------------------------------
// 2. PERCENT
// --------------------------------------------------------------------------

/**
 * A percentage, already expressed in percent units (1.5 renders "1.50%", NOT
 * "150.00%").
 *
 * ⛔ That choice is not arbitrary: every percent-shaped field this app carries
 * — `gap_pct`, `change_pct`, `todaysChangePerc`, `pct_above_50sma` — is already
 * in percent units, and a primitive that silently multiplied by 100 would be
 * wrong for all of them. A fraction-valued caller converts at its own boundary,
 * where the unit is known.
 *
 * @param {*} value               percent units
 * @param {{decimals?: number, signed?: boolean, absent?: *}} [options]
 */
export function formatPercent(value, { decimals = 2, signed = false, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  const body = Number(value).toFixed(decimals)
  // `toFixed` already carries the minus sign; only the plus is ours to add,
  // and only when the caller asked for a signed render.
  const sign = signed && Number(value) >= 0 ? '+' : ''
  return `${sign}${body}%`
}

// --------------------------------------------------------------------------
// 3. CURRENCY
// --------------------------------------------------------------------------

/**
 * A US-dollar amount.
 *
 * `formatCurrency(v)` is byte-identical to `presentationFormat.js`'s
 * `formatPrice(v)`, including its `toFixed(2)` (NOT `toLocaleString`), so an
 * existing render cannot move by a thousands separator appearing where there
 * was none.
 *
 * @param {*} value
 * @param {{decimals?: number, absent?: *}} [options]
 */
export function formatCurrency(value, { decimals = 2, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  return `$${Number(value).toFixed(decimals)}`
}

// --------------------------------------------------------------------------
// 3b. PRICE — TWO NAMED PRIMITIVES, ON PURPOSE  (S10 CP2 / F-S10-1)
// --------------------------------------------------------------------------

/**
 * ⛔⛔ THERE ARE TWO CORRECT WAYS TO RENDER A PRICE IN THIS APP AND S10 OWNS
 * BOTH BY NAME. This is the resolution of F-S10-1, and it is deliberately NOT
 * a reconciliation.
 *
 * The finding: `provenance/presentationFormat.formatPrice` renders `"$12.50"`
 * with an em dash when absent, and `chart/drawingLabels.formatPrice` renders
 * `"123.46"` — no symbol, tick-aware decimals, EMPTY STRING when absent — and
 * `drawingLabels`'s own comment called itself *"already the one place in the
 * app that knows how a price is rendered"*, a sentence false for as long as the
 * other one has existed.
 *
 * ⭐ THE GATE'S RULING, AND THE REASON IT IS RIGHT: *"the answer is probably
 * 'both, for different surfaces'. A chart drawing label must be tick-aware and
 * must not waste pixels on a currency symbol; a provenance disclosure must be
 * unambiguous. That is a case for S10 owning TWO named primitives with stated
 * call-site rules, not for collapsing them into one."*
 *
 * ⛔ AND THE ABSENT SENTINELS ARE READ BY LAYOUT, NOT BY A HUMAN. An em dash
 * HOLDS a column; an empty string COLLAPSES it. Picking whichever spelling is
 * more common and migrating the rest would move a member-visible layout on four
 * product surfaces to save one function.
 *
 * ⛔⛔ NEITHER FUNCTION MAY CHANGE WHAT ANY CALL SITE RENDERS. Both are
 * byte-identical to the implementation they name, proved against FROZEN ORACLES
 * in `presentationPrimitives.test.js` — the pre-CP2 bodies, run in-process, not
 * a stored expected string.
 */

/**
 * A price for a DISCLOSURE — provenance, a receipt, a coverage line. Currency
 * symbol, fixed decimals, an em dash when there is nothing.
 *
 * Byte-identical to `presentationFormat.formatPrice`, which is already
 * `formatCurrency` under S10. Named separately because the CALL-SITE RULE is
 * the thing worth writing down: a reader of a disclosure must not have to guess
 * whether a bare number is dollars.
 */
export function formatPriceDisclosure(value, { decimals = 2, absent = ABSENT } = {}) {
  return formatCurrency(value, { decimals, absent })
}

/**
 * A price for a CHART SURFACE — a drawing label, a plan sheet, a stop input.
 * No currency symbol, decimals from the instrument's tick, EMPTY STRING when
 * there is nothing.
 *
 * Byte-identical to `chart/drawingLabels.formatPrice`, including every branch
 * of its magnitude fallback and its rejection of `''`/`null`/`undefined`
 * BEFORE coercion (`Number(null)` is 0, and a missing value would otherwise
 * print a real number nothing is actually at).
 *
 * ⚠️ ONE OF ITS CALL SITES IS BEHAVIOUR, NOT PRESENTATION. `StopConfirmSheet`
 * seeds an EDITABLE INPUT from `formatPrice(roundToTick(stop, tick), {tick})`,
 * so what this returns is what a member sees, edits and submits. Any future
 * change to the decimal rule is a member-visible behaviour change and needs its
 * own line.
 *
 * ⛔ `maxDecimals` caps the tick-derived precision at 6. A tick of 1e-9 would
 * otherwise ask for nine decimals on a price nobody quotes that way.
 */
export function formatPriceTick(value, { tick = null, maxDecimals = 6 } = {}) {
  if (value === null || value === undefined || value === '') return ''
  const v = Number(value)
  if (!Number.isFinite(v)) return ''
  if (tick && Number.isFinite(tick) && tick > 0) {
    const dp = Math.min(maxDecimals, Math.max(0, Math.ceil(-Math.log10(tick) - 1e-9)))
    return v.toFixed(dp)
  }
  const a = Math.abs(v)
  if (a === 0) return '0.00'
  if (a < 1) return v.toFixed(4)
  if (a < 1000) return v.toFixed(2)
  return v.toFixed(2)
}

// --------------------------------------------------------------------------
// 4. DATE / TIME WITH SESSION
// --------------------------------------------------------------------------

/**
 * A clock time in the MARKET's timezone, optionally suffixed with the zone
 * label the surfaces already print.
 *
 * `formatTimeEt(v, {seconds: true})`  is byte-identical to the retired
 *   `presentationFormat.formatEtTime(v)`.
 * `formatTimeEt(v, {seconds: false})` is byte-identical to the retired
 *   `FreshnessBadge.formatAsOf(v)`.
 *
 * ⭐ Those two were ONE formatter differing by a single field, in two files,
 * inside one four-component family — the smallest possible instance of the
 * problem S10 exists to end.
 *
 * ⛔ A falsy input and an unparseable input both return `absent`, exactly as
 * both predecessors did. `new Date(undefined)` is Invalid Date, and an Invalid
 * Date formatted is the literal string "Invalid Date" — which is what would
 * have reached a member if the guard were dropped.
 *
 * @param {string|number|Date|null|undefined} value  anything `new Date()` accepts
 * @param {{seconds?: boolean, zoneSuffix?: string|null, absent?: *}} [options]
 */
export function formatTimeEt(value, { seconds = false, zoneSuffix = null, absent = null } = {}) {
  if (!value) return absent
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return absent
  const opts = {
    timeZone: MARKET_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }
  if (seconds) opts.second = '2-digit'
  const text = d.toLocaleTimeString(LOCALE, opts)
  return zoneSuffix ? `${text} ${zoneSuffix}` : text
}

/**
 * A full date-and-time, PINNED TO THE MARKET ZONE, with a visible label.
 *
 * ⚰️ THIS WAS `formatDateTimeViewerLocal`, AND IT WAS A REAL MEMBER-VISIBLE
 * DEFECT. The retired implementation, verbatim:
 *
 *     export function formatDateTimeViewerLocal(epochSeconds, { absent = null } = {}) {
 *       if (!Number.isFinite(epochSeconds)) return absent
 *       return new Date(epochSeconds * 1000).toLocaleString(LOCALE)
 *     }
 *
 * A bare `toLocaleString` renders in the VIEWER's zone. `<Cited>` used it for
 * its `Validated:` timestamp while `<Provenance>` and `<FreshnessBadge>` pinned
 * ET a few pixels away — and NEITHER carried a zone label, which is the half
 * that made it invisible. One instant, one S8 surface, read four different ways:
 *
 *     viewer zone        BEFORE                      AFTER
 *     America/New_York   "9/11/2025, 9:32:15 AM"     "9/11/2025, 9:32:15 AM ET"
 *     America/Chicago    "9/11/2025, 8:32:15 AM"     "9/11/2025, 9:32:15 AM ET"
 *     Europe/London      "9/11/2025, 2:32:15 PM"     "9/11/2025, 9:32:15 AM ET"
 *     Asia/Tokyo         "9/11/2025, 10:32:15 PM"    "9/11/2025, 9:32:15 AM ET"
 *
 * ⭐ A LONDON READER WAS SHOWN A BAR VALIDATED AT "2:32 PM" AND NOTHING SAID
 * WHICH AFTERNOON THAT WAS. A provenance surface whose whole job is to say when
 * a value was true cannot leave the reader to guess the zone.
 *
 * ⛔ S10's FIRST BUILD DELIBERATELY DID NOT FIX THIS — its approval required
 * byte-identical rendering, and this moves a rendered string for every member
 * outside ET. It is fixed on its own line (owner, 2026-09-12) and the
 * before/after strings above are the record the ruling asked for.
 *
 * ⛔ THE LABEL IS NOT OPTIONAL. Pinning the zone without saying so would swap
 * one unlabelled timestamp for another, and a member in London would silently
 * read a number three hours earlier than the one they read yesterday.
 *
 * @param {*} epochSeconds
 * @param {{absent?: *}} [options]
 */
export function formatDateTimeEt(epochSeconds, { absent = null } = {}) {
  if (!Number.isFinite(epochSeconds)) return absent
  const text = new Date(epochSeconds * 1000).toLocaleString(LOCALE, {
    timeZone: MARKET_TIME_ZONE,
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  })
  return `${text} ET`
}

// --------------------------------------------------------------------------
// 5. FRESHNESS
// --------------------------------------------------------------------------

/**
 * The "as of ..." clause beside a freshness tier, or `null` when there must not
 * be one.
 *
 * ⭐ THE PRESENTATION RULE IT CARRIES: a REAL-TIME value gets no as-of clause.
 * Printing "as of 9:32 AM ET" beside the word LIVE tells a member the value is
 * minutes old when it is not — the clause exists to say how far behind the
 * value is, and for a live value the answer is "it isn't".
 *
 * ⛔ THE TIER IS AN INPUT, NEVER DERIVED HERE. D1's FreshnessClass is mapped to
 * a tier by `components/provenance/freshnessContract.js::mapD1Freshness`, which
 * is S8's contract and stays S8's. A second mapping in S10 would be a second
 * authority over one value, and the two would disagree the day either moved.
 *
 * @param {{tier?: string|null, asOf?: *, seconds?: boolean}} args
 * @returns {string|null}
 */
export function formatFreshnessAsOf({ tier = null, asOf = null, seconds = false } = {}) {
  if (tier === 'real_time') return null
  const t = formatTimeEt(asOf, { seconds, zoneSuffix: 'ET' })
  return t ? `as of ${t}` : null
}

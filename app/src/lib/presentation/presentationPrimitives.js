// app/src/lib/presentation/presentationPrimitives.js
//
// ─── S10 — PRESENTATION PRIMITIVES ──────────────────────────────────────────
//
// product-architecture.md's S10 block, built for the first time. Five pure
// functions — number, percent, currency, date/time-with-session, freshness —
// plus, since TERM-066, the magnitude-suffixed compact number (volume, market
// cap, revenue, share count), and nothing else. No React, no DOM, no clock, no
// locale detection, no network: every one is a total function from (value,
// options) to a string or a caller-chosen absent sentinel.
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
 * `grouping: false` drops the thousands separator ("1234.50", not
 * "1,234.50") for a value that sits in a dense numeric column or is a strike /
 * level a reader compares digit by digit — the options panels' old `toFixed`
 * grammar, which never grouped. With `decimals` it IS `toFixed(decimals)`, the
 * same rounding `formatPercent` / `formatCurrency` use: the locale formatter
 * rounds the SHORTEST decimal form (1.005 -> "1.01") where `toFixed` rounds
 * the stored double (1.005 -> "1.00"), and a migrated column must not move.
 *
 * @param {*} value
 * @param {{decimals?: number|null, grouping?: boolean, absent?: *}} [options]
 */
export function formatNumber(value, { decimals = null, grouping = true, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  if (!grouping) {
    return decimals == null
      ? Number(value).toLocaleString(LOCALE, { useGrouping: false })
      : Number(value).toFixed(decimals)
  }
  if (decimals == null) return Number(value).toLocaleString(LOCALE)
  return Number(value).toLocaleString(LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * A grouped decimal number capped at a MAXIMUM number of fraction digits, with
 * NO minimum — trailing zeros are never padded ("12.5", not "12.50"; "100",
 * not "100.00"). `formatNumber`'s `decimals` option sets both bounds equal,
 * which is the wrong shape for a value that may or may not carry a fraction.
 *
 * Byte-identical to `provenance/AbsenceReceipt.jsx`'s retired `fmtSignal`
 * number branch (S5/S8 rail `presentationSingleFormatter.test.js`, "no file in
 * it calls a locale formatter in CODE").
 *
 * @param {*} value
 * @param {{maxDecimals?: number, absent?: *}} [options]
 */
export function formatNumberMax(value, { maxDecimals = 2, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  return Number(value).toLocaleString(LOCALE, { maximumFractionDigits: maxDecimals })
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
  let body = Number(value).toFixed(decimals)
  // ⛔ A value that ROUNDS to zero is zero: -0.001 at two decimals is "0.00%", never
  // "-0.00%" — toFixed keeps the sign of what it rounded away (accuracy audit
  // 2026-10-06, design note 3). It gets no sign at all, signed render or not:
  // nothing positive happened either. (An exact or positive zero keeps "+0.00%".)
  const negZero = body.startsWith('-') && Number(body) === 0
  if (negZero) body = body.slice(1)
  // `toFixed` already carries the minus sign; only the plus is ours to add,
  // and only when the caller asked for a signed render.
  const sign = signed && !negZero && Number(value) >= 0 ? '+' : ''
  return `${sign}${body}%`
}

/**
 * A percent the SERVER already rounded, printed as sent: "3.27%", "3%", "87.5%" — ungrouped,
 * no padded zeros, at most three decimals (a server round to 1 or 2 places reads exactly as
 * sent). For a column whose server-side precision varies by row, where fixed decimals would
 * invent zeros ("3.00%") the server never sent.
 *
 * ⭐ It is the `${v}%` the terminal panels (RISK, ATTN, ERX, SEAS, BRD, U20) wrote by hand,
 * byte for byte, for every value a server round produces (oracle-tested at each call site),
 * with two differences that are fixes: a missing or non-numeric value is `absent`, never
 * "NaN%" or "—%"; and a numeric STRING ("3.5") is read as its number.
 *
 * @param {*} value    percent units
 * @param {{absent?: *}} [options]
 */
export function formatPercentAsSent(value, { absent = ABSENT } = {}) {
  const n = value == null || value === '' ? NaN : Number(value)
  if (!Number.isFinite(n)) return absent
  const body = n.toLocaleString(LOCALE, { useGrouping: false, maximumFractionDigits: 3 })
  // `${-0}` is "0"; the locale formatter writes "-0". A value that rounds to zero is zero.
  return `${body === '-0' ? '0' : body}%`
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
 * `grouping: true` adds the thousands separator ("$1,234", "-$12,500") for a money AMOUNT a
 * member reads as a total — a P&L, a block's premium, a per-contract cost — rather than a price
 * compared digit by digit. Rounding there is the locale formatter's half-away-from-zero, and a
 * value that ROUNDS to zero is zero ("$0", never "-$0": `formatPercent`'s rule). The default
 * (`grouping: false`) is unchanged, byte for byte.
 *
 * @param {*} value
 * @param {{decimals?: number, grouping?: boolean, absent?: *}} [options]
 */
export function formatCurrency(value, { decimals = 2, grouping = false, absent = ABSENT } = {}) {
  if (!Number.isFinite(value)) return absent
  if (!grouping) return signOutside('$', Number(value).toFixed(decimals))
  let body = Number(value).toLocaleString(LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (body.startsWith('-') && Number(body.slice(1).replace(/,/g, '')) === 0) body = body.slice(1)
  return signOutside('$', body)
}

/** A currency prefix goes INSIDE the minus: "-$2.90B", never "$-2.90B".
 *  `body` is the already-rounded number text, so a value that rounds to zero
 *  keeps whatever sign `toFixed` gave it. */
function signOutside(prefix, body) {
  const s = String(body)
  if (!prefix || !s.startsWith('-')) return `${prefix}${s}`
  return `-${prefix}${s.slice(1)}`
}

// --------------------------------------------------------------------------
// 3a. COMPACT — VOLUME, MARKET CAP, REVENUE, SHARE COUNT  (TERM-066)
// --------------------------------------------------------------------------

/**
 * The default magnitude ladder: B / M / K at one decimal. It is
 * `utils/profileFormat.fmtVol`'s rule, the most-copied one in the tree.
 * Ordered LARGEST FIRST — the first tier the magnitude reaches wins.
 */
export const COMPACT_TIERS = Object.freeze([
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 1 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
  Object.freeze({ at: 1e3, suffix: 'K', decimals: 1 }),
])

/**
 * ⭐ THE TERMINAL LADDER (round 2 visual pass, 2026-10-06). Every terminal
 * panel that prints a large number — revenue, market cap, flow premium, share
 * counts, volume — uses this ONE rule so the same quantity reads the same in
 * every panel:
 *
 *     T and B   two decimals     "$2.91T"  "$391.04B"
 *     M         one decimal      "$45.3M"  "12.4M"
 *     K         no decimals      "$950K"   "24K"
 *     < 1,000   whole number     "$812"
 *
 * Unit letters are always K/M/B/T, a currency sign sits inside the minus
 * ("-$1.25B"), and a value that rounds up to the next tier prints in it
 * (999,999 -> "1.0M", never "1000K"; see `formatCompact`). It is the research tabs' money grammar (EE/FA/OWN/FLOW and
 * the statement tables already agreed on it); the panels that disagreed
 * (calendar cards at one decimal on B/T, QuoteStrip volume at two on M, the
 * money columns that had no K tier) moved onto it.
 */
export const TERMINAL_COMPACT_TIERS = Object.freeze([
  Object.freeze({ at: 1e12, suffix: 'T', decimals: 2 }),
  Object.freeze({ at: 1e9, suffix: 'B', decimals: 2 }),
  Object.freeze({ at: 1e6, suffix: 'M', decimals: 1 }),
  Object.freeze({ at: 1e3, suffix: 'K', decimals: 0 }),
])

/** `formatCompact` on the terminal ladder. `money: true` adds the "$". */
export function formatCompactTerminal(value, { money = false, absent = ABSENT } = {}) {
  return formatCompact(value, { tiers: TERMINAL_COMPACT_TIERS, prefix: money ? '$' : '', absent })
}

/**
 * A number with a magnitude suffix — "11.8M", "$25.0B", "24K".
 *
 * ⭐ THE ONE PLACE A K/M/B SUFFIX IS DECIDED. The census
 * (`handRolledFormatters.census.test.js`) found this rule hand-written in
 * dozens of files, and they do NOT agree — so the ladder is a PARAMETER, and
 * each migrated grammar passes the ladder it already had rather than being
 * moved onto somebody else's:
 *
 *   • `tiers`  — `[{ at, suffix, decimals }]`, largest first. The tier is
 *     chosen on the MAGNITUDE (`Math.abs`), then PROMOTED once if rounding
 *     carried the number to the next tier's threshold: 999,950 at one decimal
 *     reads "1.0M", not "1000.0K"; 999.6 reads "1.0K", not "1000" (accuracy
 *     audit 2026-10-06, design note 2 — the grammars this replaced all printed
 *     the "1000K" form; only those boundary values moved). A ladder with no
 *     larger tier (COT's M ceiling) keeps "1000.00M": there is nothing to
 *     promote to.
 *   • `decimals` — a number is `toFixed(decimals)`. The string `'round'` is
 *     `Math.round`, which is NOT `toFixed(0)`: they part ways on a negative
 *     half (-2.5 → -2 one way, "-3" the other). The COT grammar has always
 *     rounded with `Math.round`.
 *   • `prefix` — written INSIDE the sign ("-$1.50B"). It used to sit outside
 *     ("$-1.50B", `fmtRevenue`'s old grammar), which a member reads as a
 *     typo; every prefix passed here is a currency symbol, so it follows the
 *     minus.
 *   • below the smallest tier: a `Math.round` integer, `prefix` in front.
 *
 * ⛔ Total, like every primitive here: a non-number or non-finite value
 * returns `absent` BEFORE any arithmetic. Callers that coerce (`Number(v)`,
 * `+v`) or gate (`n <= 0 → '—'`) keep doing so at their own boundary, where
 * the unit and the missing-value rule are known.
 *
 * ── OPTIONS FOR THE GRAMMARS THE LADDER ALONE COULD NOT CARRY (TERM-066) ──
 * Every one defaults to the behaviour above, so a caller that passes none of
 * them renders byte-for-byte what it did before these options existed.
 *
 *   • `decimals` may also be a FUNCTION of the magnitude (`Math.abs(value)`)
 *     returning a number or `'round'` — per-magnitude decimals inside one tier
 *     (the screener band's "12.5M" below 10M, "45M" above it).
 *   • `trim: true` drops trailing zeros from a `toFixed` body ("$1B", not
 *     "$1.0B"; "2.5", not "2.50") — `String(parseFloat(body))`, the grammar
 *     the signature levels already used. `'round'` bodies are unaffected.
 *   • `fixedUnit: true` — the SMALLEST tier also covers every value below it,
 *     so a ladder of one tier is a fixed unit ("0.40M", never "400000"), and a
 *     two-tier ladder never falls through to a bare integer ("$0K").
 *   • `promote: false` — keep the tier the magnitude chose even when rounding
 *     reaches the next tier's threshold ("1000K", "$1000M"). For grammars
 *     whose existing output is pinned exactly; new callers should leave it on.
 *
 * @param {*} value
 * @param {{tiers?: Array<{at:number, suffix:string,
 *            decimals:number|'round'|((magnitude:number)=>number|'round')}>,
 *          prefix?: string, absent?: *, trim?: boolean, fixedUnit?: boolean,
 *          promote?: boolean}} [options]
 */
export function formatCompact(value, {
  tiers = COMPACT_TIERS, prefix = '', absent = ABSENT,
  trim = false, fixedUnit = false, promote = true,
} = {}) {
  if (!Number.isFinite(value)) return absent
  const n = Number(value)
  const magnitude = Math.abs(n)
  const render = (i) => {
    const { at, suffix } = tiers[i]
    const decimals = typeof tiers[i].decimals === 'function' ? tiers[i].decimals(magnitude) : tiers[i].decimals
    const scaled = n / at
    let body = decimals === 'round' ? Math.round(scaled) : scaled.toFixed(decimals)
    if (trim && decimals !== 'round') body = String(parseFloat(body))
    return { text: `${signOutside(prefix, body)}${suffix}`, rounded: Math.abs(Number(body)) * at }
  }
  // ⛔ A value that ROUNDS up to the next tier's threshold prints in the next tier: 999,999 on
  // the terminal ladder is "1.0M", not "1000K" (accuracy audit 2026-10-06, design note 2). The
  // tier is chosen on the magnitude first, then promoted once if rounding carried it over.
  const promoted = (i, cur) => (promote && i > 0 && cur.rounded >= tiers[i - 1].at ? render(i - 1).text : cur.text)
  for (let i = 0; i < tiers.length; i++) {
    if (magnitude >= tiers[i].at) return promoted(i, render(i))
  }
  if (fixedUnit && tiers.length) return render(tiers.length - 1).text
  const whole = Math.round(n)
  if (promote && tiers.length && Math.abs(whole) >= tiers[tiers.length - 1].at) return render(tiers.length - 1).text
  return signOutside(prefix, whole)
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

// --------------------------------------------------------------------------
// 6. REPORTING CURRENCY — figures that are not US dollars
// --------------------------------------------------------------------------
//
// A US-listed ADR trades in dollars, but its statements and the analyst
// consensus on them are in the company's own currency: TSMC's FY2026 consensus
// EPS is 535.87 TAIWAN dollars, and printing it "$535.87" told a member TSM earns
// fifty times what it does (seen live 2026-10-06). The server states the
// currency (`currency: "TWD"`); these helpers put it on screen.
//
// ⛔ NOTHING HERE CONVERTS. A converted per-share figure would also need the
// ADR ratio (one TSM ADR = 5 ordinary shares), so the honest render is the
// figure in its own currency, labelled with the ISO code — never "$".
//
// ⭐ USD AND UNKNOWN RENDER EXACTLY AS BEFORE: `formatCurrencyIn(v, 'USD')` and
// `formatCurrencyIn(v, null)` are `formatCurrency(v)`, byte for byte, so a US
// name (and a payload that predates the field) moves nothing.

/** 'twd ' -> 'TWD'; anything that is not a three-letter code -> null. */
export function normalizeCurrencyCode(code) {
  if (typeof code !== 'string') return null
  const c = code.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(c) ? c : null
}

/** True only when the figures are KNOWN not to be US dollars. */
export function isForeignCurrency(code) {
  const c = normalizeCurrencyCode(code)
  return c !== null && c !== 'USD'
}

/** True when the payload STATED a currency (USD included); false when it did not. */
export function isKnownCurrency(code) {
  return normalizeCurrencyCode(code) !== null
}

// ⭐ AN UNKNOWN CURRENCY, TWO WAYS (owner decision 2026-10-07). Every helper below takes
// `{ unknown }`:
//   • 'usd' (the default) — unknown renders "$", byte for byte as it always has. Kept for the
//     surfaces whose figures ARE dollars whether or not the payload says so (US listings, 13F).
//   • 'none' — unknown renders NO symbol, and `reportingCurrencyNote` says "Currency not
//     reported". The FA and EE panels pass it: a filer's statements and consensus are in its
//     REPORTING currency, so when that is not stated a "$" is a guess (EstimateHistory's rule:
//     never a guessed "$"). Known USD stays "$"; known foreign stays its ISO code.
export const CURRENCY_NOT_REPORTED = 'Currency not reported.'
const bareWhenUnknown = (code, unknown) => unknown === 'none' && !isKnownCurrency(code)

/** The prefix for an amount in `code`: '$' for USD (and unknown, by default), 'TWD ' otherwise,
 *  and '' for unknown under `{ unknown: 'none' }`. */
export function currencyPrefix(code, { unknown = 'usd' } = {}) {
  if (isForeignCurrency(code)) return `${normalizeCurrencyCode(code)} `
  return bareWhenUnknown(code, unknown) ? '' : '$'
}

/** `formatCurrency` in the figure's own currency: "TWD 535.87", "-TWD 2.90"; a bare "2.90" for an
 *  unknown currency under `{ unknown: 'none' }`. */
export function formatCurrencyIn(value, code, { decimals = 2, absent = ABSENT, unknown = 'usd' } = {}) {
  if (!isForeignCurrency(code) && !bareWhenUnknown(code, unknown)) return formatCurrency(value, { decimals, absent })
  if (!Number.isFinite(value)) return absent
  return signOutside(currencyPrefix(code, { unknown }), Number(value).toFixed(decimals))
}

/** Relabel text a dollar formatter already produced ("$1.59B", "-$450M") for
 *  figures in `code` — or strip its "$" for an unknown currency under `{ unknown: 'none' }`.
 *  For callers whose formatter is not theirs to change. */
export function relabelDollarText(text, code, { unknown = 'usd' } = {}) {
  if (typeof text !== 'string') return text
  if (!isForeignCurrency(code) && !bareWhenUnknown(code, unknown)) return text
  return text.replace('$', currencyPrefix(code, { unknown }))
}

/** The one sentence a non-dollar table carries, or null for USD. For unknown: null by default,
 *  "Currency not reported." under `{ unknown: 'none' }`. */
export function reportingCurrencyNote(code, { unknown = 'usd' } = {}) {
  if (bareWhenUnknown(code, unknown)) return CURRENCY_NOT_REPORTED
  if (!isForeignCurrency(code)) return null
  const c = normalizeCurrencyCode(code)
  return `Figures in ${c}, the company's reporting currency. Not converted to US dollars; `
    + 'per-share figures are on the company\'s own share basis, which for an ADR may differ from one US-listed share.'
}

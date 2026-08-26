// ─── WHICH LANGUAGE IS THIS? ONE ANSWER, FOUR DIALECTS ──────────────────────
//
// ⭐ THE DECISION IS MADE ONCE, BEFORE ANY READ, AND NEVER AS A FALLBACK. Trying
// Pine, failing, then trying thinkScript would report a thinkScript refusal for
// a Pine typo — the wrong-door defect `pcf.js`'s own header records finding five
// times. Same rule, one dialect wider.
//
// ⛔ `pcf.js` KEEPS ITS DETECTOR AND THIS FILE CALLS IT. TC2000's marker set was
// measured against the whole committed PCF corpus; re-typing it here would be a
// second authority over one value — this repo's most repeated defect.
//
// ⚠️ ORDER IS THE WHOLE GRAMMAR: pine → thinkscript → pcf → formula. Pine first
// because `//@version` is a machine-readable pragma nothing else carries — and
// because it is already load-bearing on the real corpus, not just in theory:
// `pine/03-rsi-directional-momentum-scanner.pine` writes `crosses above` in its
// own prose, a thinkScript reserved phrase, so a thinkScript-first order hands a
// published Pine script to the wrong translator (measured 2026-08-25);
// thinkScript before PCF because a `;`-terminated statement is a shape PCF has
// no form for, and because `pcf.js::detectDialect` — asked about a language it
// was never given — answers WRONGLY IN BOTH DIRECTIONS (measured 2026-08-25 over
// all 75 committed scripts): 15 of the 24 thinkScript files come back `pcf` and
// the other 9 `native`, while THREE real published Pine scripts (`pine/17`,
// `pine/18`, `pine_community/02`) also come back `pcf`. Hence Pine and
// thinkScript are both decided HERE, and `pcf.js` is asked last — about the only
// two dialects its markers were ever measured against.

import { detectDialect as detectPcfDialect } from './pcf.js'

/** The names this product uses for a surface language. `formula` is the engine's
 *  own; `pcf.js` spells that one `native`, and `READER_NAME` is the ONE place the
 *  two vocabularies meet. */
export const DIALECTS = Object.freeze(['pine', 'thinkscript', 'pcf', 'formula'])

/** dialect → the key `pcf.js::READERS` (and `readFormulaSource`) knows it by. */
export const READER_NAME = Object.freeze({
  pine: 'native', thinkscript: 'native', pcf: 'pcf', formula: 'native',
})

/** Pine. `//@version` and `// @version` BOTH — two scripts in the committed
 *  community corpus write the space, and a detector that missed them would send
 *  real published Pine to another translator.
 *
 *  ⚠️ THE PRAGMA IS THE MARKER THAT SURVIVES A PASTE. Every one of the 51
 *  committed Pine scripts also carries a declaration call, so on whole files the
 *  second marker would do the job alone (measured 2026-08-25) — but a member
 *  pastes a FRAGMENT, and then the pragma is all there is. That is where the
 *  space tolerance is load-bearing, and `dialect.test.js` pins it there. */
const PINE_MARKERS = [
  /^[ \t]*\/\/[ \t]*@version[ \t]*=/m,
  /^[ \t]*(?:indicator|study|strategy|library)[ \t]*\(/m,
  /^[ \t]*import[ \t]+\w+\/\w+/m,
]

/** thinkScript. Every one of these is a shape no other dialect here can produce.
 *  ⭐ DERIVED FROM THE CORPUS, NOT FROM MEMORY: the two-word reserved phrases are
 *  in the list because `16-scan-rsi-crosses-30-70.ts` is a bare condition with no
 *  `def`, no `plot` and no `;` at all — without them it would fall through to
 *  `formula` and be read by the wrong door. */
const THINKSCRIPT_MARKERS = [
  /^[ \t]*declare[ \t]+(?:lower|upper|once|hide_on_daily|weak_volume_dependency|on_volume_profile)/im,
  /^[ \t]*(?:def|plot|input|rec)[ \t]+["\w]/im,
  /\bDouble\.(?:NaN|Pi|POSITIVE_INFINITY|NEGATIVE_INFINITY)\b/i,
  /\b(?:AddLabel|AddChartBubble|AddCloud|AddVerticalLine|AssignValueColor|AssignPriceColor|AssignBackgroundColor|SetDefaultColor|SetPaintingStrategy|SetLineWeight|CompoundValue|GetAggregationPeriod)[ \t]*\(/i,
  /\bcrosses[ \t]+(?:above|below)\b/i,
  /\bis[ \t]+(?:greater|less)[ \t]+than\b/i,
  /\bwithin[ \t]+\d+[ \t]+bars?\b/i,
  /\bAggregationPeriod\.[A-Z_]+/,
  /\bAverageType\.[A-Z_]+/i,
]

/**
 * Which surface language is this source written in?
 *
 * ⛔ IT NEVER PARSES. A detector that tried a parse would report a translator's
 * refusal for a source that belongs to a different translator.
 *
 * @param {string} source
 * @returns {'pine'|'thinkscript'|'pcf'|'formula'}
 */
export function detectDialect(source) {
  if (typeof source !== 'string' || source.trim() === '') return 'formula'
  if (PINE_MARKERS.some((re) => re.test(source))) return 'pine'
  if (THINKSCRIPT_MARKERS.some((re) => re.test(source))) return 'thinkscript'
  return detectPcfDialect(source) === 'pcf' ? 'pcf' : 'formula'
}

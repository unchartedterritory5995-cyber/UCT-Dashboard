// app/src/components/chart/builder/authoring/readableName.js
//
// ─── WHEN THE DOCK KEEPS THE ASSISTANT'S NAME FOR A NEW INDICATOR ────────────
//
// Measured on production 2026-11-15 over fourteen built indicators: the assistant named each
// well ("Distribution Day Count", "ATR Extension", "Tight Weekly Closes") and the dock showed
// "SUM 25 (1 when Close at or below 0.998 times previous Close and Volume above pr…", because a
// `create` always took the name DERIVED from the formula (`derivedName.js`).
//
// That rule exists for a measured reason and it STAYS for the case it was written for: a
// model-given "EMA 20" stayed "EMA 20" after "make it 50". A short derived name follows the
// maths and is kept. Only when the derived name is not something a person can read (it is long,
// or it reads like a formula) is the assistant's name kept instead, and only when that name IS
// a name: short words, no formula, no sentence.
//
// This is the dock's use of the `keepCreateName` seam in `authoringSession.modelTurn`, the one
// UCT Agent has used since the owner's ruling of 2026-11-04 ("created indicators get human
// names"). A kept name is a CUSTOM name: it is the member's to rename, and a later maths edit
// does not rewrite it. ⚠️ So a kept name that states a number ("50-Day Volume Ratio") can go
// stale after "make it 30"; at most two number words are allowed, the same bound the Agent uses.

/** A derived name longer than this is not kept as the indicator's name. */
export const DERIVED_READABLE_MAX = 28

const FORMULA = /[<>=+*^[\]·−×÷≥≤≠…(]|&&|\|\|/
// ⚠️ WIDER THAN THE AGENT'S RULE IN THREE PLACES, each measured on the assistant's own names
// (house set, 2026-11-16): a slash ("Previous Week High/Low", "EMA 10/21 Trend"), a percent
// sign ("Average Daily Range %"), and a bracketed number ("Up/Down Volume Ratio (50)").
// A bracket holding anything else is a call ("sum(close, 5)") and is still refused.
const BRACKETED_NUMBER = /\(\d{1,4}\)/g
const NOT_A_NAME = /[<>=+*^\\[\]{}()·−×÷$#@|;:!?"“”]|&&|\bhttps?\b|\b(?:when|where|if|that|which|above|below|crosses?|greater|less|than|times|minus|plus|divided)\b/i

/** Can a person read this derived name as a name? ("EMA 20" yes; a formula or a long one, no.) */
// ⭐ 2026-11-17 — ARITHMETIC SPELLED IN WORDS IS STILL A FORMULA. Measured on production over
// multi-turn conversations: "relative strength line versus SPY" was named "Relative Strength vs
// SPY" by the assistant and shown as "Close divided by SPY Close", because that derived name is
// short and carries no symbol; MACD's main line read "EMA 12 minus EMA 26". The derived name
// spells its operators as words, so the four arithmetic ones are read as what they are.
// ⛔ COMPARISONS ARE LEFT READABLE ON PURPOSE: "Close above SMA 50" is a sentence a member
// checks their request against, and it follows the maths after "make it 100", which a kept
// name would not.
const ARITHMETIC_WORDS = /\b(?:divided by|times|minus|plus)\b/i

export function derivedIsReadable(name) {
  const n = typeof name === 'string' ? name.trim() : ''
  return !!n && n.length <= DERIVED_READABLE_MAX && !FORMULA.test(n) && !ARITHMETIC_WORDS.test(n)
}

/** `raw` as a name, or null when it is not one: 3 to 40 characters, at most six words, no
 *  formula, no sentence words, at most two words carrying a number. */
export function humanName(raw) {
  const n = String(raw || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '')
  if (n.length < 3 || n.length > 40 || NOT_A_NAME.test(n.replace(BRACKETED_NUMBER, ''))) return null
  const words = n.split(' ')
  if (words.length > 6 || !/[A-Za-z]{2}/.test(n) || words.filter((w) => /\d/.test(w)).length > 2) return null
  return n
}

/**
 * The dock's answer to `keepCreateName(name, { derivedName })`: keep the assistant's name for
 * a new indicator only when it is a name and the derived one is not readable.
 */
export function keepAssistantName(name, { derivedName = null } = {}) {
  return !!humanName(name) && !derivedIsReadable(derivedName)
}

// ─── THE SAME QUESTION FOR EACH LINE OF A NEW INDICATOR ──────────────────────
//
// Measured on production 2026-11-17 (fifty requests through the window): the assistant labelled
// its lines well ("Signal", "Histogram", "+DI", "Upper Band", "RS at 52-week high") and the
// window, the chart's legend and the Plots tab showed "EMA 9 (MACD 12,26)",
// "MACD 12,26 minus EMA 9 (MACD 12,26)", "PLUSDI 14 (High, Low)" and
// "Close divided by SPY Close at or above HIGHEST 252 (Close d…". The rule is the name's rule:
// a short derived label follows the maths and is kept ("EMA 21", "SMA 50"); only where the
// derived one is not readable is the assistant's kept, and only when it IS a label. A kept label
// is CUSTOM (an appended `rename_output`): the member's to rename, and a later maths edit does
// not rewrite it, with the same two-number bound against going stale.
//
// ⚠️ A LABEL IS NOT A NAME IN THREE WAYS, each from the assistant's own labels in that run:
// two characters are enough ("%K", "R1"); a leading plus sign is part of it ("+DI"); and
// "above" / "below" are position words in a label ("% Below 52W High"), where in a NAME they
// mark a sentence.
const NOT_A_LABEL = /[<>=+*^\\[\]{}()·−×÷$#@|;:!?"“”]|&&|\bhttps?\b|\b(?:when|where|if|that|which|crosses?|greater|less|than|times|minus|plus|divided)\b/i

/** A line's label longer than this is not kept. */
export const LABEL_MAX = 32

/** `raw` as a line's label, or null when it is not one. */
export function humanLabel(raw) {
  const n = String(raw || '').replace(/\s+/g, ' ').trim().replace(/[.]+$/, '')
  if (n.length < 2 || n.length > LABEL_MAX) return null
  const body = n.replace(BRACKETED_NUMBER, '').replace(/^\+(?=[A-Za-z])/, '')   // "+DI": the sign is part of the label
  if (NOT_A_LABEL.test(body)) return null
  const words = n.split(' ')
  if (words.length > 6 || !/[A-Za-z]/.test(n) || words.filter((w) => /\d/.test(w)).length > 2) return null
  return n
}

/**
 * The dock's answer to `keepCreateLabel(label, { derivedLabel })`: keep the assistant's label
 * for a line of a new indicator only when it is a label and the derived one is not readable.
 */
export function keepAssistantLabel(label, { derivedLabel = null } = {}) {
  return !!humanLabel(label) && !derivedIsReadable(derivedLabel)
}

// app/src/pages/formulas/memberReason.js
//
// WHAT A MEMBER READS FOR A NAME THAT IS DELIBERATELY NOT AVAILABLE (Indicators backlog 31).
//
// The engine's table records WHY each absent name is absent, in the engine's words, for the people
// who maintain it: "CUMULATIVE FROM THE FIRST BAR, WITH NO ABSOLUTE SEED…", "DARK, 2026-11-14 (UCT
// RS screens, unit U…) … OFF in production". The reference page and its downloadable file printed
// those notes to members verbatim (measured 2026-11-17: 172 entries, a median of 519 characters,
// 133 with runs of capitals, some naming unreleased work, internal files and other firms).
//
// This is the member's layer over that roster, and nothing else reads it:
//   · a short sentence per KIND of reason, chosen from the reason's own opening words, so a new
//     entry of a known kind is covered the day it is added;
//   · entries that are not a member's business are LEFT OUT of the member's list: unreleased
//     columns, internal bookkeeping columns, and names that have since become available;
//   · anything unrecognised gets a plain fallback, never the engine's note.
//
// ⛔ THE ENGINE'S TABLE IS UNTOUCHED. Its reasons stay where the engine's owners read them. The
// substitute a member can paste (`item.instead`) is still the manifest's own, parsed formula.

const strip = (reason) => String(reason == null ? '' : reason).replace(/^[^A-Za-z`]+/, '')

/** Not shown to a member at all. */
const LEFT_OUT = [
  /^DARK\b/, /^TEXT, and DARK\b/,                         // unreleased columns
  /^DISPLAY-ONLY ARCHIVE CONTEXT/, /^NOT A MEMBER COLUMN/, /^RS EXIT WARNINGS/,
  /^an operations timestamp/, /^an `as_of` SOURCE/, /^the same, for the bar-dated family/,
  /\bAN EXPANSION SINCE\b/, /HAS IT AS AN EXPANSION/,     // available now: not "not available"
]

const NOT_FILLED = 'Not filled in yet, so a formula cannot read it. It becomes available once the nightly data carries it.'

/** The member's sentence, by how the engine's reason opens. First match wins. */
const SENTENCES = [
  [/^TEXT, for the same reason as `snapshot_d/, 'A date, not a number, so a formula cannot read it. Filter by it in the Screener.'],
  [/^TEXT\b/, 'Text, not a number, so a formula cannot read it. Filter or sort by it in the Screener.'],
  [/^Wave 7\b/, NOT_FILLED],
  [/^HELD BACK BECAUSE IT IS EMPTY/, NOT_FILLED],
  [/^for the same reason as `chg_pct_3m`/, NOT_FILLED],
  [/^NOT GRANTED YET/, 'A Screener filter, not a formula name yet. Use it as a filter in the Screener; on a chart, describe it and the UCT Agent writes the formula.'],
  [/^LIVE-ONLY/, 'A live extended-hours value. Formulas read the nightly snapshot, so it is a Screener column and not a formula name.'],
  [/^holds letter grades/, 'A letter grade, not a number. Filter by it in the Screener.'],
  [/^a comma-joined LIST/, 'A list of pattern names, not a number. Filter by pattern in the Screener.'],
  [/^the row's IDENTITY/, 'The symbol itself, not a value a formula reads.'],
  [/^CUMULATIVE FROM THE FIRST BAR|^THE SAME SHAPE AS `obv`|^A DIFFERENT SHAPE FROM `obv`|^THE EXACT MIRROR OF `nvi`/,
    'A running total from the first bar of history. Its level depends on how much history is loaded, so the same date could read two different numbers. Not available as a formula function.'],
  [/^A RANK, NOT A RANGE/, 'A percentile rank over a window, which the formula language cannot express yet.'],
  [/ALREADY EXPRESSIBLE/, 'No separate name is needed: it is a short formula.'],
  [/^AN N-BAR CHANGE/, 'A change over several bars has no function of its own: write the difference.'],
]

const FALLBACK = Object.freeze({ function: 'Not available as a formula function.', scalar: 'Not available to formulas.' })

/** Left out wherever the reason says it, not only where it opens with it: a column of the private
 *  archive is described as "TEXT" first and as archive context further on. */
const LEFT_OUT_ANYWHERE = /ARCHIVE CONTEXT/

/** `{ leftOut, says }` for one excluded entry of `buildVocabulary()`. */
export function memberReason(item) {
  const head = strip(item && item.reason)
  if (LEFT_OUT.some((re) => re.test(head)) || LEFT_OUT_ANYWHERE.test(head)
      || /^archive_/.test(String((item && item.name) || ''))) return { leftOut: true, says: null }
  const hit = SENTENCES.find(([re]) => re.test(head))
  return { leftOut: false, says: hit ? hit[1] : (FALLBACK[item && item.kind] || FALLBACK.scalar) }
}

/** The excluded roster as a member reads it: left-out entries dropped, each with `says`.
 *  Idempotent: an entry that already carries `says` is kept as it is. */
export function memberExcluded(excluded) {
  const out = []
  for (const item of Array.isArray(excluded) ? excluded : []) {
    if (item && typeof item.says === 'string') { out.push(item); continue }
    const m = memberReason(item)
    if (!m.leftOut) out.push({ ...item, says: m.says })
  }
  return out
}

/** A vocabulary (`buildVocabulary()`) with its excluded roster as a member reads it. */
export function memberVocabulary(vocab) {
  return { ...vocab, excluded: memberExcluded(vocab && vocab.excluded) }
}

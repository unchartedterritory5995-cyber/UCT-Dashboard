// app/src/components/chart/shortTag.js
//
// Does a result row's short tag only RESTATE its name?
//
// The tag (`shortName`, or a breadth row's `chip`) sits INSIDE the row's
// button, so its text joins the button's accessible name. When it repeats the
// name, VoiceOver reads "Parabolic SAR SAR", "TRIX TRIX", "AAPL AAPL"; the
// caller then marks it `aria-hidden` (still visible, just not spoken).
//
// A tag that adds something the name does not spell (a breadth population
// "NYSE", a security's type "ETF", a cadence "Daily", an abbreviation like
// "ADX" for "Average Directional Index") is information and stays in the name.
//
// It restates the name when, ignoring case and punctuation, it is:
//   - the name itself                      TRIX / TRIX, AAPL / AAPL
//   - a whole word run inside the name     SAR in Parabolic SAR, VWAP, Ichimoku
//   - a leading cut of the name            Vol / Volume, Stoch, Oops Reversa
//   - the initials of the name's words     RSI, MA, OBV (On-Balance Volume)
//
// ⛔⛔ THE LAST THREE ARE FOR ABBREVIATIONS ONLY. A TICKER IS AN IDENTIFIER,
// NOT AN ABBREVIATION: on a security row the name is the COMPANY and the tag is
// the only place the ticker is in the button's name ("Ford Motor Company" / F,
// "Visa Inc." / V, "International Business Machines" / IBM, "Meta Platforms" /
// META). Every rule but equality would hide it. So `exactOnly` keeps just the
// first rule, and `rowTagRestatesName` decides which a row gets.

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function tagRestatesName(name, tag, { exactOnly = false } = {}) {
  const n = words(name)
  const t = words(tag)
  if (!n.length || !t.length) return false
  const nj = n.join(' ')
  const tj = t.join(' ')
  if (exactOnly) return nj === tj
  // the name itself is the whole-run case: ' trix ' contains ' trix '
  if ((' ' + nj + ' ').includes(' ' + tj + ' ')) return true
  if (nj.startsWith(tj)) return true
  return t.length === 1 && n.length > 1 && n.map((w) => w[0]).join('') === t[0]
}

// The kinds whose `shortName` is the DEFINITION's abbreviation of its own name.
// A catalogue definition row in the Add surface carries no `kind` at all, and
// is one of these. Every other kind (security, breadth, fundamental,
// positioning, feature, and any kind added later) gets equality only, so a new
// kind can never lose information by default.
const ABBREVIATING_KINDS = new Set(['technical', 'builtin', 'formula'])

/** `tagRestatesName` for a result row, with the rule its kind is owed. */
export function rowTagRestatesName(row, tag) {
  if (!row) return false
  const abbreviates = !row.kind || ABBREVIATING_KINDS.has(row.kind)
  return tagRestatesName(row.name, tag, { exactOnly: !abbreviates })
}

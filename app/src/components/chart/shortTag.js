// app/src/components/chart/shortTag.js
//
// Does a result row's short tag only RESTATE its name?
//
// The tag (`shortName`, or a breadth row's `chip`) sits INSIDE the row's
// button, so its text joins the button's accessible name. When it repeats the
// name, VoiceOver reads "Parabolic SAR SAR", "TRIX TRIX", "AAPL AAPL"; the
// caller then marks it `aria-hidden` (still visible, just not spoken).
//
// Decided from the two STRINGS, never from a list of row kinds: a kind list is
// a second authority over "what this tag says", and an unknown kind would
// default one way or the other without looking. A tag that adds something the
// name does not spell (a breadth population "NYSE", a security's type "ETF",
// a cadence "Daily", an abbreviation like "ADX" for "Average Directional
// Index") is information and stays in the name.
//
// It restates the name when, ignoring case and punctuation, it is:
//   - the name itself                      TRIX / TRIX, AAPL / AAPL
//   - a whole word run inside the name     SAR in Parabolic SAR, VWAP, Ichimoku
//   - a leading cut of the name            Vol / Volume, Stoch, Oops Reversa
//   - the initials of the name's words     RSI, MA, OBV (On-Balance Volume)

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function tagRestatesName(name, tag) {
  const n = words(name)
  const t = words(tag)
  if (!n.length || !t.length) return false
  const nj = n.join(' ')
  const tj = t.join(' ')
  // the name itself is the whole-run case: ' trix ' contains ' trix '
  if ((' ' + nj + ' ').includes(' ' + tj + ' ')) return true
  if (nj.startsWith(tj)) return true
  return t.length === 1 && n.length > 1 && n.map((w) => w[0]).join('') === t[0]
}

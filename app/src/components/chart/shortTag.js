// app/src/components/chart/shortTag.js
//
// Does a result row's short tag only RESTATE its name?
//
// The tag (`shortName`, or a breadth row's `chip`) sits INSIDE the row's
// button, so its text joins the button's accessible name. When the name
// already says it, VoiceOver reads it twice: "Parabolic SAR SAR", "TRIX TRIX",
// "Nasdaq-100 E-Mini COT COT". The caller then marks the tag `aria-hidden`
// (still visible, just not spoken).
//
// ONE RULE: the tag's words, ignoring case and punctuation, are a whole-word
// run inside the name. That covers equality (TRIX / TRIX) and containment
// (Parabolic SAR / SAR, NAAIM Exposure Index / NAAIM, Meta Platforms Inc. / META).
//
// ⛔ NOTHING ELSE IS HIDDEN, and never by a list of row kinds:
//   - an abbreviation the name does not literally contain (RSI, ADX, OBV, MA,
//     "Oops Reversa") is VISIBLE text, and WCAG 2.5.3 Label in Name says the
//     visible label must be in the accessible name: a voice-control user who
//     says "click RSI" has to match. Hiding it to save a repeat would break that.
//   - a ticker is an identifier, not an abbreviation (Ford Motor Company / F,
//     IBM, COST): it is spoken unless the name already says it as a word.
// Visible text therefore leaves the accessible name only when the name already
// contains it, word for word.

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function tagRestatesName(name, tag) {
  const n = words(name)
  const t = words(tag)
  if (!n.length || !t.length) return false
  return (' ' + n.join(' ') + ' ').includes(' ' + t.join(' ') + ' ')
}

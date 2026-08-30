/**
 * ⛔ PRESENTATION ONLY. THE SENTENCE IS `theRead.js`'s, AND IT STAYS ITS.
 *
 * The Read is the one element on this tab meant to be read rather than looked
 * at, and a run of prose set at one weight is skimmed by nobody — a reader who
 * only wants the values has to read every word to find them. Weighting the
 * figures gives the strip two ways in.
 *
 * ⛔ AND IT MUST NOT BECOME A SECOND AUTHOR OVER THE SENTENCE. `theRead.js`'s
 * whole contract is that every clause traces to a number it derived; a view
 * layer that rewrote, reordered or dropped a clause to make it fit would put a
 * second authority over that. So this does the only safe thing: `String.split`
 * on a CAPTURING pattern, which re-emits every character of the input in order
 * — the odd indices are the matches, the even ones the text between them, and
 * their concatenation is the original by construction. It cannot add a word or
 * lose one. `TheReadStrip.test.jsx` pins that identity over every clause the
 * composer produces, with a control proving the split is not a no-op.
 *
 * The pattern deliberately swallows a leading sign and a trailing `%` or
 * ordinal so "+4.5%" and "1st" are emphasised whole rather than shedding their
 * unit; a date splits at its hyphens into three matched runs, which rejoins to
 * the same date and renders as one weighted token.
 */
const FIGURE = /([+-]?\d[\d,]*(?:\.\d+)?(?:%|st|nd|rd|th)?)/g
export const splitFigures = (text) => String(text ?? '').split(FIGURE)

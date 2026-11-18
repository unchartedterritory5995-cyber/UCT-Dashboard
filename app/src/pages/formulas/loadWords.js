// app/src/pages/formulas/loadWords.js
//
// HOW HEAVY A PUBLISHED INDICATOR IS TO DRAW, AS A MEMBER READS IT (Studio lane R6).
//
// The server measures a published indicator once, at publish: a count of the work it does over one
// fixed 5,000-bar series (never a clock, so the answer is the same on every machine), and files
// it in one of three classes against a budget. It sends `load` with a listing:
//
//   { class: 'light' | 'moderate' | 'heavy', work: <count> }     measured
//   { class: null, measured: false }                             not measured yet (a pasted script,
//                                                                until the service that runs those
//                                                                is switched on)
//   (absent)                                                     a listing from before this existed
//
// ⛔ THE CLASS IS THE SERVER'S. Nothing here turns a count into a class: a second set of
// thresholds in the browser would be a second authority over one decision. This file only words
// it. An absent `load` draws nothing; "not measured yet" is said in words, never guessed.

const WORDS = Object.freeze({
  light: 'Light to draw.',
  moderate: 'Moderate to draw: fine on a chart, noticeable across many charts at once.',
  heavy: 'Heavy to draw: slower to appear, most of all on a phone or with many charts open.',
})

/** The classes the server may send, lightest first. */
export const LOAD_CLASSES = Object.freeze(Object.keys(WORDS))

/**
 * The line for one listing's `load`, or null when there is nothing to say.
 * @returns {null | { code: 'light'|'moderate'|'heavy'|'unmeasured', text: string }}
 */
export function loadLine(load) {
  if (!load || typeof load !== 'object') return null
  if (typeof load.class === 'string' && WORDS[load.class]) return { code: load.class, text: WORDS[load.class] }
  if (load.measured === false) return { code: 'unmeasured', text: 'How heavy it is to draw has not been measured yet.' }
  return null
}

/** The time a fresh run took on THIS device, for the share preview: said as this device's, with
 *  the bar count it was measured over. Null for anything that is not a real measurement. */
export function deviceTimeLine(ms, bars) {
  // the engine's script lane is switched off in this build, so nothing was run here: said, not guessed
  if (ms && typeof ms === 'object' && ms.unmeasured) return 'The time on this device was not measured.'
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null
  if (!Number.isInteger(bars) || bars <= 0) return null
  const shown = ms < 1 ? 'under 1 ms' : ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`
  return `Drew ${bars.toLocaleString('en-US')} bars in ${shown} on this device.`
}

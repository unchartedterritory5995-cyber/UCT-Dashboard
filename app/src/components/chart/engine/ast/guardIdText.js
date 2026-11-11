// app/src/components/chart/engine/ast/guardIdText.js
//
// ─── THE MEMBER-TEXT GUARD-ID RULE (moved from lib/presentation/memberCopy.js, 2026-11-09) ───
//
// ⛔ ONE AUTHORITY, HOSTED IN THE CHART GROUP. Every chart-side surface that shows an engine sentence
// to a member (StockChart, ChartPane, the builder, the indicator dialogs, the scan card, the formula
// reference, the agent's alert relay) imports the rule from HERE. Importing it from `memberCopy.js`
// made that research-copy module a new shared chunk listed in the chart embeds' preload maps, which
// pushed `bytes.notebook_first_open` over budget on the engine-40 landing
// (tools/notebook_perf_budgets.py).
//
// ⭐ WHY `parse.js` RE-EXPORTS IT. `parse.js` sits in the `sentence` chunk that every one of those
// surfaces already loads; its re-export edge gives this module the same set of dependents, so Rollup
// places it INSIDE that chunk (no new chunk, no new preload filename; verified from the build
// manifest). It is NOT imported by `sentence.js`, whose import closure `interpret.test.js` holds to
// pure arithmetic (this module uses RegExp).
//
// The text below is the NO-GUARD-IDS lane's, verbatim; private constant names carry a GUARD_ prefix.
// `memberCopy.js` is its master content (memberText / memberSentence) for the research panels.

/** ⭐ THE ONE LIST of guard-id namespaces (`<ns>:<id>`). There is no guard registry in the
 *  engine: ids are string literals across the lanes (`pine:`, `runtime:`, `thinkscript:`, `pcf:`,
 *  ...). Measured 2026-11-08 (r4: the drift rail in attachedPineDisclosures.noGuardIds.test.jsx now enforces it) by grepping every `guard: '<ns>:` literal under app/src; add a
 *  namespace HERE when a lane mints a new one. The member rail
 *  (attachedPineDisclosures.noGuardIds.test.jsx) builds its pattern from this same list. */
export const GUARD_NAMESPACES = Object.freeze([
  'pine', 'runtime', 'strategy', 'enum', 'thinkscript', 'pcf', 'canonicalise', 'objects', 'alert',
  'import', 'other-symbol', 'request', 'let', 'picker', 'budget', 'resolve', 'probe', 'engine', 'bind',
  'consumer', 'presentation', 'sentence', 'chart', 'lower-tf', 'object', 'scan',
])

const GUARD_NS_ALT = GUARD_NAMESPACES.join('|')
/** A guard id: a known namespace, a colon, then an id that may carry `.`, `_`, `-`, `:` and the
 *  uppercase of an `err.name` (`runtime:runtime.error`, `runtime:TypeError`). Never `3:2`. */
export const GUARD_ID_SOURCE = String.raw`(?<![\w:-])(?:${GUARD_NS_ALT}):[A-Za-z0-9](?:[A-Za-z0-9._:-]*[A-Za-z0-9])?`

const GUARD_ID_RE_SRC = GUARD_ID_SOURCE
const GUARD_WHOLE_PAREN = new RegExp(String.raw`\s*\(\s*${GUARD_ID_RE_SRC}\s*\)`, 'g')           // " (pine:x)"
const GUARD_TRAILING_IN_PAREN = new RegExp(String.raw`\s*[,;]\s*${GUARD_ID_RE_SRC}(?=\s*\))`, 'g') // "(row 3, pine:x)"
const GUARD_LEADING_IN_PAREN = new RegExp(String.raw`\(\s*${GUARD_ID_RE_SRC}\s*[,;:]\s*`, 'g')     // "(pine:x, row 3)"
const GUARD_BACKTICKED = new RegExp('`' + GUARD_ID_RE_SRC + '`' + String.raw`\s*[,;:]?\s*`, 'g')   // "`pine:x`: oops"

/** `s` with every QUOTED guard id removed: a whole `(ID)` parenthetical, an `, ID` / `ID, `
 *  inside one (its parentheses kept), or a backticked id with its separator. ⛔ A bare id in the
 *  middle of a sentence is left alone: removing it eats the subject or the noun it stands for, so
 *  that sentence is its composer's to fix. Non-strings pass through unchanged. */
export function withoutGuardIds(s) {
  if (typeof s !== 'string') return s
  const t = s
    .replace(GUARD_WHOLE_PAREN, '')
    .replace(GUARD_TRAILING_IN_PAREN, '')
    .replace(GUARD_LEADING_IN_PAREN, '(')
    .replace(GUARD_BACKTICKED, '')
    .replace(/\s*\(\s*\)/g, '')
  return t === s ? s : t.trim()
}

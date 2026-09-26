// app/src/components/chart/engine/runtime/text.js
//
// ─── THE `str.*` TABLE THE RUNTIME EXECUTES ─────────────────────────────────
//
// ⛔⛔ WHY THIS IS NOT IN `interpret.js` WITH THE POINTWISE TABLE. `OP.POINTWISE`
// deliberately borrows the columnar lane's own scalar implementations, so a
// builtin over runtime state and the same builtin over a pure series are the
// same arithmetic BY CONSTRUCTION. That argument does not reach here, because
// the columnar lane has no text implementations to borrow and must not grow
// any: `pine.js::PINE_TEXT_PREDICATE` admits exactly four `str.*` names on the
// stated ground that each CONSUMES text and answers with a NUMBER, so nothing
// textual survives the fold — and says in the same breath that a text PRODUCER
// "is the step that would make text a value". These are producers. They belong
// where a slot can hold a value, which is here.
//
// ⭐ THE FOUR CONSUMERS APPEAR IN BOTH LANES, AND THAT IS INTENTIONAL, NOT A
// SECOND AUTHORITY. The columnar lane folds `str.contains(syminfo.ticker, "/")`
// at BIND time, when both operands are fixed for the binding; this lane answers
// the same question about a value that changes bar to bar, which that fold
// cannot see. Different inputs, same answer — and `strBuiltins.test.js` pins
// the agreement on the shapes both can reach.
//
// ⛔ EVERY ENTRY DECLARES ITS OPERAND KINDS, and the VM checks them from THAT
// declaration rather than each function checking its own. One check site cannot
// drift; seven hand-written checks can, and the one that drifts is the one
// nobody reads again.

/**
 * @typedef {object} TextFn
 * @property {string[]} args     operand kinds, in order ('string' today)
 * @property {'string'|'number'} returns
 * @property {Function} fn       applied only after the kinds are checked
 */

/** @type {Readonly<Record<string, TextFn>>} */
export const TEXT_FNS = Object.freeze({
  // ⛔⛔ `replaceAll`, NEVER `replace`. With a STRING needle, `replace` replaces
  // only the FIRST occurrence — so a member's `str.replace_all(list, "\n", ",")`
  // over a pasted watchlist would join the first two lines and silently drop
  // every symbol after them. Pine replaces every occurrence.
  //
  // ⛔ AND THE NEEDLE IS LITERAL, WHICH IS THE SECOND REASON A REGEX PATH IS
  // WRONG. `str.replace_all("BRK.B", ".", "-")` must give `BRK-B`; a regex `.`
  // matches any character and would give `---B`. Real tickers carry dots.
  // `String.prototype.replaceAll` with a string needle is literal by contract.
  'str.replace_all': {
    args: ['string', 'string', 'string'],
    returns: 'string',
    fn: (s, target, replacement) => s.replaceAll(target, replacement),
  },
  // ⚠️ Pine's `str.trim` removes leading and trailing whitespace. It does NOT
  // collapse the inside, which is why the test pins a fixture with an interior
  // space — a `.replace(/\s+/g, '')` would pass a naive fixture and mangle
  // every multi-word string a member has.
  'str.trim': { args: ['string'], returns: 'string', fn: (s) => s.trim() },
  'str.upper': { args: ['string'], returns: 'string', fn: (s) => s.toUpperCase() },
  'str.lower': { args: ['string'], returns: 'string', fn: (s) => s.toLowerCase() },

  // ── the consumers: text in, NUMBER out ──
  // ⭐ A Pine `bool` is 1/0 in this engine's value model, the same spelling the
  // columnar lane uses, so these compose with every existing numeric operator
  // and with `?:` without a conversion step.
  'str.contains': {
    args: ['string', 'string'], returns: 'number', fn: (s, sub) => (s.includes(sub) ? 1 : 0),
  },
  'str.startswith': {
    args: ['string', 'string'], returns: 'number', fn: (s, pre) => (s.startsWith(pre) ? 1 : 0),
  },
  // ⭐ `endswith` IS HERE THOUGH NEITHER ACCEPTANCE SCRIPT USES IT, and that is
  // a deliberate exception to "implement only what was measured". It is the
  // declared pair of `startswith` in `PINE_TEXT_PREDICATE`, so without it a
  // member gets `str.startswith` working over a mutable value and
  // `str.endswith` refused beside it — a refusal that is false about its own
  // neighbour, which this codebase records as the thing that teaches a reader
  // to distrust every refusal in the file.
  'str.endswith': {
    args: ['string', 'string'], returns: 'number', fn: (s, suf) => (s.endsWith(suf) ? 1 : 0),
  },
  'str.length': { args: ['string'], returns: 'number', fn: (s) => s.length },
})

/** The names this lane serves, for the front end's admission check. */
export const TEXT_NAMES = Object.freeze(Object.keys(TEXT_FNS))

/** Does this call PRODUCE text? Used by the front end's route decision — a call
 *  returning a number composes with ordinary arithmetic and needs no text
 *  routing, while one returning a string must stay out of the columnar lane. */
export const producesText = (name) => (
  Object.prototype.hasOwnProperty.call(TEXT_FNS, name) && TEXT_FNS[name].returns === 'string')

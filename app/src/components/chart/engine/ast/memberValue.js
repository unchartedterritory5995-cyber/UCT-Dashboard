// app/src/components/chart/engine/ast/memberValue.js
//
// ─── ⭐⭐ WHAT COUNTS AS A NUMBER A MEMBER SUPPLIED ──────────────────────────
//
// ⛔⛔ ONE PREDICATE, TWO DOORS, BECAUSE THE PRODUCT CANNOT ANSWER TWO WAYS ABOUT
// WHOSE NUMBER IS IN A FORMULA. `translatePine(src, {inputValues})` and
// `translateThinkScript(src, {inputValues})` both freeze a member's value into the
// tree before translation. Each had — or was about to grow — its own
// `Number.isFinite(Number(v))` test, and that test is WRONG in a way that is
// invisible until you look for it.
//
// ⚰️ THE MEASURED DEFECT, ON THE SHIPPED PINE DOOR:
//
//     inputValues: { th: null }   ->   `rsi(close, 14) < 0`     ok: true
//     inputValues: { th: [] }     ->   `rsi(close, 14) < 0`     ok: true
//     inputValues: { th: false }  ->   `rsi(close, 14) < 0`     ok: true
//     inputValues: { th: '' }     ->   `rsi(close, 14) < 0`     ok: true
//     inputValues: { th: '   ' }  ->   `rsi(close, 14) < 0`     ok: true
//     inputValues: { th: true }   ->   `rsi(close, 14) < 1`     ok: true
//
// `Number(null)`, `Number([])`, `Number(false)`, `Number('')` and `Number('  ')`
// are all `0`, and `0` is finite. So a member's RSI-below-30 screen became
// RSI-below-ZERO — a screen that matches nothing, on every symbol, forever, and
// looks exactly like a quiet market. This is the same `Number('') === 0` trap this
// repo has already paid for twice: once on a blank threshold, once on a blank
// length field.
//
// ⛔⛔ AND ITS OWN RAIL COULD NOT SEE IT. `pine.knob.test.js` asserts that a
// non-number refuses — over a fixture whose input is a WINDOW. `windowLiteral`
// refuses a zero-bar window downstream, so the test went green while the guard it
// names never fired (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`).
// Both knob tests now drive a THRESHOLD, where nothing downstream can save it.
//
// ⭐ SO THE RULE IS "IS THIS A NUMBER", NOT "CAN THIS BE COERCED TO ONE".
// A JS number that is finite, or a string that is entirely a number. Nothing else
// — no booleans, no null, no arrays, no empty or blank strings. A caller who
// genuinely means zero writes `0` or `'0'`, both of which are admitted.

/** The member's value as a finite number, or `null` if it is not one.
 *
 *  ⚠️ `null` IS THE REJECTION, and a valid `0` is NOT null — so callers must test
 *  `=== null`, never falsiness. Writing `if (!v)` here would throw away the one
 *  value a threshold most often wants.
 */
export function memberNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  // ⛔ A STRING IS ADMITTED ONLY IF IT IS ENTIRELY A NUMBER. Number fields hand
  // back strings, so refusing them outright would reject the door's own input; but
  // `Number` treats an empty or whitespace-only string as `0`, which is the whole
  // defect above. `trim() === ''` is tested BEFORE the conversion, never after.
  if (typeof value !== 'string') return null
  if (value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Is this text a number the member could have meant? ⭐ The same rule, asked of
 *  a translator's own printed default — `input.source(hl2)` folds to
 *  `(high + low) / 2` and `input averageType = AverageType.WILDERS` folds to a
 *  name, and neither is something a number may replace. */
export const isNumericText = (text) => memberNumber(text) !== null

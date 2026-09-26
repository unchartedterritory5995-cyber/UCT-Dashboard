// app/src/components/chart/engine/runtime/records.js
//
// ─── ⭐⭐ A USER-DEFINED TYPE IS A RECORD THIS LANE CARRIES AND CAN MUTATE ───
//
// Pine's `type Foo` / `Foo.new(…)` / `f.field` / `f.field := x` is the backbone
// of every modern order-block and market-structure script. `handles.js` closed
// the neighbouring gap — a DRAWING as a value — and its header ends with the
// sentence this file is the answer to:
//
//     "A member's own object cannot reach this lane today, but a `{family,
//      site}` test would start answering true for one the day a UDT can."
//
// It can now, and `isDrawingHandle` still asks a SYMBOL, so it does not.
//
// ⛔⛔ A RECORD IS MUTABLE, AND THAT IS PINE'S SEMANTICS RATHER THAN AN
// OVERSIGHT. Every other value this VM carries is immutable — a number, a
// string, a frozen drawing handle — and freezing was the first thing tried
// here. It is WRONG: Pine's UDT instances are REFERENCE types. The corpus idiom
//
//     ob = array.get(obs, i)
//     ob.breaker := true
//
// reads an element out of an array, writes one field, and expects the array's
// element to have changed. A copy-on-write record would leave the array holding
// the old value and the script would loop forever waiting for a flag it had
// already set — a wrong answer with nothing red anywhere. Measured demand for
// exactly that shape: 14 of the 16 real `runtime:udt` scripts write a field at
// all, and `bigbeluga-smart-money-concepts` writes 222 of them.
//
// ⛔⛔ AND THE FIELD TABLE IS FIXED AT CONSTRUCTION — BY ONE EXPLICIT CHECK,
// NOT BY TWO MECHANISMS. `fieldGet`/`fieldSet` refuse a name the type never
// declared, so `ob.typo := 1` is a named error rather than a field nobody
// declared appearing at run time and reading back `na` forever.
//
// ⚰️ `Object.seal(f)` WAS HERE AND IS GONE, on its own measurement. Deleting it
// left every case in `udtRecords.test.js` GREEN, because the explicit check
// fires first on every path that can reach the table — so the seal was a second
// guard over one value that nothing could make fire, sitting exactly where a
// reader counts it as protection (`lesson_a_guard_repeated_is_a_guard_unproved`).
// It is recorded rather than quietly dropped: a future direct write to `rec.f`
// would bypass the check, and the answer to that is to route it through
// `fieldSet`, not to re-add a seal nobody has seen work.
//
// ⛔ `kindOf` ANSWERS THE TYPE'S OWN NAME, NOT `'object'`. `collections.js`
// explains why `'drawing'` beat `'other'`: the refusal is what a member reads,
// and *"takes a number, got other"* names nothing they wrote. *"takes a number,
// got orderBlock"* names the type on their own line. No declared operand kind is
// ever a user type name, so every kind check in the VM refuses a record BY NAME
// instead of coercing it — which is the same argument, one type further out.

/** ⛔ ASKED BY SYMBOL, for the reason `handles.js` gives: a `{type, f}` duck
 *  test would start answering true for the next value model that happens to
 *  carry those two field names, and a value model that widens itself by
 *  accident is how a record becomes whatever was nearby. */
const TAG = Symbol.for('uct.pine.udtRecord')

export class RecordError extends Error {
  constructor(message) { super(message); this.name = 'RecordError' }
}

/**
 * One instance of a user-defined type.
 *
 * @param {string} type    the type name the member declared
 * @param {string[]} fields  the field names, in DECLARATION order
 * @param {any[]} values   one value per field, same order
 */
export function udtRecord(type, fields, values) {
  if (typeof type !== 'string' || !type) {
    throw new RecordError('udtRecord: a record carries the name of its type')
  }
  if (!Array.isArray(fields) || !Array.isArray(values) || fields.length !== values.length) {
    throw new RecordError(
      `udtRecord: \`${type}\` declares ${fields && fields.length} field(s) and `
      + `${values && values.length} value(s) were supplied`)
  }
  const f = {}
  for (let i = 0; i < fields.length; i += 1) f[fields[i]] = values[i]
  // ⛔ THE WRAPPER IS FROZEN even though `f` is not, so nothing downstream can
  // re-point a record at another type's fields and keep its name.
  return Object.freeze({ [TAG]: true, type, f })
}

export const isUdtRecord = (v) => (
  typeof v === 'object' && v !== null && v[TAG] === true)

/** ⛔ THE ONE READ SITE. A field the type never declared is a NAMED error, not
 *  `undefined` — `undefined` would flow on as `na` and a member would read a
 *  misspelled field as "no data for this bar", which is the wrong answer
 *  wearing the costume of a fact (`collections.js::at` makes the same trade). */
export function fieldGet(rec, name) {
  if (!isUdtRecord(rec)) {
    throw new RecordError(
      `\`.${name}\` reads a field of a user-defined type, and this value is `
      + `${rec === null || rec === undefined || Number.isNaN(rec) ? '`na`' : 'not one'}`
      + ' — Pine stops the script here rather than answering na')
  }
  if (!Object.prototype.hasOwnProperty.call(rec.f, name)) {
    throw new RecordError(`\`${rec.type}\` declares no field \`${name}\``)
  }
  return rec.f[name]
}

/** ⛔ THE ONE WRITE SITE, and it refuses an undeclared field for the same
 *  reason `fieldGet` does — and it is an EXPLICIT check rather than a sealed
 *  object because the sentence is what a member reads. A seal fails SILENTLY in
 *  sloppy mode and throws a bare `TypeError` naming a JavaScript rule in strict
 *  mode; neither names the type and field the member wrote. See the header. */
export function fieldSet(rec, name, value) {
  if (!isUdtRecord(rec)) {
    throw new RecordError(
      `\`.${name} :=\` writes a field of a user-defined type, and this value is `
      + `${rec === null || rec === undefined || Number.isNaN(rec) ? '`na`' : 'not one'}`
      + ' — Pine stops the script here rather than ignoring the write')
  }
  if (!Object.prototype.hasOwnProperty.call(rec.f, name)) {
    throw new RecordError(`\`${rec.type}\` declares no field \`${name}\``)
  }
  rec.f[name] = value
  return value
}

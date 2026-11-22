// app/src/components/chart/engine/ast/typeDescriptor.js
//
// ─── ⭐⭐ W6-T3a — ONE STATIC TYPE PER SLOT ───────────────────────────────────
//
// The runtime front end used to carry a value's static type as separate flags on
// each slot (`collection`, `elemText`, `elemColour`, `elemUdt`, `udt`, `colour`,
// `text`, and the drawing family), set at five binding sites and read by a dozen
// helpers. Each new family (matrix, map, enum) would have added another flag, and
// two flags could disagree about one value with nothing red. This module holds
// the ONE shape that replaces them all:
//
//     slots[s].ty = { kind, elem?, key?, name?, declaredOnly? }
//
//   kind   'array' | 'matrix' | 'map' | 'udt' | 'drawing' | 'enum'
//          | 'num' | 'text' | 'colour' | 'bool'
//   elem   a descriptor: the element type of an array / matrix, the VALUE type of
//          a map (absent when neither the declaration nor the initialiser says)
//   key    a descriptor: the key type of a map
//   name   the user type (`udt`), the drawing family (`drawing`), the enum (`enum`)
//   declaredOnly  true when the WRITTEN type supplied the collection kind and the
//          initialiser did not build a collection (`var array<Foo> obs = na`). The
//          front end reads it at the C18 object door ONLY, where master's reading
//          (collection kind from the initialiser alone) is kept.
//
// ⛔ THIS MODULE IS PURE: it knows type WORDS and descriptors, never a scope, a slot
// table or a parse node. The front end owns the reading of a binding
// (`pineRuntimeFrontend.js::bindSlotTy`) and is the only writer of `slots[s].ty`.
// Every reader goes through the getters below, so "is this slot a collection?" has
// one answer in one place.
//
// For the W6 tasks that build on this (docs/pine/W6-BREAKDOWN.md §4):
//   · T7 / T8: `tyOfTypeWord('matrix' | 'map', typeArgs)` answers
//     `{kind:'matrix', elem}` / `{kind:'map', key, elem}` today; the method form
//     asks `methodNsOf(ty)` and gets `'matrix'` / `'map'` for those receivers, so a
//     member they serve is looked up under its own family.
//   · T10: pass the script's enum names as `opts.enums`; `E e = …` then reads
//     `{kind:'enum', name:'E'}`.
//   · T3b: `exprType` answers these same descriptors (`makeTy`) and reads a name's
//     type through the front end's `slotTy(slot)`.

export const TY_KINDS = Object.freeze(['array', 'matrix', 'map', 'udt', 'drawing', 'enum',
  'num', 'text', 'colour', 'bool'])
const KIND_SET = new Set(TY_KINDS)
export const COLLECTION_KINDS = Object.freeze(new Set(['array', 'matrix', 'map']))
/** The kinds whose WRITTEN type wins over the initialiser: references, whose `na`
 *  initialiser carries no type. Scalars keep master's initialiser reading (see
 *  `bindingTy`). */
const REFERENCE_KINDS = new Set(['array', 'matrix', 'map', 'udt', 'drawing', 'enum'])

/** The drawing families a WRITTEN type names on this lane (`var line l = na`) — the
 *  roster `markDrawingSlot` read before T3a, kept exact (`polyline` is not one). */
export const DRAWING_TYPE_WORD = /^(line|label|box|table|linefill)$/

/**
 * Build a descriptor. ⛔ An unknown kind THROWS: a descriptor this module cannot
 * name is a front-end bug, and a malformed type would read as "untyped" to every
 * getter with nothing red.
 */
export function makeTy(kind, { elem = null, key = null, name = null, declaredOnly = false } = {}) {
  if (!KIND_SET.has(kind)) throw new Error(`typeDescriptor: unknown kind ${JSON.stringify(kind)}`)
  const ty = { kind }
  if (elem) ty.elem = elem
  if (key) ty.key = key
  if (name) ty.name = name
  if (declaredOnly) ty.declaredOnly = true
  return Object.freeze(ty)
}

/**
 * A WRITTEN Pine type → its descriptor, or null when it is not a type this lane
 * can name.
 *
 * @param {string}   word       the type head (`float`, `array`, `Foo`, `line`)
 * @param {string[]} [typeArgs] the lexer's `typeArgs` (`array<Foo>` → ['Foo'],
 *                              `map<string, float>` → ['string', 'float'])
 * @param {{udtTypes?: {has: Function}, enums?: {has: Function}}} [opts]
 */
/** ⛔ HONESTY-SWEEP item 5 (2026-11-07) — the WRITTEN number word (`int` / `float`) of a `num`
 *  descriptor made from a type word. This lane has ONE number type (`num`), so the word rides
 *  BESIDE the descriptor (a WeakMap on its identity), never in its shape: every `num` stays
 *  `{kind:'num'}` to every reader and rail. Read only by `collectionNumWordsConflict`. */
const NUM_WORD = new WeakMap()
export const numWordOf = (ty) => (ty && typeof ty === 'object' && NUM_WORD.get(ty)) || null

/** Do two COLLECTION types hold numbers of DIFFERENT written words (`array<int>` where
 *  `array<float>` is declared, or a map's key / value)? Only when both words are known. A
 *  scalar `int` passed to a `float` is NOT asked here (Pine converts it). */
export function collectionNumWordsConflict(want, got) {
  if (!want || !got || want.kind !== got.kind) return false
  if (want.kind !== 'array' && want.kind !== 'matrix' && want.kind !== 'map') return false
  const inner = (a, b) => {
    if (!a || !b) return false
    if (a.kind === 'num' && b.kind === 'num') {
      const x = numWordOf(a)
      const y = numWordOf(b)
      return !!(x && y && x !== y)
    }
    return collectionNumWordsConflict(a, b)
  }
  return inner(want.elem || null, got.elem || null) || inner(want.key || null, got.key || null)
}

export function tyOfTypeWord(word, typeArgs, opts = {}) {
  const w = String(word == null ? '' : word)
  const args = Array.isArray(typeArgs) ? typeArgs : []
  const { udtTypes = null, enums = null } = opts
  switch (w) {
    case 'float': case 'int': {
      const t = makeTy('num')
      NUM_WORD.set(t, w)
      return t
    }
    case 'bool': return makeTy('bool')
    case 'string': return makeTy('text')
    case 'color': return makeTy('colour')
    default: break
  }
  if (w === 'array' || w === 'matrix') {
    // ⛔ A WRITTEN COLLECTION TYPE CARRIES ITS `<T>`. The lexer attaches `typeArgs`
    // only to a real declaration (`stripTypeArguments`), so a bare `array` word is
    // not a written type and names nothing here.
    if (args.length !== 1) return null
    return makeTy(w, { elem: elemTyOf(args[0], opts) })
  }
  if (w === 'map') {
    if (args.length !== 2) return null
    return makeTy('map', { key: elemTyOf(args[0], opts), elem: elemTyOf(args[1], opts) })
  }
  if (udtTypes && udtTypes.has(w)) return makeTy('udt', { name: w })
  if (enums && enums.has(w)) return makeTy('enum', { name: w })
  if (DRAWING_TYPE_WORD.test(w)) return makeTy('drawing', { name: w })
  return null
}

/** An element type argument → its descriptor. ⛔ Pine has no nested collections (a
 *  UDT wrapper is the idiom), so a nested or collection argument answers null —
 *  "the declaration does not say" — never a guess. */
function elemTyOf(arg, opts) {
  const a = String(arg == null ? '' : arg)
  if (!a || /[<>]/.test(a) || COLLECTION_KINDS.has(a)) return null
  return tyOfTypeWord(a, null, opts)
}

/**
 * ONE RULE FOR A BINDING'S TYPE: the written type first, else the initialiser.
 *
 * ⭐ A WRITTEN REFERENCE TYPE WINS (`var array<Foo> obs = na`, `var Foo ob = na`,
 * `var line l = na`): the corpus declares these empty and fills them by
 * assignment, which declares nothing, so an initialiser-only rule would leave the
 * slot untyped. A written collection with no element type takes the element of an
 * initialiser collection of the SAME kind.
 *
 * ⛔ A WRITTEN SCALAR (`string s = na`, `color c = na`) DOES NOT OVERRIDE THE
 * INITIALISER, and when the initialiser has no type only `num` / `bool` are
 * recorded. Master marked text and colour slots from the initialiser alone (a
 * colour-typed NAME is still read by `colourTypedNamesOf`); making a written
 * `string` a text slot changes what `+` and `:=` lower to, which is a served
 * change and not this refactor's.
 *
 * @param {object|null} declared  `tyOfTypeWord` of the written type, or null
 * @param {object|null} init      the initialiser's descriptor, or null
 */
export function bindingTy(declared, init) {
  if (declared && REFERENCE_KINDS.has(declared.kind)) {
    if (!COLLECTION_KINDS.has(declared.kind)) return declared
    const same = init && init.kind === declared.kind ? init : null
    return makeTy(declared.kind, {
      elem: declared.elem || (same && same.elem) || null,
      key: declared.key || (same && same.key) || null,
      declaredOnly: !isCollectionTy(init),
    })
  }
  if (init) return init
  if (declared && (declared.kind === 'num' || declared.kind === 'bool')) return declared
  return null
}

// ── the getters: every reader of a slot's type asks one of these ───────────────

export const isCollectionTy = (ty) => !!ty && COLLECTION_KINDS.has(ty.kind)
/** The element descriptor of a collection, or null. */
export const elemTy = (ty) => (isCollectionTy(ty) && ty.elem) || null
/** The element kind of a collection (`'text'`, `'colour'`, `'udt'`, …), or null. */
export const elemKindOf = (ty) => { const e = elemTy(ty); return e ? e.kind : null }
/** The user type a record slot holds, or null. */
export const udtNameOf = (ty) => (ty && ty.kind === 'udt' ? ty.name : null)
/** The user type a collection's elements are, or null. */
export const elemUdtOf = (ty) => { const e = elemTy(ty); return e && e.kind === 'udt' ? e.name : null }
/** The drawing family a handle slot holds, or null. */
export const drawingOf = (ty) => (ty && ty.kind === 'drawing' ? ty.name : null)
export const isTextTy = (ty) => !!ty && ty.kind === 'text'
export const isColourTy = (ty) => !!ty && ty.kind === 'colour'
/**
 * ⭐ THE METHOD FORM'S NAMESPACE — `ufcs.methodFormCall`'s `nsOf` callback: a
 * collection receiver's own family. `m.rows()` on a matrix is `matrix.rows(m)`,
 * never `array.rows(m)`; null for anything that is not a collection.
 */
export const methodNsOf = (ty) => (isCollectionTy(ty) ? ty.kind : null)

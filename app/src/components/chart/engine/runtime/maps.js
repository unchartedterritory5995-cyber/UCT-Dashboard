// app/src/components/chart/engine/runtime/maps.js
//
// ─── ⭐⭐ W6-T8 — `map.*` ON THE RUNTIME LANE ────────────────────────────────
//
// A sibling of `collections.js` (arrays) and `matrices.js` (W6-T7). The members are
// built here and merged into `collections.js`'s ONE table (`ARRAY_FNS`), so the VM
// dispatches them through its one collection op and the front end admits them
// through its one admitter (`admitArrayCall`). `collections.js` hands its error
// class in (`buildMapFns`), so a stop here is `runtime:CollectionError` like every
// other collection stop, with no import cycle.
//
// ⭐ EVERY SERVED RULE IS A SENTENCE TradingView PUBLISHES, quoted where it is used:
//   · REF  — the Pine v6 reference, read 2026-11-06 through
//            `tools/pine_survey/pine_reference_extract.js` (`map.new<type,type>`,
//            `map.put`, `map.get`, `map.remove`, `map.keys`, `map.values`, `map.copy`, …);
//   · MAN  — the Pine user manual, Maps page
//            (https://www.tradingview.com/pine-script-docs/language/maps/, read 2026-11-06).
// Every rail in `__tests__/w6Map.test.js` quotes the sentence it rests on.
//
// ⛔ WHAT NEITHER TEXT SETTLES STOPS THE RUN BY NAME and is a row in W6-K1
// (`docs/pine/capture-queue-2026-11-06-w6.md`, probe `vw-w6-map.pine`):
//   · an `na` key (does `na` equal `na` as a key? the texts name no rule);
//   · a key type the run does not hold (an enum key waits for W6-T10).
//
// ⛔ A MAP IS A REFERENCE, like an array: `m2 = m` is a second name for one map and
// only `map.copy` makes another (MAN: "Modifications to a shallow copy do not affect
// the original `id` map or its internal insertion order."). The slot holds the map
// object itself, so assignment aliases with no handle table.

const MAP_TAG = Symbol.for('uct.pine.map')

/** Is this runtime value a map? A Symbol tag, never the shape of the object. */
export const isMap = (v) => !!(v && typeof v === 'object' && v[MAP_TAG] === true)

/** A map value: its declared key type (`kt`), its declared VALUE type (`vt`, `null` when the
 *  run was not told) and a JS `Map`, whose iteration order IS insertion order and whose `set`
 *  of a present key keeps that key's place — the two rules REF states (see `map.put`).
 *  ⛔ Not frozen: `vmState.cloneValues` shares frozen values, and a map is mutable. */
export const mapFromParts = (keyType, entries, valueType = null) => (
  { [MAP_TAG]: true, kt: keyType, vt: valueType, m: new Map(entries || []) })

/** The front end's `typeArg` for `map.new<K, V>` carries both type words, `K,V`
 *  (`pineRuntimeFrontend.js::admitArrayCall`). */
export const MAP_TYPE_SEP = ','
/** The front end's `typeArg` on a `map.put` / `map.remove` whose ANSWER the script reads (a
 *  value, not a statement). A statement drops the answer, so a missing key's `na` is never
 *  seen there and nothing need stop. */
export const MAP_ANSWER_READ = 'read'

/** MAN: "Similar to arrays and matrices, maps can contain up to 100,000 elements in
 *  total. However, because each key-value pair in a map consists of two elements (a
 *  unique key and associated value), the maximum number of key-value pairs that a map
 *  can contain is 50,000." */
export const MAP_MAX_PAIRS = 50000

/** REF (`map.new<type,type>`): "`keyType` can be a primitive type or enum. For example:
 *  int, float, bool, string, color." A colour is a packed integer in this runtime
 *  (`colours.js`), and a bool rides the numeric stack, so every key here is a JS number
 *  or string, compared by value. ⛔ An enum key is not held until W6-T10. */
const KEY_TYPES = Object.freeze({ int: 'number', float: 'number', bool: 'number', color: 'number', string: 'string' })

/** ⛔⛔ W6-T8 r1 (review B1) — A PINE 6 `bool` IS NEVER `na`. MAN says a missing key's `get`
 *  "returns na", and REF says `put` / `remove` answer "na" for a new / missing key; but REF's
 *  `bool` type says "Bool" variables can have values true or false. For a bool-valued map in
 *  v6 the two texts conflict, and what TradingView answers (`false`? a runtime error?) is
 *  unstated, so the run STOPS BY NAME there (W6-K1, probe row N05): the same fail-closed rule
 *  as `pineRuntimeFrontend.js` ("A PINE 6 `bool` IS NEVER `na`") and the unmeasured bool array
 *  fill (`collections.js::UNMEASURED_FILL`). Every other value type holds `na` in v6 (int,
 *  float, string, color, a user type, a drawing), and a v5-or-older `bool` holds `na` (MAN's
 *  answer stands there). ⛔ An unknown value type (`vt` null) or an unknown version is treated
 *  as the case that can fail: it stops. */
const naAnswerable = (map, budget) => (
  (map.vt !== null && map.vt !== undefined && map.vt !== 'bool')
  || !!(budget && Number.isFinite(budget.pineVersion) && budget.pineVersion < 6))

const W6K1 = 'the Pine reference and manual do not settle it, so the run stops here rather than '
  + 'serving a guessed convention (W6-K1)'

/** The `map.*` members, built against `collections.js`'s error class.
 *  @param {{ CollectionError: Function }} deps */
export function buildMapFns({ CollectionError }) {
  const unpinned = (what) => new CollectionError(`${what} — ${W6K1}`)

  /** The `na` a missing / new key answers — or a stop by name where the map's value type
   *  cannot hold `na` (`naAnswerable`). */
  const naAnswer = (map, budget, what) => {
    if (naAnswerable(map, budget)) return NaN
    throw unpinned(`\`${what}\` answers \`na\` for a missing key, and a v6 \`map<${map.kt}, ${map.vt || '?'}>\` value `
      + 'cannot be `na` (REF: "Bool" variables can have values true or false)')
  }

  /** The map argument. ⛔ An `na` map id is a runtime error in Pine: a NAMED stop, never
   *  the VM's kind sentence (the arguments are declared `any` so this is the one check). */
  const mapArg = (v, what) => {
    if (isMap(v)) return v
    if (typeof v === 'number' && Number.isNaN(v)) {
      throw new CollectionError(`\`${what}\`: the map is \`na\` (no map was assigned to it before this call); `
        + 'Pine stops the script here with a runtime error')
    }
    throw new CollectionError(`\`${what}\` takes a map, got ${v === null ? 'null' : typeof v}`)
  }

  /** A key: of the map's declared key type, and never `na` (W6-K1). */
  const keyArg = (map, k, what) => {
    if (typeof k === 'number' && Number.isNaN(k)) throw unpinned(`\`${what}\` with an \`na\` key`)
    const want = KEY_TYPES[map.kt]
    if (typeof k !== want) {
      throw new CollectionError(`\`${what}\`: a key of a \`map<${map.kt}, …>\` is a ${map.kt}, got ${typeof k}`)
    }
    return k
  }

  /** REF (`map.new<type,type>`): "`valueType` can be of any type except `array<>`,
   *  `matrix<>`, and `map<>`." A script that holds one cannot compile in Pine. */
  const valueArg = (v, what) => {
    if (Array.isArray(v) || isMap(v) || (v && typeof v === 'object' && v[Symbol.for('uct.pine.matrix')] === true)) {
      throw new CollectionError(`\`${what}\`: a map's value cannot be an array, a matrix or a map (the reference)`)
    }
    return v
  }

  /** One more pair, inside MAN's 50,000 and the run's element budget (two elements a pair). */
  const roomFor = (map, extra, what, budget) => {
    const n = map.m.size + extra
    if (n > MAP_MAX_PAIRS) {
      throw new CollectionError(`\`${what}\`: a map holds at most ${MAP_MAX_PAIRS} key-value pairs, and this `
        + `would make ${n} — Pine stops the script here`)
    }
    budget.peak('ARRAY_ELEMENTS', 2 * n)
  }

  return {
    // REF: "Creates a new map object: a collection that consists of key-value pairs, where
    // all keys are of the `keyType`, and all values are of the `valueType`."
    'map.new': {
      args: [], returns: 'map', generic: true, minArgs: 0, maxArgs: 0,
      fn: (a, budget, typeArg) => {
        const [kt, vt] = String(typeArg || '').split(MAP_TYPE_SEP)
        if (!Object.prototype.hasOwnProperty.call(KEY_TYPES, kt)) {
          throw new CollectionError(`map.new<${kt || '?'}, …>: this runtime holds a map keyed by int, float, `
            + 'bool, string or color (the reference\'s primitive key types); an enum key waits for W6-T10')
        }
        // ⛔⛔ HONESTY-SWEEP item 4 (2026-11-07) — A COLOUR KEY. REF lists `color` among the key
        // types, but no sentence says when two colours are the SAME key: this runtime compared
        // packed RGBA, so `color.new(color.red, 50)` and `color.red` were two keys (and a
        // colour made by `color.rgb`, `color.from_gradient` or an input the same or not by its
        // bytes). Until capture Q-HS4 (`vw-hs4-map-color-key.pine`) settles it, the run stops
        // here by name rather than serving a guessed equality.
        if (kt === 'color') {
          throw new CollectionError('map.new<color, …>: a map keyed by colour — when two colours are the same '
            + 'key (and whether transparency counts) is not stated by the Pine reference or manual, so the run '
            + 'stops here rather than serving a guessed equality (Q-HS4)')
        }
        return mapFromParts(kt, null, vt || null)
      },
    },
    // REF: "Returns the number of key-value pairs in the `id` map."
    'map.size': {
      args: ['any'], returns: 'number',
      fn: (a) => mapArg(a[0], 'map.size').m.size,
    },
    // MAN: "This function returns the value if the `id` map contains the `key`.
    // Otherwise, it returns na."
    'map.get': {
      args: ['any', 'any'], returns: 'any',
      fn: (a, budget) => {
        const map = mapArg(a[0], 'map.get')
        const k = keyArg(map, a[1], 'map.get')
        return map.m.has(k) ? map.m.get(k) : naAnswer(map, budget, 'map.get')
      },
    },
    // REF: "Returns true if the `key` was found in the `id` map, false otherwise."
    'map.contains': {
      args: ['any', 'any'], returns: 'number',
      fn: (a) => {
        const map = mapArg(a[0], 'map.contains')
        return map.m.has(keyArg(map, a[1], 'map.contains')) ? 1 : 0
      },
    },
    // REF: "The previous value associated with `key` if the key was already present in
    // the map, or na if the key is new." / "Maps maintain insertion order. Note that the
    // order does not change when inserting a pair with a `key` that's already in the map.
    // The new pair replaces the existing pair with the `key` in such cases."
    // ⭐ JS `Map#set` of a present key keeps its place, and of a new key appends — the
    // two halves. A key REMOVED and then put is new (REF's own word), and MAN names it as
    // the exception to "does not change": "The only exception is if the script completely
    // removes the key beforehand." So it is inserted where a new key is, at the end.
    'map.put': {
      args: ['any', 'any', 'any'], returns: 'any',
      fn: (a, budget, typeArg) => {
        const map = mapArg(a[0], 'map.put')
        const k = keyArg(map, a[1], 'map.put')
        const v = valueArg(a[2], 'map.put')
        budget.charge('ARRAY_OPERATIONS', 1)
        const had = map.m.has(k)
        // a READ answer for a new key is `na` (or a stop: `naAnswer`); a statement drops it
        const prev = had ? map.m.get(k) : (typeArg === MAP_ANSWER_READ ? naAnswer(map, budget, 'map.put') : NaN)
        if (!had) roomFor(map, 1, 'map.put', budget)
        map.m.set(k, v)
        return prev
      },
    },
    // MAN: "This function puts all key-value pairs from the `id2` map, in their insertion
    // order, into the `id1` map. As with map.put(), if any keys in `id2` are also present
    // in `id1`, this function replaces the key-value pairs that contain those keys without
    // affecting their initial insertion order."
    'map.put_all': {
      args: ['any', 'any'], returns: 'void',
      fn: (a, budget) => {
        const map = mapArg(a[0], 'map.put_all')
        const src = mapArg(a[1], 'map.put_all')
        if (map.kt !== src.kt) {
          throw new CollectionError(`\`map.put_all\`: a \`map<${src.kt}, …>\` into a \`map<${map.kt}, …>\``)
        }
        let fresh = 0
        for (const k of src.m.keys()) if (!map.m.has(k)) fresh += 1
        roomFor(map, fresh, 'map.put_all', budget)
        budget.charge('ARRAY_OPERATIONS', Math.max(1, src.m.size))
        // ⛔ a snapshot first: `m.put_all(m)` must not read what it writes
        for (const [k, v] of [...src.m]) map.m.set(k, v)
      },
    },
    // REF: "The previous value associated with `key` if the key was present in the map, or
    // na if there was no such key." MAN: "This function removes the key and its associated
    // value from the map while preserving the insertion order of other key-value pairs."
    'map.remove': {
      args: ['any', 'any'], returns: 'any',
      fn: (a, budget, typeArg) => {
        const map = mapArg(a[0], 'map.remove')
        const k = keyArg(map, a[1], 'map.remove')
        budget.charge('ARRAY_OPERATIONS', 1)
        if (!map.m.has(k)) return typeArg === MAP_ANSWER_READ ? naAnswer(map, budget, 'map.remove') : NaN
        const prev = map.m.get(k)
        map.m.delete(k)
        return prev
      },
    },
    // REF: "Returns an array of all the keys in the `id` map. The resulting array is a copy
    // and any changes to it are not reflected in the original map." / "Maps maintain
    // insertion order. The elements within the array returned by this function will also
    // be in the insertion order."
    'map.keys': {
      args: ['any'], returns: 'array',
      fn: (a, budget) => {
        const map = mapArg(a[0], 'map.keys')
        budget.charge('ARRAY_OPERATIONS', map.m.size)
        budget.peak('ARRAY_ELEMENTS', map.m.size)
        return [...map.m.keys()]
      },
    },
    // REF: the same two sentences for `map.values`.
    'map.values': {
      args: ['any'], returns: 'array',
      fn: (a, budget) => {
        const map = mapArg(a[0], 'map.values')
        budget.charge('ARRAY_OPERATIONS', map.m.size)
        budget.peak('ARRAY_ELEMENTS', map.m.size)
        return [...map.m.values()]
      },
    },
    // REF: "Creates a copy of an existing map." MAN: "Scripts can make a shallow copy of an
    // `id` map by using the map.copy() function. Modifications to a shallow copy do not
    // affect the original `id` map or its internal insertion order." Shallow: a value that
    // is a record is the SAME record in both (MAN: "point to the same objects as the
    // original").
    'map.copy': {
      args: ['any'], returns: 'map',
      fn: (a, budget) => {
        const map = mapArg(a[0], 'map.copy')
        budget.peak('ARRAY_ELEMENTS', 2 * map.m.size)
        budget.charge('ARRAY_OPERATIONS', map.m.size)
        return mapFromParts(map.kt, map.m, map.vt)
      },
    },
    // REF: "Clears the map, removing all key-value pairs from it."
    'map.clear': {
      args: ['any'], returns: 'void',
      fn: (a, budget) => {
        budget.charge('ARRAY_OPERATIONS', 1)
        mapArg(a[0], 'map.clear').m.clear()
      },
    },
  }
}

/** What each member writes (`collections.js::ARRAY_WRITES`'s vocabulary): `size` = the
 *  map's pair count can change, so a `for` bound reading `map.size` is moved by it. */
export const MAP_WRITES = Object.freeze({
  'map.new': 'none', 'map.size': 'none', 'map.get': 'none', 'map.contains': 'none',
  'map.keys': 'none', 'map.values': 'none', 'map.copy': 'none',
  'map.put': 'size', 'map.put_all': 'size', 'map.remove': 'size', 'map.clear': 'size',
})

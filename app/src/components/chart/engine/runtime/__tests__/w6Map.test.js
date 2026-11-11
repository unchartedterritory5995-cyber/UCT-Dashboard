// app/src/components/chart/engine/runtime/__tests__/w6Map.test.js
//
// ─── ⭐⭐ W6-T8 — `map.*` ON THE RUNTIME LANE ────────────────────────────────────
//
// Each member here is served from a sentence TradingView publishes, and nothing else:
//   · REF — the Pine v6 reference entry (read 2026-11-06 through
//           `tools/pine_survey/pine_reference_extract.js`);
//   · MAN — the Pine user manual, Maps page
//           (https://www.tradingview.com/pine-script-docs/language/maps/, read 2026-11-06).
// Each `describe` quotes the sentence it rests on. What neither text states STOPS the run by
// name — `W6-K1` in `docs/pine/capture-queue-2026-11-06-w6.md`, probe
// `tools/visual_conformance/probes/vw-w6-map.pine` — and every such stop has a rail below that
// reaches it. The members live in `runtime/maps.js`, dispatched through `collections.js`'s ONE
// table (`ARRAY_FNS`).
//
// ⛔ EVERY FIXTURE MOVES with the bars: the expected value is computed here in JavaScript from
// the same bars, never typed in. Keys are put OUT of sorted order ("b", "a", "c"), so insertion
// order and sorted order disagree and a sorting implementation goes red.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { Budget } from '../limits.js'
import { ARRAY_FNS, DOOR_GATED_ARRAY, kindOf } from '../collections.js'
import { isMap, MAP_MAX_PAIRS } from '../maps.js'
import { encodeState, cloneValues } from '../vmState.js'

const N = 6
const BARS = Array.from({ length: N }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 99.5 + i, h: 101.25 + i * 2, l: 98.75 - i, c: 100.5 + i * 3, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const per = (f) => BARS.map((b, i) => f(b, i))

function build(src, version = 6, extra = {}) {
  return buildRuntimeIr(`//@version=${version}\nindicator("t", overlay = true)\n${src}`, { bars: BARS, inputs: {}, ...extra })
}
function runPine(src, version = 6) {
  const built = build(src, version)
  if (!built.ok) throw new Error(`refused: ${built.refusal.guard} — ${built.refusal.message}`)
  const program = lowerIrProgram(built.ir)
  const { outputs } = execute(program, { bars: N, series: SERIES, columns: program.columns, confirmed: true })
  return outputs.map((o) => Array.from(o))
}
const nan = () => NaN
// "b" ← close, "a" ← open, "c" ← high: insertion order b, a, c; sorted order a, b, c
const BAC = 'm = map.new<string, float>()\nm.put("b", close)\nm.put("a", open)\nm.put("c", high)\n'

describe('⭐ map.new — REF: "Creates a new map object: a collection that consists of key-value pairs"', () => {
  it('an empty map of the declared key type; the name form and a `var` binding', () => {
    const [s, t] = runPine('m = map.new<string, float>()\nplot(map.size(m))\nvar map<int, float> n = map.new<int, float>()\nn.put(bar_index, close)\nplot(n.size())')
    expect(s).toEqual(per(() => 0))
    expect(t).toEqual(per((_, i) => i + 1))
  })
  it('REF: "`keyType` can be a primitive type or enum. For example: int, float, bool, string, color." — each primitive is held (a colour key stops: HONESTY-SWEEP item 4, `honestySweep.test.js`)', () => {
    const [i, f, b, s] = runPine('mi = map.new<int, float>()\nmi.put(3, close)\nplot(mi.get(3))\n'
      + 'mf = map.new<float, float>()\nmf.put(1.5, open)\nplot(mf.get(1.5))\n'
      + 'mb = map.new<bool, float>()\nmb.put(true, high)\nplot(mb.get(true))\n'
      + 'ms = map.new<string, float>()\nms.put("k", low)\nplot(ms.get("k"))')
    expect(i).toEqual(per((b0) => b0.c))
    expect(f).toEqual(per((b0) => b0.o))
    expect(b).toEqual(per((b0) => b0.h))
    expect(s).toEqual(per((b0) => b0.l))
  })
  it('⛔ a key type this run does not hold (an enum waits for W6-T10) stops by name', () => {
    const budget = new Budget()
    expect(() => ARRAY_FNS['map.new'].fn([], budget, 'Dir')).toThrow(/map\.new<Dir, …>.*W6-T10/)
  })
})

describe('⭐ map.put — REF: "The previous value associated with `key` if the key was already present in the map, or na if the key is new."', () => {
  it('a new key answers na; a present key answers the PREVIOUS value, not the new one', () => {
    const [first, second] = runPine('m = map.new<string, float>()\nplot(m.put("a", close))\nplot(map.put(m, "a", open))')
    expect(first).toEqual(per(nan))
    expect(second).toEqual(per((b) => b.c))
  })
  it('the new value replaces the old (REF: "When adding a new value with a key that the map already contains, that value replaces the old value associated with the key.")', () => {
    const [g, s] = runPine(`${BAC}m.put("a", low)\nplot(m.get("a"))\nplot(m.size())`)
    expect(g).toEqual(per((b) => b.l))
    expect(s).toEqual(per(() => 3))
  })
  it('as a statement, its value is dropped', () => {
    const [s] = runPine('m = map.new<int, float>()\nmap.put(m, 1, close)\nm.put(2, open)\nplot(m.size())')
    expect(s).toEqual(per(() => 2))
  })
})

describe('⭐ insertion order — REF: "Maps maintain insertion order. Note that the order does not change when inserting a pair with a `key` that\'s already in the map."', () => {
  it('keys() is in insertion order (b, a, c), NOT sorted', () => {
    const [k0, k1, k2] = runPine(`${BAC}k = m.keys()\nplot(str.length(array.get(k, 0)) * (array.get(k, 0) == "b" ? 1 : 0))\nplot(array.get(k, 1) == "a" ? 1 : 0)\nplot(array.get(k, 2) == "c" ? 1 : 0)`)
    expect(k0).toEqual(per(() => 1))
    expect(k1).toEqual(per(() => 1))
    expect(k2).toEqual(per(() => 1))
  })
  it('values() follows the same order (REF map.values: "The elements within the array returned by this function will also be in the insertion order.")', () => {
    const [v0, v1, v2] = runPine(`${BAC}v = m.values()\nplot(array.get(v, 0))\nplot(array.get(v, 1))\nplot(array.get(v, 2))`)
    expect(v0).toEqual(per((b) => b.c))
    expect(v1).toEqual(per((b) => b.o))
    expect(v2).toEqual(per((b) => b.h))
  })
  it('a re-put of an EXISTING key keeps its place (b stays first, its value replaced)', () => {
    const [first, val, last] = runPine(`${BAC}m.put("b", low)\nk = m.keys()\nplot(array.get(k, 0) == "b" ? 1 : 0)\nplot(array.get(m.values(), 0))\nplot(array.get(k, 2) == "c" ? 1 : 0)`)
    expect(first).toEqual(per(() => 1))
    expect(val).toEqual(per((b) => b.l))
    expect(last).toEqual(per(() => 1))
  })
  // MAN: "Pine Script internally maintains the insertion order of a map's key-value pairs." With the old slot
  // excluded ("The only exception is if the script completely removes the key beforehand.") and the key "new"
  // (REF put), the end is the only position consistent with all three.
  it('a key REMOVED and put again is a new key, at the end (MAN: "Pine Script internally maintains the insertion order of a map’s key-value pairs."; REF put: "na if the key is new"; MAN: "The only exception is if the script completely removes the key beforehand.")', () => {
    const [r, last, first] = runPine(`${BAC}m.remove("b")\nplot(m.put("b", low))\nk = m.keys()\nplot(array.get(k, 2) == "b" ? 1 : 0)\nplot(array.get(k, 0) == "a" ? 1 : 0)`)
    expect(r).toEqual(per(nan))
    expect(last).toEqual(per(() => 1))
    expect(first).toEqual(per(() => 1))
  })
})

describe('⭐ map.get — MAN: "This function returns the value if the `id` map contains the `key`. Otherwise, it returns na."', () => {
  it('a present key answers its value; a missing key answers na', () => {
    const [g, miss] = runPine(`${BAC}plot(m.get("c"))\nplot(map.get(m, "zz"))`)
    expect(g).toEqual(per((b) => b.h))
    expect(miss).toEqual(per(nan))
  })
})

describe('⭐ map.contains — REF: "Returns true if the `key` was found in the `id` map, false otherwise."', () => {
  it('true for a present key, false for a missing one', () => {
    const [y, n] = runPine(`${BAC}plot(m.contains("a") ? 1 : 0)\nplot(map.contains(m, "zz") ? 1 : 0)`)
    expect(y).toEqual(per(() => 1))
    expect(n).toEqual(per(() => 0))
  })
})

describe('⭐ map.remove — REF: "The previous value associated with `key` if the key was present in the map, or na if there was no such key."', () => {
  it('answers the removed value, then na; MAN: "while preserving the insertion order of other key-value pairs"', () => {
    const [r, again, s, k0, k1] = runPine(`${BAC}plot(m.remove("a"))\nplot(map.remove(m, "a"))\nplot(m.size())\nk = m.keys()\nplot(array.get(k, 0) == "b" ? 1 : 0)\nplot(array.get(k, 1) == "c" ? 1 : 0)`)
    expect(r).toEqual(per((b) => b.o))
    expect(again).toEqual(per(nan))
    expect(s).toEqual(per(() => 2))
    expect(k0).toEqual(per(() => 1))
    expect(k1).toEqual(per(() => 1))
  })
})

describe('⭐ map.keys / map.values — REF: "The resulting array is a copy and any changes to it are not reflected in the original map."', () => {
  it('a write to the returned array does not reach the map', () => {
    const [s, g] = runPine(`${BAC}k = m.keys()\narray.push(k, "z")\nv = m.values()\narray.set(v, 0, -1.0)\nplot(m.size())\nplot(m.get("b"))`)
    expect(s).toEqual(per(() => 3))
    expect(g).toEqual(per((b) => b.c))
  })
  it('a name bound to `map.keys` / `map.values` is an ARRAY: its method form is `array.*`, not `map.*`', () => {
    const [s, v] = runPine(`${BAC}k = map.keys(m)\nvs = map.values(m)\nplot(k.size())\nplot(vs.get(1))`)
    expect(s).toEqual(per(() => 3))
    expect(v).toEqual(per((b) => b.o))
  })
  it('an empty map answers empty arrays', () => {
    const [k, v] = runPine('m = map.new<string, float>()\nplot(array.size(m.keys()))\nplot(array.size(m.values()))')
    expect(k).toEqual(per(() => 0))
    expect(v).toEqual(per(() => 0))
  })
})

describe('⭐ map.size / map.clear — REF: "Returns the number of key-value pairs in the `id` map." / "Clears the map, removing all key-value pairs from it."', () => {
  it('size counts pairs; clear empties', () => {
    const [s, c, g] = runPine(`${BAC}plot(m.size())\nm.clear()\nplot(map.size(m))\nplot(m.get("a"))`)
    expect(s).toEqual(per(() => 3))
    expect(c).toEqual(per(() => 0))
    expect(g).toEqual(per(nan))
  })
})

describe('⭐ a map is a REFERENCE; map.copy is a second one — MAN: "Modifications to a shallow copy do not affect the original `id` map or its internal insertion order."', () => {
  it('an alias sees a write through the other name', () => {
    const [s, g] = runPine(`${BAC}m2 = m\nm2.put("d", low)\nplot(m.size())\nplot(m.get("d"))`)
    expect(s).toEqual(per(() => 4))
    expect(g).toEqual(per((b) => b.l))
  })
  it('a copy keeps the order and is independent of the original', () => {
    const [cs, os, k0, og] = runPine(`${BAC}c = map.copy(m)\nc.put("d", low)\nc.remove("a")\nplot(c.size())\nplot(m.size())\nplot(array.get(c.keys(), 0) == "b" ? 1 : 0)\nplot(m.get("a"))`)
    expect(cs).toEqual(per(() => 3))
    expect(os).toEqual(per(() => 3))
    expect(k0).toEqual(per(() => 1))
    expect(og).toEqual(per((b) => b.o))
  })
  // ⚠️ At the member level: reading a record field off `c.get("a")` is a member chain on a
  // call result (`pine:member`, T9's receiver work), and a METHOD-form initialiser
  // (`c = m.copy()`) leaves `c` untyped for arrays too (`b = a.copy()` refuses `b.size`).
  it('shallow: a record value is the SAME record in both (MAN: "point to the same objects as the original")', () => {
    const budget = new Budget()
    const rec = { v: 1 }
    const m = ARRAY_FNS['map.new'].fn([], budget, 'string')
    ARRAY_FNS['map.put'].fn([m, 'a', rec], budget)
    const c = ARRAY_FNS['map.copy'].fn([m], budget)
    expect(c).not.toBe(m)
    expect(ARRAY_FNS['map.get'].fn([c, 'a'], budget)).toBe(rec)
  })
  it('a `var` map persists across bars', () => {
    const [s] = runPine('var m = map.new<int, float>()\nm.put(bar_index % 3, close)\nplot(m.size())')
    expect(s).toEqual(per((_, i) => Math.min(i + 1, 3)))
  })
})

describe('⭐ map.put_all — MAN: "This function puts all key-value pairs from the `id2` map, in their insertion order, into the `id1` map. … replaces the key-value pairs that contain those keys without affecting their initial insertion order."', () => {
  it('new keys append in id2\'s order; a shared key keeps id1\'s place and takes id2\'s value', () => {
    const [s, k0, k3, k4, v0] = runPine(`${BAC}m2 = map.new<string, float>()\nm2.put("e", low)\nm2.put("b", volume)\nm2.put("d", open)\nmap.put_all(m, m2)\nk = m.keys()\nplot(m.size())\nplot(array.get(k, 0) == "b" ? 1 : 0)\nplot(array.get(k, 3) == "e" ? 1 : 0)\nplot(array.get(k, 4) == "d" ? 1 : 0)\nplot(m.get("b"))`)
    expect(s).toEqual(per(() => 5))
    expect(k0).toEqual(per(() => 1))
    expect(k3).toEqual(per(() => 1))
    expect(k4).toEqual(per(() => 1))
    expect(v0).toEqual(per((b) => b.v))
  })
})

describe('⛔ W6-T8 r1 (review B1) — a v6 `bool` is never `na`: a missing key on a bool-valued map STOPS by name (W6-K1, N05)', () => {
  // MAN map.get: "Otherwise, it returns na."  REF `bool`: "\"Bool\" variables can have values true or false."
  // In v6 the two conflict for a `map<_, bool>`; what TradingView answers is unstated, so the run stops.
  const BM = 'm = map.new<string, bool>()\nm.put("t", close > open)\n'
  it('get of a missing key stops; get of a present key and contains are served', () => {
    expect(() => runPine(`${BM}x = m.get("zz")\nplot(x ? 1 : 2)`)).toThrow(/`map\.get` answers `na` for a missing key, and a v6 `map<string, bool>` value cannot be `na`.*W6-K1/)
    const [p, c] = runPine(`${BM}plot(m.get("t") ? 1 : 2)\nplot(m.contains("zz") ? 1 : 0)`)
    expect(p).toEqual(per((b) => (b.c > b.o ? 1 : 2)))
    expect(c).toEqual(per(() => 0))
  })
  it('put of a NEW key and remove of a missing key stop when their answer is READ', () => {
    expect(() => runPine(`${BM}x = m.put("q", true)\nplot(x ? 1 : 2)`)).toThrow(/`map\.put` answers `na`.*W6-K1/)
    expect(() => runPine(`${BM}x = map.remove(m, "zz")\nplot(x ? 1 : 2)`)).toThrow(/`map\.remove` answers `na`.*W6-K1/)
  })
  it('as STATEMENTS (the answer dropped) put and remove are served; a READ put of a PRESENT key answers the previous value', () => {
    const [s, prev] = runPine(`${BM}m.put("q", true)\nmap.remove(m, "zz")\nm.remove("q")\nplot(m.size())\nplot(m.put("t", false) ? 1 : 2)`)
    expect(s).toEqual(per(() => 1))
    expect(prev).toEqual(per((b) => (b.c > b.o ? 1 : 2)))
  })
  it('in v5 a bool holds na, so MAN\'s answer stands: get of a missing key is na', () => {
    const [x] = runPine(`${BM}plot(na(m.get("zz")) ? 1 : 0)`, 5)
    expect(x).toEqual(per(() => 1))
  })
  it('every other v6 value type holds na: int, string, color answer na for a missing key', () => {
    const [i, s, c] = runPine('mi = map.new<string, int>()\nplot(na(mi.get("z")) ? 1 : 0)\n'
      + 'ms = map.new<string, string>()\nplot(na(ms.get("z")) ? 1 : 0)\n'
      + 'mc = map.new<string, color>()\nplot(na(mc.get("z")) ? 1 : 0)')
    expect(i).toEqual(per(() => 1))
    expect(s).toEqual(per(() => 1))
    expect(c).toEqual(per(() => 1))
  })
  it('an UNKNOWN value type fails closed in v6 (and answers na in v5); a copy keeps the value type', () => {
    const b6 = new Budget()
    const m = ARRAY_FNS['map.new'].fn([], b6, 'string')
    expect(m.vt).toBe(null)
    expect(() => ARRAY_FNS['map.get'].fn([m, 'z'], b6)).toThrow(/W6-K1/)
    const b5 = new Budget()
    b5.pineVersion = 5
    expect(ARRAY_FNS['map.get'].fn([m, 'z'], b5)).toBeNaN()
    const mb = ARRAY_FNS['map.new'].fn([], b6, 'string,bool')
    expect(mb.vt).toBe('bool')
    expect(ARRAY_FNS['map.copy'].fn([mb], b6).vt).toBe('bool')
    const mf = ARRAY_FNS['map.new'].fn([], b6, 'string,float')
    expect(ARRAY_FNS['map.get'].fn([mf, 'z'], b6)).toBeNaN()
  })
})

describe('⛔ what the texts do not settle stops BY NAME (W6-K1); a runtime error is a stop, never na', () => {
  it('an `na` key, on put / get / contains / remove', () => {
    for (const call of ['m.put(na, close)', 'v = m.get(na)', 'v = m.contains(na)', 'v = m.remove(na)']) {
      expect(() => runPine(`m = map.new<float, float>()\n${call}\nplot(close)`), call).toThrow(/with an `na` key.*W6-K1/)
    }
  })
  it('an `na` map id stops by name', () => {
    expect(() => runPine('var map<string, float> m = na\nplot(m.size())')).toThrow(/`map\.size`: the map is `na`/)
  })
  it('MAN: "the maximum number of key-value pairs that a map can contain is 50,000." — the 50,001st pair stops by name', () => {
    const budget = new Budget()
    const m = ARRAY_FNS['map.new'].fn([], budget, 'int')
    for (let i = 0; i < MAP_MAX_PAIRS; i += 1) ARRAY_FNS['map.put'].fn([m, i, i], budget)
    expect(m.m.size).toBe(50000)
    // a present key is a replacement, not a new pair: still served at the cap
    expect(ARRAY_FNS['map.put'].fn([m, 7, -1], budget)).toBe(7)
    expect(() => ARRAY_FNS['map.put'].fn([m, MAP_MAX_PAIRS, 0], budget)).toThrow(/at most 50000 key-value pairs/)
    const two = ARRAY_FNS['map.new'].fn([], budget, 'int')
    ARRAY_FNS['map.put'].fn([two, -1, 0], budget)
    expect(() => ARRAY_FNS['map.put_all'].fn([m, two], budget)).toThrow(/at most 50000 key-value pairs/)
  })
  it('REF: "`valueType` can be of any type except `array<>`, `matrix<>`, and `map<>`." — such a value stops', () => {
    const budget = new Budget()
    const m = ARRAY_FNS['map.new'].fn([], budget, 'string')
    expect(() => ARRAY_FNS['map.put'].fn([m, 'a', [1]], budget)).toThrow(/cannot be an array, a matrix or a map/)
  })
  it('a key of the wrong type stops by name', () => {
    const budget = new Budget()
    const m = ARRAY_FNS['map.new'].fn([], budget, 'string')
    expect(() => ARRAY_FNS['map.get'].fn([m, 1], budget)).toThrow(/a key of a `map<string, …>` is a string/)
  })
  it('an array member handed a map refuses naming the map', () => {
    expect(() => runPine('m = map.new<string, float>()\nplot(array.size(m))')).toThrow(/got map/)
  })
})

describe('⭐ the one table: every map member is a collection member, classified and door-gated', () => {
  const names = Object.keys(ARRAY_FNS).filter((n) => n.startsWith('map.'))
  it('the roster', () => {
    expect(names.sort()).toEqual(['map.clear', 'map.contains', 'map.copy', 'map.get', 'map.keys', 'map.new',
      'map.put', 'map.put_all', 'map.remove', 'map.size', 'map.values'])
  })
  it('each declares what it writes; the pair count moves under put / put_all / remove / clear', () => {
    for (const n of names) expect(['none', 'elements', 'size']).toContain(ARRAY_FNS[n].writes)
    for (const n of ['map.put', 'map.put_all', 'map.remove', 'map.clear']) expect(ARRAY_FNS[n].writes).toBe('size')
  })
  it('a v6 `for` whose bound reads `map.size` and whose body puts is refused (the bound can move); in v5 it runs', () => {
    const src = 'm = map.new<int, float>()\nm.put(0, close)\nfor i = 0 to map.size(m) - 1\n    map.put(m, i + 1, close)\n    if map.size(m) > 3\n        break\nplot(map.size(m))'
    const b = build(src)
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:loop')
    expect(b.refusal.message).toContain('map.put')
    expect(runPine(src, 5)[0]).toEqual(per(() => 2))
  })
  it('each is gated at the C18 object door (master held none)', () => {
    for (const n of names) expect(DOOR_GATED_ARRAY.has(n)).toBe(true)
  })
  it('kindOf answers `map`', () => {
    const m = ARRAY_FNS['map.new'].fn([], new Budget(), 'string')
    expect(isMap(m)).toBe(true)
    expect(kindOf(m)).toBe('map')
  })
  it('a `for [k, v] in` walk over a map stays refused by name (W6-F1, T6)', () => {
    const b = build('m = map.new<string, float>()\nm.put("a", close)\nfor [k, v] in m\n    log.info(k)\nplot(close)')
    expect(b.ok).toBe(false)
    expect(b.refusal.message).toMatch(/a walk over a map is not yet captured \(W6-F1\)/)
  })
})

describe('⭐ a map in a run\'s state: encoded by key type and pairs in order, checkpointed as a deep copy with aliasing kept', () => {
  const budget = new Budget()
  const mk = (pairs) => {
    const m = ARRAY_FNS['map.new'].fn([], budget, 'string')
    for (const [k, v] of pairs) ARRAY_FNS['map.put'].fn([m, k, v], budget)
    return m
  }
  it('encodeState: equal maps encode equal; a different value, or the SAME pairs in another order, encode different', () => {
    const a = encodeState([[mk([['b', 1.5], ['a', 2.5]])]])
    expect(a).not.toBe(null)
    expect(encodeState([[mk([['b', 1.5], ['a', 2.5]])]])).toEqual(a)
    expect(encodeState([[mk([['b', 1.5], ['a', 9.5]])]])).not.toEqual(a)
    expect(encodeState([[mk([['a', 2.5], ['b', 1.5]])]])).not.toEqual(a)
    // the value type is part of the value (it decides what a missing key answers)
    const mb = ARRAY_FNS['map.new'].fn([], budget, 'string,bool')
    const mf = ARRAY_FNS['map.new'].fn([], budget, 'string,float')
    expect(encodeState([[mb]])).not.toEqual(encodeState([[mf]]))
    expect(cloneValues([[mb]])[0][0].vt).toBe('bool')
    const m = mk([['a', 1]])
    expect(encodeState([[m, m]])).not.toEqual(encodeState([[mk([['a', 1]]), mk([['a', 1]])]]))
  })
  it('cloneValues: a write to the live map does not reach the checkpoint; two slots sharing one map still share one', () => {
    const m = mk([['b', 1.5], ['a', 2.5]])
    const [[c1, c2]] = cloneValues([[m, m]])
    expect(isMap(c1)).toBe(true)
    expect(c1).toBe(c2)
    ARRAY_FNS['map.put'].fn([m, 'z', 0], budget)
    ARRAY_FNS['map.put'].fn([m, 'b', 9], budget)
    expect([...c1.m.keys()]).toEqual(['b', 'a'])
    expect(c1.m.get('b')).toBe(1.5)
    expect(c1.kt).toBe('string')
  })
})

// ⭐ The C7 collector (`objectStore.js::collect`) WITHHOLDS a family when it would reach an
// object held only in a collection (unmeasured). A drawing held as a map VALUE is held in a
// collection: `vm.js::heldNow` walks map values for it.
describe('⭐ a drawing held as a map value counts as held in a collection (the C7 collector withholds)', () => {
  const NB = 300
  const BB = Array.from({ length: NB }, (_, i) => { const c = 100 + i * 0.05; return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 } })
  const SB = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BB.map((b) => b[k])))
  const finOf = (hold) => {
    const src = '//@version=6\nindicator("t", overlay = true, max_labels_count = 5)\n' + hold
      + 'if bar_index % 10 == 0 and bar_index > 0\n    label.new(bar_index, close, str.tostring(bar_index))\n'
    const b = buildRuntimeIr(src, { bars: BB, inputs: {}, objectsInRun: true, tf: 'D', basePeriod: 'D' })
    if (!b.ok) throw new Error(`refused: ${b.refusal.guard} — ${b.refusal.message}`)
    const p = lowerIrProgram(b.ir)
    return execute(p, { bars: NB, series: SB, columns: p.columns, confirmed: true, barTimes: BB.map((x) => x.t) }).objects.finish()
  }
  it('held in a map: the label family is withheld by name', () => {
    const fin = finOf('var m = map.new<string, label>()\nif bar_index == 0\n    m.put("k", label.new(bar_index, close, "held"))\n')
    expect(fin.withheld.label).toMatch(/held in an array or a user type/)
  })
  it('CONTROL: the same map holding no label leaves the collector free', () => {
    const fin = finOf('var m = map.new<string, label>()\nif bar_index == 0\n    label.new(bar_index, close, "free")\n')
    expect(fin.withheld.label).toBeUndefined()
  })
})

// ⭐ Rail gaps (review W6-T8 r1 note, and r0 "a put_all across key types (no rail seen)").
describe('W6-T8 rail gaps — stops that must stay stops', () => {
  // REF `bool`: "\"Bool\" variables can have values true or false." A v6 bool `get` of a missing key
  // STOPS even as a statement (stricter than the coordinator's "statement gets answer na"): pinned so
  // a later builder does not "fix" it to na.
  const BM = 'm = map.new<string, bool>()\nm.put("t", close > open)\n'
  it('a v6 bool-valued `get` of a missing key STOPS as a statement too (method and name form)', () => {
    expect(() => runPine(`${BM}m.get("zz")\nplot(m.size())`)).toThrow(/`map\.get` answers `na` for a missing key.*W6-K1/)
    expect(() => runPine(`${BM}map.get(m, "zz")\nplot(m.size())`)).toThrow(/`map\.get` answers `na` for a missing key.*W6-K1/)
  })
  it('CONTROL: the same statement on a present key is served', () => {
    expect(runPine(`${BM}m.get("t")\nplot(m.size())`)[0]).toEqual(per(() => 1))
  })
  // REF map.put_all: "Puts all key-value pairs from the `id2` map into the `id` map" and states no
  // key conversion; a map's keys are "all ... of the `keyType`" (REF map.new). Mixed key types stop.
  it('`map.put_all` across key types stops by name; the same key type is served', () => {
    expect(() => runPine('m = map.new<string, float>()\nm2 = map.new<int, float>()\nm2.put(1, close)\nmap.put_all(m, m2)\nplot(m.size())'))
      .toThrow(/`map\.put_all`: a `map<int, …>` into a `map<string, …>`/)
    expect(runPine('m = map.new<string, float>()\nm2 = map.new<string, float>()\nm2.put("a", close)\nmap.put_all(m, m2)\nplot(m.size())')[0])
      .toEqual(per(() => 1))
  })
})

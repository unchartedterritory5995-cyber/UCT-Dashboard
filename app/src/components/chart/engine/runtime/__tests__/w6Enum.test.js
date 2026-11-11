// W6-T10: `enum` declarations and `input.enum` on the runtime lane (docs/pine/W6-BREAKDOWN.md, T10).
// Authorities: Pine manual, Enums (https://www.tradingview.com/pine-script-docs/language/enums/);
// Pine v6 reference, keyword `enum` and `input.enum`. Each served shape below is one those texts state:
// fields with optional `const string` titles (a missing title is the field's name), `E.field` bound to a
// variable, compared with `==` / `!=`, used in `switch` and conditionals; `input.enum(defval, ...)` with an
// optional `options` tuple that must include `defval`.
// Kept refused until capture W6-E1 (spec): `str.tostring(e)`, an `na` enum value, a member-set
// `input.enum` (the default serves). Refused by name as not built here: an enum as a call argument
// (user function, collection), an enum-typed UDT field, a nested or repeated `enum`.
import { describe, it, expect } from 'vitest'
import { buildRuntimeIr, collectEnums, ENUM_RESERVED_NAMES_V5, ENUM_RESERVED_NAMES_V6 } from '../../ast/pineRuntimeFrontend.js'
import { lexPine, blockStatements } from '../../ast/pine.js'
import { runtimeInputSpecsOf } from '../runtimeInputs.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

const N = 8
// closes 100..107
const BARS = Array.from({ length: N }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000 }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const D = 'enum E\n    a\n    b = "B"\n    c\n'
const build = (src, o = {}, v = 6) => buildRuntimeIr(`//@version=${v}\nindicator("t")\n${src}`, { bars: BARS, inputs: {}, ...o })
const out0 = (src, o, v) => {
  const b = build(src, o, v)
  expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  const p = lowerIrProgram(b.ir)
  return Array.from(execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true, barTimes: BARS.map((x) => x.t) }).outputs[0])
}
const refused = (src, re, o, v) => {
  const b = build(src, o, v)
  expect(b.ok).toBe(false)
  expect(b.refusal.guard).toBe('runtime:enum')
  if (re) expect(b.refusal.message).toMatch(re)
}
const ones = (v) => Array(N).fill(v)

describe('W6-T10 enum declarations', () => {
  it('collectEnums reads fields and titles; a missing title is the field name', () => {
    const l = lexPine(`//@version=6\nindicator("t")\n${D}enum F\n    x = "X"\n`)
    const reg = collectEnums(blockStatements(l.tokens, l.indents, 0))
    expect([...reg.keys()]).toEqual(['E', 'F'])
    expect([...reg.get('E').members]).toEqual([['a', 'a'], ['b', 'B'], ['c', 'c']])
    expect(reg.get('E').bad).toBe(null)
  })
  it('a declaration alone builds and leaves the script unchanged', () => {
    expect(out0(`${D}plot(close)`)).toEqual(BARS.map((b) => b.c))
  })
  it('E.field binds and compares with == and !=', () => {
    expect(out0(`${D}x = E.b\nplot(x == E.b ? 1 : 0)`)).toEqual(ones(1))
    expect(out0(`${D}x = E.b\nplot(x != E.b ? 1 : 0)`)).toEqual(ones(0))
    expect(out0(`${D}plot(E.a == E.c ? 1 : 0)`)).toEqual(ones(0))
  })
  it('two fields with the SAME title are two members (compared by field, never by title)', () => {
    const src = 'enum T\n    p = "Same"\n    q = "Same"\n'
    expect(out0(`${src}plot(T.p == T.q ? 1 : 0)`)).toEqual(ones(0))
    expect(out0(`${src}plot(T.p != T.q ? 1 : 0)`)).toEqual(ones(1))
    expect(out0(`${src}x = T.q\nplot(x == T.q ? 1 : 0)`)).toEqual(ones(1))
  })
  it('a field whose title is another field name is still its own member', () => {
    expect(out0('enum T\n    p = "q"\n    q\nplot(T.p == T.q ? 1 : 0)')).toEqual(ones(0))
  })
  it('an enum declared after its first use still binds (pre-pass)', () => {
    expect(out0(`x = E.c\nplot(x == E.c ? 1 : 0)\n${D}`)).toEqual(ones(1))
  })
  it('a var enum slot reassigned with := follows the bar', () => {
    expect(out0(`${D}var m = E.a\nif close > 103\n    m := E.b\nplot(m == E.b ? 1 : 0)`)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
  })
  it('a written enum type, and an if on an enum comparison', () => {
    expect(out0(`${D}E m = E.c\nplot(m == E.c ? 1 : 0)`)).toEqual(ones(1))
    expect(out0(`${D}var m = E.a\nif close > 104\n    m := E.c\nv = 0\nif m != E.a\n    v := 1\nplot(v)`))
      .toEqual([0, 0, 0, 0, 0, 1, 1, 1])
  })
  it('switch on an enum value, the value a ?: of enum fields', () => {
    expect(out0(`${D}m = close > 104 ? E.c : close > 102 ? E.b : E.a\nv = switch m\n    E.a => 1\n    E.b => 2\n    => 3\nplot(v)`))
      .toEqual([1, 1, 1, 2, 2, 3, 3, 3])
  })
  it('two enums with the same field names stay apart', () => {
    expect(out0(`${D}enum F\n    a\n    b\nx = F.b\ny = E.b\nplot(x == F.b and y == E.b ? 1 : 0)`)).toEqual(ones(1))
  })
})

describe('W6-T10 input.enum at its default', () => {
  it('the default field serves (positional, named defval, options containing it)', () => {
    expect(out0(`${D}m = input.enum(E.b, "M")\nplot(m == E.b ? 1 : 0)`)).toEqual(ones(1))
    expect(out0(`${D}m = input.enum(defval = E.c, title = "M")\nplot(m == E.c ? 1 : 0)`)).toEqual(ones(1))
    expect(out0(`${D}m = input.enum(E.b, "M", options = [E.a, E.b])\nplot(m == E.a ? 1 : 0)`)).toEqual(ones(0))
  })
  it('switch on input.enum directly', () => {
    expect(out0(`${D}v = switch input.enum(E.c, "M")\n    E.a => 1\n    E.c => 3\n    => 9\nplot(v)`)).toEqual(ones(3))
  })
  it('a member-set input.enum refuses by name (W6-E1); the default is what serves', () => {
    refused(`${D}m = input.enum(E.b, "M")\nplot(m == E.b ? 1 : 0)`, /member-set `input\.enum`.*W6-E1/, { inputs: { m: 'a' } })
  })
  it('options that leave out the default, or are not its fields, refuse', () => {
    refused(`${D}m = input.enum(E.b, "M", options = [E.a, E.c])\nplot(m == E.b ? 1 : 0)`, /leave out its default/)
    refused(`${D}enum F\n    a\nm = input.enum(E.b, "M", options = [E.b, F.a])\nplot(m == E.b ? 1 : 0)`, /not a list of fields/)
  })
  it('the settings path does not offer it (no knob until the member input menu), by name', () => {
    const { specs, skipped } = runtimeInputSpecsOf(`//@version=6\nindicator("t")\n${D}m = input.enum(E.b, "M")\nplot(close)`)
    expect(specs.map((s) => s.key)).not.toContain('m')
    expect(JSON.stringify(skipped)).toMatch(/enum menu is not offered here yet/)
  })
})

describe('W6-T10 kept refused until W6-E1', () => {
  it('str.tostring of an enum value', () => {
    refused(`${D}plot(str.length(str.tostring(E.a)))`, /str\.tostring.*W6-E1/)
  })
  it('an na enum value: declared, assigned, an arm, compared', () => {
    refused(`${D}E m = na\nplot(close)`, /`na`.*W6-E1/)
    refused(`${D}var m = E.a\nm := na\nplot(m == E.a ? 1 : 0)`, /`na`.*W6-E1/)
    refused(`${D}m = close > 103 ? E.a : na\nplot(m == E.a ? 1 : 0)`, /W6-E1/)
    refused(`${D}m = E.a\nplot(m == na ? 1 : 0)`, /W6-E1/)
  })
})

describe('W6-T10 refused by name everywhere else', () => {
  it('an enum value as a number, text or condition', () => {
    refused(`${D}plot(E.a)`)
    refused(`${D}m = E.a\nplot(str.length("x" + m))`)
    refused(`${D}m = E.a\nplot(m ? 1 : 0)`)
    refused(`${D}m = E.a\nplot(na(m) ? 1 : 0)`)
  })
  it('== against another enum or text', () => {
    refused(`${D}enum F\n    a\nplot(E.a == F.a ? 1 : 0)`, /two different enums/)
    refused(`${D}plot(E.a == "a" ? 1 : 0)`)
  })
  it('wrong types at a binding or an assignment', () => {
    refused(`${D}float m = E.a\nplot(close)`)
    refused(`${D}var x = 1\nx := E.a\nplot(x)`)
    refused(`${D}var m = E.a\nm := 1\nplot(m == E.a ? 1 : 0)`)
  })
  it('a collection element, a function argument, an enum-typed field', () => {
    refused(`${D}a = array.new_string()\narray.push(a, E.a)\nplot(close)`)
    refused(`${D}g(e) => e == E.a ? 1 : 0\nplot(g(E.a))`)
    refused(`${D}type T\n    E m\nplot(close)`, /field `m` of the enum `E`/)
  })
  it('a declaration this lane cannot read exactly', () => {
    refused('enum E\n    a = 1\nplot(close)', /not one string literal/)
    refused(`${D}${D}plot(close)`, /declared a second time/)
    refused(`${D}if close > 0\n    enum G\n        x\nplot(close)`, /inside a block/)
    refused(`${D}plot(E.z == E.a ? 1 : 0)`, /declares no field `z`/)
  })
})

describe('W6-T10 unchanged elsewhere', () => {
  it('the C18 object door keeps master answer (no enum arm there)', () => {
    const b = build(`${D}plot(close)`, { objectDoor: true })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).not.toBe('runtime:enum')
  })
  it('v4 `enum = 5` is still a name (W6-T2)', () => {
    expect(out0('enum = 5\nplot(close + enum)', {}, 4)).toEqual(BARS.map((b) => b.c + 5))
  })
})

describe('W6-T10 enum names Pine reserves (review N2)', () => {
  it('an enum named like a built-in namespace or type refuses by name', () => {
    refused('enum color\n    red\n    blue\nplot(color.red == color.blue ? 1 : 0)', /built-in type or namespace/)
    refused('enum syminfo\n    a\nplot(close)', /built-in type or namespace/)
    refused('enum float\n    a\nplot(close)', /built-in type or namespace/)
    refused('enum polyline\n    a\nx = polyline.a\nplot(x == polyline.a ? 1 : 0)', /built-in type or namespace/)
  })
  it('an enum sharing its name with a declared type refuses by name', () => {
    refused('type Q\n    float v\nenum Q\n    a\nplot(close)', /must be unique/)
  })
  it('a name near a reserved one still serves', () => {
    expect(out0('enum colors\n    red\n    blue\nplot(colors.red == colors.blue ? 1 : 0)')).toEqual(ones(0))
  })
})

// ⭐⭐ W6-T10-N (review N1, N3, Q6). Every reserved name, per version, from each version's own reference:
// the head of every dotted variable/constant/function/method name, plus every `types` entry
// (`tools/pine_survey/pine_reference_extract.js --version 5|6`, derived 2026-11-07, docs/pine/evidence/2026-11-07-w6-t10n).
// ⛔ TYPED HERE, NOT READ FROM THE ENGINE'S SET: a rail that iterated the engine's own list could not see a
// name dropped from it. The equality row below catches a name ADDED to it.
const V5_NAMES = [
  'adjustment', 'alert', 'array', 'backadjustment', 'barmerge', 'barstate', 'box', 'chart', 'color', 'currency',
  'dayofweek', 'display', 'dividends', 'earnings', 'extend', 'font', 'format', 'hline', 'input', 'label', 'line',
  'linefill', 'location', 'log', 'map', 'math', 'matrix', 'order', 'plot', 'polyline', 'position', 'request',
  'runtime', 'scale', 'session', 'settlement_as_close', 'shape', 'size', 'splits', 'str', 'strategy', 'syminfo',
  'ta', 'table', 'text', 'ticker', 'timeframe', 'xloc', 'yloc',
  'bool', 'const', 'float', 'int', 'series', 'simple', 'string',
]
const V6_ONLY = ['footprint', 'volume_row']
const V6_NAMES = [...V5_NAMES, ...V6_ONLY]
const RESERVED_BY_VERSION = { 5: V5_NAMES, 6: V6_NAMES }
const reservedSrc = (name) => `enum ${name}\n    a\n    b\nplot(close)`
const servedSrc = (name) => `enum ${name}\n    a\n    b\nx = ${name}.a\nplot(x == ${name}.b ? 1 : 0)`
const capital = (n) => n[0].toUpperCase() + n.slice(1)

describe('W6-T10-N reserved enum names, per version (review N1/N3)', () => {
  it('the lists are the references’ lists exactly: 56 in v5, 58 in v6', () => {
    expect(V5_NAMES.length).toBe(56)
    expect(V6_NAMES.length).toBe(58)
    expect([...ENUM_RESERVED_NAMES_V5].sort()).toEqual([...V5_NAMES].sort())
    expect([...ENUM_RESERVED_NAMES_V6].sort()).toEqual([...V6_NAMES].sort())
  })
  for (const v of [5, 6]) {
    describe(`v${v}`, () => {
      for (const name of RESERVED_BY_VERSION[v]) {
        it(`enum ${name} refuses by name`, () => refused(reservedSrc(name), /built-in type or namespace/, {}, v))
      }
    })
  }
  // ⛔ r1 (review W6-T10-N B1): the helper once dropped its version, so every "v5" row ran as v6. This row
  // proves `refused` builds the version it is given, on the one shape whose answer differs by version.
  it('GUARD: `refused` runs in the version it is given (footprint refuses in v6, not in v5)', () => {
    expect(() => refused(reservedSrc('footprint'), /built-in type or namespace/, {}, 6)).not.toThrow()
    expect(() => refused(reservedSrc('footprint'), /built-in type or namespace/, {}, 5)).toThrow()
  })
  it('a script with no version line reads the v6 list (fails closed): `enum footprint` refuses', () => {
    const b = buildRuntimeIr(`indicator("t")\n${reservedSrc('footprint')}`, { bars: BARS, inputs: {} })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('runtime:enum')
    expect(b.refusal.message).toMatch(/built-in type or namespace/)
  })
  for (const name of V6_ONLY) {
    it(`v5 enum ${name} is a legal name and serves (no such namespace in the v5 reference)`, () => {
      expect(out0(servedSrc(name), {}, 5)).toEqual(ones(0))
    })
  }
})

describe('W6-T10-N Pine names are case-sensitive (manual, Identifiers; Enums: `Syminfo` works) (review Q6)', () => {
  for (const v of [5, 6]) {
    describe(`v${v}`, () => {
      for (const name of RESERVED_BY_VERSION[v]) {
        it(`enum ${capital(name)} serves`, () => expect(out0(servedSrc(capital(name)), {}, v)).toEqual(ones(0)))
      }
    })
  }
  it('the manual’s own pair:`Syminfo` serves and `syminfo` refuses', () => {
    expect(out0(servedSrc('Syminfo'))).toEqual(ones(0))
    refused(reservedSrc('syminfo'), /built-in type or namespace/)
  })
  it('near misses serve: plural, suffix, all-caps, camel case', () => {
    for (const name of ['colors', 'tas', 'COLOR', 'FLOAT', 'footprints', 'volumeRow', 'volume_rows', 'str_', 'Ta']) {
      expect(out0(servedSrc(name)), name).toEqual(ones(0))
    }
  })
})

// ⭐ Rail gap (review W6-T10 N2): an enum-typed collection. REF keyword `enum`: "Additionally, one can
// use an enum in a collection's type template to restrict the values it will allow as elements."
// What this lane serves of that today is pinned here, so the shape is deliberate, not incidental:
// - an EMPTY map whose VALUE type is an enum builds and runs; it holds no pair (REF map.new creates
//   "a new map object", and nothing was put), so `size` is 0;
// - an enum KEY, and an enum array or matrix with no initial value, STOP the run by name: what Pine
//   fills them with (or how an enum key is held) is not measured, so nothing is guessed.
const runAll = (src, v = 6) => {
  const b = build(src, {}, v)
  expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  const p = lowerIrProgram(b.ir)
  return execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true, barTimes: BARS.map((x) => x.t) })
    .outputs.map((o) => Array.from(o))
}
describe('W6-T10 N2 an enum in a collection\'s type template', () => {
  it('an empty map<string, E> builds and runs: size 0 (method and name form)', () => {
    expect(runAll(`${D}m = map.new<string, E>()\nplot(m.size())\nplot(map.size(m))`)).toEqual([ones(0), ones(0)])
  })
  it('an enum KEY stops the run by name (map.new<E, float>), never an empty map read as data', () => {
    expect(() => runAll(`${D}m = map.new<E, float>()\nplot(m.size())`)).toThrow(/map\.new<E, …>: this runtime holds a map keyed by int, float, bool, string or color/)
  })
  it('an enum array or matrix with no initial value stops the run by name (its fill is unmeasured)', () => {
    expect(() => runAll(`${D}a = array.new<E>(2)\nplot(a.size())`)).toThrow(/array\.new<E>\(2\) with no initial value/)
    expect(() => runAll(`${D}m = matrix.new<E>(1, 1)\nplot(m.rows())`)).toThrow(/matrix\.new<E>\(1, 1\) with no initial value.*W6-M1/)
  })
})

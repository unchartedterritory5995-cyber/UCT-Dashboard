// app/src/components/chart/engine/runtime/__tests__/runtimeInputs.test.js
//
// ⭐⭐ UIE PHASE 2 (M4) — a runtime script's own settings as ordinary UCT inputs.
//
// The slice, end to end: the member door mints a runtime document that DECLARES the
// script's `input.*` settings (`runtimeInputs.js`); an instance's values reach the run
// through the registry (the binder's own call, `registry.computeFor(def, bars,
// inst.inputs, ctx)`); the run computes exactly what the same script computes with that
// value typed as its default; a value outside the author's bounds is refused by name;
// and an untouched instance draws exactly what it drew before.
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { validateDefinition } from '../../defSchema'
import { runtimeInputSpecsOf, runtimeInputValues } from '../runtimeInputs'
import { computeRuntimeColumns } from '../runtimeColumns'

const FLAG = 'VITE_PINE_RUNTIME_PANE_ENABLED'
const OBJ = 'VITE_PINE_OBJECTS_ONLY_PANE_ENABLED'
const ID = 'u_member-pane-m4'
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

const bars = Array.from({ length: 400 }, (_, i) => {
  const c = 100 + 7 * Math.sin(i / 9) + 3 * Math.sin(i / 3.7)
  return { t: 1600000000 + i * 86400, o: c - 0.4, h: c + 1.2, l: c - 1.1, c, v: 1000 + (i % 17) * 5 }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

// a script only the runtime lane can draw (a loop over a member-set length)
const script = (len = 10, mult = 1.5, show = 'true', mode = '"Up"') => `//@version=5
indicator("M4 slice")
len = input.int(${len}, "Length", minval=2, maxval=100)
mult = input.float(${mult}, "Multiplier")
show = input.bool(${show}, "Show")
mode = input.string(${mode}, "Mode", options=["Up", "Down"])
float s = 0.0
for i = 0 to len - 1
    s += close[i]
avg = s / len
plot(show ? (mode == "Up" ? avg * mult : -avg * mult) : na)
`

const mint = (src) => {
  vi.stubEnv(OBJ, '1')
  vi.stubEnv(FLAG, '1')
  const built = memberPaneDefinition({ source: src, id: ID })
  expect(built.ok, built.reason).toBe(true)
  expect(built.lane).toBe('runtime')
  return built
}
const column = (built, inputs) => {
  const { installed } = registry.installUserDefinitions([built.definition])
  const cols = registry.computeFor(installed[0], bars, inputs, CTX)
  registry.uninstallUserDefinition(ID)
  return cols
}
const values = (cols, built) => cols[built.rows[0].key]

describe('⭐ the script declares its settings as defSchema inputs', () => {
  it('int / float / bool / enum, with the author\'s title, bounds and options', () => {
    const { specs, skipped } = runtimeInputSpecsOf(script())
    expect(specs).toEqual([
      { key: 'len', type: 'int', default: 10, label: 'Length', min: 2, max: 100 },
      { key: 'mult', type: 'float', default: 1.5, label: 'Multiplier' },
      { key: 'show', type: 'bool', default: true, label: 'Show' },
      { key: 'mode', type: 'enum', default: 'Up', label: 'Mode', options: ['Up', 'Down'] },
    ])
    expect(skipped).toEqual([])
  })

  it('legacy `input()` reads its literal; what cannot be read exactly is skipped BY NAME', () => {
    const { specs, skipped } = runtimeInputSpecsOf(`//@version=4
study("x")
a = input(20)
b = input(true, "On")
c = input(-2.5)
src = input(close, "Source", input.source)
d = input.int(10 + 4)
e = input.color(color.red)
plot(close)
`)
    expect(specs.map((s) => [s.key, s.type, s.default])).toEqual([['a', 'int', 20], ['b', 'bool', true], ['c', 'float', -2.5]])
    expect(skipped.map((s) => s.key)).toEqual(['src', 'd', 'e'])
    for (const s of skipped) expect(s.reason).toBeTruthy()
  })

  it('the minted runtime document carries them, and the document is valid', () => {
    const built = mint(script())
    // after the builder's own style inputs every document carries (`color`, `lineWidth`)
    expect(built.definition.inputs.map((i) => i.key).filter((k) => !['color', 'lineWidth'].includes(k)))
      .toEqual(['len', 'mult', 'show', 'mode'])
    expect(validateDefinition(built.definition).ok).toBe(true)
  })
})

describe('⭐⭐ an instance\'s value reaches the run, and computes what the author\'s would', () => {
  it('untouched: exactly the default document\'s column', () => {
    const built = mint(script())
    expect(values(column(built, undefined), built)).toEqual(values(column(built, { len: 10, mult: 1.5 }), built))
  })

  for (const [name, given, truthSrc] of [
    ['an int length (loop bound)', { len: 25 }, script(25)],
    ['a float', { mult: 3 }, script(10, 3)],
    ['an option', { mode: 'Down' }, script(10, 1.5, 'true', '"Down"')],
    ['several at once', { len: 4, mult: 0.5, mode: 'Down' }, script(4, 0.5, 'true', '"Down"')],
  ]) {
    it(`${name}: equals the script with that value written as its default`, () => {
      const got = values(column(mint(script()), given), mint(script()))
      const truth = mint(truthSrc)
      const want = values(column(truth, undefined), truth)
      expect(got.length).toBe(bars.length)
      expect(got).toEqual(want)
      expect(got).not.toEqual(values(column(mint(script()), undefined), mint(script())))
    })
  }

  it('⛔ a value outside the author\'s bounds, or not among its options, is refused by name — never clamped', () => {
    const built = mint(script())
    for (const bad of [{ len: 1 }, { len: 500 }, { mode: 'Sideways' }]) {
      const cols = column(built, bad)
      expect(Object.keys(cols), JSON.stringify(bad)).toEqual([])
      const errs = Object.values(registry.columnErrors(cols))
      expect(errs.length).toBeGreaterThan(0)
      expect(errs[0].message).toMatch(/len|mode/)
    }
  })

  it('the memo keys on the settings: two instances with different values never share a run', () => {
    const built = mint(script())
    const { installed } = registry.installUserDefinitions([built.definition])
    const a = registry.computeFor(installed[0], bars, { len: 5 }, CTX)
    const b = registry.computeFor(installed[0], bars, { len: 30 }, CTX)
    expect(a[built.rows[0].key]).not.toEqual(b[built.rows[0].key])
  })

  it('runtimeInputValues hands only what differs, a switch as 1 / 0', () => {
    const def = { inputs: runtimeInputSpecsOf(script()).specs }
    expect(runtimeInputValues(def, { len: 10, show: true })).toEqual({})
    expect(runtimeInputValues(def, { len: 12, show: false, nope: 3 })).toEqual({ len: 12, show: 0 })
  })

  it('direct callers pass settings on the context (`runtimeInputs`), the worker shape', () => {
    const built = mint(script())
    const direct = computeRuntimeColumns(built.definition, bars, { ...CTX, runtimeInputs: { len: 25 } })
    const truth = mint(script(25))
    expect(direct[built.rows[0].key]).toEqual(values(column(truth, undefined), truth))
  })
})

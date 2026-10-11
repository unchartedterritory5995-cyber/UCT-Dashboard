// app/src/components/chart/engine/runtime/__tests__/runtimeInputsColourSource.test.js
//
// ⭐⭐ UIE PHASE 3 (M4) — COLOUR AND SOURCE INPUTS OF A RUNTIME SCRIPT, END TO END.
//
// The member door mints the document; an instance's values reach the run through the
// registry (the binder's own call); each setting computes EXACTLY what the same script
// computes with that value typed as its default. A value the setting does not admit is
// refused by name; a colour input that colours nothing is not offered; a timeframe
// input is not offered (no other timeframe's bars exist here); and a document minted
// before these settings existed runs exactly as it did.
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { validateDefinition } from '../../defSchema'
import { resolvePlotForInstance } from '../../pool'
import { runtimeInputSpecsOf } from '../runtimeInputs'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeObjectsOf } from '../runtimeObjects'

const ID = 'u_member-pane-m4c'
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })
const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 7 * Math.sin(i / 9) + 3 * Math.sin(i / 3.7)
  return { t: 1600000000 + i * 86400, o: c - 0.4 + Math.sin(i) * 0.3, h: c + 1.2, l: c - 1.1, c, v: 1000 + (i % 17) * 5 }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
const mint = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const built = memberPaneDefinition({ source: src, id: ID })
  expect(built.ok, built.reason).toBe(true)
  expect(built.lane).toBe('runtime')
  return built
}
const run = (built, inputs) => {
  const { installed } = registry.installUserDefinitions([built.definition])
  const cols = registry.computeFor(installed[0], bars, inputs, CTX)
  registry.uninstallUserDefinition(ID)
  return cols
}
const specOf = (built, key) => built.definition.inputs.find((i) => i.key === key)

// a loop only the runtime lane draws, over a member-chosen source
const SRC = (src = 'close', v = 5) => `//@version=${v}
indicator("M4 source")
src = input.source(${src}, "Source")
float s = 0.0
for i = 0 to 9
    s += src[i]
plot(s / 10)
`
// a per-bar colour (the run computes it) and a fixed plot colour (the schema links it)
const COL = (up = 'color.green', dn = '#FF0000', fixed = 'color.blue') => `//@version=5
indicator("M4 colour")
up = input.color(${up}, "Up")
dn = input.color(${dn}, "Down")
fx = input.color(${fixed}, "Line")
float s = 0.0
for i = 0 to 4
    s += close[i]
m = s / 5
plot(m, color = m > m[1] ? up : dn)
plot(m * 1.01, color = fx)
`

describe('⭐⭐ a source input', () => {
  it('is offered as a menu of the chart\'s bar series, the author\'s default first chosen', () => {
    const spec = specOf(mint(SRC()), 'src')
    expect(spec).toMatchObject({ type: 'enum', default: 'close', label: 'Source', source: true })
    expect(spec.options).toEqual(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'])
    expect(validateDefinition(mint(SRC()).definition).ok).toBe(true)
  })

  for (const pick of ['hl2', 'open', 'hlcc4']) {
    it(`${pick}: equals the script with ${pick} typed as its default`, () => {
      const built = mint(SRC())
      const key = built.rows[0].key
      const got = run(built, { src: pick })[key]
      const truth = mint(SRC(pick))
      expect(got).toEqual(run(truth, undefined)[truth.rows[0].key])
      expect(got).not.toEqual(run(built, undefined)[key])
    })
  }

  it('v4\'s `input(close, "Source", input.source)` is the same setting', () => {
    const v4 = '//@version=4\nstudy("v4 src")\nsrc = input(close, "Source", input.source)\nfloat s = 0.0\nfor i = 0 to 9\n    s := s + src[i]\nplot(s / 10)\n'
    const built = mint(v4)
    expect(specOf(built, 'src')).toMatchObject({ type: 'enum', default: 'close' })
    expect(run(built, { src: 'hl2' })[built.rows[0].key]).not.toEqual(run(built, undefined)[built.rows[0].key])
  })

  it('⛔ a source that is not a bar series is refused by name, never guessed', () => {
    const cols = run(mint(SRC()), { src: 'vwap' })
    expect(Object.keys(cols)).toEqual([])
    expect(Object.values(registry.columnErrors(cols))[0].message).toMatch(/src/)
  })
})

describe('⭐⭐ a colour input', () => {
  it('each the run colours with is offered, with the author\'s colour as #RRGGBB', () => {
    const built = mint(COL())
    for (const k of ['up', 'dn']) expect(specOf(built, k)).toMatchObject({ type: 'color' })
    expect(specOf(built, 'dn').default).toBe('#FF0000')
    expect(specOf(built, 'up').default).toMatch(/^#[0-9A-F]{6}$/)
    expect(validateDefinition(built.definition).ok).toBe(true)
  })

  it('a PER-BAR colour: the run\'s colour column equals the script with that colour typed in', () => {
    const built = mint(COL())
    const colourKey = Object.keys(built.definition.compute.outputs).find((k) => !built.rows.some((r) => r.key === k))
    const got = run(built, { up: '#123456' })[colourKey]
    const truth = mint(COL('#123456'))
    expect(got).toEqual(run(truth, undefined)[colourKey])
    expect(got).not.toEqual(run(built, undefined)[colourKey])
  })

  it('⛔ a FIXED plot colour is not offered twice: the plot\'s own Style colour is that knob', () => {
    const built = mint(COL())
    expect(specOf(built, 'fx')).toBeUndefined()
    expect(JSON.stringify(built.notes)).toMatch(/fx.*fixed colour.*Style/)
    // the plot's Style colour is a reference to its own colour input, which an instance's
    // value replaces the UCT way (`pool.resolvePlotForInstance`)
    const plot = built.definition.plots.find((p) => p.key === built.rows[1].key)
    expect(plot.color).toMatch(/^\$/)
    const key = plot.color.slice(1)
    expect(specOf(built, key)).toMatchObject({ type: 'color' })
    const resolved = resolvePlotForInstance({ ...plot, color: specOf(built, key).default, $refs: { color: key } },
      { [key]: '#ABCDEF' })
    expect(resolved.color.toUpperCase()).toBe('#ABCDEF')
  })

  it('a drawing the run makes takes the member\'s colour', () => {
    const src = '//@version=5\nindicator("M4 label", overlay = true)\nc = input.color(color.orange, "Label")\n'
      + 'float s = 0.0\nfor i = 0 to 4\n    s += close[i]\nplot(s / 5)\nvar label lb = na\nlabel.delete(lb)\n'
      + 'lb := label.new(bar_index, s / 5, "x", color = c)\n'
    const built = mint(src)
    expect(specOf(built, 'c')).toMatchObject({ type: 'color' })
    const cols = computeRuntimeColumns(built.definition, bars, { ...CTX, runtimeInputs: { c: '#00FF7F' } })
    const label = runtimeObjectsOf(cols).live.find((o) => o.family === 'label')
    expect(String(label.props.color).toUpperCase()).toContain('00FF7F')
  })

  it('⛔ a value that is not a colour is refused by name', () => {
    const cols = run(mint(COL()), { up: 'green' })
    expect(Object.keys(cols)).toEqual([])
    expect(Object.values(registry.columnErrors(cols))[0].message).toMatch(/up/)
  })
})

describe('⛔ what is not offered, by name', () => {
  it('a colour input that colours nothing', () => {
    const built = mint('//@version=5\nindicator("unused")\nc = input.color(color.red, "Unused")\nfloat s = 0.0\nfor i = 0 to 4\n    s += close[i]\nplot(s)\n')
    expect(specOf(built, 'c')).toBeUndefined()
    expect(JSON.stringify(built.notes)).toMatch(/colours nothing/)
  })

  it('a see-through default colour (the picker sets opaque colours)', () => {
    const { specs, skipped } = runtimeInputSpecsOf('//@version=5\nindicator("t")\nc = input.color(#FF000080)\nplot(close, color = c)\n')
    expect(specs).toEqual([])
    expect(skipped[0].reason).toMatch(/see-through/)
  })

  it('a timeframe input: another timeframe\'s bars are not made up', () => {
    const { specs, skipped } = runtimeInputSpecsOf('//@version=5\nindicator("t")\ntf = input.timeframe("D", "TF")\nplot(close)\n')
    expect(specs).toEqual([])
    expect(skipped[0].reason).toMatch(/timeframe/)
  })
})

describe('⭐ saved documents', () => {
  it('a document minted before these settings existed (no colour or source inputs) runs exactly as before, whatever an instance carries', () => {
    const built = mint(SRC())
    const old = { ...built, definition: { ...built.definition, inputs: built.definition.inputs.filter((i) => i.key !== 'src') } }
    const key = built.rows[0].key
    expect(run(old, { src: 'hl2' })[key]).toEqual(run(old, undefined)[key])
    expect(run(old, undefined)[key]).toEqual(computeRuntimeColumns(built.definition, bars, CTX)[key])
  })

  it('save and reload: the stored instance value is what the next run reads', () => {
    const built = mint(SRC())
    const stored = JSON.parse(JSON.stringify({ inputs: { src: 'ohlc4' } }))
    const truth = mint(SRC('ohlc4'))
    expect(run(built, stored.inputs)[built.rows[0].key]).toEqual(run(truth, undefined)[truth.rows[0].key])
  })
})

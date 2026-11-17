// app/src/components/chart/engine/runHalfColours.test.js
//
// SETTINGS PARITY (2c, colours): a plot's colour setting is the script's colour input, so a moved
// line colour reaches the drawings that read it (RS Rating's rating label is written in the line's
// colour), and a plain `input(<colour>)` is a colour setting of a runtime script.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { projectMemberDocument } from './memberDocumentProjection'
import { hostColourLinks, runHalfRunInputs } from './runHalfInputs'
import { runtimeInputSpecsOf } from './runtime/runtimeInputs'
import { runtimeColumnsFor } from './runtime/runtimeColumns'
import * as registry from './nativeRegistry'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const LF = String.fromCharCode(10)

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
})
afterEach(() => {
  __resetRuntimePanePermission()
  vi.unstubAllEnvs()
})

describe('a plain input with a colour default is a colour setting', () => {
  const specOf = (line) => runtimeInputSpecsOf(['//@version=5', 'indicator("c")', line, 'plot(close)'].join(LF))

  it('an opaque `color.rgb(r, g, b, 0)`, a Pine colour name and a hex literal', () => {
    expect(specOf("c = input(color.rgb(0, 0, 255, 0), title = 'Color')").specs).toEqual([
      expect.objectContaining({ key: 'c', type: 'color', default: '#0000FF', label: 'Color' })])
    expect(specOf("c = input(color.orange, title = 'C')").specs[0]).toMatchObject({ type: 'color', default: '#FF9800' })
    expect(specOf("c = input(#2962FF, title = 'C')").specs[0]).toMatchObject({ type: 'color', default: '#2962FF' })
  })

  it('an opaque `color.new(<fixed colour>, 0)` is that colour', () => {
    expect(specOf("c = input(color.new(#b2b5be, 0), title = 'Line Color')").specs[0])
      .toMatchObject({ key: 'c', type: 'color', default: '#B2B5BE', label: 'Line Color' })
    expect(specOf("c = input(color.new(color.orange, 0), title = 'C')").specs[0])
      .toMatchObject({ type: 'color', default: '#FF9800' })
  })

  it('a see-through default is that colour at its opacity, `#RRGGBBAA` (the picker sets both, as TradingView\'s does)', () => {
    // TradingView records `color.rgb(121, 213, 242, 62)` as rgba(121,213,242,0.38): alpha byte round(0.38 * 255) = 0x61
    expect(specOf("c = input(color.rgb(121, 213, 242, 62), title = 'C')").specs[0]).toMatchObject({ type: 'color', default: '#79D5F261' })
    expect(specOf("c = input(color.new(#b2b5be, 40), title = 'C')").specs[0]).toMatchObject({ type: 'color', default: '#B2B5BE99' })
    expect(specOf("c = input(#2962FF80, title = 'C')").specs[0]).toMatchObject({ type: 'color', default: '#2962FF80' })
  })

  it('⛔ a transparency that is not a literal 0 to 100 is skipped by name', () => {
    const r = specOf("c = input(color.rgb(121, 213, 242, 150), title = 'C')")
    expect(r.specs).toEqual([])
    expect(r.skipped[0].reason).toMatch(/transparency/)
  })

  it('CONTROL: a number and a switch are still a number and a switch', () => {
    expect(specOf("n = input(14, title = 'N')").specs[0]).toMatchObject({ type: 'int', default: 14 })
    expect(specOf("b = input(false, title = 'B')").specs[0]).toMatchObject({ type: 'bool', default: false })
  })

  it('the run takes the member\'s colour for such an input (the plot draws in it)', () => {
    const src = ['//@version=5', 'indicator("c")', "c = input(color.rgb(0, 0, 255, 0), title = 'Color')",
      'plot(close, "a", color = c)'].join(LF)
    const def = { id: 'u_rhc1', compute: { kind: 'runtime', fn: 'runtime:u_rhc1', rev: 1, source: src, outputs: { a: 0 } },
      inputs: runtimeInputSpecsOf(src).specs, meta: { runtimeHistory: 'listing' } }
    const bars = Array.from({ length: 30 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 10, h: 11, l: 9, c: 10 + i, v: 1 }))
    expect(() => runtimeColumnsFor(def, bars, { c: '#FF0000' }, { tf: 'D', historyFromListing: true })).not.toThrow()
  })
})

describe('RS Rating: the line colour is the rating label\'s text colour', () => {
  const def = () => projectMemberDocument(memberPaneDefinition({ source: RS, id: 'u_rhc2', name: 'RS' }).definition)

  it('each plot colour setting links to the colour input its plot draws with', () => {
    expect(hostColourLinks(def())).toEqual({ color: 'colorRS', out2Color: 'colMa', out4Color: 'colMa2' })
  })

  it('an INSTALLED document (its plots resolved, the reference in `$refs`) links the same way', () => {
    const { installed, errors } = registry.installUserDefinitions([memberPaneDefinition({ source: RS, id: 'u_rhc3', name: 'RS' }).definition])
    expect(installed.length, errors.join(' | ')).toBe(1)
    try {
      expect(hostColourLinks(installed[0])).toEqual({ color: 'colorRS', out2Color: 'colMa', out4Color: 'colMa2' })
    } finally {
      registry.uninstallUserDefinition('u_rhc3')
    }
  })

  it('the run is handed the colours in its own names; only the line colour needs evidence (the label reads it)', () => {
    const r = runHalfRunInputs(def(), { color: '#FF0000', out2Color: '#00BCD4', out4Color: '#4CAF50' })
    expect(r).toMatchObject({ ok: true, values: { colorRS: '#FF0000', colMa: '#00BCD4', colMa2: '#4CAF50' } })
    expect(r.needsEvidence).toEqual(['colorRS'])
  })

  it('⛔ a colour setting no colour input stands behind (a fill\'s helper plot) is still refused by name', () => {
    const r = runHalfRunInputs(def(), { out3Color: '#FF0000' })
    expect(r).toMatchObject({ ok: false, key: 'out3Color' })
  })
})

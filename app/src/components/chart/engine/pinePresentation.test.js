// app/src/components/chart/engine/pinePresentation.test.js
//
// A Pine document's settings, laid out as TradingView lays out the script's inputs (RS Rating, measured
// against its TradingView capture 2026-11-17): source order, the script's group headers, inline rows and
// tooltips, its titles where ours were column keys, a plot colour that IS a script input on the Inputs tab,
// and a v4 `input(false, …)` switch held as 0/1 shown as a switch writing 1 / 0. Read at form time only.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import * as registry from './nativeRegistry'
import { fieldsForInstance, fieldsFromDefinition } from '../indicatorRegistry'
import { pineInputDeclarations, pineFieldPresentation } from './pinePresentation'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from './runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from './runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')

// TradingView's Inputs tab for RS Rating, as its capture records it (study.inputs in order): every input, nothing
// left out. 'Comparative Symbol for Line' (source line 22) joined ours with engine 68 (#1545, the comparison symbol
// as a run-half setting); the two see-through DOT colours (the 'Color' after each 'Type' in the New Highs / New Lows
// groups, source lines 27 and 32) with engine 69 (#1565); the two see-through AREA colours ('Positive Area' /
// 'Negative Area', source lines 42-43) with engine 70 (#1574). Each at TradingView's position.
const TV_INPUTS = ['Hide Rating', 'Rating Only', 'Color', 'Comparative Symbol for Line',
  'Approximate Value of Comparative Symbol', 'Offset (%)',
  'Plot RS New Highs', 'Type', 'Color', 'Look-back', 'Size', 'Plot RS New Lows', 'Type', 'Color', 'Look-back', 'Size',
  'Display MA 1 on RS Line', 'Lenght Da', 'Color', 'Type Da', 'Lenght We', 'Type We', 'Area Color',
  'Positive Area', 'Negative Area',
  'Display MA 2 on RS Line', 'Lenght Da', 'Color', 'Type Da', 'Lenght We', 'Type We',
  'Use fix values for replay mode', 'For 99 stocks', 'For 90+ stocks', 'For 70+ stocks', 'For 50+ stocks',
  'For 30+ stocks', 'For 10+ stocks', 'For 1- stocks']

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

const installRS = (id) => {
  const minted = memberPaneDefinition({ source: RS, id, name: 'RS' }).definition
  const { installed, errors } = registry.installUserDefinitions([minted])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return { minted, def: installed[0] }
}

describe('the script\'s input declarations', () => {
  it('every input in source order, with its title, group, inline, tooltip and a bool\'s kind', () => {
    const d = pineInputDeclarations(RS)
    expect(d).toHaveLength(39)
    expect(d[0]).toMatchObject({ name: 'hideRSRat', title: 'Hide Rating', group: 'RS Line' })
    expect(d.find((x) => x.name === 'offset')).toMatchObject({ group: 'Shape & Offset', tooltip: expect.stringMatching(/under the price/) })
    expect(d.find((x) => x.name === 'boolMa')).toMatchObject({ kind: 'bool', group: '1st MA on RS Line' })
  })
})

describe('RS Rating\'s settings form is TradingView\'s Inputs tab', () => {
  it('the Inputs tab: TradingView\'s titles, in TradingView\'s order, under its headers', () => {
    const { def } = installRS('u_pp1')
    try {
      const f = fieldsForInstance(def, { instanceId: 'i', defId: def.id, inputs: {} })
      expect(f.inputs.map((x) => x.label)).toEqual(TV_INPUTS)
      const byKey = Object.fromEntries(f.inputs.map((x) => [x.key, x]))
      expect(byKey.hideRSRat.group).toBe('RS Line')
      expect(byKey.offset).toMatchObject({ group: 'Shape & Offset', tooltip: expect.any(String) })
      expect(byKey.out2Color).toMatchObject({ label: 'Color', group: '1st MA on RS Line', inline: 'c' })
    } finally {
      registry.uninstallUserDefinition('u_pp1')
    }
  })

  it('a v4 `input(false, …)` held as 0/1 is a switch writing 1 / 0; the Style tab holds the widths, titled', () => {
    const { def } = installRS('u_pp2')
    try {
      const f = fieldsForInstance(def, { instanceId: 'i', defId: def.id, inputs: {} })
      for (const k of ['boolMa', 'boolMa2', 'fillMa']) {
        expect(f.inputs.find((x) => x.key === k)).toMatchObject({ type: 'toggle', numeric: true })
        expect(f.values[k]).toBe(0)
      }
      expect(f.style.map((x) => x.label)).toEqual(expect.arrayContaining(['RS Line width', '1st MA on RS Line width',
        '2nd MA on RS Line width']))
      expect(f.style.some((x) => /^out\d/.test(x.label))).toBe(false)
      expect(f.style.some((x) => x.key === 'color' || x.key === 'out2Color')).toBe(false)
    } finally {
      registry.uninstallUserDefinition('u_pp2')
    }
  })

  it('⛔ read at form time only: the stored document is untouched', () => {
    const { minted, def } = installRS('u_pp3')
    try {
      expect(minted.inputs.map((i) => i.key).slice(0, 2)).toEqual(['color', 'lineWidth'])
      expect(minted.inputs.some((i) => i.group || i.tooltip)).toBe(false)
      expect(def.inputs.find((i) => i.key === 'boolMa')).toMatchObject({ type: 'int', default: 0 })
    } finally {
      registry.uninstallUserDefinition('u_pp3')
    }
  })

  it('CONTROL: a document without a Pine source is laid out exactly as before', () => {
    const plain = { id: 'x', inputs: [{ key: 'b', type: 'int', label: 'B', default: 0 }, { key: 'a', type: 'int', label: 'A', default: 1 }], plots: [] }
    expect(pineFieldPresentation(plain).order.size).toBe(0)
    expect(fieldsFromDefinition(plain).map((f) => [f.key, f.type])).toEqual([['b', 'number'], ['a', 'number']])
  })
})

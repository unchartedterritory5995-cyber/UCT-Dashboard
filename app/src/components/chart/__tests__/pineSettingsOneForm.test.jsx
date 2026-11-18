// app/src/components/chart/__tests__/pineSettingsOneForm.test.jsx
//
// ─── ⭐⭐ ONE FORM MODEL: THE CHART SETTINGS INSPECTOR SHOWS WHAT THE LEGEND DIALOG SHOWS (2026-11-17) ──
//
// A Pine indicator's settings are laid out by ONE model, `fieldsForInstance`, which
// `pinePresentation.test.js` holds to TradingView's Inputs tab (RS Rating's capture). The chart settings
// Inspector (the legend gear's target on /charts) drew its own split instead:
//   ⚰️ every colour went to Appearance on the house rule, so RS Rating's seven script colours left
//      their groups for one flat, ungrouped list, where TradingView shows them in Inputs;
//   ⚰️ an untitled plot's style row printed its column key ("out2 style"), where TradingView's Style
//      tab says "Plot" and our own colour / width rows already said the plot's name.
// These rails render the REAL Inspector and hold it to the model, key for key.
import { useState } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from '../ChartSettingsModal'
import { mergeChartSettings } from '../chartDefaults'
import * as registry from '../engine/nativeRegistry'
import { setIndicatorEnabled, findInstance } from '../engine/instanceControls'
import { fieldsForInstance, hiddenPlotOnlyInputKeys } from '../indicatorRegistry'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { plotTitlesOf } from '../engine/pinePresentation'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, setRuntimeKillList } from '../engine/runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const RS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const ID = 'u_oneform01'

beforeEach(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  const minted = memberPaneDefinition({ source: RS, id: ID, name: 'RS Rating' }).definition
  const { installed, errors } = registry.installUserDefinitions([minted])
  expect(installed.length, errors.join(' | ')).toBe(1)
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(ID)
  __resetRuntimePanePermission()
  vi.unstubAllEnvs()
})

function Host({ initial }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} />
}
const inspector = () => document.body.querySelector('[data-inspector-for]')
const section = (name) => inspector().querySelector(`[data-section="${name}"]`)
const openAllGroups = () => {
  for (const b of [...inspector().querySelectorAll('[data-group] > button[aria-expanded="false"]')]) fireEvent.click(b)
}
const fieldsIn = (sec) => [...(sec ? sec.querySelectorAll('[data-field]') : [])]
  .map((el) => ({ key: el.getAttribute('data-field'), label: (el.querySelector('[class*="insFieldLabel"]')?.textContent || '').trim() }))
  .filter((f) => !f.key.startsWith('__'))

function showRS() {
  const cs = setIndicatorEnabled(mergeChartSettings({}), ID, true, registry)
  const inst = cs.indicatorInstances.find((i) => i.defId === ID)
  expect(inst, 'the instance was not added').toBeTruthy()
  render(<Host initial={cs} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  const row = [...document.body.querySelectorAll('[data-structure-row]')]
    .find((r) => /RS Rating/.test(r.textContent || ''))
  expect(row, 'no structure row for RS Rating').toBeTruthy()
  fireEvent.click(row)
  expect(inspector(), 'the Inspector did not open').toBeTruthy()
  openAllGroups()
  return { def: registry.getDefinition(ID), inst: findInstance(cs, inst.instanceId) }
}

describe('⭐⭐ the Inspector\'s Inputs ARE the model\'s Inputs (TradingView\'s Inputs tab)', () => {
  it('the same keys, in the same order, with the same titles', () => {
    const { def, inst } = showRS()
    const model = fieldsForInstance(def, inst)
    const core = fieldsIn(section('core'))
    expect(core.map((f) => f.key)).toEqual(model.inputs.map((f) => f.key))
    expect(core.map((f) => f.label)).toEqual(model.inputs.map((f) => f.label))
  })

  it('⚰️ the seven script colours sit in Inputs, each under its own group, none in Appearance', () => {
    const { def, inst } = showRS()
    const model = fieldsForInstance(def, inst)
    const colours = model.inputs.filter((f) => f.type === 'color')
    expect(colours.map((f) => f.label)).toEqual(['Color', 'Color', 'Color', 'Color', 'Positive Area', 'Negative Area', 'Color'])
    const look = new Set(fieldsIn(section('appearance')).map((f) => f.key))
    for (const c of colours) {
      expect(look.has(c.key), `${c.key} is in Appearance`).toBe(false)
      const el = section('core').querySelector(`[data-field="${c.key}"]`)
      expect(el, `${c.key} is not in Inputs`).toBeTruthy()
      expect(el.closest('[data-group]')?.getAttribute('data-group'), `${c.key}'s group`).toBe(c.group)
    }
  })

  it('the Appearance fields are the model\'s Style fields, less the ONE named difference', () => {
    const { def, inst } = showRS()
    const model = fieldsForInstance(def, inst)
    const look = fieldsIn(section('appearance'))
    // ⛔ THE ONE DIFFERENCE, NAMED, AND A RECORDED DECISION (coordinator ruling 2026-11-17), NOT DRIFT:
    // the Inspector does not offer a style input only an UNDRAWN plot reads (`hiddenPlotOnlyInputKeys`,
    // Batch 2: a box with no effect), which is our own UX deviation. The dialog keeps listing them,
    // because for a Pine script the reference is TradingView's form, which lists a setting whether or
    // not a drawn plot reads it. On RS Rating: `out5Color` / `out5Width`.
    const inert = hiddenPlotOnlyInputKeys(def)
    expect([...inert].sort(), 'RS Rating\'s undrawn plot\'s own colour / width, by name').toEqual(['out5Color', 'out5Width'])
    expect(look.map((f) => f.key)).toEqual(model.style.map((f) => f.key).filter((k) => !inert.has(k)))
    expect(model.inputs.some((f) => inert.has(f.key)), 'the difference never reaches Inputs').toBe(false)
    expect(look.map((f) => f.label)).toEqual(expect.arrayContaining(['RS Line width', '1st MA on RS Line width', '2nd MA on RS Line width']))
  })

  it('a Pine tooltip rides to the Inspector (it was dropped)', () => {
    const { def, inst } = showRS()
    const offset = fieldsForInstance(def, inst).inputs.find((f) => f.key === 'offset')
    expect(offset.tooltip).toMatch(/under the price/)
    const label = section('core').querySelector('[data-field="offset"] [class*="insFieldLabel"]')
    expect(label.getAttribute('title')).toBe(offset.tooltip)
  })
})

describe('⭐⭐ a plot\'s style row is named as TradingView names it, never by its column key', () => {
  it('titled plots by their title, untitled by the group of the colour they draw in, else "Plot"', () => {
    const { def } = showRS()
    const rows = [...inspector().querySelectorAll('[data-field^="__style__:"]')]
    expect(rows.length).toBeGreaterThan(1)
    const titles = plotTitlesOf(def)
    for (const r of rows) {
      const key = r.getAttribute('data-field').slice('__style__:'.length)
      const text = r.querySelector('[class*="insFieldLabel"]').textContent.trim()
      expect(text, `the row for ${key}`).not.toMatch(/out\d/)
      expect(text).toBe(`${titles.get(key)} style`)
      expect(r.querySelector('select').getAttribute('aria-label')).not.toMatch(/out\d/)
    }
    expect(rows.map((r) => r.querySelector('[class*="insFieldLabel"]').textContent.trim()))
      .toEqual(expect.arrayContaining(['RS Line style', '1st MA on RS Line style', '2nd MA on RS Line style']))
  })

  it('every accessible name is distinct on RS Rating', () => {
    showRS()
    const names = [...inspector().querySelectorAll('[data-field^="__style__:"] select')].map((s) => s.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
  })

  it('⭐ two UNTITLED plots both read "Plot style" (TradingView\'s "Plot"); a screen reader still tells them apart', () => {
    const TWO = '//@version=5\nindicator("Two plots")\nplot(ta.sma(close, 10), "A")\nplot(ta.sma(close, 20))\nplot(ta.sma(close, 30))\n'
    const minted = memberPaneDefinition({ source: TWO, id: 'u_oneform02', name: 'Two plots' })
    expect(minted.ok, minted.reason).toBe(true)
    const { installed, errors } = registry.installUserDefinitions([minted.definition])
    expect(installed.length, errors.join(' | ')).toBe(1)
    try {
      const cs = setIndicatorEnabled(mergeChartSettings({}), 'u_oneform02', true, registry)
      render(<Host initial={cs} />)
      fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
      fireEvent.click([...document.body.querySelectorAll('[data-structure-row]')].find((r) => /Two plots/.test(r.textContent || '')))
      const rows = [...inspector().querySelectorAll('[data-field^="__style__:"]')]
      expect(rows).toHaveLength(3)
      expect(rows.map((r) => r.querySelector('[class*="insFieldLabel"]').textContent.trim()))
        .toEqual(['A style', 'Plot style', 'Plot style'])
      const names = rows.map((r) => r.querySelector('select').getAttribute('aria-label'))
      expect(names).toEqual(['Two plots A plot style', 'Two plots Plot plot style', 'Two plots Plot 2 plot style'])
    } finally {
      registry.uninstallUserDefinition('u_oneform02')
    }
  })
})

describe('plotTitlesOf — the one naming rule', () => {
  it('own title; else the linked colour\'s group; else "Plot"; never a column key', () => {
    const def = registry.getDefinition(ID)
    const t = plotTitlesOf(def)
    for (const v of t.values()) expect(v).not.toMatch(/^out\d+$/)
    expect([...t.values()]).toEqual(expect.arrayContaining(['RS Line']))
    const bare = { id: 'x', inputs: [], plots: [{ key: 'value', label: '' }, { key: 'out2', label: 'out2' }, { key: 'k', label: 'Mine' }] }
    expect(Object.fromEntries(plotTitlesOf(bare))).toEqual({ value: 'Plot', out2: 'Plot', k: 'Mine' })
  })

  it('⭐ the import\'s stand-in (an untitled first plot labelled with the indicator\'s name) is "Plot"; a script title that equals the name is kept', () => {
    // a document that carries its Pine source (a runtime document's own, as `pineSourceOf` reads it)
    const doc = (src, name) => ({ id: 'd', meta: { name }, inputs: [], compute: { kind: 'runtime', source: src },
      plots: [{ key: 'value', label: name }] })
    expect(plotTitlesOf(doc('//@version=5\nindicator("Mine")\nplot(ta.sma(close, 10))\n', 'Mine')).get('value')).toBe('Plot')
    expect(plotTitlesOf(doc('//@version=5\nindicator("RSI")\nplot(ta.rsi(close, 14), "RSI")\n', 'RSI')).get('value')).toBe('RSI')
    expect(plotTitlesOf(doc('//@version=5\nindicator("RSI")\nplot(ta.rsi(close, 14), title = \'RSI\')\n', 'RSI')).get('value')).toBe('RSI')
    // and on the real import of RS Rating, its titled first plot stays titled
    expect(plotTitlesOf(registry.getDefinition(ID)).get('value')).toBe('RS Line')
  })

  it('⚠️ STATED LIMIT: an import that kept only its formula carries no source, so its stand-in is kept', () => {
    const m = memberPaneDefinition({ source: '//@version=5\nindicator("Mine")\nplot(ta.sma(close, 10))\n', id: 'u_oneform04', name: 'Mine' })
    expect(m.ok, m.reason).toBe(true)
    expect(m.definition.plots[0].label).toBe('Mine')
    expect(plotTitlesOf(m.definition).get('value')).toBe('Mine')
  })
})

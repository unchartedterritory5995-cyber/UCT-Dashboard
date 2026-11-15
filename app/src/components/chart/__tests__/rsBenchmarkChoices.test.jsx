// app/src/components/chart/__tests__/rsBenchmarkChoices.test.jsx
//
// ⭐ 2026-11-12 — "I want to be able to benchmark to sector, theme etc" (owner).
// The UCT RS benchmark menu grew Pick a sector, Theme (auto) and Pick a theme.
// What this pins, against the REGISTERED definitions (never a copy):
//   1. the menu: the order and the plain labels, one declaration shared by every
//      RS indicator that takes a benchmark, the new options hidden until the live
//      row names them, the old keys all still there;
//   2. the companions: the sector list and the theme chooser each wake only under
//      their own option (dimmed otherwise, never removed);
//   3. the theme chooser on all three settings surfaces — the settings dialog,
//      the Chart Settings inspector, the phone sheet: it searches, and a pick
//      stores the theme's ID (never its name), once;
//   4. the pane label names the benchmark plainly: `UCT RS · XLV` for a picked
//      sector, the theme's name for a picked theme (before and after the server
//      answers), and the server's name for Theme (auto).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import * as engineRegistry from '../engine/nativeRegistry'
import { getDefinition } from '../engine/nativeRegistry'
import { fieldsForInstance, evalActiveWhen } from '../indicatorRegistry'
import { legendChips, readoutChipName } from '../engine/readout'
import { findInstance } from '../engine/instanceControls'
import { mergeChartSettings } from '../chartDefaults'
import { primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests } from '../engine/serverCompute'
import { _resetOptionsSources } from '../engine/optionsSources'
import { loadOptionsSource } from '../optionsSourceLoader'
import IndicatorSettingsDialog from '../IndicatorSettingsDialog'
import ChartSettingsModal from '../ChartSettingsModal'
import MobileIndicatorSheet from '../../../pages/charts/mobile/MobileIndicatorSheet'

const RS = getDefinition('rsLine')
const BENCH_IDS = ['rsLine', 'rsPhases', 'rsVsEma', 'rsExit']
const MENU = [
  ['SPY', 'S&P 500 (SPY)'], ['RSP', 'Equal-weight S&P 500 (RSP)'], ['QQQ', 'Nasdaq 100 (QQQ)'],
  ['IWM', 'Russell 2000 (IWM)'], ['SECTOR', 'Sector (auto)'], ['SECTOR_PICK', 'Pick a sector'],
  ['INDUSTRY', 'Industry group (auto)'], ['THEME', 'Theme (auto)'], ['THEME_PICK', 'Pick a theme'],
  ['CUSTOM', 'Your symbol'],
]
const THEMES = { options: [
  { value: 'ai_chips', label: 'AI / GPU Chips' },
  { value: 'semis', label: 'Semiconductors' },
  { value: 'chips_act', label: 'Reshoring and the CHIPS Act' },
  { value: 'cloud', label: 'Cloud Computing' },
] }
const optionValues = (def, key) => (def.inputs.find((i) => i.key === key).options || [])
  .map((o) => (Array.isArray(o) ? o[0] : o.value))
/** The live v4 row: every server input, every enum's options (what production answers). */
const v4Body = () => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: 'rsLine', version: 5, compute: { kind: 'server', fn: 'rsLine', rev: 5 },
    inputs: RS.meta.serverInputs.map((key) => {
      const inp = RS.inputs.find((i) => i.key === key)
      return { key, type: inp ? inp.type : 'x', default: null, ...(inp && inp.type === 'enum' ? { options: optionValues(RS, key) } : {}) }
    }),
    columns: ['rsLine'],
  }],
})
const V4_DECLARED = { inputs: RS.meta.serverInputs, options: { benchmark: MENU.map(([v]) => v), view: optionValues(RS, 'view') } }

beforeEach(async () => {
  clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null); _resetOptionsSources()
  await loadOptionsSource('rsThemes', { fetchImpl: () => Promise.resolve({ ok: true, json: () => Promise.resolve(THEMES) }) })
})
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null); _resetOptionsSources() })

describe('1 · the menu', () => {
  it('lists the ten choices in the owner\'s order with plain labels, the same on every RS indicator', () => {
    for (const id of BENCH_IDS) {
      const def = getDefinition(id)
      if (!def) continue          // the split rows register only with their flag
      const bench = def.inputs.find((i) => i.key === 'benchmark')
      expect(bench.options.map((o) => [o[0], o[1]]), id).toEqual(MENU)
      expect(bench.tooltip.split(/[.!?](\s|$)/).filter((s) => s.trim()), `${id}: one sentence`).toHaveLength(1)
    }
    const { RS_LINE_SLIM_RAW, RS_LINE_V5_RAW } = engineRegistry
    for (const raw of [RS_LINE_SLIM_RAW, RS_LINE_V5_RAW]) {
      expect(raw.inputs.find((i) => i.key === 'benchmark').options.map((o) => o[0])).toEqual(MENU.map(([v]) => v))
    }
  })

  it('the new choices wait for the live row; every old key is still offered', () => {
    const shown = (declared) => fieldsForInstance(RS, null, { declared }).all
      .find((f) => f.key === 'benchmark').options.map((o) => o[0])
    expect(shown(null)).toEqual(['SPY', 'RSP', 'QQQ', 'IWM', 'SECTOR', 'INDUSTRY'])
    expect(shown(V4_DECLARED)).toEqual(MENU.map(([v]) => v))
    // a saved chart on an old key keeps it, whatever the server says
    for (const key of ['SPY', 'RSP', 'SECTOR', 'QQQ', 'IWM', 'INDUSTRY', 'CUSTOM']) expect(shown(V4_DECLARED)).toContain(key)
  })
})

describe('2 · the companions', () => {
  const fields = (inputs) => {
    const m = fieldsForInstance(RS, { instanceId: 'rs', defId: 'rsLine', inputs }, { declared: V4_DECLARED })
    return { byKey: Object.fromEntries(m.all.map((f) => [f.key, f])), values: m.values }
  }
  it('the sector list wakes only under Pick a sector, with the eleven funds in plain names', () => {
    const { byKey, values } = fields({ benchmark: 'SECTOR_PICK' })
    expect(byKey.sectorBenchmark.type).toBe('select')
    expect(byKey.sectorBenchmark.options.map((o) => o[1])).toEqual([
      'Technology (XLK)', 'Health Care (XLV)', 'Financials (XLF)', 'Consumer Discretionary (XLY)',
      'Consumer Staples (XLP)', 'Energy (XLE)', 'Industrials (XLI)', 'Materials (XLB)', 'Utilities (XLU)',
      'Real Estate (XLRE)', 'Communication Services (XLC)'])
    expect(evalActiveWhen(byKey.sectorBenchmark.activeWhen, values)).toBe(true)
    expect(evalActiveWhen(byKey.themeBenchmark.activeWhen, values)).toBe(false)
  })
  it('the theme chooser wakes only under Pick a theme, and is a chooser, not a text box', () => {
    const { byKey, values } = fields({ benchmark: 'THEME_PICK' })
    expect(byKey.themeBenchmark).toMatchObject({ type: 'pick', optionsSource: 'rsThemes', label: 'Theme' })
    expect(evalActiveWhen(byKey.themeBenchmark.activeWhen, values)).toBe(true)
    expect(evalActiveWhen(byKey.sectorBenchmark.activeWhen, values)).toBe(false)
    const auto = fields({ benchmark: 'THEME' })
    expect(evalActiveWhen(auto.byKey.themeBenchmark.activeWhen, auto.values), 'Theme (auto) needs no pick').toBe(false)
  })
})

/** Type into a chooser and pick the option with this name. */
function pickFrom(box, query, name) {
  act(() => { fireEvent.focus(box) })
  act(() => { fireEvent.change(box, { target: { value: query } }) })
  const list = document.getElementById(box.getAttribute('aria-controls'))
  const names = within(list).getAllByRole('option').map((o) => o.textContent)
  const opt = within(list).getByRole('option', { name })
  act(() => { fireEvent.mouseDown(opt) })
  return names
}

describe('3 · the theme chooser on the three settings surfaces', () => {
  const blob = (inputs) => ({
    ...mergeChartSettings(null),
    indicatorInstances: [{ instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs, hidden: false }],
  })
  const stored = (cs) => (findInstance(cs, 'inst:rsLine:1') || {}).inputs || {}

  it('the settings dialog: search, pick, the ID is stored once and the box shows the name', () => {
    primeServerDefinitions(v4Body())
    const seen = { cs: blob({ benchmark: 'THEME_PICK' }), writes: 0 }
    function Host() {
      const [cs, setCs] = useState(seen.cs)
      return <IndicatorSettingsDialog open instanceId="inst:rsLine:1" settings={cs}
        registry={{ getDefinition: engineRegistry.getDefinition, listDefinitions: engineRegistry.listDefinitions }}
        onChange={(next) => { seen.cs = next; seen.writes += 1; setCs(next) }} onClose={() => {}} />
    }
    render(<Host />)
    const row = document.querySelector('[data-input-key="themeBenchmark"]')
    expect(row).toBeTruthy()
    const box = within(row).getByRole('combobox')
    expect(box.value).toBe('')
    expect(box.getAttribute('placeholder')).toBe('Search themes')
    const names = pickFrom(box, 'chip', 'AI / GPU Chips')
    expect(names).toEqual(['AI / GPU Chips', 'Reshoring and the CHIPS Act'])
    expect(stored(seen.cs).themeBenchmark).toBe('ai_chips')
    expect(seen.writes).toBe(1)
    expect(within(document.querySelector('[data-input-key="themeBenchmark"]')).getByRole('combobox').value).toBe('AI / GPU Chips')
  })

  it('the settings dialog: under any other benchmark the chooser is inert', () => {
    primeServerDefinitions(v4Body())
    render(<IndicatorSettingsDialog open instanceId="inst:rsLine:1" settings={blob({ benchmark: 'SECTOR' })}
      registry={{ getDefinition: engineRegistry.getDefinition, listDefinitions: engineRegistry.listDefinitions }}
      onChange={() => {}} onClose={() => {}} />)
    const box = within(document.querySelector('[data-input-key="themeBenchmark"]')).getByRole('combobox')
    expect(box.disabled).toBe(true)
  })

  it('the Chart Settings inspector: the same chooser, the same single write', () => {
    primeServerDefinitions(v4Body())
    const seen = { cs: blob({ benchmark: 'THEME_PICK', themeBenchmark: 'semis' }), writes: 0 }
    function Host() {
      const [cs, setCs] = useState(seen.cs)
      return <ChartSettingsModal open settings={cs} onChange={(next) => { seen.cs = next; seen.writes += 1; setCs(next) }} onClose={() => {}} />
    }
    render(<Host />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    const rows = [...document.body.querySelectorAll('[data-structure-row]')]
    const row = rows.find((r) => /UCT R/.test(r.textContent || ''))
    expect(row, rows.map((r) => r.textContent).join(' | ')).toBeTruthy()
    fireEvent.click(row)
    const inspector = document.body.querySelector('[data-inspector-for]')
    const field = inspector.querySelector('[data-field="themeBenchmark"]')
    expect(field, 'the inspector renders the theme chooser').toBeTruthy()
    const box = within(field).getByRole('combobox')
    expect(box.value).toBe('Semiconductors')
    const before = seen.writes
    pickFrom(box, 'cloud', 'Cloud Computing')
    expect(stored(seen.cs).themeBenchmark).toBe('cloud')
    expect(seen.writes - before).toBe(1)
  })

  it('the phone sheet: the same chooser in a 44 px row, the same single write', () => {
    primeServerDefinitions(v4Body())
    const initial = { indicatorInstances: [{ instanceId: 'rs-1', defId: 'rsLine', inputs: { benchmark: 'THEME_PICK' }, hidden: false }] }
    const writes = []
    function Harness() {
      const [cs, setCs] = useState(initial)
      return <MobileIndicatorSheet open onClose={() => {}} cs={cs}
        onWrite={(next) => { writes.push(next); setCs(next) }}
        onBrowseLibrary={() => {}} onOpenSettings={() => {}}
        initialEditing={{ kind: 'study', defId: 'rsLine', instanceId: 'rs-1' }} />
    }
    render(<Harness />)
    const row = document.querySelector('[data-input-key="themeBenchmark"]')
    expect(row).toBeTruthy()
    const box = within(row).getByRole('combobox')
    expect(box.className).toMatch(/textInput/)
    pickFrom(box, 'semi', 'Semiconductors')
    expect(writes).toHaveLength(1)
    expect(writes[0].indicatorInstances.find((i) => i.instanceId === 'rs-1').inputs.themeBenchmark).toBe('semis')
  })

  it('a stored theme the list no longer holds reads as words, with a note', () => {
    primeServerDefinitions(v4Body())
    render(<IndicatorSettingsDialog open instanceId="inst:rsLine:1" settings={blob({ benchmark: 'THEME_PICK', themeBenchmark: 'old_theme' })}
      registry={{ getDefinition: engineRegistry.getDefinition, listDefinitions: engineRegistry.listDefinitions }}
      onChange={() => {}} onClose={() => {}} />)
    const row = document.querySelector('[data-input-key="themeBenchmark"]')
    expect(within(row).getByRole('combobox').value).toBe('Old Theme')
    expect(within(row).getByRole('status').textContent).toBe('That theme is no longer listed')
  })
})

describe('4 · the pane label names the benchmark plainly', () => {
  const binding = { key: 'inst:rsLine:1::rsLine', instanceId: 'inst:rsLine:1', defId: 'rsLine', plotKey: 'rsLine',
    series: { __id: 'rs' }, lastValue: 0.4187 }
  const chip = (inputs, scalars) => legendChips([binding], null, engineRegistry,
    [{ instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs, hidden: false }],
    scalars ? { scalarsOf: () => scalars } : undefined)[0]

  it('a picked sector reads as its fund before the server answers', () => {
    expect(readoutChipName(chip({ benchmark: 'SECTOR_PICK', sectorBenchmark: 'XLV' }), RS)).toBe('UCT RS · XLV')
    expect(readoutChipName(chip({ benchmark: 'SECTOR_PICK' }), RS)).toBe('UCT RS · XLK')
  })

  it('a picked theme reads as its name, never its ID', () => {
    expect(readoutChipName(chip({ benchmark: 'THEME_PICK', themeBenchmark: 'ai_chips' }), RS)).toBe('UCT RS · AI / GPU Chips')
    expect(readoutChipName(chip({ benchmark: 'THEME_PICK' }), RS)).toBe('UCT RS · Pick a theme')
    _resetOptionsSources()
    expect(readoutChipName(chip({ benchmark: 'THEME_PICK', themeBenchmark: 'ai_chips' }), RS), 'list not loaded: the ID as words')
      .toBe('UCT RS · Ai Chips')
  })

  it('once the server answers, its plain name wins: a theme, a sector fund, a fallback', () => {
    const named = (name, resolved) => ({ benchmark: { requested: 'THEME', resolved, name, label: name, fallback: null } })
    expect(readoutChipName(chip({ benchmark: 'THEME' }, named('AI / GPU Chips', 'THEME:ai_chips')), RS))
      .toBe('UCT RS · AI / GPU Chips')
    expect(readoutChipName(chip({ benchmark: 'THEME' }, named('XLK', 'XLK')), RS)).toBe('UCT RS · XLK')
    expect(readoutChipName(chip({ benchmark: 'INDUSTRY' }, named('Semiconductors', 'INDUSTRY:Semiconductors')), RS))
      .toBe('UCT RS · Semiconductors')
  })
})

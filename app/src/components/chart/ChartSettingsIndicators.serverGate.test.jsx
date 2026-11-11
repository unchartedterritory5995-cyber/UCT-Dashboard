// app/src/components/chart/ChartSettingsIndicators.serverGate.test.jsx
//
// ⭐ UCT RS PHASE 3, UNIT 3-02b — the server gate in the Chart Settings Inspector,
// at parity with the settings dialog and the phone sheet (3-02):
//   · the Preset row lists `visiblePresets(def, serverDeclares(def.id))`, and
//     re-reads when the definitions LAND;
//   · the field list comes through `fieldsForInstance(…, {declared})`: a gated
//     input appears only once declared, a gated option likewise, a legacy input
//     never;
//   · a STORED gated option the live row does not declare is shown, disabled,
//     as "<label> (not available)", and the select reads it;
//   · only a `server` definition asks for the definitions (selecting RSI spends
//     no GET), and a server one asks once.
//
// ⛔ Drives the REAL modal with the probe registered beside the shipped
// definitions (`inspectorTextProbe.fixture.js`).
import { useState } from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { findInstance, setIndicatorEnabled } from './engine/instanceControls'
import * as registry from './engine/nativeRegistry'
import {
  primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests,
} from './engine/serverCompute'
import { PROBE_ID, PROBE_INST, definitionsBody } from './__tests__/inspectorTextProbe.fixture'

vi.mock('./engine/nativeRegistry', async (importOriginal) => {
  const actual = await importOriginal()
  const { withProbe } = await import('./__tests__/inspectorTextProbe.fixture')
  return withProbe(actual)
})

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

const blob = (inputs = {}) => ({
  ...mergeChartSettings(null),
  indicatorInstances: [{ instanceId: PROBE_INST, defId: PROBE_ID, inputs, hidden: false }],
})

function Host({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={(next) => { onSeen(next); setCs(next) }} onClose={() => {}} />
}

const rows = () => [...document.body.querySelectorAll('[data-structure-row]')]
const nameOf = (r) => (r.querySelector('[class*="insRowName"]')?.textContent || '').trim()
const pick = (re) => {
  const row = rows().find((r) => re.test(nameOf(r)))
  if (!row) throw new Error(`no structure row matches ${re}; rows: ${rows().map(nameOf).join(' | ')}`)
  fireEvent.click(row)
}
const inspector = () => document.body.querySelector('[data-inspector-for]')
const field = (key) => inspector().querySelector(`[data-field="${key}"]`)
const presetLabels = () => [...field('__preset__').querySelectorAll('select option')].map((o) => o.textContent)
const benchmarkOptions = () => [...field('benchmark').querySelectorAll('select option')]
  .map((o) => [o.value, o.textContent, o.disabled])
const fieldKeys = () => [...inspector().querySelectorAll('[data-section="core"] [data-field]')]
  .map((el) => el.getAttribute('data-field'))

function mount(cs) {
  const seen = { cs }
  render(<Host initial={cs} onSeen={(next) => { seen.cs = next }} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  return seen
}

describe('⭐ the Preset row follows the live row', () => {
  it('nothing declared (unknown or failed): the gated presets are hidden, the ungated ones listed', () => {
    mount(blob()); pick(/^Text probe/)
    expect(presetLabels()).toEqual(['Plain', 'Tech', 'Custom'])
  })

  it('the live row declares CUSTOM: "My symbol" and the requiresServer preset appear when the answer LANDS', () => {
    mount(blob()); pick(/^Text probe/)
    act(() => { primeServerDefinitions(definitionsBody({ custom: true })) })
    expect(presetLabels()).toEqual(['Plain', 'My symbol', 'Dark preset', 'Tech', 'Custom'])
  })

  it('choosing a gated preset once declared applies it through applyPresetInputs', () => {
    primeServerDefinitions(definitionsBody({ custom: true }))
    const seen = mount(blob()); pick(/^Text probe/)
    fireEvent.change(field('__preset__').querySelector('select'), { target: { value: 'mine' } })
    expect(findInstance(seen.cs, PROBE_INST).inputs.benchmark).toBe('CUSTOM')
    expect(field('__preset__').querySelector('select').value).toBe('mine')
  })

  it('a row that matches a hidden preset reads Custom, not the hidden preset', () => {
    mount(blob({ length: 30 })); pick(/^Text probe/)
    const sel = field('__preset__').querySelector('select')
    expect(sel.value).toBe('__custom')
    expect(presetLabels()).not.toContain('Dark preset')
  })
})

describe('⭐ the field list goes through fieldsForInstance(…, {declared})', () => {
  it('nothing declared: no gated input, no gated option, never the legacy input', () => {
    mount(blob()); pick(/^Text probe/)
    const keys = fieldKeys()
    expect(keys).toEqual(expect.arrayContaining(['benchmark', 'customBenchmark', 'note', 'length']))
    expect(keys).not.toContain('window')
    expect(keys).not.toContain('oldMode')
    expect(benchmarkOptions().map((o) => o[0])).toEqual(['SPY', 'RSP'])
  })

  it('declared: the gated input and the gated option appear on landing; the legacy input still never does', () => {
    mount(blob()); pick(/^Text probe/)
    expect(field('window')).toBeNull()
    act(() => { primeServerDefinitions(definitionsBody({ custom: true })) })
    expect(field('window')).toBeTruthy()
    expect(field('window').querySelector('input[type="number"]').value).toBe('63')
    expect(benchmarkOptions().map((o) => o[0])).toEqual(['SPY', 'RSP', 'CUSTOM'])
    expect(field('oldMode')).toBeNull()
    // the declared field order is the definition's
    expect(fieldKeys().filter((k) => !k.startsWith('__')))
      .toEqual(['benchmark', 'customBenchmark', 'note', 'length', 'window'])
  })

  it('a gated input, once declared, writes through the row writer', () => {
    primeServerDefinitions(definitionsBody({ custom: true }))
    const seen = mount(blob()); pick(/^Text probe/)
    fireEvent.change(field('window').querySelector('input'), { target: { value: '100' } })
    expect(findInstance(seen.cs, PROBE_INST).inputs.window).toBe(100)
  })
})

describe('⭐ a STORED gated value the live row does not declare renders honestly', () => {
  it('shown, disabled, as "(not available)", and the select reads it', () => {
    mount(blob({ benchmark: 'CUSTOM', customBenchmark: 'XLK' })); pick(/^Text probe/)
    const sel = field('benchmark').querySelector('select')
    expect(sel.value).toBe('CUSTOM')
    expect(benchmarkOptions()).toEqual([
      ['SPY', 'S&P 500', false], ['RSP', 'Equal weight', false], ['CUSTOM', 'Your symbol (not available)', true],
    ])
    // once the server declares it again it is an ordinary option
    act(() => { primeServerDefinitions(definitionsBody({ custom: true })) })
    expect(benchmarkOptions().at(-1)).toEqual(['CUSTOM', 'Your symbol', false])
  })

  it('choosing a live option from it writes the live value', () => {
    const seen = mount(blob({ benchmark: 'CUSTOM' })); pick(/^Text probe/)
    fireEvent.change(field('benchmark').querySelector('select'), { target: { value: 'RSP' } })
    expect(findInstance(seen.cs, PROBE_INST).inputs.benchmark).toBe('RSP')
    expect(benchmarkOptions().map((o) => o[0])).toEqual(['SPY', 'RSP'])
  })

  it('a stored ungated value adds nothing to the list', () => {
    mount(blob({ benchmark: 'RSP' })); pick(/^Text probe/)
    expect(benchmarkOptions().map((o) => o[0])).toEqual(['SPY', 'RSP'])
  })
})

describe('⛔ who asks for the definitions', () => {
  it('selecting a non-server definition (RSI) never asks; selecting the server one asks exactly once', async () => {
    const fetcher = vi.fn(async () => definitionsBody({ custom: true }))
    __setServerDefinitionsFetcherForTests(fetcher)
    const cs = setIndicatorEnabled(blob(), 'rsi', true, registry)
    mount(cs)
    pick(/^Relative Strength Index/)
    expect(inspector()).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
    pick(/^Text probe/)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
    fireEvent.change(field('length').querySelector('input'), { target: { value: '20' } })
    pick(/^Relative Strength Index/)
    pick(/^Text probe/)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(presetLabels()).toContain('My symbol')
  })
})

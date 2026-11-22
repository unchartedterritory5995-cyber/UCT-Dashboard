/* UCT RS PHASE 3, UNIT 3-02 — the generic text control on the phone, and the
 * server gate wired into the phone study editor.
 *
 * What these rails pin:
 *   · a `string` input renders a text box in its row (`data-input-key`), 44 px
 *     tall by class (the tap floor) with 16 px text, its tooltip wired through
 *     `aria-describedby` and never part of its name;
 *   · a valid value commits ONCE through the sheet's writer (`setInstanceInput`),
 *     upper-cased, on Enter or blur; an invalid value writes NOTHING, sets
 *     `aria-invalid` and shows the input's hint through `aria-describedby`;
 *   · the preset row lists `visiblePresets(def, serverDeclares(def.id))` and
 *     re-reads when the definitions land;
 *   · a STORED gated option the live row does not declare is a pressed, inert
 *     chip "<label> (not available)".
 *
 * The fixture is a native-shaped SERVER definition validated through the REAL
 * `validateDefinition` and served through a partial mock of the registry's
 * `getDefinition` (the groups suite's idiom). */
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react'
import { vi, describe, test, expect, afterEach, beforeEach } from 'vitest'
import MobileIndicatorSheet from './MobileIndicatorSheet'
import { validateDefinition } from '../../../components/chart/engine/defSchema'
import { CUSTOM_PRESET } from '../../../components/chart/engine/instanceControls'
import { primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests } from '../../../components/chart/engine/serverCompute'

const fixtures = vi.hoisted(() => new Map())
vi.mock('../../../components/chart/engine/nativeRegistry', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getDefinition: (id) => fixtures.get(id) || actual.getDefinition(id) }
})

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

const TICKER = '^[A-Z][A-Z0-9.\\-]{0,9}$'
const ID = 'textProbeSheet'
const raw = {
  schemaVersion: 1, id: ID, version: 1,
  compute: { kind: 'server', fn: ID, rev: 1 },
  meta: {
    name: 'Text probe', shortName: 'TP', category: 'Momentum', tier: 'premium', repaint: 'non-repainting',
    serverInputs: ['benchmark', 'customBenchmark', 'length'],
    presets: [
      { id: 'plain', label: 'Plain', inputs: { length: 21 } },
      { id: 'mine', label: 'My symbol', inputs: { benchmark: 'CUSTOM' } },
      { id: 'dark', label: 'Dark preset', requiresServer: true, inputs: { length: 30 } },
    ],
  },
  placement: { target: 'pane' },
  inputs: [
    { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY',
      options: [['SPY', 'S&P 500'], ['RSP', 'Equal weight'], ['CUSTOM', 'Your symbol', { requiresServer: true }]] },
    { key: 'customBenchmark', type: 'string', label: 'Symbol', default: '',
      pattern: TICKER, maxLength: 10, case: 'upper', placeholder: 'e.g. XLK',
      hint: 'Letters, dots and dashes, up to 10', tooltip: 'The symbol to compare against.' },
    { key: 'length', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
  ],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: '#ffffff', width: 1 }],
  events: [],
}
{
  const res = validateDefinition(raw)
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  fixtures.set(ID, res.def)
}
const body = ({ custom }) => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: ID, version: 1, compute: { kind: 'server', fn: ID, rev: 1 },
    inputs: [
      { key: 'benchmark', type: 'enum', default: 'SPY', options: custom ? ['SPY', 'RSP', 'CUSTOM'] : ['SPY', 'RSP'] },
      { key: 'customBenchmark', type: 'string', default: '' },
      { key: 'length', type: 'int', default: 14 },
    ],
    columns: ['line'],
  }],
})

function Harness({ initial, onWrite }) {
  const [cs, setCs] = useState(initial)
  return (
    <MobileIndicatorSheet open onClose={vi.fn()} cs={cs}
      onWrite={(next) => { onWrite(next); setCs(next) }}
      onBrowseLibrary={vi.fn()} onOpenSettings={vi.fn()}
      initialEditing={{ kind: 'study', defId: ID, instanceId: 'tp-1' }} />
  )
}
function mount(inputs = {}) {
  const initial = { indicatorInstances: [{ instanceId: 'tp-1', defId: ID, inputs, hidden: false }] }
  const onWrite = vi.fn()
  render(<Harness initial={initial} onWrite={onWrite} />)
  const ed = screen.getByRole('dialog', { name: 'Text probe settings' })
  const row = (k) => ed.querySelector(`[data-input-key="${k}"]`)
  const last = () => (onWrite.mock.calls.length ? onWrite.mock.calls.at(-1)[0] : initial)
  return { ed, row, onWrite, last }
}
const stored = (cs) => cs.indicatorInstances.find((i) => i.instanceId === 'tp-1').inputs || {}
const box = (row) => row.querySelector('input[type="text"]')
const describedBy = (el) => (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent)
const presetIds = (ed) => [...ed.querySelectorAll('[data-testid="preset-row"] [data-preset-id]')].map((b) => b.dataset.presetId)

describe('⭐ the text box on the phone', () => {
  test('renders in its row with its placeholder, its tooltip through aria-describedby, and the stored value', () => {
    const { row } = mount({ customBenchmark: 'XLK' })
    const input = box(row('customBenchmark'))
    expect(input).toBeTruthy()
    expect(input.value).toBe('XLK')
    expect(input.getAttribute('placeholder')).toBe('e.g. XLK')
    expect(input.getAttribute('autocapitalize')).toBe('characters')
    expect(describedBy(input)).toEqual(['The symbol to compare against.'])
    expect(within(row('customBenchmark')).getByRole('textbox', { name: 'Symbol' })).toBe(input)
  })

  test('the phone row keeps 44 px: the box is a tap-floor control with 16 px text, in a base (not media-gated) rule', () => {
    const { row } = mount()
    const input = box(row('customBenchmark'))
    expect(input.className).toMatch(/textInput/)
    const css = readFileSync(join(process.cwd(), 'src/pages/charts/mobile/MobileCharts.module.css'), 'utf8')
    const rule = /\n\.textInput \{([^}]*)\}/.exec(css)
    expect(rule, 'a base .textInput rule').toBeTruthy()
    expect(rule[1]).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(rule[1]).toMatch(/font-size:\s*16px/)
    expect(rule[1]).toMatch(/min-width:\s*0/)
    // and the row it sits in is the 44 px + 8 row every editor line uses
    expect(row('customBenchmark').querySelector('[class*="paramRow"]')).toBeTruthy()
  })

  test('a valid value commits ONCE through the sheet writer, upper-cased, on Enter', () => {
    const { row, onWrite, last } = mount()
    const input = box(row('customBenchmark'))
    fireEvent.change(input, { target: { value: 'xlk' } })
    expect(box(row('customBenchmark')).value).toBe('XLK')
    expect(onWrite).not.toHaveBeenCalled()
    fireEvent.keyDown(box(row('customBenchmark')), { key: 'Enter' })
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(stored(last()).customBenchmark).toBe('XLK')
    fireEvent.blur(box(row('customBenchmark')))
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  test('⛔ an invalid value writes NOTHING, sets aria-invalid, and shows the hint through aria-describedby', () => {
    const { row, onWrite } = mount({ customBenchmark: 'XLK' })
    fireEvent.change(box(row('customBenchmark')), { target: { value: '$$$' } })
    fireEvent.blur(box(row('customBenchmark')))
    expect(onWrite).not.toHaveBeenCalled()
    const input = box(row('customBenchmark'))
    expect(input.value).toBe('$$$')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(input)).toEqual(['The symbol to compare against.', 'Letters, dots and dashes, up to 10'])
    fireEvent.change(input, { target: { value: 'qqq' } })
    expect(box(row('customBenchmark')).getAttribute('aria-invalid')).toBeNull()
    fireEvent.blur(box(row('customBenchmark')))
    expect(onWrite).toHaveBeenCalledTimes(1)
  })
})

describe('⭐ the server gate on the phone', () => {
  test('nothing declared: the gated option chip and both gated presets are hidden; they appear when the answer lands', () => {
    const { ed, row } = mount()
    expect(presetIds(ed)).toEqual(['plain', CUSTOM_PRESET])
    expect(within(row('benchmark')).queryByRole('button', { name: /Your symbol/ })).toBeNull()
    act(() => { primeServerDefinitions(body({ custom: true })) })
    expect(presetIds(ed)).toEqual(['plain', 'mine', 'dark', CUSTOM_PRESET])
    expect(within(row('benchmark')).getByRole('button', { name: 'Your symbol' })).toBeEnabled()
  })

  test('⭐ a STORED gated value is a pressed, inert "(not available)" chip — and writes nothing when tapped', () => {
    const { row, onWrite } = mount({ benchmark: 'CUSTOM', customBenchmark: 'XLK' })
    const chip = within(row('benchmark')).getByRole('button', { name: 'Your symbol (not available)' })
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(chip).toBeDisabled()
    expect(chip.dataset.unavailable).toBe('true')
    fireEvent.click(chip)
    expect(onWrite).not.toHaveBeenCalled()
    // a live option still writes, and the member leaves the dark value behind
    fireEvent.click(within(row('benchmark')).getByRole('button', { name: 'S&P 500' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(within(row('benchmark')).queryByRole('button', { name: /not available/ })).toBeNull()
  })
})

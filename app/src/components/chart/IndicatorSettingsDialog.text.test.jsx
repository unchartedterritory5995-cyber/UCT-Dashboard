// app/src/components/chart/IndicatorSettingsDialog.text.test.jsx
//
// ⭐ UCT RS PHASE 3, UNIT 3-02 — the generic text control, on desktop, and the
// server gate wired into the settings dialog.
//
// What these rails pin:
//   · the schema: a `string` input may declare `pattern` (anchored), `maxLength`
//     (1-64), `case: 'upper'`, `placeholder`, `hint`; `validateInputValue`
//     enforces pattern and maxLength on NON-EMPTY values only; the modifiers are
//     refused on any other type;
//   · `fieldFromInput` maps `string` to `{type: 'text', …}`;
//   · the box commits on Enter or blur, ONCE, through `setInstanceInput`, upper-
//     cased; an invalid value writes NOTHING, sets `aria-invalid`, and shows the
//     input's own hint (or "Not a valid value") wired through `aria-describedby`;
//   · the tooltip is wired through `aria-describedby`;
//   · the preset picker lists `visiblePresets(def, serverDeclares(def.id))`, and
//     re-reads when the definitions land;
//   · a STORED gated option the live row does not declare is shown, disabled,
//     as "<label> (not available)".
//
// ⭐ EVERY WRITE IS PROVED THROUGH THE DOOR: the blob the dialog hands `onChange`
// is read for the stored input, never a spy on the writer.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import IndicatorSettingsDialog from './IndicatorSettingsDialog'
import { fieldFromInput, fieldsForInstance, textInputCommit, TEXT_INPUT_FALLBACK_HINT } from './indicatorRegistry'
import { mergeChartSettings } from './chartDefaults'
import { findInstance } from './engine/instanceControls'
import { validateDefinition, validateInputValue } from './engine/defSchema'
import { primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests } from './engine/serverCompute'

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

// ─── the fixture: a server definition with a text input and the three gates ──

const TICKER = '^[A-Z][A-Z0-9.\\-]{0,9}$'
const textProbeRaw = () => ({
  schemaVersion: 1, id: 'textProbe', version: 1,
  compute: { kind: 'server', fn: 'textProbe', rev: 1 },
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
    { key: 'note', type: 'string', label: 'Note', default: '' },
    { key: 'length', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
  ],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: '#ffffff', width: 1 }],
  events: [],
})

/** The route's body, declaring CUSTOM (and the dark preset's input) or not. */
const definitionsBody = ({ custom }) => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: 'textProbe', version: 1, compute: { kind: 'server', fn: 'textProbe', rev: 1 },
    inputs: [
      { key: 'benchmark', type: 'enum', default: 'SPY', options: custom ? ['SPY', 'RSP', 'CUSTOM'] : ['SPY', 'RSP'] },
      { key: 'customBenchmark', type: 'string', default: '' },
      { key: 'length', type: 'int', default: 14 },
    ],
    columns: ['line'],
  }],
})

function fakeRegistry(raw) {
  const res = validateDefinition(raw)
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  const def = res.def
  return { def, getDefinition: (id) => (id === def.id ? def : null), listDefinitions: () => [def] }
}

const INST = 'inst:textProbe:1'
const blob = (inputs = {}) => ({
  ...mergeChartSettings(null),
  indicatorInstances: [{ instanceId: INST, defId: 'textProbe', inputs, hidden: false }],
})

function Harness({ initial, registry, spy }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog open instanceId={INST} settings={cs} registry={registry}
      onChange={(next) => { spy(next); setCs(next) }} onClose={() => {}} />
  )
}

function mount(inputs = {}) {
  const registry = fakeRegistry(textProbeRaw())
  const initial = blob(inputs)
  const spy = vi.fn()
  render(<Harness initial={initial} registry={registry} spy={spy} />)
  const last = () => (spy.mock.calls.length ? spy.mock.calls.at(-1)[0] : initial)
  const row = (k) => screen.getByRole('dialog').querySelector(`[data-input-key="${k}"]`)
  return { spy, last, row, def: registry.def }
}

const stored = (cs) => findInstance(cs, INST).inputs || {}
const box = (row) => row.querySelector('input[type="text"]')
const describedBy = (el) => (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent)

// ─── the schema ─────────────────────────────────────────────────────────────

describe('defSchema — the text modifiers', () => {
  const withInput = (input) => ({ ...textProbeRaw(), inputs: [input] , meta: { ...textProbeRaw().meta, presets: [], serverInputs: [input.key] } })
  const ok = (input) => validateDefinition(withInput(input))

  it('accepts the declared shape, and a default that is empty or matches', () => {
    expect(ok({ key: 'b', type: 'string', default: '', pattern: TICKER, maxLength: 10, case: 'upper', placeholder: 'XLK', hint: 'Letters' }).ok).toBe(true)
    expect(ok({ key: 'b', type: 'string', default: 'XLK', pattern: TICKER }).ok).toBe(true)
    expect(ok({ key: 'b', type: 'string', default: 'anything at all' }).ok).toBe(true)
  })

  it('⛔ refuses an unanchored or broken pattern, a maxLength outside 1-64, another case, and a default that misses', () => {
    for (const bad of [
      { pattern: '[A-Z]+' }, { pattern: '^[A-Z]+' }, { pattern: '^[A-Z+$' }, { pattern: '^A\\$' }, { pattern: 7 },
      { maxLength: 0 }, { maxLength: 65 }, { maxLength: 2.5 },
      { case: 'lower' }, { placeholder: 5 }, { hint: 'x'.repeat(121) },
    ]) {
      const res = ok({ key: 'b', type: 'string', default: '', ...bad })
      expect(res.ok, JSON.stringify(bad)).toBe(false)
    }
    expect(ok({ key: 'b', type: 'string', default: 'xlk', pattern: TICKER }).ok).toBe(false)
    expect(ok({ key: 'b', type: 'string', default: 'ABCDEFGHIJK', maxLength: 10 }).ok).toBe(false)
  })

  it('⛔ refuses the modifiers on a type that is not a string', () => {
    expect(ok({ key: 'n', type: 'int', default: 1, maxLength: 4 }).ok).toBe(false)
    expect(ok({ key: 'n', type: 'enum', default: 'a', options: ['a'], placeholder: 'x' }).ok).toBe(false)
  })

  it('validateInputValue: pattern and maxLength bind non-empty values; empty is "not set"', () => {
    const spec = { type: 'string', pattern: TICKER, maxLength: 10 }
    const errs = (v) => { const e = []; validateInputValue(spec, v, 'v', e); return e }
    expect(errs('')).toEqual([])
    expect(errs('BRK.B')).toEqual([])
    expect(errs('brk')).toHaveLength(1)
    expect(errs('ABCDEFGHIJK').length).toBeGreaterThan(0)
    expect(errs(5)).toHaveLength(1)
  })
})

describe('fieldFromInput and textInputCommit', () => {
  it('a string input maps to a text field carrying what it declares, and nothing it does not', () => {
    expect(fieldFromInput({ key: 'b', type: 'string', label: 'Symbol', default: '', pattern: TICKER, maxLength: 10, case: 'upper', placeholder: 'e.g. XLK' }))
      .toEqual({ key: 'b', label: 'Symbol', type: 'text', pattern: TICKER, maxLength: 10, case: 'upper', placeholder: 'e.g. XLK' })
    expect(fieldFromInput({ key: 'n', type: 'string', default: '' })).toEqual({ key: 'n', label: 'n', type: 'text' })
  })

  it('trims, upper-cases when told to, and answers with the input\'s hint or the generic one', () => {
    const f = fieldFromInput(textProbeRaw().inputs[1])
    expect(textInputCommit(f, '  xlk ')).toEqual({ ok: true, value: 'XLK', hint: null })
    expect(textInputCommit(f, '')).toEqual({ ok: true, value: '', hint: null })
    expect(textInputCommit(f, 'x y')).toEqual({ ok: false, value: 'X Y', hint: 'Letters, dots and dashes, up to 10' })
    const plain = { key: 'p', type: 'text', pattern: '^[0-9]+$' }
    expect(textInputCommit(plain, 'abc').hint).toBe(TEXT_INPUT_FALLBACK_HINT)
  })
})

// ─── the control ────────────────────────────────────────────────────────────

describe('⭐ the text box in the dialog', () => {
  it('renders a text box with its placeholder, its tooltip wired through aria-describedby, and the stored value', () => {
    const { row } = mount({ customBenchmark: 'XLK' })
    const input = box(row('customBenchmark'))
    expect(input).toBeTruthy()
    expect(input.value).toBe('XLK')
    expect(input.getAttribute('placeholder')).toBe('e.g. XLK')
    expect(input.getAttribute('maxlength')).toBe('10')
    expect(describedBy(input)).toEqual(['The symbol to compare against.'])
    expect(input.getAttribute('aria-invalid')).toBeNull()
    // the accessible NAME is the label alone, never the tooltip
    expect(screen.getByRole('textbox', { name: 'Symbol' })).toBe(input)
  })

  it('a valid value commits ONCE through setInstanceInput, upper-cased, on Enter', () => {
    const { spy, last, row } = mount()
    const input = box(row('customBenchmark'))
    fireEvent.change(input, { target: { value: 'xl' } })
    expect(input.value).toBe('XL')            // upper-cased as typed
    fireEvent.change(input, { target: { value: 'xlk' } })
    expect(spy).not.toHaveBeenCalled()        // typing alone writes nothing
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(stored(last()).customBenchmark).toBe('XLK')
    // the blur that follows changes nothing, so writes nothing
    fireEvent.blur(box(row('customBenchmark')))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('commits on blur too, and clearing the box writes "" (not set)', () => {
    const { spy, last, row } = mount({ customBenchmark: 'XLK' })
    const input = box(row('customBenchmark'))
    fireEvent.change(input, { target: { value: 'brk.b' } })
    fireEvent.blur(input)
    expect(stored(last()).customBenchmark).toBe('BRK.B')
    fireEvent.change(box(row('customBenchmark')), { target: { value: '' } })
    fireEvent.blur(box(row('customBenchmark')))
    expect(stored(last()).customBenchmark).toBe('')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('⛔ an invalid value writes NOTHING, keeps the text, sets aria-invalid and shows the hint through aria-describedby', () => {
    const { spy, row } = mount({ customBenchmark: 'XLK' })
    const input = box(row('customBenchmark'))
    fireEvent.change(input, { target: { value: 'not a ticker' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
    const after = box(row('customBenchmark'))
    expect(after.value).toBe('NOT A TICKER')
    expect(after.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(after)).toEqual(['The symbol to compare against.', 'Letters, dots and dashes, up to 10'])
    // the miss clears the moment the text reads right, and THEN the commit writes
    fireEvent.change(after, { target: { value: 'qqq' } })
    expect(box(row('customBenchmark')).getAttribute('aria-invalid')).toBeNull()
    fireEvent.blur(box(row('customBenchmark')))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('an input with no hint says the generic sentence on a miss', () => {
    const raw = textProbeRaw()
    raw.inputs[2] = { key: 'note', type: 'string', label: 'Note', default: '', pattern: '^[0-9]+$' }
    const registry = fakeRegistry(raw)
    const spy = vi.fn()
    render(<Harness initial={blob()} registry={registry} spy={spy} />)
    const input = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
    expect(describedBy(screen.getByRole('textbox', { name: 'Note' }))).toEqual([TEXT_INPUT_FALLBACK_HINT])
  })
})

// ─── the server gate in the dialog ──────────────────────────────────────────

const presetOptions = () => [...screen.getByRole('combobox', { name: 'Preset' }).querySelectorAll('option')].map((o) => o.textContent)
const benchmarkOptions = (row) => [...row('benchmark').querySelectorAll('option')]
  .map((o) => [o.value, o.textContent, o.disabled])

describe('⭐ the server gate — presets and options follow the live row', () => {
  it('nothing declared (unknown or failed): the gated option and both gated presets are hidden', () => {
    const { row } = mount()
    expect(presetOptions()).toEqual(['Plain', 'Custom'])
    expect(benchmarkOptions(row).map((o) => o[0])).toEqual(['SPY', 'RSP'])
  })

  it('the live row declares CUSTOM: the option and the presets appear — and they appear when the answer LANDS', () => {
    const { row } = mount()
    expect(presetOptions()).toEqual(['Plain', 'Custom'])
    act(() => { primeServerDefinitions(definitionsBody({ custom: true })) })
    expect(presetOptions()).toEqual(['Plain', 'My symbol', 'Dark preset', 'Custom'])
    expect(benchmarkOptions(row).map((o) => o[0])).toEqual(['SPY', 'RSP', 'CUSTOM'])
  })

  it('⭐ a STORED gated value the live row does not declare is shown, disabled, as "(not available)"', () => {
    const { row, def } = mount({ benchmark: 'CUSTOM', customBenchmark: 'XLK' })
    const sel = row('benchmark').querySelector('select')
    expect(sel.value).toBe('CUSTOM')
    expect(benchmarkOptions(row)).toEqual([
      ['SPY', 'S&P 500', false], ['RSP', 'Equal weight', false], ['CUSTOM', 'Your symbol (not available)', true],
    ])
    // the model says the same, and a declared row lists it as an ordinary option
    const f = (declared) => fieldsForInstance(def, { inputs: { benchmark: 'CUSTOM' } }, { declared }).all.find((x) => x.key === 'benchmark')
    expect(f(null).options.at(-1)).toEqual(['CUSTOM', 'Your symbol (not available)', { disabled: true }])
    act(() => { primeServerDefinitions(definitionsBody({ custom: true })) })
    expect(benchmarkOptions(row).at(-1)).toEqual(['CUSTOM', 'Your symbol', false])
  })

  it('a stored ungated value adds nothing to the list', () => {
    const { row } = mount({ benchmark: 'RSP' })
    expect(benchmarkOptions(row).map((o) => o[0])).toEqual(['SPY', 'RSP'])
  })

  it('⛔ a non-server definition never asks for the definitions (no GET spent opening RSI-like settings)', () => {
    const fetcher = vi.fn(async () => definitionsBody({ custom: true }))
    __setServerDefinitionsFetcherForTests(fetcher)
    const raw = textProbeRaw()
    raw.compute = { kind: 'native', fn: 'textProbe', rev: 1 }
    raw.inputs[0] = { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY', options: [['SPY', 'S&P 500'], ['RSP', 'Equal weight']] }
    raw.meta = { ...raw.meta, serverInputs: undefined, presets: [{ id: 'plain', label: 'Plain', inputs: { length: 21 } }] }
    delete raw.meta.serverInputs
    const registry = fakeRegistry(raw)
    render(<Harness initial={blob()} registry={registry} spy={vi.fn()} />)
    expect(screen.getByRole('textbox', { name: 'Symbol' })).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('a server definition asks exactly once for the page, however often it renders', async () => {
    const fetcher = vi.fn(async () => definitionsBody({ custom: true }))
    __setServerDefinitionsFetcherForTests(fetcher)
    const { row } = mount()
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    fireEvent.change(box(row('customBenchmark')), { target: { value: 'xlk' } })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(presetOptions()).toContain('My symbol')
  })
})

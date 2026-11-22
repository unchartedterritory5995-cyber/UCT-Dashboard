// app/src/components/chart/ChartSettingsIndicators.text.test.jsx
//
// ⭐ UCT RS PHASE 3, UNIT 3-02b — the generic text control in the THIRD settings
// surface, the Chart Settings Inspector, with the settings dialog's rules (3-02):
//   · a `string` input renders a real text box (role textbox, named by its label),
//     with its placeholder, maxLength and the stored value;
//   · Enter or blur commits ONCE, upper-cased, through the modal's one row writer
//     (`applyRowPatch` -> `setInstanceInput`); typing alone writes nothing; an
//     unchanged value writes nothing;
//   · an invalid value writes NOTHING, keeps the text, sets `aria-invalid` and
//     shows the input's own hint (or "Not a valid value") through
//     `aria-describedby`; the miss clears the moment the text reads right;
//   · a write from elsewhere (a preset) replaces an uncommitted draft;
//   · the cell is shrinkable in the Inspector column (a CSS rail: jsdom measures
//     no boxes).
//
// ⛔ Drives the REAL modal, as the other Inspector suites do; the probe
// definition is registered beside the shipped ones by mocking `nativeRegistry`.
// Every write is read off the blob the modal hands `onChange`, never a spy on a writer.
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import { findInstance } from './engine/instanceControls'
import { clearServerDefinitions, __setServerDefinitionsFetcherForTests } from './engine/serverCompute'
import { TEXT_INPUT_FALLBACK_HINT } from './indicatorRegistry'
import { PROBE_ID, PROBE_INST } from './__tests__/inspectorTextProbe.fixture'

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
const inspector = () => document.body.querySelector('[data-inspector-for]')
const field = (key) => inspector().querySelector(`[data-field="${key}"]`)
const box = (key) => field(key)?.querySelector('input[type="text"]') || null
const describedBy = (el) => (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent)

function mount(inputs = {}) {
  const seen = { cs: blob(inputs), writes: 0 }
  render(<Host initial={seen.cs} onSeen={(next) => { seen.cs = next; seen.writes += 1 }} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  const row = rows().find((r) => /^Text probe/.test(nameOf(r)))
  if (!row) throw new Error(`no Text probe row; rows: ${rows().map(nameOf).join(' | ')}`)
  fireEvent.click(row)
  return seen
}
const stored = (cs) => findInstance(cs, PROBE_INST).inputs || {}

describe('⭐ the text box in the Inspector', () => {
  it('renders a text box named by its label, with its placeholder, maxLength and the stored value', () => {
    mount({ customBenchmark: 'XLK' })
    const input = box('customBenchmark')
    expect(input).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Symbol' })).toBe(input)
    expect(input.value).toBe('XLK')
    expect(input.getAttribute('placeholder')).toBe('e.g. XLK')
    expect(input.getAttribute('maxlength')).toBe('10')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()
    // the label is the Inspector's own label cell, carrying the tooltip as `title`
    const label = field('customBenchmark').querySelector('[class*="insFieldLabel"]')
    expect(label.textContent).toBe('Symbol')
    expect(label.getAttribute('title')).toBe('The symbol to compare against.')
  })

  it('a valid value commits ONCE, upper-cased, on Enter; typing alone and the blur after write nothing', () => {
    const seen = mount()
    const input = box('customBenchmark')
    fireEvent.change(input, { target: { value: 'xl' } })
    expect(box('customBenchmark').value).toBe('XL')     // upper-cased as typed
    fireEvent.change(box('customBenchmark'), { target: { value: 'xlk' } })
    expect(seen.writes).toBe(0)
    fireEvent.keyDown(box('customBenchmark'), { key: 'Enter' })
    expect(seen.writes).toBe(1)
    expect(stored(seen.cs).customBenchmark).toBe('XLK')
    expect(seen.cs.preset).toBe('custom')
    expect(box('customBenchmark').value).toBe('XLK')
    fireEvent.blur(box('customBenchmark'))
    expect(seen.writes).toBe(1)
  })

  it('commits on blur too, and clearing the box writes "" (not set)', () => {
    const seen = mount({ customBenchmark: 'XLK' })
    fireEvent.change(box('customBenchmark'), { target: { value: ' brk.b ' } })
    fireEvent.blur(box('customBenchmark'))
    expect(stored(seen.cs).customBenchmark).toBe('BRK.B')   // trimmed
    fireEvent.change(box('customBenchmark'), { target: { value: '' } })
    fireEvent.blur(box('customBenchmark'))
    expect(stored(seen.cs).customBenchmark).toBe('')
    expect(seen.writes).toBe(2)
  })

  it('an unchanged value writes nothing', () => {
    const seen = mount({ customBenchmark: 'XLK' })
    fireEvent.change(box('customBenchmark'), { target: { value: 'xlk' } })
    fireEvent.keyDown(box('customBenchmark'), { key: 'Enter' })
    expect(seen.writes).toBe(0)
  })

  it('⛔ an invalid value writes NOTHING, keeps the text, sets aria-invalid and shows the hint through aria-describedby', () => {
    const seen = mount({ customBenchmark: 'XLK' })
    fireEvent.change(box('customBenchmark'), { target: { value: 'not a ticker' } })
    fireEvent.keyDown(box('customBenchmark'), { key: 'Enter' })
    fireEvent.blur(box('customBenchmark'))
    expect(seen.writes).toBe(0)
    expect(stored(seen.cs).customBenchmark).toBe('XLK')
    const after = box('customBenchmark')
    expect(after.value).toBe('NOT A TICKER')
    expect(after.getAttribute('aria-invalid')).toBe('true')
    expect(describedBy(after)).toEqual(['Letters, dots and dashes, up to 10'])
    // the line sits UNDER the box, inside the shrinkable cell
    const miss = document.getElementById(after.getAttribute('aria-describedby'))
    expect(miss.closest('[data-text-cell]')).toBe(after.closest('[data-text-cell]'))
    // the miss clears the moment the text reads right, and THEN the commit writes
    fireEvent.change(after, { target: { value: 'qqq' } })
    expect(box('customBenchmark').getAttribute('aria-invalid')).toBeNull()
    expect(box('customBenchmark').getAttribute('aria-describedby')).toBeNull()
    fireEvent.blur(box('customBenchmark'))
    expect(seen.writes).toBe(1)
    expect(stored(seen.cs).customBenchmark).toBe('QQQ')
  })

  it('an input with no hint says the generic sentence on a miss', () => {
    const seen = mount()
    const note = screen.getByRole('textbox', { name: 'Note' })
    fireEvent.change(note, { target: { value: 'abc' } })
    fireEvent.blur(note)
    expect(seen.writes).toBe(0)
    expect(describedBy(screen.getByRole('textbox', { name: 'Note' }))).toEqual([TEXT_INPUT_FALLBACK_HINT])
  })

  it("another box committing leaves this box's uncommitted draft (and its miss) alone", () => {
    const seen = mount({ customBenchmark: 'XLK' })
    fireEvent.change(box('customBenchmark'), { target: { value: 'bad value' } })
    fireEvent.blur(box('customBenchmark'))
    expect(box('customBenchmark').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '42' } })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Note' }))
    expect(stored(seen.cs).note).toBe('42')
    expect(box('customBenchmark').value).toBe('BAD VALUE')
    expect(box('customBenchmark').getAttribute('aria-invalid')).toBe('true')
  })

  it('a write from elsewhere (a preset) replaces an uncommitted draft and its miss', () => {
    const seen = mount()
    fireEvent.change(box('customBenchmark'), { target: { value: 'bad value' } })
    fireEvent.keyDown(box('customBenchmark'), { key: 'Enter' })
    expect(box('customBenchmark').getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(field('__preset__').querySelector('select'), { target: { value: 'tech' } })
    expect(stored(seen.cs).customBenchmark).toBe('XLK')
    expect(box('customBenchmark').value).toBe('XLK')
    expect(box('customBenchmark').getAttribute('aria-invalid')).toBeNull()
  })

  it('switching to another row and back starts the box from the stored value', () => {
    mount({ customBenchmark: 'XLK' })
    fireEvent.change(box('customBenchmark'), { target: { value: 'half' } })
    const other = rows().find((r) => !/^Text probe/.test(nameOf(r)))
    expect(other, 'the chart needs a second row to switch to').toBeTruthy()
    fireEvent.click(other)
    expect(inspector()?.getAttribute('data-inspector-for')).not.toBe(PROBE_INST)
    fireEvent.click(rows().find((r) => /^Text probe/.test(nameOf(r))))
    expect(box('customBenchmark').value).toBe('XLK')
  })
})

describe('the text cell respects the Inspector column (CSS rail — jsdom measures no boxes)', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'components', 'chart', 'ChartSettingsModal.module.css'), 'utf8')
    .replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(css)
    if (!m) throw new Error(`no rule for ${sel}`)
    return m[1]
  }
  it('the cell is a maximum width that shrinks (min(210px, 100%), min-width 0, flex-shrink 1)', () => {
    const cell = rule('.insTextCell')
    expect(cell).toMatch(/width:\s*min\(210px,\s*100%\)/)
    expect(cell).toMatch(/min-width:\s*0/)
    expect(cell).toMatch(/flex:\s*0 1 auto/)
  })
  it('the box fills the cell and can shrink; the miss line wraps rather than overflowing', () => {
    const input = rule('.insFieldCtl .insText')
    expect(input).toMatch(/width:\s*100%/)
    expect(input).toMatch(/min-width:\s*0/)
    expect(input).toMatch(/box-sizing:\s*border-box/)
    expect(rule('.insTextMiss')).toMatch(/overflow-wrap:\s*break-word/)
  })
  it('the label column is untouched: it still wraps and never ellipsizes', () => {
    const label = rule('.insFieldLabel')
    expect(label).toMatch(/flex:\s*0 0 92px/)
    expect(label).toMatch(/white-space:\s*normal/)
    expect(label).not.toMatch(/text-overflow/)
  })
})

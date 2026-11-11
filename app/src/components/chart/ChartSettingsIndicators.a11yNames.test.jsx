// ⭐ UCT RS a11y gate §12.2 (2026-11-08) — the Chart Settings Inspector's selects and
// number boxes are NAMED by their visible field label. Before, a screen reader read
// the RS row's Benchmark as "combo box, S&P 500 (SPY)" with no "Benchmark": the label
// was a bare span beside the control. The label now names it through
// `aria-labelledby`, so the name and the words on screen are one value.
import { useState } from 'react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, act } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { setIndicatorEnabled } from './engine/instanceControls'
import { primeServerDefinitions, clearServerDefinitions, __setServerDefinitionsFetcherForTests } from './engine/serverCompute'

beforeEach(() => { clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })
afterEach(() => { cleanup(); clearServerDefinitions(); __setServerDefinitionsFetcherForTests(null) })

const RS = 'rsLine'
const rsDef = () => registry.getDefinition(RS)
const optionValue = (o) => (Array.isArray(o) ? o[0] : (o && typeof o === 'object' ? o.value : o))
/** The v4 row as the server publishes it with RS_V3_ENABLED on (so Reading is offered). */
const v4Body = () => ({
  definitions: [{
    id: RS,
    inputs: rsDef().meta.serverInputs.map((key) => {
      const spec = rsDef().inputs.find((i) => i.key === key)
      return spec && spec.type === 'enum' ? { key, options: spec.options.map(optionValue) } : { key }
    }),
  }],
})

function Host({ initial }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={setCs} onClose={() => {}} />
}
function openRsInspector() {
  act(() => { primeServerDefinitions(v4Body()) })
  render(<Host initial={setIndicatorEnabled(mergeChartSettings({}), RS, true, registry)} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  const row = [...document.body.querySelectorAll('[data-structure-row]')]
    .find((r) => /^UCT/.test((r.querySelector('[class*="insRowName"]')?.textContent || '').trim()))
  expect(row, 'the RS row is listed').toBeTruthy()
  fireEvent.click(row)
  const ins = document.body.querySelector('[data-inspector-for]')
  expect(ins, 'the RS inspector is open').not.toBeNull()
  return ins
}

describe('the Inspector names each select and number box by its field label', () => {
  it('the RS inspector: Benchmark and Reading are named comboboxes', () => {
    const ins = openRsInspector()
    const benchmark = within(ins).getByRole('combobox', { name: 'Benchmark' })
    expect(benchmark.closest('[data-field]').getAttribute('data-field')).toBe('benchmark')
    const reading = within(ins).getByRole('combobox', { name: 'Reading' })
    expect(reading.closest('[data-field]').getAttribute('data-field')).toBe('view')
  })

  it('every input-field select and number box in the RS inspector carries its own label as its name', () => {
    const ins = openRsInspector()
    // open every folded group so every field renders
    for (const b of [...ins.querySelectorAll('[data-group] > button[aria-expanded="false"]')]) fireEvent.click(b)
    const ctls = [...ins.querySelectorAll('[data-field] select, [data-field] input[type="number"]')]
      .filter((c) => !c.closest('[data-field]').getAttribute('data-field').startsWith('__'))
    expect(ctls.length).toBeGreaterThan(2)
    for (const c of ctls) {
      const fieldEl = c.closest('[data-field]')
      const key = fieldEl.getAttribute('data-field')
      const label = fieldEl.querySelector('[class*="insFieldLabel"]')
      const role = c.tagName === 'SELECT' ? 'combobox' : 'spinbutton'
      expect(label, `${key} has a visible label`).not.toBeNull()
      const named = within(fieldEl).getByRole(role, { name: label.textContent })
      expect(named, `${key} is named "${label.textContent}"`).toBe(c)
    }
  })
})

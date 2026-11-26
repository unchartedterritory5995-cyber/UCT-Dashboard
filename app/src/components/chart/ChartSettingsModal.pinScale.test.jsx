// app/src/components/chart/ChartSettingsModal.pinScale.test.jsx
//
// ─── PIN TO SCALE, IN THE INSPECTOR (owner, 2026-11-26, Fred RS) ────────────
//
// TradingView's per-indicator "Pin to scale", in TradingView's words, for an instance drawn on
// price: "Same as price" / "No scale". The control READS `placement.pinScaleOf` (what the chart
// draws with) and WRITES `setInstancePinScale`; offered on price only.

import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { addInstance } from './engine/instanceControls'

function Host({ initial, seen }) {
  const [cs, setCs] = useState(initial)
  return <ChartSettingsModal open settings={cs} onChange={(next) => { seen.cs = next; setCs(next) }} onClose={() => {}} />
}
const rowFor = (re) => [...document.body.querySelectorAll('[data-structure-row]')]
  .find((r) => re.test((r.querySelector('[class*="insRowName"]')?.textContent || '').trim()))
const pinSelect = () => [...(document.body.querySelector('[data-inspector-for]')?.querySelectorAll('select') || [])]
  .find((s) => /pin to scale/i.test(s.getAttribute('aria-label') || ''))

afterEach(() => cleanup())

describe('Pin to scale', () => {
  it('an average on price offers "Same as price" / "No scale", and a pick is stored on that instance', () => {
    const seen = {}
    render(<Host initial={mergeChartSettings({})} seen={seen} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    fireEvent.click(rowFor(/^EMA 9$/))
    const sel = pinSelect()
    expect(sel, 'no Pin to scale control on a price overlay').toBeTruthy()
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Same as price', 'No scale'])
    expect(sel.value).toBe('price')
    fireEvent.change(sel, { target: { value: 'none' } })
    const ema = (seen.cs.indicatorInstances || []).filter((i) => i && i.placement && i.placement.pinScale)
    expect(ema.length).toBe(1)
    expect(ema[0].placement.pinScale).toBe('none')
    expect(pinSelect().value).toBe('none')
  })

  it('CONTROL: an oscillator in its own pane has no such control', () => {
    const seen = {}
    render(<Host initial={addInstance(mergeChartSettings({}), 'rsi', registry)} seen={seen} />)
    fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
    fireEvent.click(rowFor(/RSI|Relative Strength/i))
    expect(document.body.querySelector('[data-inspector-for]'), 'the RSI row did not open').toBeTruthy()
    expect(pinSelect()).toBeFalsy()
  })
})

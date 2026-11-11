// app/src/components/chart/ChartSettingsIndicators.firstAddTour.test.jsx
//
// ─── UCT RS Phase 4, 4-11 — the first-add tour from the MAIN add door ────────
//
// The real-screen check found the tour opened only when UCT RS was added from the
// indicator library dialog; Chart Settings → Indicators → "＋ Add to Chart" (the
// chart header's own "Add to Chart" control lands here too) never reported the add.
// This door now reports the FIRST add of a toured definition through
// `onIndicatorFirstAdd` (the library's own rule, `isTouredFirstAdd`), and ChartPane
// holds it until the modal closes, then hands it to the chart's tour handler
// (`ChartPane.firstAddTour.test.jsx`). Here: the report, on the REAL `rsLine`
// definition, and the rule's refusals (a second instance, a re-enable).
import { useState } from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { isTouredFirstAdd } from './legend/indicatorTour'
import { resultRows } from './__tests__/resultRows'

const RS = 'rsLine'

function Host({ initial, onFirstAdd, seen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal open settings={cs} onClose={() => {}}
      onChange={(next) => { seen.cs = next; setCs(next) }} onIndicatorFirstAdd={onFirstAdd} />
  )
}
function show(instances = []) {
  const onFirstAdd = vi.fn()
  const seen = { cs: null }
  render(<Host initial={mergeChartSettings({ indicatorInstances: instances })} onFirstAdd={onFirstAdd} seen={seen} />)
  fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
  return { onFirstAdd, seen }
}
function addRs() {
  if (!document.body.querySelector('[data-testid="add-surface"]')) fireEvent.click(screen.getByTestId('add-enter'))
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'UCT Relative Strength' } })
  const row = resultRows().find((r) => r.dataset.defId === RS)
  expect(row, 'the add surface lists UCT RS').toBeTruthy()
  fireEvent.click(row)
}
const live = (cs) => ((cs && cs.indicatorInstances) || []).filter((i) => i && i.defId === RS && !i.deleted && !i.hidden)

afterEach(() => { cleanup() })

describe('Chart Settings → Indicators: the first add of a toured definition is reported', () => {
  it('the shipped rsLine declares a tour (the premise)', () => {
    expect(registry.getDefinition(RS).meta.tour.length).toBeGreaterThan(0)
  })

  it('the first add of UCT RS reports rsLine once', () => {
    const { onFirstAdd, seen } = show()
    addRs()
    expect(live(seen.cs)).toHaveLength(1)
    expect(onFirstAdd).toHaveBeenCalledTimes(1)
    expect(onFirstAdd).toHaveBeenCalledWith(RS)
  })

  it('a second instance is not a first add (the row ＋ Add another)', () => {
    const { onFirstAdd, seen } = show([{ instanceId: 'rs-1', defId: RS, inputs: {}, hidden: false }])
    addRs()                                         // an already-on row: lands on it, adds nothing
    fireEvent.click(screen.getByRole('button', { name: `Add another ${registry.getDefinition(RS).meta.name}` }))
    expect(live(seen.cs)).toHaveLength(2)
    expect(onFirstAdd).not.toHaveBeenCalled()
  })

  it('a chart holding a hidden instance is not a first add either (a re-enable, or another beside it)', () => {
    const { onFirstAdd, seen } = show([{ instanceId: 'rs-1', defId: RS, inputs: {}, hidden: true }])
    addRs()
    const more = screen.queryByRole('button', { name: `Add another ${registry.getDefinition(RS).meta.name}` })
    if (more) {
      fireEvent.click(more)
      expect(seen.cs).not.toBeNull()
    }
    expect(onFirstAdd).not.toHaveBeenCalled()
  })

  it('the shared rule: absent → live, toured; never hidden → live, never a definition without a tour', () => {
    const row = { id: RS }
    const none = mergeChartSettings({ indicatorInstances: [] })
    const one = mergeChartSettings({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: {}, hidden: false }] })
    const hid = mergeChartSettings({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs: {}, hidden: true }] })
    expect(isTouredFirstAdd(row, none, one, registry)).toBe(true)
    expect(isTouredFirstAdd(row, hid, one, registry)).toBe(false)
    expect(isTouredFirstAdd(row, one, one, registry)).toBe(false)
    expect(isTouredFirstAdd({ id: RS, builtIn: 'overlay' }, none, one, registry)).toBe(false)
    const rsi = registry.getDefinition('rsi')
    expect(rsi && rsi.meta && rsi.meta.tour).toBeFalsy()
    const rsiOn = mergeChartSettings({ indicatorInstances: [{ instanceId: 'rsi-1', defId: 'rsi', inputs: {}, hidden: false }] })
    expect(isTouredFirstAdd({ id: 'rsi' }, none, rsiOn, registry)).toBe(false)
  })
})

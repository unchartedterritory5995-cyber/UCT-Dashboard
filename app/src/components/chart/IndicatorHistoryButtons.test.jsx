// app/src/components/chart/IndicatorHistoryButtons.test.jsx — A1.2: panel Undo / Redo
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import * as R from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { setInstanceHidden, withInstances } from './engine/instanceControls'
import { recordIndicatorChange, peekIndicatorHistory, _resetIndicatorHistoryForTests } from './indicatorHistoryStore'
import IndicatorHistoryButtons from './IndicatorHistoryButtons'

const norm = (cs) => mergeChartSettings(JSON.stringify(cs))
function chart() {
  const base = mergeChartSettings(null)
  const raw = norm({ ...base, indicatorInstances: [...(base.indicatorInstances || []),
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false }] })
  return norm(withInstances(raw, raw.indicatorInstances, R))
}

let store
beforeEach(() => {
  _resetIndicatorHistoryForTests()
  try { window.sessionStorage.clear() } catch { /* jsdom */ }
  store = { cs: chart(), writes: 0 }
  // ⛔ The panel's sink RECORDS (as ChartPane's modal onChange does) — an Undo through it
  // must not push a new entry.
  store.write = (next) => {
    recordIndicatorChange('chart:c1', store.cs, next, { labelOf: () => 'RSI' })
    store.cs = norm(next); store.writes++
  }
})
afterEach(cleanup)

const Host = () => <IndicatorHistoryButtons surfaceKey="chart:c1" cs={store.cs} write={store.write} />
const live = () => store.cs.indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1')

describe('A1.2 — IndicatorHistoryButtons', () => {
  it('disabled with nothing to undo; names the entry; Undo and Redo go through the panel sink without re-recording', () => {
    const view = render(<Host />)
    expect(screen.getByRole('button', { name: 'Nothing to undo' }).disabled).toBe(true)
    store.write(setInstanceHidden(store.cs, 'inst:rsi:1', true, R))
    view.rerender(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo: RSI hidden' }))
    expect(live().hidden).toBe(false)
    expect(peekIndicatorHistory('chart:c1').past, 'the Undo recorded itself as a new change').toHaveLength(0)
    expect(peekIndicatorHistory('chart:c1').future).toHaveLength(1)
    view.rerender(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Redo: RSI hidden' }))
    expect(live().hidden).toBe(true)
    expect(peekIndicatorHistory('chart:c1').past).toHaveLength(1)
  })

  it('a stale Undo says so and writes nothing', () => {
    const view = render(<Host />)
    store.write(setInstanceHidden(store.cs, 'inst:rsi:1', true, R))
    store.cs = norm({ ...store.cs, indicatorInstances: store.cs.indicatorInstances.map((i) => (i.instanceId === 'inst:rsi:1' ? { ...i, inputs: { period: 30 } } : i)) })
    view.rerender(<Host />)
    const before = store.writes
    fireEvent.click(screen.getByRole('button', { name: 'Undo: RSI hidden' }))
    expect(store.writes).toBe(before)
    expect(screen.getByRole('status').textContent).toMatch(/Can't undo/)
  })

  it('renders nothing without a surface key', () => {
    render(<IndicatorHistoryButtons surfaceKey={null} cs={store.cs} write={store.write} />)
    expect(screen.queryByTestId('indicator-history-buttons')).toBeNull()
  })
})

// app/src/components/chart/IndicatorUndoToast.test.jsx — A1.2: the Undo toast
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import * as R from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { setInstanceHidden, setInstanceInput, withInstances } from './engine/instanceControls'
import { recordIndicatorChange, _resetIndicatorHistoryForTests } from './indicatorHistoryStore'
import IndicatorUndoToast, { TOAST_MS } from './IndicatorUndoToast'

const norm = (cs) => mergeChartSettings(JSON.stringify(cs))
function chart() {
  const base = mergeChartSettings(null)
  const raw = norm({ ...base, indicatorInstances: [...(base.indicatorInstances || []),
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 }, hidden: false }] })
  return norm(withInstances(raw, raw.indicatorInstances, R))
}

function Host({ store }) {
  return <IndicatorUndoToast surfaceKey="chart:c1" chartId="c1" cs={store.cs} write={store.write} />
}

let store
beforeEach(() => {
  _resetIndicatorHistoryForTests()
  try { window.sessionStorage.clear() } catch { /* jsdom */ }
  store = { cs: chart(), writes: 0 }
  store.write = (next) => { store.cs = norm(next); store.writes++ }
})
afterEach(() => { cleanup(); vi.useRealTimers() })

function hideRsi(view) {
  const before = store.cs
  store.cs = norm(setInstanceHidden(before, 'inst:rsi:1', true, R))
  act(() => { recordIndicatorChange('chart:c1', before, store.cs, { labelOf: () => 'RSI', origin: 'c1' }) })
  view.rerender(<Host store={store} />)
}
const live = () => store.cs.indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1')

describe('A1.2 — IndicatorUndoToast', () => {
  it('appears for a new change, Undo writes through the host sink, then offers Redo', () => {
    const view = render(<Host store={store} />)
    expect(screen.queryByTestId('indicator-undo-toast')).toBeNull()
    hideRsi(view)
    const toast = screen.getByTestId('indicator-undo-toast')
    expect(toast.getAttribute('role')).toBe('status')
    expect(toast.textContent).toContain('RSI hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(store.writes).toBe(1)
    expect(live().hidden).toBe(false)
    view.rerender(<Host store={store} />)
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(live().hidden).toBe(true)
  })

  it('a stale Undo says so and writes nothing', () => {
    const view = render(<Host store={store} />)
    hideRsi(view)
    store.cs = norm(setInstanceInput(store.cs, 'inst:rsi:1', 'period', 40, R))
    view.rerender(<Host store={store} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(store.writes).toBe(0)
    expect(screen.getByTestId('indicator-undo-toast').textContent).toMatch(/^Can't undo: RSI changed since\./)
  })

  it(`hides itself after ${TOAST_MS} ms`, () => {
    vi.useFakeTimers()
    const view = render(<Host store={store} />)
    hideRsi(view)
    expect(screen.getByTestId('indicator-undo-toast')).toBeTruthy()
    act(() => { vi.advanceTimersByTime(TOAST_MS + 10) })
    expect(screen.queryByTestId('indicator-undo-toast')).toBeNull()
  })

  it('⛔ Ctrl+Z is taken ahead of a bubble-phase listener ONLY while the toast is visible', () => {
    const drawingUndo = vi.fn()
    window.addEventListener('keydown', drawingUndo)
    try {
      const view = render(<Host store={store} />)
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(drawingUndo).toHaveBeenCalledTimes(1)          // no toast → the drawing layer gets it
      hideRsi(view)
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      expect(drawingUndo).toHaveBeenCalledTimes(1)          // toast → indicator undo, drawing untouched
      expect(live().hidden).toBe(false)
    } finally { window.removeEventListener('keydown', drawingUndo) }
  })

  it('never takes Ctrl+Z inside a text field', () => {
    const view = render(<><input aria-label="t" /><Host store={store} /></>)
    hideRsi(view)
    view.rerender(<><input aria-label="t" /><Host store={store} /></>)
    fireEvent.keyDown(screen.getByLabelText('t'), { key: 'z', ctrlKey: true })
    expect(store.writes).toBe(0)
  })

  it('an entry from ANOTHER chart on the same surface is not toasted here', () => {
    const view = render(<Host store={store} />)
    const before = store.cs
    store.cs = norm(setInstanceHidden(before, 'inst:rsi:1', true, R))
    act(() => { recordIndicatorChange('chart:c1', before, store.cs, { labelOf: () => 'RSI', origin: 'c2' }) })
    view.rerender(<Host store={store} />)
    expect(screen.queryByTestId('indicator-undo-toast')).toBeNull()
  })
})

describe('A1.2 — IndicatorUndoToast after Undo', () => {
  it('Undo of the newest entry does not re-toast the entry beneath it', () => {
    const view = render(<Host store={store} />)
    hideRsi(view)                                   // entry 1
    act(() => { vi.useRealTimers() })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    const before = store.cs
    store.cs = norm(setInstanceHidden(before, 'inst:rsi:1', false, R))
    act(() => { recordIndicatorChange('chart:c1', before, store.cs, { labelOf: () => 'RSI', origin: 'c1' }) })   // entry 2
    view.rerender(<Host store={store} />)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    view.rerender(<Host store={store} />)
    expect(screen.getByTestId('indicator-undo-toast').textContent).toContain('Undone')
  })
})

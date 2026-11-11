// Grid mode: the owner's interaction rules (2026-11-09).
//  • The wheel scrolls the sheet wherever the mouse is; a chart only receives
//    the wheel / presses once its card has been clicked (gold).
//  • A click selects the card; it never jumps to Focus.
//  • The corner button enlarges the chart; Escape closes it, not the window.
//  • Only rows near the screen exist (900+ names must not build 900 cards).
import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'

// A stand-in chart that records which events actually reach it.
const reached = []
vi.mock('../../../../components/StockChart', () => ({
  default: ({ sym }) => (
    <div data-testid={`chart-${sym}`}
      onWheel={() => reached.push(`wheel:${sym}`)}
      onPointerDown={() => reached.push(`press:${sym}`)}
      onMouseDown={() => reached.push(`mousedown:${sym}`)}
      onMouseUp={() => reached.push(`mouseup:${sym}`)} />
  ),
}))
vi.mock('../../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchListDeep: vi.fn() }))
vi.mock('../../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {} }) }))
vi.mock('../../../../components/chart/ChartSettingsModal', () => ({
  default: ({ onChange, onClose }) => (
    <div role="dialog" aria-label="Chart settings">
      <button type="button" onClick={() => onChange({ textSize: 13 })}>change</button>
      <button type="button" onClick={onClose}>done</button>
    </div>
  ),
}))
// Every card gets its chart at once (the queue's ordering is tested separately).
vi.mock('./gridMountQueue', () => ({
  claimMount: (e) => e.grant(), releaseMount: () => {}, noteScroll: () => {},
}))

const ScanGrid = (await import('./ScanGrid')).default

const rows = (n) => Array.from({ length: n }, (_, i) => ({ sym: `S${i}`, pct: 10 - i * 0.01, price: 10, sector: 'Tech', industry: i === 0 ? 'Semis' : 'tech' }))

beforeEach(() => { reached.length = 0 })

test('an unselected chart never sees the wheel; the sheet scrolls instead', () => {
  render(<ScanGrid rows={rows(3)} />)
  const chart = screen.getByTestId('chart-S0')
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
  chart.dispatchEvent(ev)
  expect(reached).toEqual([])
  // Not prevented: the browser's own scroll of the sheet goes ahead.
  expect(ev.defaultPrevented).toBe(false)
})

test('a click selects the card (gold) and hands the chart the wheel; another card still scrolls', () => {
  const onSelect = vi.fn()
  const { container } = render(<ScanGrid rows={rows(3)} onSelect={onSelect} />)
  const chart = screen.getByTestId('chart-S1')
  // The selecting press is swallowed (it must not start a pan) …
  act(() => { fireEvent.pointerDown(chart) })
  expect(reached).toEqual([])
  expect(onSelect).toHaveBeenCalledWith('S1')
  expect(container.querySelectorAll('[data-selected]')).toHaveLength(1)
  // … and from then on the chart is interactive.
  act(() => { fireEvent.click(chart) })
  fireEvent.wheel(chart)
  expect(reached).toEqual(['wheel:S1'])
  // A DIFFERENT card under the mouse: the wheel goes to the sheet again.
  fireEvent.wheel(screen.getByTestId('chart-S2'))
  expect(reached).toEqual(['wheel:S1'])
})

test('Enlarge opens the big chart; Escape closes it without closing the window', () => {
  const onKey = vi.fn()
  window.addEventListener('keydown', onKey)
  render(<ScanGrid rows={rows(2)} />)
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge S0 chart' }))
  const dialog = screen.getByRole('dialog', { name: 'S0 chart' })
  // The drill window skips its own Escape while this attribute is on screen.
  expect(dialog.hasAttribute('data-drill-popover')).toBe(true)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  window.removeEventListener('keydown', onKey)
})

test('a 900-name list builds only a screenful of cards', () => {
  const { container } = render(<ScanGrid rows={rows(900)} />)
  const n = container.querySelectorAll('[data-grid-card]').length
  expect(n).toBeGreaterThan(0)
  expect(n).toBeLessThan(60)
})

test('the selecting click never starts a drag: no part of it reaches the chart, even after a re-render mid-press', async () => {
  render(<ScanGrid rows={rows(2)} />)
  const chart = screen.getByTestId('chart-S0')
  // A real mouse: pointerdown, (React re-renders the card as gold in a
  // microtask), then mousedown / pointerup / mouseup / click.
  await act(async () => { fireEvent.pointerDown(chart, { buttons: 1 }) })
  await act(async () => { fireEvent.mouseDown(chart) })
  fireEvent.pointerUp(chart)
  fireEvent.mouseUp(chart)
  fireEvent.click(chart)
  // The chart saw neither a press nor a release, so it is not mid-drag.
  expect(reached).toEqual([])
  await act(async () => { await new Promise(r => setTimeout(r, 5)) })
  // The NEXT press is the chart's (a held drag pans).
  fireEvent.mouseDown(chart)
  fireEvent.mouseUp(chart)
  expect(reached).toEqual(['mousedown:S0', 'mouseup:S0'])
})

test('the mouse leaving the card lets the chart go: the wheel scrolls the sheet again', () => {
  const { container } = render(<ScanGrid rows={rows(2)} />)
  const chart = screen.getByTestId('chart-S0')
  act(() => { fireEvent.pointerDown(chart) })
  fireEvent.click(chart)
  expect(container.querySelectorAll('[data-selected]')).toHaveLength(1)
  act(() => { fireEvent.pointerLeave(container.querySelector('[data-selected]'), { buttons: 0 }) })
  expect(container.querySelectorAll('[data-selected]')).toHaveLength(0)
  fireEvent.wheel(chart)
  expect(reached).toEqual([])
})

test('one-line header: sector · industry after the % change, a repeated name once', () => {
  render(<ScanGrid rows={rows(2)} />)
  expect(screen.getByText('Tech · Semis')).toBeTruthy()
  // S1: industry "tech" repeats the sector, so it shows once.
  expect(screen.getAllByText('Tech')).toHaveLength(1)
})

test('the enlarged chart has a settings gear; a change there reaches the host', async () => {
  const onChange = vi.fn()
  render(<ScanGrid rows={rows(2)} onChartSettingsChange={onChange} />)
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge S0 chart' }))
  fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }))
  fireEvent.click(await screen.findByRole('button', { name: 'change' }))
  expect(onChange).toHaveBeenCalledWith({ textSize: 13 })
  // Escape belongs to the settings window while it is open: the chart stays big.
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(screen.getByRole('dialog', { name: 'S0 chart' })).toBeTruthy()
})

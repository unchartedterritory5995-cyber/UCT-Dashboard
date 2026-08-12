import { useRef } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import CompareSymbolsPanel from './CompareSymbolsPanel'

function makeApi(initial = []) {
  let comp = initial, pct = false
  return {
    getComparison: vi.fn(() => comp),
    setComparison: vi.fn((arr) => { comp = arr }),
    getPercentScale: vi.fn(() => pct),
    setPercentScale: vi.fn((on) => { pct = on }),
  }
}

// Wrap so chartApiById/activeChartRef are real refs pointing at one fake chart.
function Wrap({ api }) {
  const chartApiById = useRef(new Map([['chart-1', api]]))
  const activeChartRef = useRef('chart-1')
  return <CompareSymbolsPanel chartApiById={chartApiById} activeChartRef={activeChartRef} onClose={() => {}} />
}

test('adds a symbol on Enter and writes it to the active chart', () => {
  const api = makeApi()
  render(<Wrap api={api} />)
  const input = screen.getByPlaceholderText(/Add symbol/i)
  fireEvent.change(input, { target: { value: 'qqq' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(api.setComparison).toHaveBeenCalledWith([expect.objectContaining({ sym: 'QQQ', enabled: true })])
  expect(screen.getByText('QQQ')).toBeInTheDocument()
})

test('loads existing comparisons from the chart', () => {
  const api = makeApi([{ sym: 'SPY', enabled: true, color: '#60a5fa' }])
  render(<Wrap api={api} />)
  expect(screen.getByText('SPY')).toBeInTheDocument()
})

test('removing a symbol writes the pruned list', () => {
  const api = makeApi([{ sym: 'SPY', enabled: true, color: '#60a5fa' }])
  render(<Wrap api={api} />)
  fireEvent.click(screen.getByLabelText('Remove SPY'))
  expect(api.setComparison).toHaveBeenLastCalledWith([])
})

test('the per-symbol "Same % scale" toggle writes scaleMode to the chart', () => {
  const api = makeApi([{ sym: 'QQQ', enabled: true, color: '#60a5fa', scaleMode: 'new' }])
  render(<Wrap api={api} />)
  fireEvent.click(screen.getByText('Same % scale'))
  expect(api.setComparison).toHaveBeenLastCalledWith([expect.objectContaining({ sym: 'QQQ', scaleMode: 'same' })])
})

test('clears a chart stuck in % scale on open (retired "All %" cleanup)', () => {
  const api = makeApi()
  api.getPercentScale = vi.fn(() => true)
  render(<Wrap api={api} />)
  expect(api.setPercentScale).toHaveBeenCalledWith(false)
})

import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import ChartWidget from './ChartWidget'

vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <button onClick={() => onSymbolChange && onSymbolChange('AAPL')}>change</button>
    </div>
  ),
}))

function Wrap({ color, initialGroups = { A: null, B: null, C: null, D: null } }) {
  const [groupSyms, setGroupSyms] = useState(initialGroups)
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ChartWidget color={color} opts={{}} />
      <span data-testid="groupA">{groupSyms.A ?? 'null'}</span>
      <span data-testid="groupB">{groupSyms.B ?? 'null'}</span>
    </WorkspaceContext.Provider>
  )
}

test('defaults to SPY when its color group is empty', () => {
  render(<Wrap color="A" />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('SPY')
})

test('renders the color groups ticker when set', () => {
  render(<Wrap color="B" initialGroups={{ A: 'NVDA', B: 'TSLA', C: null, D: null }} />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('TSLA')
})

test('symbol changes write back to the widgets color group only', () => {
  render(<Wrap color="B" initialGroups={{ A: 'NVDA', B: null, C: null, D: null }} />)
  act(() => { screen.getByText('change').click() })
  expect(screen.getByTestId('groupA').textContent).toBe('NVDA')
  expect(screen.getByTestId('groupB').textContent).toBe('AAPL')
})

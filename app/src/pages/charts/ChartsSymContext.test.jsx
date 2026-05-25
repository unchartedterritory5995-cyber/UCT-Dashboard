import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { ChartsSymContext, useChartsSym } from './ChartsSymContext'
import { WorkspaceContext } from './WorkspaceContext'

function Probe() {
  const { sym, setSym } = useChartsSym()
  return (
    <div>
      <span data-testid="sym">{sym ?? 'null'}</span>
      <button onClick={() => setSym('NVDA')}>set</button>
    </div>
  )
}

test('useChartsSym returns null + no-op setter outside any provider', () => {
  render(<Probe />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  screen.getByText('set').click()
  expect(screen.getByTestId('sym').textContent).toBe('null')
})

test('useChartsSym maps to Group A of WorkspaceContext when WorkspaceContext is present', () => {
  function Wrapper() {
    const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
    const setGroupSym = (color, sym) => {
      setGroupSyms(prev => ({ ...prev, [color]: sym }))
    }
    return (
      <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
        <Probe />
      </WorkspaceContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  act(() => { screen.getByText('set').click() })
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
})

test('explicit ChartsSymContext provider still overrides (per-widget scope)', () => {
  function Wrapper() {
    const [sym, setSym] = useState('AAPL')
    return (
      <ChartsSymContext.Provider value={{ sym, setSym }}>
        <Probe />
      </ChartsSymContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym').textContent).toBe('AAPL')
  act(() => { screen.getByText('set').click() })
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
})

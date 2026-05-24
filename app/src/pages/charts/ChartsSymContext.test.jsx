import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { ChartsSymContext, useChartsSym } from './ChartsSymContext'

function Probe() {
  const { sym, setSym } = useChartsSym()
  return (
    <div>
      <span data-testid="sym">{sym ?? 'null'}</span>
      <button onClick={() => setSym('NVDA')}>set</button>
    </div>
  )
}

test('useChartsSym returns null + no-op setter when used outside provider', () => {
  render(<Probe />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  // Click must not throw
  screen.getByText('set').click()
  expect(screen.getByTestId('sym').textContent).toBe('null')
})

test('useChartsSym reads + writes through the provider', () => {
  function Wrapper() {
    const [sym, setSym] = useState(null)
    return (
      <ChartsSymContext.Provider value={{ sym, setSym }}>
        <Probe />
      </ChartsSymContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym').textContent).toBe('null')
  act(() => { screen.getByText('set').click() })
  expect(screen.getByTestId('sym').textContent).toBe('NVDA')
})

import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { WorkspaceContext, useWorkspace } from './WorkspaceContext'

function Probe({ color }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  return (
    <div>
      <span data-testid={`sym-${color}`}>{groupSyms[color] ?? 'null'}</span>
      <button onClick={() => setGroupSym(color, 'NVDA')}>{`set-${color}`}</button>
    </div>
  )
}

test('useWorkspace returns empty groups + no-op setter when used outside provider', () => {
  render(<Probe color="A" />)
  expect(screen.getByTestId('sym-A').textContent).toBe('null')
  screen.getByText('set-A').click()
  expect(screen.getByTestId('sym-A').textContent).toBe('null')
})

test('reads and writes color group through the provider', () => {
  function Wrapper() {
    const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
    const setGroupSym = (color, sym) => {
      setGroupSyms(prev => ({ ...prev, [color]: sym }))
    }
    return (
      <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
        <Probe color="A" />
        <Probe color="B" />
      </WorkspaceContext.Provider>
    )
  }
  render(<Wrapper />)
  expect(screen.getByTestId('sym-A').textContent).toBe('null')
  expect(screen.getByTestId('sym-B').textContent).toBe('null')
  act(() => { screen.getByText('set-A').click() })
  expect(screen.getByTestId('sym-A').textContent).toBe('NVDA')
  expect(screen.getByTestId('sym-B').textContent).toBe('null')
})

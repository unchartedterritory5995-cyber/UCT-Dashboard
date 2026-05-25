import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import ScannerWidget from './ScannerWidget'

vi.mock('../../Screener', () => ({
  default: ({ embedded }) => (
    <div data-testid="screener-render" data-embedded={String(embedded)}>SCREENER</div>
  ),
}))

function Wrap({ color }) {
  const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ScannerWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders Screener in embedded mode', () => {
  render(<Wrap color="C" />)
  expect(screen.getByTestId('screener-render').getAttribute('data-embedded')).toBe('true')
})

test('mounts under the WorkspaceContext and renders without errors for each color', () => {
  for (const c of ['A', 'B', 'C', 'D']) {
    const { unmount } = render(<Wrap color={c} />)
    expect(screen.getByTestId('screener-render')).toBeInTheDocument()
    unmount()
  }
})

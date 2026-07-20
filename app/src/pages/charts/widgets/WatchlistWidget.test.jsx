import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import WatchlistWidget from './WatchlistWidget'

// Mock Watchlists — assert it receives embedded=true + pickList and uses ChartsSymContext.
vi.mock('../../Watchlists', () => ({
  default: ({ embedded, pickList }) => (
    <div data-testid="watchlists-render" data-embedded={String(embedded)} data-picklist={String(pickList)}>WATCHLISTS</div>
  ),
}))
// Mock the picker so we don't pull in its data hooks.
vi.mock('./WatchlistPicker', () => ({
  default: () => <div data-testid="watchlist-picker">PICKER</div>,
}))

function Wrap({ color, opts }) {
  const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <WatchlistWidget color={color} opts={opts} onOptsChange={() => {}} />
    </WorkspaceContext.Provider>
  )
}

test('shows the list picker when no list is chosen yet (freshly added, empty opts)', () => {
  render(<Wrap color="A" opts={{}} />)
  expect(screen.getByTestId('watchlist-picker')).toBeInTheDocument()
  expect(screen.queryByTestId('watchlists-render')).not.toBeInTheDocument()
})

test('renders the scoped embedded Watchlists (single-list pick mode) once a list is chosen', () => {
  render(<Wrap color="C" opts={{ watchKey: 'flagged', watchName: 'Flagged' }} />)
  const el = screen.getByTestId('watchlists-render')
  expect(el.getAttribute('data-embedded')).toBe('true')
  expect(el.getAttribute('data-picklist')).toBe('flagged')
  expect(screen.queryByTestId('watchlist-picker')).not.toBeInTheDocument()
})

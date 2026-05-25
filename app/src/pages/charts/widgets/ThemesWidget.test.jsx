import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import ThemesWidget from './ThemesWidget'

vi.mock('../../ThemeTrackerPage', () => ({
  default: ({ embedded }) => (
    <div data-testid="themes-render" data-embedded={String(embedded)}>THEMES</div>
  ),
}))

function Wrap({ color }) {
  const [groupSyms, setGroupSyms] = useState({ A: null, B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  return (
    <WorkspaceContext.Provider value={{ groupSyms, setGroupSym }}>
      <ThemesWidget color={color} opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('renders ThemeTrackerPage in embedded mode', () => {
  render(<Wrap color="A" />)
  expect(screen.getByTestId('themes-render').getAttribute('data-embedded')).toBe('true')
})

test('mounts under the WorkspaceContext and renders without errors for each color', () => {
  for (const c of ['A', 'B', 'C', 'D']) {
    const { unmount } = render(<Wrap color={c} />)
    expect(screen.getByTestId('themes-render')).toBeInTheDocument()
    unmount()
  }
})

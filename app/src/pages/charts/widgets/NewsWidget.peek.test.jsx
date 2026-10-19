// The real News & Catalysts widget in a peeking host (the screener): it reads what is already
// written and its empty state sends the member to the door that generates.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, expect, test, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { ChartHostOverlayContext } from './chartHostOverlay'
import NewsWidget from './NewsWidget'

let mockNews = { status: 'none', events: [] }
const hookCalls = []
vi.mock('../../../hooks/useNewsCatalysts', () => ({ default: (sym, o) => { hookCalls.push([sym, o]); return mockNews } }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: () => null }))
vi.mock('./NewsSettingsPanel', () => ({ default: () => null }))
vi.mock('../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))
vi.mock('../../../components/chart/drawingsStore', () => ({ addDrawing: vi.fn() }))

const ws = { groupSyms: { A: 'TJGC', B: null, C: null, D: null }, setGroupSym: vi.fn() }
const renderIn = (host) => render(
  <MemoryRouter>
    <WorkspaceContext.Provider value={ws}>
      <ChartHostOverlayContext.Provider value={host}>
        <NewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      </ChartHostOverlayContext.Provider>
    </WorkspaceContext.Provider>
  </MemoryRouter>,
)

beforeEach(() => { mockNews = { status: 'none', events: [] }; hookCalls.length = 0 })

test('a peeking host reads the feed with peek on', () => {
  renderIn({ newsPeek: true })
  expect(hookCalls.at(-1)).toEqual(['TJGC', { generating: false, peek: true }])
})

test('/charts (no host) reads the feed exactly as before, peek off', () => {
  renderIn(null)
  expect(hookCalls.at(-1)).toEqual(['TJGC', { generating: false, peek: false }])
  expect(screen.getByText(/No catalysts yet for TJGC/)).toBeInTheDocument()
  expect(screen.queryByText(/Find catalysts/)).toBeNull()
})

test('nothing on record: the peek says so and links to the research Catalysts tab, which generates', () => {
  renderIn({ newsPeek: true })
  expect(screen.getByText(/No catalysts on record yet for TJGC/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Find catalysts/ })).toHaveAttribute('href', '/research/TJGC?section=catalysts')
})

test('while the peek is still settling it claims nothing', () => {
  mockNews = { status: 'loading', events: [] }
  renderIn({ newsPeek: true })
  expect(screen.queryByText(/No catalysts/)).toBeNull()
})

test('written catalysts render as the ordinary widget rows', () => {
  mockNews = { status: 'ready', events: [{ date: '2026-10-16', type: 'catalyst', direction: 'up', title: 'Wins a Pentagon contract', move_pct: 18.2, source: 'wire' }] }
  renderIn({ newsPeek: true })
  expect(screen.getByText('Wins a Pentagon contract')).toBeInTheDocument()
  expect(screen.queryByText(/Find catalysts/)).toBeNull()
})

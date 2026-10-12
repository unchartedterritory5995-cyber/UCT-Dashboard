import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

let mockPlan = 'pro'
let mockRole = null
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, display_name: 'Pat', role: mockRole },
    plan: mockPlan,
    // AuthContext is the single source for paid access (admin counts as paid).
    isPaid: mockRole === 'admin' || (!!mockPlan && mockPlan !== 'free'),
  }),
}))
vi.mock('swr', () => ({ default: () => ({ data: null }) }))
// V19: the UCT Terminal entry's target comes from useTerminalNavPath (unit-tested beside it).
let mockTerminalNavPath = '/terminal'
vi.mock('../../pages/terminal/TerminalRoutes', () => ({ useTerminalNavPath: () => mockTerminalNavPath }))

import MoreSheet from './MoreSheet'

function renderSheet(props = {}) {
  return render(
    <MemoryRouter>
      <MoreSheet open onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => { mockPlan = 'pro'; mockRole = null; mockTerminalNavPath = '/terminal' })

test('renders the full directory for a paid user', () => {
  renderSheet()
  ;['Dashboard', 'Morning Wire', 'UCT 20', 'Breadth', 'Charts', 'UCT Terminal',
    // ⚰️ 'Patterns' REMOVED — the page was retired (15.7% precision) and
    // `MoreSheet.jsx` stopped listing it; this expectation was left behind, so
    // the directory test failed on a row the product deliberately dropped.
    'Screener', 'Options Flow', 'Model Book',
    'Journal', 'Settings', 'Website'].forEach((label) =>
    expect(screen.getByText(label)).toBeInTheDocument(),
  )
})

test('free users see every tool; paid ones render locked (not hidden)', () => {
  mockPlan = 'free'
  renderSheet()
  // Free tools
  expect(screen.getByText('Dashboard')).toBeInTheDocument()
  expect(screen.getByText('Breadth')).toBeInTheDocument()
  expect(screen.getByText('Charts')).toBeInTheDocument()
  expect(screen.getByText('Model Book')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
  // Paid tools now render (locked → upgrade) instead of being hidden
  expect(screen.getByText('Morning Wire')).toBeInTheDocument()
  expect(screen.getByText('UCT 20')).toBeInTheDocument()
})

test('admin sees the Admin link', () => {
  mockRole = 'admin'
  renderSheet()
  expect(screen.getByText('Admin')).toBeInTheDocument()
})

test('clicking a link calls onClose', () => {
  const onClose = vi.fn()
  renderSheet({ onClose })
  fireEvent.click(screen.getByText('Settings'))
  expect(onClose).toHaveBeenCalled()
})

test('renders nothing when closed', () => {
  render(<MemoryRouter><MoreSheet open={false} onClose={vi.fn()} /></MemoryRouter>)
  expect(screen.queryByText('Settings')).toBeNull()
})

test('Flow Scoreboard is reachable from the mobile More menu too, not only the desktop nav', () => {
  renderSheet()
  expect(screen.getByText('Flow Record')).toBeInTheDocument()
})

// V19: "keep classic calendar" must reach the phone menu's UCT Terminal entry too.
function renderSheetAndWatch() {
  function Where() { return <span data-testid="where">{useLocation().pathname}</span> }
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <MoreSheet open onClose={vi.fn()} />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>,
  )
}

test('V19: UCT Terminal opens the classic calendar for a member who kept it', () => {
  mockTerminalNavPath = '/calendar'
  renderSheetAndWatch()
  fireEvent.click(screen.getByText('UCT Terminal'))
  expect(screen.getByTestId('where').textContent).toBe('/calendar')
})

test('V19: UCT Terminal opens the terminal for everyone else', () => {
  renderSheetAndWatch()
  fireEvent.click(screen.getByText('UCT Terminal'))
  expect(screen.getByTestId('where').textContent).toBe('/terminal')
})

import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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

import MoreSheet from './MoreSheet'

function renderSheet(props = {}) {
  return render(
    <MemoryRouter>
      <MoreSheet open onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => { mockPlan = 'pro'; mockRole = null })

test('renders the full directory for a paid user', () => {
  renderSheet()
  ;['Dashboard', 'Morning Wire', 'UCT 20', 'Breadth', 'Charts', 'Calendar',
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

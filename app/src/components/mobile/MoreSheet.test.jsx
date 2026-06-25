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
    'Screener', 'Patterns', 'Options Flow', 'Model Book',
    'Journal', 'Settings', 'Website'].forEach((label) =>
    expect(screen.getByText(label)).toBeInTheDocument(),
  )
})

test('free users only see free pages + account', () => {
  mockPlan = 'free'
  renderSheet()
  expect(screen.getByText('Breadth')).toBeInTheDocument()
  expect(screen.getByText('Charts')).toBeInTheDocument()
  expect(screen.getByText('Settings')).toBeInTheDocument()
  // Paid-only destinations are hidden for free users
  expect(screen.queryByText('Model Book')).toBeNull()
  expect(screen.queryByText('UCT 20')).toBeNull()
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

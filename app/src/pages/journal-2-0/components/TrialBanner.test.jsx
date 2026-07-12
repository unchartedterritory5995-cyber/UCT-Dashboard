import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'

let mockAuth
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}))
vi.mock('../../../components/ui/UIcon', () => ({
  default: () => <span />,
}))

import TrialBanner from './TrialBanner'

function renderBanner() {
  return render(
    <MemoryRouter>
      <TrialBanner />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockAuth = { trial: null, subscription: null }
})

test('Stripe trialing subscription shows the convert date and links to Settings', () => {
  mockAuth = {
    trial: { active: false, days_left: 0 },
    subscription: { status: 'trialing', current_period_end: '2026-07-19T21:00:00+00:00' },
  }
  renderBanner()
  expect(screen.getByText(/converts Jul 19/i)).toBeInTheDocument()
  expect(screen.getByText(/Nothing charged until then/i)).toBeInTheDocument()
  expect(screen.getByRole('link')).toHaveAttribute('href', '/settings?section=billing')
})

test('Stripe trialing without a period end still shows the card-on-file chip', () => {
  mockAuth = { trial: null, subscription: { status: 'trialing', current_period_end: null } }
  renderBanner()
  expect(screen.getByText(/card on file/i)).toBeInTheDocument()
})

test('an active (converted) subscription shows nothing', () => {
  mockAuth = { trial: { active: false, days_left: 0 }, subscription: { status: 'active' } }
  const { container } = renderBanner()
  expect(container.textContent).toBe('')
})

test('shows N days left and links to /pricing for a trial user', () => {
  mockAuth = { trial: { active: true, days_left: 9 } }
  renderBanner()
  expect(screen.getByText(/9 days left/i)).toBeInTheDocument()
  expect(screen.getByText(/Keep everything for \$200\/mo/i)).toBeInTheDocument()
  expect(screen.getByRole('link')).toHaveAttribute('href', '/pricing')
})

test('uses the singular "day" when one day remains', () => {
  mockAuth = { trial: { active: true, days_left: 1 } }
  renderBanner()
  expect(screen.getByText(/1 day left/i)).toBeInTheDocument()
})

test('renders nothing for a paid/non-trial user', () => {
  mockAuth = { trial: { active: false, days_left: 0 } }
  const { container } = renderBanner()
  expect(container.textContent).toBe('')
})

test('renders nothing when there is no trial data', () => {
  mockAuth = { trial: null }
  const { container } = renderBanner()
  expect(container.textContent).toBe('')
})

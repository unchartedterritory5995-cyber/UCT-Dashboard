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
  mockAuth = { trial: null }
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

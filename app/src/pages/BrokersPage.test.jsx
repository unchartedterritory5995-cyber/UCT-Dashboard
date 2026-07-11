import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BrokersPage from './BrokersPage'

function renderPage() {
  return render(
    <MemoryRouter>
      <BrokersPage />
    </MemoryRouter>,
  )
}

test('renders the hero headline (public, no auth crash)', () => {
  // No auth context, no provider — a truly public page must render standalone.
  renderPage()
  expect(
    screen.getByRole('heading', { name: /Broker sync you can actually trust\./i }),
  ).toBeInTheDocument()
})

test('renders the "Verified by us" table with Robinhood + its verified date + notes', () => {
  renderPage()
  const table = screen.getByRole('table')
  expect(table).toBeInTheDocument()
  const rh = within(table).getByRole('rowheader', { name: /Robinhood/i })
  expect(rh).toBeInTheDocument()
  // Verified date rendered as "Jul 2, 2026" (ISO 2026-07-02, no UTC day-shift).
  expect(within(table).getByText(/Jul 2, 2026/)).toBeInTheDocument()
  // Capability notes surface honestly.
  expect(within(table).getByText(/Equities \+ options/i)).toBeInTheDocument()
})

test('renders the "Supported via SnapTrade" section with the honest framing', () => {
  renderPage()
  expect(
    screen.getByRole('heading', { name: /Supported via SnapTrade\./i }),
  ).toBeInTheDocument()
  expect(screen.getByText(/we verify each one on a real account before we badge it/i)).toBeInTheDocument()
})

test('offers a request-verification affordance (mailto + support link)', () => {
  renderPage()
  const mailto = screen.getByRole('link', { name: /Request verification/i })
  expect(mailto).toHaveAttribute('href', expect.stringContaining('mailto:contact@uctintelligence.com'))
  expect(mailto.getAttribute('href')).toContain('subject=')
  const support = screen.getByRole('link', { name: /Contact support/i })
  expect(support).toHaveAttribute('href', '/support')
})

test('states the broker-mirror trust promise (never filter imports)', () => {
  renderPage()
  expect(screen.getByText(/we never filter your imports/i)).toBeInTheDocument()
})

test('contains NO emoji anywhere', () => {
  const { container } = renderPage()
  const text = container.textContent || ''
  expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false)
})

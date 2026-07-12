import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach, test, expect } from 'vitest'

// Controllable auth state (mirrors the JournalLayout.test pattern).
let mockAuth
vi.mock('../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}))
// UIcon → inert span so the test is isolated from the SVG registry.
vi.mock('../components/ui/UIcon', () => ({
  default: ({ name }) => <span data-icon={name} />,
}))

import Pricing from './Pricing'

function renderPricing() {
  return render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockAuth = {
    user: null,
    plan: 'free',
    trial: null,
    annualAvailable: false,
    startCheckout: vi.fn(),
  }
})

test('renders both tiers — Free forever + UCT Intelligence', () => {
  renderPricing()
  expect(screen.getByRole('heading', { name: /Free forever/i })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /UCT Intelligence/i })).toBeInTheDocument()
})

test('shows the annual $19/$228 headline and reveals $29 monthly on toggle', () => {
  renderPricing()
  expect(screen.getByText('$19')).toBeInTheDocument()
  expect(screen.getByText(/\$228\/yr/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Monthly/i }))
  expect(screen.getByText('$29')).toBeInTheDocument()
})

test('states the 14-day no-card trial plainly', () => {
  renderPricing()
  expect(screen.getAllByText(/14-day full-access trial/i).length).toBeGreaterThan(0)
  expect(screen.getAllByText(/no credit card/i).length).toBeGreaterThan(0)
})

test('states one-click cancel, published refunds, and data export', () => {
  renderPricing()
  expect(screen.getAllByText(/Cancel in one click/i).length).toBeGreaterThan(0)
  expect(screen.getByText(/Refunds within 7 days of any charge/i)).toBeInTheDocument()
  expect(screen.getByText(/Your data exports completely, always/i)).toBeInTheDocument()
})

test('includes the honest scope line', () => {
  renderPricing()
  expect(screen.getByText(/Built for US stock & options traders/i)).toBeInTheDocument()
})

test('includes the TradeZella comparison line', () => {
  renderPricing()
  expect(screen.getByText(/TradeZella sells a journal for \$399\/yr/i)).toBeInTheDocument()
})

test('signed-out CTAs point at /signup', () => {
  renderPricing()
  const signupLinks = screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/signup')
  expect(signupLinks.length).toBeGreaterThan(0)
})

test('shows the annual-billing-coming-online note when annual is not configured', () => {
  renderPricing()
  expect(screen.getByText(/Annual billing is coming online/i)).toBeInTheDocument()
})

test('paid user sees the "You\'re in" state, not a checkout button', () => {
  mockAuth = { user: { role: 'member' }, plan: 'pro', trial: null, annualAvailable: true, startCheckout: vi.fn() }
  renderPricing()
  expect(screen.getByText(/You're in\./i)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Subscribe/i })).toBeNull()
})

test('trial user sees days-left + a Subscribe CTA', () => {
  mockAuth = { user: { role: 'member' }, plan: 'free', trial: { active: true, days_left: 7 }, annualAvailable: true, startCheckout: vi.fn() }
  renderPricing()
  expect(screen.getByText(/7 days left/i)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Subscribe/i })).toBeInTheDocument()
})

test('free logged-in user Subscribe button starts checkout for the selected billing', () => {
  const startCheckout = vi.fn()
  mockAuth = { user: { role: 'member' }, plan: 'free', trial: null, annualAvailable: true, startCheckout }
  renderPricing()
  fireEvent.click(screen.getByRole('button', { name: /Subscribe/i }))
  expect(startCheckout).toHaveBeenCalledWith('annual')
})

test('contains no emoji', () => {
  const { container } = renderPricing()
  const text = container.textContent || ''
  const emojiRe = /[\u{1F000}-\u{1FAFF}☀-➿]/u
  expect(emojiRe.test(text)).toBe(false)
  expect(text.includes('✓')).toBe(false)
  expect(text.includes('✗')).toBe(false)
})

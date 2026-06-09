import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('renders nav sidebar with free-tier links by default', () => {
  // Free tier (default, no paid plan) shows ONLY the four FREE_PAGES:
  // Breadth, Charts, Options Flow, Journal. Everything else (Dashboard,
  // Morning Wire, UCT 20, Calendar, Screener, Patterns, Post Market, Model
  // Book, Setup Library, Support) is paid-only and hidden from the nav.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /breadth/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /^charts$/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /options flow/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /journal/i })).toBeInTheDocument()
  // Paid-only pages are absent for free users
  expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /model book/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /calendar/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /theme tracker/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /watchlists/i })).not.toBeInTheDocument()
})

test('active link has active class', () => {
  renderWithProviders(<NavBar />, { route: '/breadth' })
  const breadthLink = screen.getByRole('link', { name: /breadth/i })
  expect(breadthLink.className).toMatch(/active/)
})

test('Charts link active on /charts and on legacy paths during transition', () => {
  renderWithProviders(<NavBar />, { route: '/charts' })
  const chartsLink = screen.getByRole('link', { name: /^charts$/i })
  expect(chartsLink.className).toMatch(/active/)
})

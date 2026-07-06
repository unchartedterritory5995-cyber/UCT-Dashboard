import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('renders nav sidebar with free-tier links by default', () => {
  // Free tier (default, no paid plan) shows the six FREE_PAGES matching the
  // Landing "five tools, no card required" promise plus Model Book: Dashboard,
  // Breadth, Charts, Options Flow, Journal, Model Book. Everything else
  // (Morning Wire, UCT 20, Calendar, Theme Tracker, Screener, Patterns, Post
  // Market, Watchlists, Support) is paid-only and hidden from the nav.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /breadth/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /^charts$/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /options flow/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /journal/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /model book/i })).toBeInTheDocument()
  // Paid-only pages are absent for free users
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

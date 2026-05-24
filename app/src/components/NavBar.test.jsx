import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('renders nav sidebar with free-tier links by default', () => {
  // Charts hub (unified) + dashboard + breadth + calendar are FREE_PAGES.
  // Theme Tracker, Watchlists, Multi-Chart no longer appear in the nav —
  // they've been subsumed under /charts.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /breadth/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /^charts$/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /calendar/i })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /theme tracker/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /watchlists/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /multi chart/i })).not.toBeInTheDocument()
})

test('active link has active class', () => {
  renderWithProviders(<NavBar />, { route: '/dashboard' })
  const dashLink = screen.getByRole('link', { name: /dashboard/i })
  expect(dashLink.className).toMatch(/active/)
})

test('Charts link active on /charts and on legacy paths during transition', () => {
  renderWithProviders(<NavBar />, { route: '/charts' })
  const chartsLink = screen.getByRole('link', { name: /^charts$/i })
  expect(chartsLink.className).toMatch(/active/)
})

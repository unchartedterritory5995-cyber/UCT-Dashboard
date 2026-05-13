import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('renders nav sidebar with free-tier links by default', () => {
  // Unauthenticated render shows the FREE_PAGES whitelist: Dashboard,
  // Breadth, Theme Tracker, Calendar, Watchlists. Paid links are gated
  // behind useAuth().plan === 'pro' / admin.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /breadth/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /theme tracker/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /calendar/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /watchlists/i })).toBeInTheDocument()
})

test('active link has active class', () => {
  renderWithProviders(<NavBar />, { route: '/dashboard' })
  const dashLink = screen.getByRole('link', { name: /dashboard/i })
  expect(dashLink.className).toMatch(/active/)
})

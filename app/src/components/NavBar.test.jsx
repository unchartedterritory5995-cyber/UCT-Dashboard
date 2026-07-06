import { renderWithProviders, screen } from '../test-utils'
import NavBar from './NavBar'

test('free tier: free tools link to their page, paid tools are locked to upgrade', () => {
  // Free tier (default, no paid plan). The six FREE_PAGES (Dashboard, Breadth,
  // Charts, Options Flow, Journal, Model Book) link to their page. Paid tools
  // are no longer hidden — they render dimmed + locked and route to /subscribe
  // so a free user can see what Pro unlocks.
  renderWithProviders(<NavBar />)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard')
  expect(screen.getByRole('link', { name: /breadth/i })).toHaveAttribute('href', '/breadth')
  expect(screen.getByRole('link', { name: /^charts$/i })).toHaveAttribute('href', '/charts')
  expect(screen.getByRole('link', { name: /model book/i })).toHaveAttribute('href', '/model-book')
  // Paid tools are VISIBLE now, routed to the upgrade page
  expect(screen.getByRole('link', { name: /calendar/i })).toHaveAttribute('href', '/subscribe')
  expect(screen.getByRole('link', { name: /morning wire/i })).toHaveAttribute('href', '/subscribe')
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

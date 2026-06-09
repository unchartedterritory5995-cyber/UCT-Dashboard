import { renderWithProviders, screen, within } from '../test-utils'
import Layout from './Layout'

test('renders nav sidebar and outlet', () => {
  renderWithProviders(
    <Layout>
      <div data-testid="child-content">hello</div>
    </Layout>
  )
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByTestId('child-content')).toBeInTheDocument()
})

test('renders the free-tier mobile tab bar (Markets/Charts/Journal/More)', () => {
  renderWithProviders(
    <Layout>
      <div>child</div>
    </Layout>
  )
  // Scope to the bottom tab bar (role=navigation, aria-label="Primary") since
  // the mobile drawer also renders some of these labels. Default render is the
  // free tier (no paid plan), so the paid-only Home (→ /dashboard) tab is hidden.
  const tabBar = screen.getByRole('navigation', { name: 'Primary' })
  ;['Markets', 'Charts', 'Journal', 'More'].forEach((label) =>
    expect(within(tabBar).getByText(label)).toBeInTheDocument(),
  )
  expect(within(tabBar).queryByText('Home')).not.toBeInTheDocument()
})

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

test('renders the free-tier mobile tab bar (Wire/More)', () => {
  renderWithProviders(
    <Layout>
      <div>child</div>
    </Layout>
  )
  // Scope to the bottom tab bar (role=navigation, aria-label="Primary") since
  // the mobile drawer also renders some of these labels. Default render is the
  // free tier (no paid plan): only Morning Wire is free, so every paid-only
  // tab (Home/Markets/Charts/Journal) is hidden.
  const tabBar = screen.getByRole('navigation', { name: 'Primary' })
  ;['Wire', 'More'].forEach((label) =>
    expect(within(tabBar).getByText(label)).toBeInTheDocument(),
  )
  ;['Home', 'Markets', 'Charts', 'Journal'].forEach((label) =>
    expect(within(tabBar).queryByText(label)).not.toBeInTheDocument(),
  )
})

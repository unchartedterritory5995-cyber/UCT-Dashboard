import { renderWithProviders, screen } from '../test-utils'
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

test('no bottom tab bar renders — the top-left menu is the ONE touch nav', () => {
  renderWithProviders(
    <Layout>
      <div>child</div>
    </Layout>
  )
  // The bottom tab bar was removed 2026-09-01 (owner call — it duplicated the
  // top-left menu route-for-route, and its 58px belonged to the chart). The
  // touch shell's nav is MobileNav's menu button, opening the one MoreSheet.
  expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  expect(screen.getByLabelText('Open menu')).toBeInTheDocument()
})

import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils'
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

// 2026-09-03 discoverability slice — WIRE tests, not component tests: each
// asserts the real CommandPalette dialog appears, not merely that a prop was
// called. A hand-built onOpenPalette spy could stay green through a severed
// paletteRef wire; rendering the whole Layout is what catches that.
describe('Layout — visible search triggers open the real global palette', () => {
  test('desktop NavBar Search row opens it', async () => {
    renderWithProviders(<Layout><div>child</div></Layout>)
    fireEvent.click(screen.getByLabelText('Search — Ctrl+K'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument())
  })

  test('mobile top-bar Search button opens the SAME palette', async () => {
    renderWithProviders(<Layout><div>child</div></Layout>)
    fireEvent.click(screen.getByLabelText('Search'))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument())
  })
})

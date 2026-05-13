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

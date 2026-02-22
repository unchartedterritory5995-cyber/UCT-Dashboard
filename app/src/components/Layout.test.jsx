import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Layout from './Layout'

test('renders nav sidebar and outlet', () => {
  render(
    <MemoryRouter>
      <Layout>
        <div data-testid="child-content">hello</div>
      </Layout>
    </MemoryRouter>
  )
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByTestId('child-content')).toBeInTheDocument()
})

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NavBar from './NavBar'

test('renders nav sidebar with all links', () => {
  render(<MemoryRouter><NavBar /></MemoryRouter>)
  expect(screen.getByTestId('nav-sidebar')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /morning wire/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /traders/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /screener/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /options flow/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /post market/i })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /model book/i })).toBeInTheDocument()
})

test('active link has active class', () => {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <NavBar />
    </MemoryRouter>
  )
  const dashLink = screen.getByRole('link', { name: /dashboard/i })
  expect(dashLink.className).toMatch(/active/)
})

import { renderWithProviders, screen } from '../test-utils'
import Terms from './Terms'

// Member-content terms, added 2026-09-23 as SUBSECTIONS of existing sections so
// Terms.test.jsx's "no existing section renumbered, exactly 13" rail holds.

test('members keep ownership of their own content', () => {
  renderWithProviders(<Terms />)
  expect(screen.getByRole('heading', { name: 'Your Content' })).toBeInTheDocument()
  expect(screen.getByText(/You keep ownership of what you create in the Service/)).toBeInTheDocument()
})

test('the intellectual-property claim excludes member content', () => {
  renderWithProviders(<Terms />)
  expect(screen.getByText(/Except for Your Content \(below\), all content/)).toBeInTheDocument()
})

test('share links and AI output each have their own terms', () => {
  renderWithProviders(<Terms />)
  expect(screen.getByRole('heading', { name: 'Sharing' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'AI-Generated Content' })).toBeInTheDocument()
  expect(screen.getByText(/is not investment advice, and should be checked before/)).toBeInTheDocument()
})

test('the content license points at the privacy policy', () => {
  renderWithProviders(<Terms />)
  expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
})

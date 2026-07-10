import { render, screen } from '@testing-library/react'
import UnlimitedBadge from './UnlimitedBadge'

test('renders the "no credits, ever" pill text', () => {
  render(<UnlimitedBadge />)
  expect(screen.getByText(/Unlimited · no credits, ever/)).toBeInTheDocument()
})

test('forwards an extra className', () => {
  const { container } = render(<UnlimitedBadge className="extra" />)
  expect(container.querySelector('.extra')).toBeInTheDocument()
})

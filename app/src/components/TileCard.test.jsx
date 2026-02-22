import { render, screen } from '@testing-library/react'
import TileCard from './TileCard'

test('renders title and children', () => {
  render(<TileCard title="Market Breadth"><span>content here</span></TileCard>)
  expect(screen.getByText('Market Breadth')).toBeInTheDocument()
  expect(screen.getByText('content here')).toBeInTheDocument()
})

test('renders badge when provided', () => {
  render(<TileCard title="Theme" badge="Live"><span>x</span></TileCard>)
  expect(screen.getByText('Live')).toBeInTheDocument()
})

test('renders children without title', () => {
  render(<TileCard><span>no title</span></TileCard>)
  expect(screen.getByText('no title')).toBeInTheDocument()
})

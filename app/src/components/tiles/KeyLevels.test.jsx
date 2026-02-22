import { render, screen } from '@testing-library/react'
import KeyLevels from './KeyLevels'

test('renders default ticker label', () => {
  render(<KeyLevels />)
  expect(screen.getAllByText(/QQQ/i).length).toBeGreaterThan(0)
})

test('renders chart embed area', () => {
  render(<KeyLevels />)
  expect(screen.getByTestId('key-levels-chart')).toBeInTheDocument()
})

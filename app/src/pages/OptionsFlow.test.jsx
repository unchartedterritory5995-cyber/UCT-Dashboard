import { render, screen } from '@testing-library/react'
import OptionsFlow from './OptionsFlow'

test('renders options flow placeholder', () => {
  render(<OptionsFlow />)
  expect(screen.getAllByText(/options flow/i).length).toBeGreaterThan(0)
  expect(screen.getByText(/coming soon/i)).toBeInTheDocument()
})

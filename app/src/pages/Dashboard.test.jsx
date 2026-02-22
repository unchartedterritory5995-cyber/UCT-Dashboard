import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'

// Mock SWR to avoid fetch errors in tests
vi.mock('swr', () => ({
  default: () => ({ data: null, error: null })
}))

test('renders dashboard page without crashing', () => {
  render(<MemoryRouter><Dashboard /></MemoryRouter>)
  expect(document.body).toBeTruthy()
})

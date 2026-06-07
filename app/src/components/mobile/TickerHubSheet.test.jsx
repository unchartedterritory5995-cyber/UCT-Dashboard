import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateMock }))
// Stub the flag + live-price hooks so the sheet renders in isolation.
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))

import { TickerHubProvider, useTickerHub } from './TickerHubContext'
import TickerHubSheet from './TickerHubSheet'

function Opener() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('AAPL')}>open AAPL</button>
}

function Harness() {
  return (
    <MemoryRouter>
      <TickerHubProvider>
        <Opener />
        <TickerHubSheet />
      </TickerHubProvider>
    </MemoryRouter>
  )
}

test('is closed until a ticker is opened', () => {
  render(<Harness />)
  expect(screen.queryByText('AAPL')).toBeNull()
})

test('opens with the sym header and action buttons', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('Chart')).toBeInTheDocument()
  expect(screen.getByText('Flag')).toBeInTheDocument()
})

test('Chart action navigates to /charts', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  fireEvent.click(screen.getByText('Chart'))
  expect(navigateMock).toHaveBeenCalledWith('/charts')
})

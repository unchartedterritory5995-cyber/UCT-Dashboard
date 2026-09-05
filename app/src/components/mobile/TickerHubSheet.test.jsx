import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateMock }))
// Stub data hooks + the heavy/lazy chart + voice button so the sheet renders in isolation.
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: vi.fn(), hasAlert: () => false }),
}))
vi.mock('../../hooks/useTickerTweets', () => ({ default: () => ({ data: [] }) }))
// The sheet now mounts ChartPane (the same chart /charts renders) instead of a
// bare StockChart. ChartPane is lazy + imports the very same StockChart module,
// so stubbing it here still covers the pane's inner chart.
vi.mock('../StockChart', () => ({ default: () => <div data-testid="stock-chart" /> }))
vi.mock('../voice/CompassAssistButton', () => ({ default: ({ label }) => <button>{label}</button> }))

import { TickerHubProvider, useTickerHub } from './TickerHubContext'
import TickerHubSheet from './TickerHubSheet'

function Opener() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('AAPL')}>open AAPL</button>
}

function OpenBrk() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('BRK-B')}>open BRK-B</button>
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

test('opens with header, action buttons, TF chips and Compass', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('Chart')).toBeInTheDocument()
  expect(screen.getByText('Alert')).toBeInTheDocument()
  expect(screen.getByText('Flag')).toBeInTheDocument()
  expect(screen.getByText('Journal')).toBeInTheDocument()
  expect(screen.getByText('Research')).toBeInTheDocument()
  expect(screen.getByText('Ask AI')).toBeInTheDocument()
  // ChartPane (the TF row's new home) is a lazy chunk, heavier than bare
  // StockChart was — under full-suite parallel load the Suspense fallback can
  // still be up when the default 1000ms findBy timeout fires, so give it real
  // headroom before asserting on timeframe labels it renders.
  await screen.findByTestId('stock-chart', {}, { timeout: 8000 })
  expect(screen.getByText('1W')).toBeInTheDocument()
  expect(screen.getByText('🧭 Ask Compass about AAPL')).toBeInTheDocument()
})

test('Chart action navigates to /charts', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  fireEvent.click(screen.getByText('Chart'))
  expect(navigateMock).toHaveBeenCalledWith('/charts')
})

test('Alert action reveals an inline alert form', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  fireEvent.click(screen.getByText('Alert'))
  expect(screen.getByPlaceholderText('$ price')).toBeInTheDocument()
  expect(screen.getByText('Set')).toBeInTheDocument()
})

test('Research action navigates to the canonical /research/:sym route', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  fireEvent.click(screen.getByText('Research'))
  expect(navigateMock).toHaveBeenCalledWith('/research/AAPL')
})

test('Ask AI action navigates to the same route with ?section=ai, never a second AI surface', () => {
  render(<Harness />)
  fireEvent.click(screen.getByText('open AAPL'))
  fireEvent.click(screen.getByText('Ask AI'))
  expect(navigateMock).toHaveBeenCalledWith('/research/AAPL?section=ai')
})

test('a class-share symbol (BRK-B) reaches Research in its canonical hyphen form, unconverted', () => {
  render(
    <MemoryRouter>
      <TickerHubProvider>
        <OpenBrk />
        <TickerHubSheet />
      </TickerHubProvider>
    </MemoryRouter>,
  )
  fireEvent.click(screen.getByText('open BRK-B'))
  fireEvent.click(screen.getByText('Research'))
  expect(navigateMock).toHaveBeenCalledWith('/research/BRK-B')
})

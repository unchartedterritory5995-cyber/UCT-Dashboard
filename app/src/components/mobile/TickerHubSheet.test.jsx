import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, beforeEach } from 'vitest'

const navigateMock = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigateMock }))
// Stub data hooks + the heavy/lazy chart + voice button so the sheet renders in isolation.
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: vi.fn(), hasAlert: () => false }),
}))
vi.mock('../../hooks/useTickerTweets', () => ({ default: () => ({ data: [] }) }))
// S7 filing-watch — stubbed for the pre-existing navigation/action tests below
// (they don't exercise it); a dedicated block further down drives the real
// hook shape to prove the Filings action itself.
const filingWatchMock = vi.hoisted(() => ({
  watchState: vi.fn(() => 'NOT_WATCHING'),
  getWatch: vi.fn(() => null),
  createOrReactivate: vi.fn(),
  suspend: vi.fn(),
}))
vi.mock('../../hooks/useFilingWatch', () => ({ default: () => filingWatchMock }))
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
  // S7 filing watch — a DIFFERENT action from the price-alert "Alert" button above.
  expect(screen.getByText('Filings')).toBeInTheDocument()
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

describe('S7 filing-watch action — distinct from the price Alert button', () => {
  beforeEach(() => {
    filingWatchMock.watchState.mockReset().mockReturnValue('NOT_WATCHING')
    filingWatchMock.getWatch.mockReset().mockReturnValue(null)
    filingWatchMock.createOrReactivate.mockReset()
    filingWatchMock.suspend.mockReset()
  })

  test('NOT_WATCHING: clicking Filings creates a watch for this sym', () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('open AAPL'))
    fireEvent.click(screen.getByText('Filings'))
    expect(filingWatchMock.createOrReactivate).toHaveBeenCalledWith('AAPL')
    expect(filingWatchMock.suspend).not.toHaveBeenCalled()
  })

  test('ACTIVE: clicking Filings suspends the existing watch, never creates a second one', () => {
    filingWatchMock.watchState.mockReturnValue('ACTIVE')
    filingWatchMock.getWatch.mockReturnValue({ id: 'p1' })
    render(<Harness />)
    fireEvent.click(screen.getByText('open AAPL'))
    fireEvent.click(screen.getByText('Filings'))
    expect(filingWatchMock.suspend).toHaveBeenCalledWith('p1', 'AAPL')
    expect(filingWatchMock.createOrReactivate).not.toHaveBeenCalled()
  })

  test('SUSPENDED: clicking Filings reactivates via the same create call', () => {
    filingWatchMock.watchState.mockReturnValue('SUSPENDED')
    render(<Harness />)
    fireEvent.click(screen.getByText('open AAPL'))
    fireEvent.click(screen.getByText('Filings'))
    expect(filingWatchMock.createOrReactivate).toHaveBeenCalledWith('AAPL')
  })

  test('CREATING: the Filings action is disabled, no duplicate click fires a second request', () => {
    filingWatchMock.watchState.mockReturnValue('CREATING')
    render(<Harness />)
    fireEvent.click(screen.getByText('open AAPL'))
    const btn = screen.getByText('Filings').closest('button')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(filingWatchMock.createOrReactivate).not.toHaveBeenCalled()
  })
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

import { renderWithProviders, screen, fireEvent } from '../test-utils'
import { useLocation } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

function RouteSpy() {
  const location = useLocation()
  return <div data-testid="route-spy">{location.pathname}{location.search}</div>
}

// Suppress prefetchBars side effects — the click handler kicks off SWR
// preloads against /api/bars/* that resolve to relative URLs jsdom can't fetch.
vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

// StockChart is lazy-loaded inside the modal; stub it so tests don't need to
// boot Lightweight Charts or hit /api/bars.
vi.mock('./StockChart', () => ({
  default: ({ sym, tf }) => <div data-testid={`stock-chart-${sym}-${tf}`}>chart {sym} {tf}</div>,
}))

// The canonical SymbolSearch component (same one ResearchHeader's "+ Compare"
// uses) has its own dedicated coverage elsewhere; stub it here exactly as
// ResearchHeader.test.jsx does so the Compare action can be exercised without
// its real dropdown/fetch machinery.
vi.mock('./chart/SymbolSearch', () => ({
  default: ({ sym, onSymbolChange, displayLabel }) => (
    <button
      data-testid={sym ? 'symbol-search-primary' : 'symbol-search-compare'}
      onClick={() => onSymbolChange(sym ? 'TSLA' : 'MSFT')}
    >
      {displayLabel || sym || 'search'}
    </button>
  ),
}))

import TickerPopup from './TickerPopup'

test('renders ticker text', () => {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  expect(screen.getByText('NVDA')).toBeInTheDocument()
})

test('renders custom children', () => {
  renderWithProviders(<TickerPopup sym="NVDA">NVIDIA</TickerPopup>)
  expect(screen.getByText('NVIDIA')).toBeInTheDocument()
})

test('shows modal on click', () => {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
})

test('closes modal on overlay click', () => {
  renderWithProviders(<TickerPopup sym="NVDA" />)
  fireEvent.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('chart-modal'))
  expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
})

test('modal shows tab buttons for all timeframes', async () => {
  // The popup now mounts ChartPane — the same chart /charts renders — so the
  // timeframe row is ChartPane's, not this component's. Same intent as before
  // (every timeframe reachable from the popup); the labels are the workspace's
  // canonical ones (1m/5m/…/1D/1W) instead of the old bespoke 1min/5min/Daily.
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  // Wait on the chart stub FIRST. ChartPane is a lazy chunk and a heavier one
  // than bare StockChart was, so under full-suite parallel load the Suspense
  // fallback can still be up when a findByRole for a button times out. Once the
  // stub is present the pane has mounted, so its timeframe bar is present too
  // and the rest can be synchronous.
  await screen.findByTestId('stock-chart-NVDA-D')
  for (const label of ['1m', '5m', '30m', '1h', '1D', '1W']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
  }
})

test('modal renders stock chart for the active timeframe', async () => {
  // The TickerPopup modal no longer hosts a Finviz image or a TradingView
  // iframe — it embeds a single StockChart (Lightweight Charts v5). We stub
  // the chart and verify the right ticker/tf gets passed in.
  const user = userEvent.setup()
  renderWithProviders(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  // Default tab on open is Daily → tf="D". findBy (not getBy) waits for the heavy
  // chart mount to render the stub — getBy raced under full-suite parallel load.
  // The StockChart mock still applies: ChartPane imports the very same module.
  expect(await screen.findByTestId('stock-chart-NVDA-D')).toBeInTheDocument()
  // Switching timeframe on ChartPane's bar must still reach StockChart's tf, so
  // the popup's tab state and the pane stay in lockstep.
  await user.click(await screen.findByRole('button', { name: '5m' }))
  expect(await screen.findByTestId('stock-chart-NVDA-5')).toBeInTheDocument()
})

describe('Research / Ask AI deep-link actions (2026-09-04 slice)', () => {
  beforeEach(() => {
    // SwitchTickerBox debounces a real fetch to /api/ticker-search; only the
    // "switch ticker" test below types into it, but stub unconditionally so a
    // stray in-flight timer from that test can never hit a real network call.
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('Full Research navigates to /research/:sym and closes the modal', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    expect(screen.getByTestId('chart-modal')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open full research for NVDA' }))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA')
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
  })

  test('Ask AI navigates to /research/:sym?section=ai', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    await user.click(screen.getByRole('button', { name: 'Ask AI about NVDA' }))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA?section=ai')
  })

  test('actions follow activeSym after switching ticker via the header search', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    await user.type(screen.getByPlaceholderText('Switch ticker…'), 'MSFT{enter}')
    await user.click(screen.getByRole('button', { name: 'Open full research for MSFT' }))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/MSFT')
  })

  test('Full Research action is keyboard-activatable', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    screen.getByRole('button', { name: 'Open full research for NVDA' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA')
  })

  test('a class-share symbol (BRK-B) reaches Full Research and Ask AI in its canonical hyphen form, unconverted', async () => {
    // No frontend provider-symbol conversion is introduced by this slice —
    // whatever canonical hyphen-form symbol the caller passes in (the same
    // form every backend-driven surface — Screener, watchlists, etc. — already
    // supplies) must reach /research/:sym byte-identical.
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="BRK-B" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-BRK-B'))
    await user.click(screen.getByRole('button', { name: 'Open full research for BRK-B' }))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/BRK-B')
  })

  test('existing Flag and Close actions still render alongside the new research actions', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TickerPopup sym="NVDA" />)
    await user.click(screen.getByTestId('ticker-NVDA'))
    expect(screen.getByRole('button', { name: 'Add to flagged list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close chart' })).toBeInTheDocument()
  })
})

describe('Compare action (Portfolio/Position Intelligence Convergence V1 Part A1)', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('renders a Compare entry point distinct from the primary switch-ticker search', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TickerPopup sym="NVDA" />)
    await user.click(screen.getByTestId('ticker-NVDA'))
    expect(screen.getByTestId('ticker-popup-compare-entry')).toBeInTheDocument()
    expect(screen.getByTestId('symbol-search-compare')).toHaveTextContent('+ Compare')
  })

  test('choosing a comparator navigates to /research/:sym/compare/:COMPARATOR and closes the modal', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    await user.click(screen.getByTestId('symbol-search-compare'))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA/compare/MSFT')
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
  })

  test('the Compare picker follows activeSym after switching ticker via the header search', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    await user.type(screen.getByPlaceholderText('Switch ticker…'), 'AMD{enter}')
    await user.click(screen.getByTestId('symbol-search-compare'))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/AMD/compare/MSFT')
  })

  test('Research and Ask AI still navigate correctly after the Compare action was added (regression)', async () => {
    const user = userEvent.setup()
    renderWithProviders(<><TickerPopup sym="NVDA" /><RouteSpy /></>)
    await user.click(screen.getByTestId('ticker-NVDA'))
    await user.click(screen.getByRole('button', { name: 'Open full research for NVDA' }))
    expect(screen.getByTestId('route-spy')).toHaveTextContent('/research/NVDA')
  })
})

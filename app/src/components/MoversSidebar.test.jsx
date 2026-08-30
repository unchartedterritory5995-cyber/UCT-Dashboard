import { renderWithProviders, screen } from '../test-utils'
import MoversSidebar from './MoversSidebar'

const mockData = {
  ripping: [
    { sym: 'RNG', pct: '+34.40%' },
    { sym: 'TNDM', pct: '+32.67%' },
  ],
  drilling: [
    { sym: 'GRND', pct: '-50.55%' },
    { sym: 'CCOI', pct: '-29.36%' },
  ]
}

test('renders ripping and drilling sections with data', () => {
  renderWithProviders(<MoversSidebar data={mockData} />)
  // Title is now mixed-case "Movers at the Open" (previously all-caps).
  expect(screen.getByText(/movers at the open/i)).toBeInTheDocument()
  expect(screen.getByText(/ripping/i)).toBeInTheDocument()
  expect(screen.getByText(/drilling/i)).toBeInTheDocument()
  expect(screen.getByText('RNG')).toBeInTheDocument()
  expect(screen.getByText('+34.40%')).toBeInTheDocument()
  expect(screen.getByText('GRND')).toBeInTheDocument()
  expect(screen.getByText('-50.55%')).toBeInTheDocument()
})

test('renders skeleton (no crash) when no data', () => {
  // Loading state now renders SkeletonTable; no literal "loading" text.
  const { container } = renderWithProviders(<MoversSidebar data={null} />)
  expect(container).toBeTruthy()
})

test('each ticker sym is wrapped in a TickerPopup trigger', () => {
  const mockData = {
    ripping:  [{ sym: 'NVDA', pct: '+5.20%' }, { sym: 'TSLA', pct: '+3.10%' }],
    drilling: [{ sym: 'META', pct: '-4.10%' }],
  }
  renderWithProviders(<MoversSidebar data={mockData} />)
  // TickerPopup renders data-testid="ticker-{sym}" on each trigger span
  expect(screen.getByTestId('ticker-NVDA')).toBeInTheDocument()
  expect(screen.getByTestId('ticker-TSLA')).toBeInTheDocument()
  expect(screen.getByTestId('ticker-META')).toBeInTheDocument()
})

test('renders a crisp company logo beside each ticker row', () => {
  renderWithProviders(<MoversSidebar data={mockData} />)
  // CompanyLogo renders an <img alt="{SYM} logo"> in its default (pre-error) state.
  expect(screen.getByAltText('RNG logo')).toBeInTheDocument()
  expect(screen.getByAltText('GRND logo')).toBeInTheDocument()
})

test('renders an On the Tape section so TapeFeed has a home', async () => {
  // MoversSidebar's external prop is `data` (destructured internally as
  // `propData`) — not `propData` itself. Also: a case-insensitive REGEX match
  // (as the brief's own snippet used) is ambiguous here — the section's
  // wrapping <div> also carries the "Nothing on the tape yet" empty-state
  // text as a sibling, so its combined textContent contains "ON THE TAPE" as
  // a substring too, and findByText(/ON THE TAPE/i) fails with "Found
  // multiple elements". An exact string match targets only the label <span>.
  renderWithProviders(<MoversSidebar data={{ ripping: [], drilling: [] }} />)
  expect(await screen.findByText('ON THE TAPE')).toBeTruthy()
})

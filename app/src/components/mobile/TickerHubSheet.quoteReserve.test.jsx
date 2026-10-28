// The Ticker Hub's quote row (price + day change, above the chart) holds its place before the
// live price lands, so nothing under it -- or the sheet's own top -- moves when it does.
//
// Measured in WebKit (live site, 834 touch): the sheet top went 465 -> 421 ~200ms after the
// chart's first canvas, the chart block itself unchanged (373px before and after). The 44px was
// the quote row (32px line + the body's 12px gap) MOUNTING: it rendered only once
// `useLivePrices` had a price, and that poll answers after the sheet is up. At 390 (sheet at
// its max height) the top held and everything below the row shifted 44px down instead.
// Reproduced locally (route-mocked /api, live-prices answered late) at 390, 834 and 1200.
//
// The fix keeps the row in the layout from the first frame with the SAME spans (price class,
// change class) holding a no-break space, so its height comes from the same type as the
// loaded row rather than from a measured number. The placeholder is aria-hidden.
//
// A STRUCTURAL RAIL (jsdom lays nothing out); the WebKit trace is the measurement.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect } from 'vitest'

const PRICES = vi.hoisted(() => ({ current: {} }))
vi.mock('../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: PRICES.current }) }))
vi.mock('../../hooks/useWatchlistAlerts', () => ({ default: () => ({ createAlert: vi.fn(), hasAlert: () => false }) }))
vi.mock('../../hooks/useTickerTweets', () => ({ default: () => ({ data: [] }) }))
vi.mock('../../hooks/useFilingWatch', () => ({
  default: () => ({ enabled: false, watchState: () => 'NOT_WATCHING', getWatch: () => null, createOrReactivate: vi.fn(), suspend: vi.fn() }),
}))
vi.mock('../chart/pane/ChartPane', () => ({ default: () => <div data-testid="chart-pane" /> }))
vi.mock('../voice/CompassAssistButton', () => ({ default: ({ label }) => <button>{label}</button> }))
vi.mock('../CompareSymbolSearch', () => ({ default: () => <button>Compare</button> }))

import { TickerHubProvider, useTickerHub } from './TickerHubContext'
import TickerHubSheet from './TickerHubSheet'

function Opener() {
  const { openTicker } = useTickerHub()
  return <button onClick={() => openTicker('RAPP')}>open RAPP</button>
}

function mount() {
  const utils = render(<MemoryRouter><TickerHubProvider><Opener /><TickerHubSheet /></TickerHubProvider></MemoryRouter>)
  fireEvent.click(screen.getByText('open RAPP'))
  return utils
}

/** The quote row and what it is made of: [tag, className, aria-hidden] per child. */
function quoteShape() {
  const dialog = screen.getByRole('dialog')
  const row = dialog.querySelector('[data-hub-quote]')
  if (!row) return null
  return {
    state: row.getAttribute('data-hub-quote'),
    className: row.className,
    kids: [...row.children].map((k) => [k.tagName, k.className.replace(/(^|_)(up|down)(_|$)/, '$1dir$3'), k.getAttribute('aria-hidden')]),
    text: row.textContent,
    beforeChart: !!(row.compareDocumentPosition(dialog.querySelector('[data-ticker-hub-chart]')) & Node.DOCUMENT_POSITION_FOLLOWING),
  }
}

describe('Ticker Hub quote row reserves its place before the live price lands', () => {
  it('with no price yet, the row is already there, above the chart, with the same spans and nothing to read', () => {
    PRICES.current = {}
    mount()
    const q = quoteShape()
    expect(q, 'the quote row must be laid out before the price arrives').not.toBeNull()
    expect(q.state).toBe('pending')
    expect(q.beforeChart).toBe(true)
    expect(q.text).toBe('  ')
    expect(q.kids.map(([, , hidden]) => hidden)).toEqual(['true', 'true'])
  })

  it('when the price lands it is the SAME row with the same structure (so the same height)', () => {
    PRICES.current = {}
    const { rerender } = mount()
    const before = quoteShape()
    PRICES.current = { RAPP: { price: 22.86, change_pct: -16.99 } }
    act(() => { rerender(<MemoryRouter><TickerHubProvider><Opener /><TickerHubSheet /></TickerHubProvider></MemoryRouter>) })
    fireEvent.click(screen.getByText('open RAPP'))
    const after = quoteShape()
    expect(after.state).toBe('live')
    expect(after.text).toBe('$22.86-16.99%')
    expect(after.className).toBe(before.className)
    // same tags and classes, child for child (direction class normalised: up/down share metrics)
    expect(after.kids.map(([t, c]) => [t, c])).toEqual(before.kids.map(([t, c]) => [t, c]))
    expect(after.kids.map(([, , hidden]) => hidden)).toEqual([null, null])
  })

  it('the placeholder spans carry the classes that size the loaded row (the wire)', () => {
    PRICES.current = {}
    mount()
    const row = screen.getByRole('dialog').querySelector('[data-hub-quote]')
    // the price span's class is the one `.price` (the 2xl type) is declared on
    expect(row.children[0].className).toMatch(/price/)
  })
})

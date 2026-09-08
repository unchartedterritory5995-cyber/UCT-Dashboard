// app/src/pages/calendar/WeekView.tickerActions.test.jsx
// Seam 19 (2026-09-06): WeekView owns ONE useTickerActions() instance (not
// one per tile) and threads longPressProps down through WeekSessionGroup to
// every EarningsTile it renders -- the same shared-hook-at-the-list-level
// pattern already established by VirtualResults.jsx/ResultCards.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeekView from './WeekView'
import { DEFAULT_FILTERS } from './filterLogic'

vi.mock('../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../components/ui/UIcon', () => ({ default: () => null }))

const mockLongPressProps = vi.fn(() => ({}))
const mockCloseMenu = vi.fn()
let mockMenu = null
vi.mock('../../components/TickerActions', () => ({
  default: ({ menu, onClose }) => menu
    ? <div data-testid="ticker-menu" onClick={onClose}>{menu.sym}</div>
    : null,
  useTickerActions: () => ({ menu: mockMenu, openMenu: vi.fn(), closeMenu: mockCloseMenu, longPressProps: mockLongPressProps }),
}))

const DS = '2026-08-10'
const E = (sym, over = {}) => ({
  sym, ew: 0, mc_b: null, _avg_vol: null, _price: null,
  eps_est: null, eps_act: null, expected_move: null,
  mine: true, _sources: [], ...over,
})

function renderWeek(bmo) {
  return render(
    <WeekView
      weekDates={[DS]}
      days={{ [DS]: { label: 'MON AUG 10', bmo, amc: [], tbd: [], econ: [], fed: [] } }}
      filters={DEFAULT_FILTERS}
      eventTypes={new Set()}
      onSelect={() => {}}
    />,
  )
}

describe('WeekView — Seam 19, TickerActions reuse', () => {
  beforeEach(() => { mockMenu = null; mockLongPressProps.mockClear(); mockCloseMenu.mockClear() })

  it('threads the SAME shared longPressProps down to every tile, keyed by its own sym', () => {
    renderWeek([E('AAON'), E('FERG')])
    expect(mockLongPressProps).toHaveBeenCalledWith('AAON')
    expect(mockLongPressProps).toHaveBeenCalledWith('FERG')
  })

  it('one hook instance serves the whole column, not one per tile', () => {
    // A per-tile hook would still call longPressProps with the right syms,
    // so the real proof is the mocked useTickerActions FACTORY firing once
    // per render pass, not once per tile -- verified via the menu render:
    // a single TickerActionsMenu (not N) appears once a menu is open.
    mockMenu = { sym: 'AAON', x: 0, y: 0 }
    renderWeek([E('AAON'), E('FERG')])
    expect(screen.getAllByTestId('ticker-menu')).toHaveLength(1)
  })

  it('renders no menu at all when nothing is open', () => {
    renderWeek([E('AAON')])
    expect(screen.queryByTestId('ticker-menu')).not.toBeInTheDocument()
  })
})

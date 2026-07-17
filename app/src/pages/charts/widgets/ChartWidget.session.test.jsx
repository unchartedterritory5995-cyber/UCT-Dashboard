import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// The session-view toggle drives StockChart's `sessionView` prop. Mock StockChart
// to surface that prop, and stub the auth-dependent + presentational hooks/children
// (the real ChartWidget can't mount them without an AuthProvider).
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, sessionView }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <span data-testid="session-view">{String(sessionView)}</span>
    </div>
  ),
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))

// useMarketOpen drives the 9:30 auto-revert; getExtSession drives which
// extended session is offered (pre/post) and whether the button is enabled.
const marketState = { isOpen: false, isPremarket: false, isExtended: false }
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => marketState }))

const extState = { session: 'post', anchorDate: '2026-07-15' }
vi.mock('../../../utils/extSession', () => ({
  getExtSession: () => extState,
  anchorNoonSec: () => 0,
}))

// Imported AFTER the mocks are registered.
import ChartWidget from './ChartWidget'

function Wrap({ tf = 'D' }) {
  const [groupSyms, setGroupSyms] = useState({ A: 'NVDA', B: null, C: null, D: null })
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  const value = {
    groupSyms,
    setGroupSym,
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <WorkspaceContext.Provider value={value}>
      <ChartWidget color="A" opts={{ tf }} />
    </WorkspaceContext.Provider>
  )
}

function setMarket(next) { Object.assign(marketState, { isOpen: false, isPremarket: false, isExtended: false }, next) }
function setExt(session) { extState.session = session }

beforeEach(() => { setMarket({}); setExt('post') })

test('daily chart shows the session toggle; pre-market enables "Include pre-market"', () => {
  setMarket({ isPremarket: true })
  setExt('pre')
  render(<Wrap tf="D" />)
  const inc = screen.getByRole('button', { name: 'Include pre-market' })
  expect(inc).toBeInTheDocument()
  expect(inc).not.toBeDisabled()
  expect(screen.getByRole('button', { name: 'Regular Hours' })).toBeInTheDocument()
  expect(screen.getByTestId('session-view').textContent).toBe('regular')
})

test('clicking "Include pre-market" flips sessionView to extended', () => {
  setMarket({ isPremarket: true })
  setExt('pre')
  render(<Wrap tf="D" />)
  act(() => { screen.getByRole('button', { name: 'Include pre-market' }).click() })
  expect(screen.getByTestId('session-view').textContent).toBe('extended')
})

test('post-market relabels the toggle "Include post-market"', () => {
  setMarket({ isExtended: true })
  setExt('post')
  render(<Wrap tf="D" />)
  expect(screen.getByRole('button', { name: 'Include post-market' })).toBeInTheDocument()
})

test('during regular hours the include button is disabled', () => {
  setMarket({ isOpen: true })
  setExt('rth')
  render(<Wrap tf="D" />)
  // Outside pre-market the label reads post-market; during RTH it's disabled.
  expect(screen.getByRole('button', { name: 'Include post-market' })).toBeDisabled()
  expect(screen.getByTestId('session-view').textContent).toBe('regular')
})

test('intraday timeframes hide the session toggle entirely', () => {
  setMarket({ isPremarket: true })
  setExt('pre')
  render(<Wrap tf="5" />)
  expect(screen.queryByRole('button', { name: /Include/ })).toBeNull()
  expect(screen.queryByRole('group', { name: 'Chart session view' })).toBeNull()
  // Intraday shows the separate EXT/RTH pair instead (extendedHoursShading pref).
  expect(screen.getByRole('group', { name: 'Chart extended hours' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Extended Hours' })).toBeInTheDocument()
})

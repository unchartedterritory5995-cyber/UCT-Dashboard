import { render, screen, act } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// Mock StockChart to surface the symbol + the change callback; mock the
// auth-dependent hooks (useWatchlistAlerts/useFlagged need an AuthProvider)
// and the presentational children the widget header renders.
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange }) => (
    <div>
      <span data-testid="chart-sym">{sym}</span>
      <button onClick={() => onSymbolChange && onSymbolChange('AAPL')}>change</button>
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
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

// Imported AFTER the mocks are registered.
import ChartWidget from './ChartWidget'

function Wrap({ color, initialGroups = { A: null, B: null, C: null, D: null } }) {
  const [groupSyms, setGroupSyms] = useState(initialGroups)
  const setGroupSym = (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s }))
  // Mirror the real WorkspaceContext value shape: buses + the activeChartRef
  // the widget now reads for hotkey dedupe (the context FALLBACK has it null,
  // but a mounted workspace always provides a ref object).
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
      <ChartWidget color={color} opts={{}} />
      <span data-testid="groupA">{groupSyms.A ?? 'null'}</span>
      <span data-testid="groupB">{groupSyms.B ?? 'null'}</span>
    </WorkspaceContext.Provider>
  )
}

test('defaults to SPY when its color group is empty', () => {
  render(<Wrap color="A" />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('SPY')
})

test('renders the color groups ticker when set', () => {
  render(<Wrap color="B" initialGroups={{ A: 'NVDA', B: 'TSLA', C: null, D: null }} />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('TSLA')
})

test('symbol changes write back to the widgets color group only', () => {
  render(<Wrap color="B" initialGroups={{ A: 'NVDA', B: null, C: null, D: null }} />)
  act(() => { screen.getByText('change').click() })
  expect(screen.getByTestId('groupA').textContent).toBe('NVDA')
  expect(screen.getByTestId('groupB').textContent).toBe('AAPL')
})

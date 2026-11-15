import { render, screen, act, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// Mock StockChart to surface the symbol + the change callback; mock the
// auth-dependent hooks (useWatchlistAlerts/useFlagged need an AuthProvider)
// and the presentational children the widget header renders.
import { PanelSlotContext } from '../panelSlot'
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, onSymbolChange, onBarsReady }) => (
    <div>
      <span data-testid="chart-sym" data-has-ready={String(typeof onBarsReady === 'function')}>{sym}</span>
      {onBarsReady && <button onClick={onBarsReady}>bars-ready</button>}
      <button onClick={() => onSymbolChange && onSymbolChange('AAPL')}>change</button>
    </div>
  ),
}))
const openWithSpy = vi.fn()
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_props, ref) => {
      useImperativeHandle(ref, () => ({ openWith: (...a) => openWithSpy(...a) }))
      return <span>search</span>
    }),
  }
})
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
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color={color} opts={{}} />
        <span data-testid="groupA">{groupSyms.A ?? 'null'}</span>
        <span data-testid="groupB">{groupSyms.B ?? 'null'}</span>
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

// Speed pass 2026-11-09: the main board releases this panel's mount slot on first bars.
test('a chart on the main board reports its first bars to the mount queue', () => {
  const ready = vi.fn()
  render(<PanelSlotContext.Provider value={ready}><Wrap color="A" /></PanelSlotContext.Provider>)
  fireEvent.click(screen.getByText('bars-ready'))
  expect(ready).toHaveBeenCalledTimes(1)
})
test('CONTROL: outside the main board the chart reports to nobody', () => {
  render(<Wrap color="A" />)
  expect(screen.getByTestId('chart-sym').dataset.hasReady).toBe('false')
})

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

// The chart container is the focusable element that owns type-to-search.
// It is the only element in the widget with tabIndex=0.
function chartSurface(container) {
  const el = container.querySelector('[tabindex="0"]')
  if (!el) throw new Error('chart surface not found')
  return el
}

test('typing a letter opens ticker search', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  fireEvent.keyDown(chartSurface(container), { key: 'n' })
  expect(openWithSpy).toHaveBeenCalledWith('n')
})

test('typing a digit does NOT open ticker search (digits are timeframes)', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  const surface = chartSurface(container)
  fireEvent.keyDown(surface, { key: '1' })
  fireEvent.keyDown(surface, { key: '5' })
  fireEvent.keyDown(surface, { key: '9' })
  expect(openWithSpy).not.toHaveBeenCalled()
})

test('Shift+letter types the ticker, does not fire the toggle', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  // Shift+H is bound to the Heikin Ashi toggle, but a letter is a ticker
  // character first (traders type tickers uppercase) — it must type "H" into
  // the search box rather than firing the toggle.
  fireEvent.keyDown(chartSurface(container), { key: 'H', code: 'KeyH', shiftKey: true })
  expect(openWithSpy).toHaveBeenCalledWith('H')
})

test('a bare digit reaches the document (not swallowed by the chart container)', () => {
  const { container } = render(<Wrap color="A" />)
  const surface = chartSurface(container)
  const received = vi.fn()
  document.addEventListener('keydown', received)
  try {
    const event = new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true })
    act(() => { surface.dispatchEvent(event) })
    expect(received).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  } finally {
    document.removeEventListener('keydown', received)
  }
})

test('Shift+digit does NOT open ticker search (still wins as a timeframe shortcut)', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  fireEvent.keyDown(chartSurface(container), { key: '!', code: 'Digit1', shiftKey: true })
  expect(openWithSpy).not.toHaveBeenCalled()
})

test('a bare letter bound to a drawing tool still opens ticker search', () => {
  openWithSpy.mockClear()
  const { container } = render(<Wrap color="A" />)
  const surface = chartSurface(container)
  // 't' is bound to tool:trendline and 'a' to tool:arrow — with no modifiers,
  // ticker search must win so TSLA/AAPL/etc. can still be typed.
  fireEvent.keyDown(surface, { key: 't' })
  expect(openWithSpy).toHaveBeenCalledWith('t')
  fireEvent.keyDown(surface, { key: 'a' })
  expect(openWithSpy).toHaveBeenCalledWith('a')
})

// 2026-11-13: the Leverage/Inverse control appeared 0.85 s after the candles at the median on
// production (its lookup started when the chart reached the symbol). The widget now holds that
// lookup for the rows ahead (lib/symbolResourceWarm.js), under the control's own key.
test('the widget holds the leverage lookup for the rows a member is about to reach, and releases it', async () => {
  const { warmSymbolResources, __resetSymbolResourceWarm } = await import('../../../lib/symbolResourceWarm')
  __resetSymbolResourceWarm({ painted: true })
  const urls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    urls.push(String(url))
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ long: [], short: [] }) }
  }))
  try {
    const { WidgetChromeContext } = await import('../widgetChromeContext')
    const groups = { A: 'NVDA', B: null, C: null, D: null }
    // CONTROL: a chart with no widget frame shows no control, makes no lookup, holds none
    const bare = render(<Wrap color="A" initialGroups={groups} />)
    urls.length = 0
    warmSymbolResources(['AMD'], 'D', { priority: true })
    await new Promise((r) => setTimeout(r, 60))
    expect(urls.filter((u) => u.includes('single-stock-etfs'))).toEqual([])
    bare.unmount()
    __resetSymbolResourceWarm({ painted: true })
    const view = render(<WidgetChromeContext.Provider value={{}}><Wrap color="A" initialGroups={groups} /></WidgetChromeContext.Provider>)
    urls.length = 0
    warmSymbolResources(['AAPL'], 'D', { priority: true })
    // (a few asks go out at a time: the header's own reads may be ahead of it in the queue)
    const { waitFor } = await import('@testing-library/react')
    await waitFor(() => expect(urls).toContain('/api/single-stock-etfs/AAPL'))
    view.unmount()
    urls.length = 0
    expect(warmSymbolResources(['MSFT'], 'D', { priority: true }), 'nothing is held once the widget is gone').toBe(0)
    expect(urls).toEqual([])
  } finally {
    vi.unstubAllGlobals()
  }
})

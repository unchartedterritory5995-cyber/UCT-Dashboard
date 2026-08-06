import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import { test, expect, vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// WIRING gate for the volume-pane lock.
//
// ChartWidget hands StockChart `volumeSeparatePane` + `volumePaneHeightPct`, and
// StockChart lets those props WIN over the saved volume.separatePane /
// volume.paneHeightPct prefs. That is deliberate (the workspace's price-scale
// margins are tuned for a separate volume pane; its height comes from dragging the
// separator into charts_vol_pane_pct) — but it made the two Settings controls
// SILENTLY dead on /charts. ChartSettingsModal.volumepane.test.jsx pins that the
// modal CAN render them inert; this file pins that ChartWidget actually asks it to.
// Without this, the lock could exist and be wired nowhere and every test still pass.
//
// Deliberately renders the REAL ChartSettingsModal (the other ChartWidget test
// files stub it) so the assertion lands on the rendered control, not on a prop.

vi.mock('../../../components/StockChart', () => ({
  default: ({ sym }) => <span data-testid="chart-sym">{sym}</span>,
}))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
// The modal reads the saved chart-settings TEMPLATES through the same hook, so this
// mock has to carry `parsePref` too (the widget-only mocks in the sibling files don't).
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (_raw, fallback) => fallback,
}))

// Imported AFTER the mocks are registered.
import ChartWidget from './ChartWidget'

function Wrap() {
  const [groupSyms, setGroupSyms] = useState({ A: 'SPY', B: null, C: null, D: null })
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <WorkspaceContext.Provider value={value}>
      <ChartWidget color="A" opts={{}} />
    </WorkspaceContext.Provider>
  )
}

test('the workspace settings modal shows Separate pane as not-applicable', () => {
  render(<Wrap />)

  fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))

  const toggle = screen.getByRole('switch', { name: 'Separate pane' })
  expect(toggle).toBeDisabled()
  // A grey control with no stated reason is still a mystery — the reason must ship.
  expect(toggle.getAttribute('title')).toBeTruthy()
})

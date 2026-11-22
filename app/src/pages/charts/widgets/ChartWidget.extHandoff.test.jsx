import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import { mergeSettingsOverride } from '../../../components/chart/instanceShape'
import { resolveShowExtended } from '../../../utils/viewSession'

// THE INVARIANT: the session the symbol handoff prepares (ChartWidget's `paneExtRef`, read by
// useSymbolHandoff) is the session the CHART draws — computed here exactly as StockChart computes
// it from the props it actually receives (its `settingsOverride` over the account's chart_settings).
// 2026-11-16: a widget blob without `extendedHoursShading` on an account with it off made the two
// disagree (the handoff prepared the extended-hours 60m series; the chart drew regular hours).

const seen = { override: undefined, handoffRef: null }
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym, settingsOverride }) => { seen.override = settingsOverride; return <span data-testid="chart-sym">{sym}</span> },
}))
vi.mock('../../../hooks/useSymbolHandoff', () => ({
  default: (sym, _tf, opts) => { seen.handoffRef = opts?.showExtended || null; return sym },
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
let mockPrefs = {}
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: mockPrefs, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({
  getExtSession: () => ({ session: null }), getExtSessionCached: () => ({ session: null }), anchorNoonSec: () => 0,
}))

import ChartWidget from './ChartWidget'

function renderWidget(settings) {
  const value = {
    groupSyms: { A: 'NVDA', B: null, C: null, D: null }, setGroupSym: () => {}, chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false }, activeChartRef: { current: null },
  }
  return render(
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" opts={{ tf: '60', settings }} onOptsChange={() => {}} />
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}
const chartDraws = () => resolveShowExtended(seen.override
  ? mergeSettingsOverride(mergeChartSettings(mockPrefs.chart_settings), seen.override)
  : mergeChartSettings(mockPrefs.chart_settings))

describe('ChartWidget: the handoff prepares the session the chart draws', () => {
  const cases = [
    ['partial blob, account off', { extendedHoursShading: false }, { indicatorInstances: [] }, false],
    ['partial blob, account on', { extendedHoursShading: true }, { indicatorInstances: [] }, true],
    ['partial blob, account unset', {}, { indicatorInstances: [] }, true],
    ['blob says on, account off', { extendedHoursShading: false }, { extendedHoursShading: true }, true],
    ['blob says off, account on', { extendedHoursShading: true }, { extendedHoursShading: false }, false],
  ]
  for (const [name, account, blob, want] of cases) {
    test(name, () => {
      mockPrefs = { chart_settings: account }
      seen.override = undefined
      seen.handoffRef = null
      renderWidget(blob)
      expect(seen.handoffRef).toBeTruthy()
      expect(chartDraws()).toBe(want)                       // the fixture means what its name says
      expect(seen.handoffRef.current).toBe(want)           // and the handoff agrees with the chart
    })
  }
})

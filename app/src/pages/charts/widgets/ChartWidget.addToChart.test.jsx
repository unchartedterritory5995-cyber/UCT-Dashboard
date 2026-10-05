/* The chart header's one Add to Chart door, the host features ChartWidget hands
   the settings modal, and the controls this project must leave alone (New chart
   tab). The modal and dock are stubbed to RECORD what the widget gives them. */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, afterEach, test, expect } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

vi.mock('../../../utils/barsMemCache', () => ({ memPeek: () => null, memHas: () => false, memPut: () => {} }))
vi.mock('../../../utils/barsIDB', () => ({ idbGet: vi.fn(async () => undefined) }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBarsToIDB: () => {}, prepareForDisplay: async () => new Promise(() => {}), prefetchReplayTimeframes: () => {},
}))
vi.mock('../../../components/StockChart', () => ({ default: () => <span data-testid="chart" /> }))
const dockSeen = []
vi.mock('./ChartDetailDock', () => ({
  default: ({ dock, children }) => { dockSeen.push(dock); return <>{children}</> },
}))
const modalSeen = []
vi.mock('../../../components/chart/ChartSettingsModal', () => ({
  default: (p) => {
    modalSeen.push(p)
    return p.open ? <div data-testid="settings-modal" data-scroll={p.scrollTo || ''} /> : null
  },
}))
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return { default: forwardRef((_p, ref) => { useImperativeHandle(ref, () => ({ openWith: () => {} })); return <span>search</span> }) }
})
vi.mock('./ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'

afterEach(() => { dockSeen.length = 0; modalSeen.length = 0 })

function Wrap({ initialOpts = { tf: 'D' }, optsLog }) {
  const [opts, setOpts] = useState(initialOpts)
  const value = {
    groupSyms: { A: 'AAPL' },
    setGroupSym: () => {},
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" opts={opts} onOptsChange={(n) => { optsLog?.push(n); setOpts(n) }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}

const lastModal = () => modalSeen[modalSeen.length - 1]

test('the header has ONE Add to Chart control, and it opens settings straight into Add to Chart', () => {
  render(<Wrap />)
  const btns = screen.getAllByRole('button', { name: 'Add to Chart' })
  expect(btns).toHaveLength(1)
  expect(btns[0].getAttribute('title')).toBe('Add to Chart')
  expect(screen.queryByTestId('settings-modal')).toBeNull()
  fireEvent.click(btns[0])
  expect(screen.getByTestId('settings-modal').getAttribute('data-scroll')).toBe('add')
})

test('the gear still opens plain Chart settings (no add target)', () => {
  render(<Wrap />)
  fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }))
  expect(screen.getByTestId('settings-modal').getAttribute('data-scroll')).toBe('')
})

test('the settings modal receives this widget’s host features, read from opts.dock', () => {
  render(<Wrap initialOpts={{ tf: 'D', dock: { strip: true, company: true, open: false } }} />)
  const items = lastModal().chartFeatures.items
  expect(items.map((f) => [f.id, f.enabled, f.open])).toEqual([
    ['earningsStrip', true, undefined],
    ['companyInfo', true, false],
  ])
})

test('the feature verbs write opts.dock — add, collapse, remove — and never opts.settings', () => {
  const log = []
  render(<Wrap optsLog={log} />)
  act(() => { lastModal().chartFeatures.add('companyInfo') })
  expect(log.at(-1).dock).toMatchObject({ company: true, open: true })
  act(() => { lastModal().chartFeatures.setOpen('companyInfo', false) })
  expect(log.at(-1).dock).toMatchObject({ company: true, open: false })
  act(() => { lastModal().chartFeatures.add('earningsStrip') })
  expect(log.at(-1).dock).toMatchObject({ strip: true })
  act(() => { lastModal().chartFeatures.remove('companyInfo') })
  expect(log.at(-1).dock).toMatchObject({ company: false, strip: true })
  expect(log.every((o) => o.settings === undefined)).toBe(true)
})

test('a refused duplicate add persists nothing', () => {
  const log = []
  render(<Wrap initialOpts={{ tf: 'D', dock: { strip: true } }} optsLog={log} />)
  act(() => { lastModal().chartFeatures.add('earningsStrip') })
  expect(log).toEqual([])
})

test('New chart tab is untouched: still its own + control, still adds a tab', () => {
  const log = []
  render(<Wrap optsLog={log} />)
  const newTab = screen.getByRole('button', { name: 'New chart tab' })
  expect(newTab.getAttribute('title')).toBe('New chart tab (independent settings, loads as UCT Default)')
  fireEvent.click(newTab)
  expect(log.at(-1).chartTabs).toHaveLength(1)
})

test('the old permanent feature buttons are gone from the header', () => {
  render(<Wrap />)
  expect(screen.queryByRole('button', { name: 'Earnings strip' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Company info panel' })).toBeNull()
})

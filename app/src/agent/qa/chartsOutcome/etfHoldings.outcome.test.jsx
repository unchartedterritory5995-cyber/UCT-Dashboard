// CHARTS OUTCOME — C3-219 (pl-exec round 6): open an ETF's holdings through the chart's own View Holdings button. The REAL
// ChartWidget is mounted in its WidgetDoorContext slot (the chart c1 of the board); its door reads whether the holdings panel is
// open and writes through the button's own toggle. The door control is offered only while the chart shows an ETF or a UCT index
// (the button shows); on a plain stock it is refused, never guessed. Read back: the panel the button opens is on the page.
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Evidence: LOCAL native Windows Node, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { HOLDINGS_HELD_OUT } from '../../agentExecHeldOut6.test.js'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => <div data-testid="chart" /> }))
vi.mock('../../../components/chart/SymbolSearch', () => ({ default: () => <span>search</span> }))
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/ChartMarketClock', () => ({ default: () => <span>clock</span> }))
vi.mock('../../../pages/charts/widgets/ChartDayGain', () => ({ default: () => <span>gain</span> }))
vi.mock('../../../pages/charts/widgets/AiSearchWidget', () => ({ default: () => null }))
vi.mock('../../../pages/charts/widgets/TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
// the ETF list (useEtfSymbols) and the holdings panel's own list are fixtures: SMH is an ETF, NVDA is not
vi.mock('../../../hooks/useEtfSymbols', () => ({ default: () => ({ isEtf: (s) => String(s || '').toUpperCase() === 'SMH' }) }))
vi.mock('../../../pages/charts/widgets/EtfHoldingsPanel', () => ({ default: ({ sym }) => <div data-testid="holdings-panel">{sym} holdings</div> }))

const ChartWidget = (await import('../../../pages/charts/widgets/ChartWidget')).default
await outcomeSuite()
afterEach(() => { afterEachOutcome(); cleanup() })

function Live({ board, groupSyms }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const chartApiById = useRef(new Map())
  const ws = { groupSyms, setGroupSym: () => {}, groupTfs: {}, chartsTheme: 'default', crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false }, activeChartRef: { current: null }, chartApiById, activeWatchlistRef: { current: null } }
  const w = board.state.widgets.find(x => x.id === 'c1')
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={ws}>
        <WidgetDoorContext.Provider value="c1"><ChartWidget color="N" chartId="c1" opts={w.opts} onOptsChange={(o) => { board.state.widgets = board.state.widgets.map(x => (x.id === 'c1' ? { ...x, opts: o } : x)) }} /></WidgetDoorContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
function mount(sym) {
  const m = open([chart('c1', 0, 0, 24, 20)], { 'N:c1': sym })
  render(<Live board={m.board} groupSyms={{ N: sym }} />)
  return m
}
const setOption = (value) => (c) => [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: 'c1', key: 'holdingsOpen', value } }]

describe('C3-219: the chart\'s View Holdings button, through its door', () => {
  it('the door reads the button: closed on an ETF, absent on a stock', async () => {
    mount('SMH')
    await waitFor(() => expect(mountedWidgetDoor('c1')?.read?.()).toEqual({ holdingsOpen: false }))
  }, 60000)
  it.each(['show me the holdings of the ETF on my chart', ...HOLDINGS_HELD_OUT.map(c => c.text)])('"%s" (SMH): the button\'s panel opens; Undo closes it', async (text) => {
    const m = mount('SMH')
    await waitFor(() => expect(mountedWidgetDoor('c1')?.read?.()).toEqual({ holdingsOpen: false }))
    const out = await m.say(text, setOption(true))
    await waitFor(() => expect(screen.getByTestId('holdings-panel').textContent).toMatch(/SMH holdings/))
    expect(mountedWidgetDoor('c1').read()).toEqual({ holdingsOpen: true })
    expect(out).not.toMatch(/couldn't|can't|isn't/i)
    await m.say('undo')
    await waitFor(() => expect(screen.queryByTestId('holdings-panel')).toBe(null))
  }, 60000)
  it('NEGATIVE on a plain stock (NVDA): refused with the reason, nothing opens', async () => {
    const m = mount('NVDA')
    await waitFor(() => expect(mountedWidgetDoor('c1')?.read?.()).toEqual({}))
    const out = await m.say('show me the holdings of the ETF on my chart', setOption(true))
    expect(out).toMatch(/ETF or a UCT index/)
    expect(screen.queryByTestId('holdings-panel')).toBe(null)
  }, 60000)
})

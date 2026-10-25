// ⭐ A1 INTERIM TWO-UNDO CONTRACT — the Agent's door on the REAL ChartWidget records NOTHING
// (docs/indicators/a1/A1-INTERIM-UNDO-CONTRACT.md §2).
//
// The Agent writes a chart's settings through `chartApiById → agent.commit({settings})` → the widget's own
// onOptsChange (ChartWidget.jsx). That write must never reach the member's indicator Undo stack (A1.2):
// the Agent keeps its own exact Undo, and a record here would be a second copy of one change.
// Indicators-owned: the changes are built with Indicators' own instance writers; no Agent planner or
// runtime is imported, so Agent Phase 2 refactors cannot move this rail. Promoted from the Agent's 10-13
// integration scratch (C:/w/a1gc, ChartWidget.agentUndo.scratch), which drove the same door via the planner.
import { render, act } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi, test, expect, beforeEach } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

vi.mock('../../../components/StockChart', () => ({ default: () => <div data-testid="chart" /> }))
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
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))

import ChartWidget from './ChartWidget'


let api
let optsLog
function Wrap({ initialOpts }) {
  const [opts, setOpts] = useState(initialOpts)
  const [groupSyms, setGroupSyms] = useState({ A: 'NVDA', B: 'AMD', C: null, D: null })
  const chartApiById = useRef(new Map())
  api = { chartApiById, get opts() { return opts }, groupSyms }
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
    chartApiById,
  }
  return (
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <ChartWidget color="A" chartId="w1" opts={opts} onOptsChange={(o) => { optsLog.push(o); setOpts(o) }} />
      </WorkspaceContext.Provider>
    </MemoryRouter>
  )
}
const adapter = () => [...api.chartApiById.current.values()][0].agent
beforeEach(() => { optsLog = []; try { sessionStorage.clear() } catch { /* */ } })

import { peekIndicatorHistory, recordIndicatorChange, HISTORY_KEY_PREFIX } from '../../../components/chart/indicatorHistoryStore'
import { mergeChartSettings } from '../../../components/chart/chartDefaults'
import * as engineRegistry from '../../../components/chart/engine/nativeRegistry'
import {
  addInstance, setInstanceHidden, setInstanceInput, removeInstance,
} from '../../../components/chart/engine/instanceControls'

const historyKeys = () => {
  const out = []
  for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.startsWith(HISTORY_KEY_PREFIX)) out.push(k) }
  return out
}
const cs = () => mergeChartSettings(JSON.stringify(api.opts.settings || {}))
const insts = () => (cs().indicatorInstances || []).filter(i => i && !i.deleted)
const commit = (next) => act(() => { expect(adapter().commit({ settings: next })).toBe(true) })

test('add / hide / setInputs / show / remove through agent.commit: each lands; the member stack stays EMPTY', () => {
  render(<Wrap initialOpts={{ tf: 'D' }} />)
  const before = insts().map(i => i.instanceId)
  commit(addInstance(cs(), 'rsi', engineRegistry))
  const rsi = insts().find(i => i.defId === 'rsi' && !before.includes(i.instanceId))
  expect(rsi).toBeTruthy()
  commit(setInstanceHidden(cs(), rsi.instanceId, true, engineRegistry))
  expect(insts().find(i => i.instanceId === rsi.instanceId).hidden).toBe(true)
  const key = Object.keys(rsi.inputs || {}).find(k => typeof rsi.inputs[k] === 'number')
  commit(setInstanceInput(cs(), rsi.instanceId, key, rsi.inputs[key] + 3, engineRegistry))
  expect(insts().find(i => i.instanceId === rsi.instanceId).inputs[key]).toBe(rsi.inputs[key] + 3)
  commit(setInstanceHidden(cs(), rsi.instanceId, false, engineRegistry))
  commit(removeInstance(cs(), rsi.instanceId, engineRegistry))
  expect(insts().find(i => i.instanceId === rsi.instanceId)).toBeUndefined()
  // settings + tf travel in ONE onOptsChange per commit — and none of them left a record anywhere
  expect(optsLog.length).toBe(5)
  for (const u of [null, 1, '1']) for (const k of ['chart:w1', 'global']) expect(peekIndicatorHistory(k, { userId: u }).past).toHaveLength(0)
  expect(historyKeys()).toEqual([])
  // CONTROL — the probes above can see a record: a MEMBER hide on this chart lands on chart:w1
  const live = insts()[0]
  recordIndicatorChange('chart:w1', cs(), setInstanceHidden(cs(), live.instanceId, true, engineRegistry), { userId: null })
  expect(peekIndicatorHistory('chart:w1', { userId: null }).past).toHaveLength(1)
  expect(historyKeys()).toHaveLength(2)                                           // the stack + its LRU index
})

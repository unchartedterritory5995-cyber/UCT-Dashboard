// CHARTS OUTCOME — pl-widget slice 2: a widget's own BUTTONS as `action` rows of the one widget-control layer
// (widgets/widgetControls.js → widget.setOption → the widget's door act(key)), and the Scanner's way back to its picker (an
// opts row, written exactly as its own "change scan" writes it). Over the REAL Scanner (ScannerWidget + ScannerResults) and
// Period Sort (PeriodSortWidget + PeriodSortResults) widgets, each mounted in its WidgetDoorContext slot beside the real Agent
// panel. A refresh is read at the widget's own data hook (the SWR mutate its footer Refresh calls), never from a receipt alone.
// Held-out phrasings: agentWidgetActionsHeldOut.test.js (committed before the change).
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Data is invented fixture data. Evidence: LOCAL native Windows Node, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow, refusals } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../../context/AuthContext'
import { REFRESH_HELD_OUT, LEAVE_HELD_OUT, ACTION_REFUSE_HELD_OUT } from '../../agentWidgetActionsHeldOut.test.js'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('echarts-for-react', () => ({ default: () => null }))
const data = vi.hoisted(() => ({ mutates: [], fail: false, hold: null }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => { try { return raw == null ? fallback : JSON.parse(raw) } catch { return fallback } } }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {}, isLoading: false }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {}, prefetchListDeep: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {},
}))
vi.mock('../../../pages/charts/useListSubscribeEnabled', () => ({ default: () => false }))
// the results table is the Watchlists page component; the footer, its Refresh and the door are the widgets' own
vi.mock('../../../pages/Watchlists', () => ({ default: () => null }))
const byKey = (key) => {
  const k = String(key || '')
  if (k.startsWith('/api/scans/period-change')) return { status: 'ready', results: [{ sym: 'AAA', pct: 1 }], as_of: '2026-11-03T15:00:00Z' }
  if (k.startsWith('/api/scans/')) return { results: [{ sym: 'AAA' }, { sym: 'BBB' }], as_of: '2026-11-03T15:00:00Z' }
  return null
}
// each data hook's own mutate: what the footer's Refresh calls. It resolves once the hook has re-read (here: at once, or when
// the test lets it go), and rejects when the server fails.
const mutateFor = (key) => () => {
  data.mutates.push(String(key))
  if (data.fail) return Promise.reject(new Error('fixture: the server failed'))
  return data.hold ? data.hold.promise : Promise.resolve(byKey(key))
}
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (key) => ({ data: byKey(key), error: null, isLoading: false, isValidating: false, mutate: mutateFor(key) }) }))
vi.mock('swr', async (orig) => ({ ...(await orig()), default: (key) => ({ data: byKey(key), isLoading: false, mutate: mutateFor(key) }) }))

const C = {
  scanner: (await import('../../../pages/charts/widgets/ScannerWidget')).default,
  periodsort: (await import('../../../pages/charts/widgets/PeriodSortWidget')).default,
}
await outcomeSuite()

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const onOpts = (id) => (opts) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts } : x)) }
  const ws = { groupSyms: { N: null }, setGroupSym: () => {}, groupTfs: {}, activeWatchlistRef: { current: null } }
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        <WorkspaceContext.Provider value={ws}>
          {board.state.widgets.filter(w => C[w.type]).map(w => {
            const W = C[w.type]
            return <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><W color={w.color} opts={w.opts} onOptsChange={onOpts(w.id)} /></WidgetDoorContext.Provider></div>
          })}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const SCAN = { scanKey: 'top-gainers-30d', scanName: 'Top Gainers 30D' }
const wgt = (id, type, opts = {}, x = 12) => ({ id, type, x, y: 0, w: 6, h: 20, color: 'N', opts })
const PS = { start: 20261001, end: 20261031 }
function board(widgets) {
  data.mutates = []; data.fail = false; data.hold = null
  const m = open([chart('c1', 0, 0, 12, 20), ...widgets], { 'N:c1': 'AAA' })
  render(<Live board={m.board} />)
  return m
}
const idOf = (c, type) => must((c.board?.[0]?.widgets || []).find(w => w.type === type), `a ${type} widget`).id
// the plan a correct planner makes from THIS request; `first` records whether the FIRST request already offered the action
function setOption(type, args, seen = {}) {
  return (c, body) => {
    seen.first ??= (body.capabilities || []).some(x => x.name === 'widget.setOption')
    return [{ action: 'widget.setOption', target: must(c.board?.[0]?.ref, 'board'), args: { widget: idOf(c, type), ...args } }]
  }
}
const boardOf = (m) => JSON.stringify(m.board.state.widgets)
const optsOf = (m, id) => m.board.state.widgets.find(w => w.id === id).opts
const MUTATES = { scanner: (k) => k === '/api/scans/top-gainers-30d', periodsort: (k) => k.startsWith('/api/scans/period-change?') }

afterEach(() => { afterEachOutcome(); cleanup() })

describe('a widget\'s own Refresh, through its door (C3-112 Scanner, C3-208 Period Sort)', () => {
  it.each(REFRESH_HELD_OUT.map(c => [c.row, c.text, c]))('%s held-out "%s": the widget\'s own data hook re-reads once; the receipt follows it; nothing else changes', async (_row, text, c) => {
    const m = board([wgt('x', c.type, c.type === 'scanner' ? SCAN : PS), wgt('y', c.type === 'scanner' ? 'periodsort' : 'scanner', c.type === 'scanner' ? PS : SCAN, 18)])
    await waitFor(() => expect(typeof mountedWidgetDoor('x')?.act).toBe('function'))
    const before = boardOf(m)
    const seen = {}
    const out = await m.say(text, setOption(c.type, c.args, seen))
    await waitFor(() => expect(data.mutates.filter(MUTATES[c.type])).toHaveLength(1))
    expect(data.mutates.filter(k => !MUTATES[c.type](k))).toEqual([])       // the other widget was not refreshed
    expect(out).toMatch(/Refresh/)
    expect(boardOf(m)).toBe(before)                                          // a Refresh keeps nothing on the board
    expect(seen.first, 'the first request offered widget.setOption (no reroute)').toBe(true)
  }, 60000)

  it('a Refresh is reported only once it resolved: a failed re-read says so, and claims nothing', async () => {
    const m = board([wgt('x', 'scanner', SCAN)])
    await waitFor(() => expect(typeof mountedWidgetDoor('x')?.act).toBe('function'))
    data.fail = true
    const out = await m.say('refresh the scanner', setOption('scanner', { key: 'refresh', value: 'run' }))
    expect(data.mutates).toHaveLength(1)
    expect(out).not.toMatch(/Refreshed/)
    expect(out).toMatch(/did not refresh|couldn|failed|didn/i)
  }, 60000)

  it('two Scanner widgets: the request tells them apart by position, and "the right scanner" refreshes that one only', async () => {
    const m = board([wgt('x', 'scanner', SCAN), wgt('y', 'scanner', { scanKey: 'ipo-1y', scanName: 'IPO 1Y' }, 18)])
    await waitFor(() => expect(typeof mountedWidgetDoor('y')?.act).toBe('function'))
    const right = (c) => {
      const s = (c.board?.[0]?.widgets || []).filter(w => w.type === 'scanner')
      expect(new Set(s.map(w => w.position)).size, 'two scanners, two positions').toBe(2)
      const r = must(s.find(w => /right/.test(String(w.position))), 'the right scanner')
      return [{ action: 'widget.setOption', target: c.board[0].ref, args: { widget: r.id, key: 'refresh', value: 'run' } }]
    }
    await m.say('refresh the right scanner', right)
    await waitFor(() => expect(data.mutates).toEqual(['/api/scans/ipo-1y']))
    expect(proposalsNow()).toHaveLength(0)
  }, 60000)

  it.each(ACTION_REFUSE_HELD_OUT.map(c => [c.text, c]))('NEGATIVE held-out "%s": refused in words; nothing is refreshed', async (text, c) => {
    const m = board([wgt('x', c.type, SCAN)])
    await waitFor(() => expect(typeof mountedWidgetDoor('x')?.act).toBe('function'))
    const out = await m.say(text, setOption(c.type, c.args))
    expect(data.mutates).toEqual([])
    expect(`${out} ${refusals().map(r => r.textContent).join(' ')}`).toMatch(c.refuse)
  }, 60000)
})

describe('the Scanner back to its picker (C3-108), as its own "change scan" writes it', () => {
  it.each(LEAVE_HELD_OUT.map(c => [c.text, c]))('held-out "%s": scanKey and scanName are cleared and the picker shows; Undo puts the scan back exactly', async (text, c) => {
    const m = board([wgt('x', 'scanner', SCAN), wgt('y', 'periodsort', PS, 18)])
    await waitFor(() => expect(mountedWidgetDoor('x')).toBeTruthy())
    const other = JSON.stringify(optsOf(m, 'y'))
    const was = JSON.stringify(optsOf(m, 'x'))
    const seen = {}
    await m.say(text, setOption('scanner', c.args, seen))
    await waitFor(() => expect(optsOf(m, 'x')).toMatchObject({ scanKey: null, scanName: null }))
    await waitFor(() => expect(mountedWidgetDoor('x')?.act).toBeUndefined())   // the picker is up: no results, no Refresh
    expect(JSON.stringify(optsOf(m, 'y'))).toBe(other)
    expect(seen.first, 'the first request offered widget.setOption (no reroute)').toBe(true)
    await m.say('undo')
    await waitFor(() => expect(JSON.stringify(optsOf(m, 'x'))).toBe(was))
  }, 60000)

  it('NEGATIVE: a Scanner already on its picker is left as it is (no change, no receipt of one)', async () => {
    const m = board([wgt('x', 'scanner', {})])
    const before = boardOf(m)
    const out = await m.say('take the scanner back to its picker', setOption('scanner', { key: 'scan', value: 'picker' }))
    expect(boardOf(m)).toBe(before)
    expect(out).toMatch(/already/i)
  }, 60000)
})

void fireEvent; void screen

// The journal capture key (Ctrl+Alt+J) on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode;
// boardVisibility.js). The key is on `document` and answers the ACTIVE chart (by widget id); a kept board stays
// mounted, and a board saved from another shares its widget ids, so without the board's gate one press could capture
// from the hidden chart too.
//   J1 (red first) the active chart of a hidden layer board captures nothing; the same chart shown captures once
//   J2 (red first) its chart decides group switches with the board STORE (never the slot's view), and a hidden layer
//      board's chart is no member of a decision (the board in front never waits on it): membership follows the handle
//   S7b (red first; review of #2901, M1) a hide and a show re-render nothing under the real ChartWidget (Profiler)
//   CX1 (red first; review of #2901, H3) a hidden layer board's chart takes no crosshair from the workspace bus; the hide
//       clears the one it may still draw; shown, it takes them again
import { render, act, cleanup } from '@testing-library/react'
import { Profiler } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { BoardVisibilityContext, createBoardVisibility } from '../../../components/chart/boardVisibility'

const paneProps = vi.hoisted(() => ({ stock: null }))
vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react')
  const api = new Proxy({}, { get: () => () => null })
  return {
    // the pane marks its widget active on mount (in the product: on hover / focus)
    default: forwardRef(({ onActivate, stockChartProps }, ref) => {
      paneProps.stock = stockChartProps
      useImperativeHandle(ref, () => api)
      useEffect(() => { onActivate?.() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="pane" />
    }),
  }
})
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_p, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span />
    }),
  }
})
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => null }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => null }))
vi.mock('./ChartDayGain', () => ({ default: () => null }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: 'Apple' }) }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))
vi.mock('../../journal-2-0/lib/embedArchive', () => ({ kickSnapshotWarm: () => {} }))

// the group-decision members registered right now, by scope (J2)
const members = vi.hoisted(() => new Map())
vi.mock('../../../hooks/handoffGroups', async (orig) => {
  const m = await orig()
  return {
    ...m,
    registerMember: (scope, group, id, member) => {
      const off = m.registerMember(scope, group, id, member)
      members.set(scope, (members.get(scope) || 0) + 1)
      return () => { members.set(scope, (members.get(scope) || 0) - 1); off() }
    },
  }
})

import ChartWidget from './ChartWidget'
import { createGroupSymsStore, createBoardGroupSymsView } from '../groupSymsStore'

let inbox = 0
beforeEach(() => {
  inbox = 0
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/j2/inbox')) inbox++
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch })

const onOptsChangeStable = () => {}
function mount(vis, store = null, bus = null, onRender = null) {
  const value = {
    groupSyms: { A: 'AAPL', B: null, C: null, D: null },
    ...(store ? { groupSymsStore: store } : {}),
    setGroupSym: () => {},
    chartsTheme: 'default',
    crosshairBus: bus || { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return render(
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <BoardVisibilityContext.Provider value={vis}>
          <Profiler id="cw" onRender={onRender || (() => {})}>
            <ChartWidget color="A" opts={{}} onOptsChange={onOptsChangeStable} />
          </Profiler>
        </BoardVisibilityContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}
const capture = () => act(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, altKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 0))
})

test('J1 (red first) the active chart of a hidden layer board captures nothing', async () => {
  const vis = createBoardVisibility({ layer: true })
  mount(vis)
  await capture()
  expect(inbox, 'NON-VACUITY: Ctrl+Alt+J captures from the active chart of a shown board').toBe(1)
  act(() => { vis.set('hidden') })
  await capture()
  expect(inbox, 'a hidden board captured').toBe(1)
  act(() => { vis.set('visible') })
  await capture()
  expect(inbox).toBe(2)
})

test('J2 (red first) a hidden layer board is no member of the group decision; the show rejoins the board store', async () => {
  members.clear()
  const source = createGroupSymsStore({ A: 'AAPL', B: null, C: null, D: null })
  const vis = createBoardVisibility({ layer: true })
  const view = createBoardGroupSymsView(source, vis)
  mount(vis, view)
  expect(members.get(source), 'a shown chart is no member under its board store (the view is not the scope)').toBe(1)
  expect(members.get(view) || 0).toBe(0)
  act(() => { vis.set('hidden') })
  expect(members.get(source), 'a hidden board chart is still a member of the group decision').toBe(0)
  act(() => { vis.set('visible') })
  expect(members.get(source)).toBe(1)
})

test('S7b (red first) a hide and a show re-render nothing under the real ChartWidget', async () => {
  const source = createGroupSymsStore({ A: 'AAPL', B: null, C: null, D: null })
  const vis = createBoardVisibility({ layer: true })
  const view = createBoardGroupSymsView(source, vis)
  let commits = 0
  mount(vis, view, null, () => { commits++ })
  await act(async () => { await new Promise((r) => setTimeout(r, 100)) })
  const before = commits
  act(() => { vis.set('hidden') })
  act(() => { vis.set('visible') })
  await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  expect(commits - before, 'a hide and a show re-rendered the ChartWidget').toBe(0)
})

test('CX1 (red first) a hidden layer board chart takes no crosshair; the hide clears its own', async () => {
  const subs = new Set()
  const bus = { emit: (color, sourceId, payload) => { for (const f of [...subs]) f({ sourceId, payload }) }, subscribe: (f) => { subs.add(f); return () => subs.delete(f) } }
  const vis = createBoardVisibility({ layer: true })
  mount(vis, null, bus)
  const got = []
  const off = paneProps.stock.subscribeCrosshair((p) => got.push(p))
  bus.emit('A', 'other-chart', { time: 1 })
  expect(got, 'NON-VACUITY: a shown chart takes the bus').toEqual([{ time: 1 }])
  act(() => { vis.set('hidden') })
  expect(got.at(-1), 'the hide did not clear the crosshair it may still draw').toBeNull()
  const n = got.length
  bus.emit('A', 'other-chart', { time: 2 })
  bus.emit('A', 'other-chart', { time: 3 })
  expect(got.length - n, 'a hidden board chart took the crosshair').toBe(0)
  act(() => { vis.set('visible') })
  bus.emit('A', 'other-chart', { time: 4 })
  expect(got.at(-1)).toEqual({ time: 4 })
  off()
})

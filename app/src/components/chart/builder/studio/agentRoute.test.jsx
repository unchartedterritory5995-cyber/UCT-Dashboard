// app/src/components/chart/builder/studio/agentRoute.test.jsx
//
// ⭐ INDICATORS ⇄ AGENT (2026-10-12) — the chart's Create Indicator / Modify door asks the Agent route
// first (`agent/indicatorEntry.js`). Promises, each failable here:
//   * a registered route TAKES the door: the chart-side dock does not open, the route is told the chart
//     (and, for Modify, the definition and its name);
//   * no route, a route that declines, or a route that throws ⇒ the dock, exactly as before;
//   * access is checked BEFORE the route (a member without Create Indicator never reaches the Agent);
//   * the Agent's own door (`openCreateIndicatorFor`) never routes back to the Agent;
//   * `openIndicatorDoor` opens the existing builder's doors on this chart, and refuses unknown doors.
import { createRef } from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import ChartToolbar from '../../ChartToolbar'
import { mergeChartSettings } from '../../chartDefaults'
import { AuthContext } from '../../../../context/AuthContext'
import { setCreateIndicatorFlag, CREATE_INDICATOR_FLAG_KEY } from './createIndicatorFlag'
import { setIndicatorAgentRoute, _resetIndicatorEntry } from '../../../../agent/indicatorEntry'
import { clearSession, createKey, chartScope } from '../authoring/conversationSessions'
import STOCKCHART_SRC from '../../../StockChart.jsx?raw'
import PANE_SRC from '../../pane/ChartPane.jsx?raw'
import WIDGET_SRC from '../../../../pages/charts/widgets/ChartWidget.jsx?raw'
import HOST_SRC from '../../../../agent/host.js?raw'

const CHART = 'w-agent-route-test'

function mount({ role = 'admin', onOpenLibrary } = {}) {
  const ref = createRef()
  render(
    <AuthContext.Provider value={{ isPaid: true, user: { id: 1, role }, loading: false }}>
      <ChartToolbar
        ref={ref}
        activeTool="cursor"
        setActiveTool={() => {}}
        chartId={CHART}
        chartSettings={mergeChartSettings(null)}
        onUpdateSettings={vi.fn()}
        onStudioPreview={vi.fn()}
        onOpenLibrary={onOpenLibrary}
      />
    </AuthContext.Provider>,
  )
  return { ref }
}

afterEach(() => {
  cleanup()
  _resetIndicatorEntry()
  try { localStorage.removeItem(CREATE_INDICATOR_FLAG_KEY) } catch { /* */ }
  clearSession(createKey(chartScope(CHART)))
})

describe('Create Indicator → UCT Agent route', () => {
  it('⭐ a registered route takes the door: the Agent is told the chart and the dock stays closed', () => {
    act(() => { setCreateIndicatorFlag(true) })
    const route = vi.fn(() => true)
    setIndicatorAgentRoute(route)
    const t = mount()
    let ok
    act(() => { ok = t.ref.current.openCreateIndicator() })
    expect(ok).toBe(true)
    expect(route).toHaveBeenCalledWith({ chartId: CHART, defId: null, name: null })
    expect(screen.queryByTestId('create-indicator')).toBeNull()
  })

  it('UNCHANGED: no route, a declining route, or a throwing route ⇒ the dock opens as before', async () => {
    act(() => { setCreateIndicatorFlag(true) })
    let t = mount()
    act(() => { t.ref.current.openCreateIndicator() })
    expect(await screen.findByTestId('create-indicator')).toBeTruthy()
    cleanup()
    setIndicatorAgentRoute(() => false)
    t = mount()
    act(() => { t.ref.current.openCreateIndicator() })
    expect(await screen.findByTestId('create-indicator')).toBeTruthy()
    cleanup()
    setIndicatorAgentRoute(() => { throw new Error('boom') })
    t = mount()
    act(() => { t.ref.current.openCreateIndicator() })
    expect(await screen.findByTestId('create-indicator')).toBeTruthy()
  })

  it('⛔ access first: without Create Indicator the route is never asked', () => {
    const route = vi.fn(() => true)
    setIndicatorAgentRoute(route)
    const t = mount()                         // flag off
    let ok
    act(() => { ok = t.ref.current.openCreateIndicator() })
    expect(ok).toBe(false)
    expect(route).not.toHaveBeenCalled()
  })

  it("the Agent's own door never routes back to the Agent", async () => {
    act(() => { setCreateIndicatorFlag(true) })
    const route = vi.fn(() => true)
    setIndicatorAgentRoute(route)
    const t = mount()
    let r
    act(() => { r = t.ref.current.openCreateIndicatorFor({}) })
    expect(r.ok).toBe(true)
    expect(route).not.toHaveBeenCalled()
    expect(await screen.findByTestId('create-indicator')).toBeTruthy()
  })
})

describe('openIndicatorDoor — the builder doors, for the Agent', () => {
  it('Library calls the chart’s Library door; an unknown door refuses', () => {
    act(() => { setCreateIndicatorFlag(true) })
    const lib = vi.fn()
    const t = mount({ onOpenLibrary: lib })
    let ok
    act(() => { ok = t.ref.current.openIndicatorDoor('library') })
    expect(ok).toBe(true)
    expect(lib).toHaveBeenCalledTimes(1)
    act(() => { ok = t.ref.current.openIndicatorDoor('nope') })
    expect(ok).toBe(false)
  })

  it('Library without a Library door refuses (nothing to open)', () => {
    act(() => { setCreateIndicatorFlag(true) })
    const t = mount()
    let ok
    act(() => { ok = t.ref.current.openIndicatorDoor('library') })
    expect(ok).toBe(false)
  })

  it.each(['formula', 'pine', 'image'])('%s opens the existing builder (no second editor)', (door) => {
    act(() => { setCreateIndicatorFlag(true) })
    const t = mount()
    let ok
    act(() => { ok = t.ref.current.openIndicatorDoor(door) })
    expect(ok).toBe(true)
    expect(screen.queryByTestId('create-indicator')).toBeNull()
  })
})

describe('the door chain the Agent reaches (source rails — found missing in the browser, 10-12)', () => {
  it('host → widget → pane → StockChart → toolbar all forward openIndicatorDoor', () => {
    expect(HOST_SRC).toMatch(/openIndicatorDoor: \(ref, door\) => \{[\s\S]{0,140}e\?\.api\.agent\.openIndicatorDoor\?\.\(door\)/)
    expect(WIDGET_SRC).toMatch(/openIndicatorDoor: \(door\) => !!paneRef\.current\?\.openIndicatorDoor\?\.\(door\)/)
    expect(PANE_SRC).toMatch(/openIndicatorDoor: \(door\) => \{[\s\S]{0,120}paneToolbarApi\.current\?\.openIndicatorDoor\?\.\(door\)/)
    expect(STOCKCHART_SRC).toMatch(/openIndicatorDoor: \(door\) => \{[\s\S]{0,80}toolbarRef\.current\?\.openIndicatorDoor\?\.\(door\)/)
  })
})

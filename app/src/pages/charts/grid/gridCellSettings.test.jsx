// app/src/pages/charts/grid/gridCellSettings.test.jsx
//
// ⭐ POLICY A on the grid's STATE side (owner ruling 2026-11-02): a cell's own
// chart settings must SURVIVE everywhere the board goes — the pref round trip
// (sanitizeState is an allow-list), the board's own mutators (group refill, Undo),
// the container's per-cell merge (incl. "Reset to my chart"), and a named
// multichart layout saved and applied through /api/charts/layouts.
//
// The chart-side half (an indicator edit lands on the cell, never in global) is
// GridChartCell.settingsScope.test.jsx, against the real StockChart.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, act, fireEvent, screen, cleanup } from '@testing-library/react'

const H = vi.hoisted(() => ({
  setPref: null,
  cellProps: [],
  modalProps: [],
  saved: [],
}))

vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ prefs: {}, setPref: H.setPref, loading: false }) }
})
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, useSearchParams: () => [new URLSearchParams()] }
})
vi.mock('../WorkspaceContext', () => ({ useWorkspace: () => ({ chartsTheme: null }) }))
vi.mock('./GridChartCell', () => ({
  default: (props) => { H.cellProps.push(props); return <div data-testid={`cell-${props.cell.id}`} /> },
}))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({
  default: (props) => { H.modalProps.push(props); return props.open ? <div role="dialog">{props.title}</div> : null },
}))
vi.mock('./useStaggeredMount', () => ({ default: (ids) => ({ mountedIds: new Set(ids), release: () => {} }) }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchGridWarm: () => {} }))
vi.mock('../../../hooks/useChartLayouts', () => ({
  default: () => ({ global: [], mine: [], saveLayout: async (body) => { H.saved.push(body) }, deleteLayout: async () => {} }),
}))

const { sanitizeState, sanitizeCellSettings, CELL_SETTINGS_MAX_BYTES } = await import('./gridLayouts')
const { default: useMultiChartState } = await import('./useMultiChartState')
const { default: MultiChartGrid } = await import('./MultiChartGrid')
const { default: MultiChartMenu } = await import('./MultiChartMenu')

const OWN = { background: '#0d0f12', indicatorInstances: [{ instanceId: 'u:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false }] }

beforeEach(() => {
  cleanup()
  H.setPref = vi.fn()
  H.cellProps.length = 0
  H.modalProps.length = 0
  H.saved.length = 0
})

describe('sanitizeState carries a cell\'s own settings', () => {
  it('round-trips settings through JSON exactly', () => {
    const raw = { layout: '1x2', cells: [{ id: 'a', sym: 'spy', tf: 'D', chartType: null, settings: OWN }, { id: 'b', sym: 'QQQ', tf: '5' }] }
    const back = sanitizeState(JSON.parse(JSON.stringify(sanitizeState(raw))))
    expect(back.cells[0].settings).toEqual(OWN)
    expect(back.cells[0].sym).toBe('SPY')
    // An unforked cell gains no key: its shape is exactly the pre-feature shape.
    expect('settings' in back.cells[1]).toBe(false)
  })

  it('refuses shapes that cannot be a settings blob, and bounds the size', () => {
    expect(sanitizeCellSettings(null)).toBeNull()
    expect(sanitizeCellSettings([1, 2])).toBeNull()
    expect(sanitizeCellSettings('x')).toBeNull()
    expect(sanitizeCellSettings({ blob: 'x'.repeat(CELL_SETTINGS_MAX_BYTES) })).toBeNull()
    const s = sanitizeState({ layout: '1x2', cells: [{ id: 'a', sym: 'SPY', tf: 'D', settings: [1] }] })
    expect('settings' in s.cells[0]).toBe(false)
  })
})

describe('the board mutators keep a cell\'s settings', () => {
  it('group refill keeps settings on a matched sym and positionally on a new one; Undo restores verbatim', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('1x2'))
    const [a, b] = result.current.state.cells
    act(() => result.current.updateCellAt(0, { ...a, sym: 'SPY', settings: OWN }))
    act(() => result.current.updateCellAt(1, { ...b, sym: 'QQQ', settings: { background: '#111111' } }))
    const snapshot = result.current.state.cells
    act(() => result.current.fillCells(['SPY', 'RKLB'], { id: 'g', by: 'today', n: 2 }))
    const [spy, rklb] = result.current.state.cells
    expect(spy.settings).toEqual(OWN)
    expect(rklb.settings).toEqual({ background: '#111111' })
    act(() => result.current.restoreCells(snapshot, null))
    expect(result.current.state.cells.map((c) => c.settings)).toEqual([OWN, { background: '#111111' }])
  })
})

function GridHost() {
  const mc = useMultiChartState()
  GridHost.mc = mc
  return <MultiChartGrid mc={mc} />
}

describe('the container merges a cell\'s settings write, and Reset clears it', () => {
  it('a settings write lands on that cell only; settings:null removes the key', async () => {
    render(<GridHost />)
    await act(async () => {})
    const lastFor = (id) => H.cellProps.filter((p) => p.cell.id === id).at(-1)
    const ids = GridHost.mc.state.cells.map((c) => c.id)
    const p0 = lastFor(ids[0])
    expect(p0, 'no cell rendered — vacuous').toBeTruthy()
    act(() => p0.onChange({ ...p0.cell, settings: OWN }))
    expect(GridHost.mc.state.cells[0].settings).toEqual(OWN)
    expect('settings' in GridHost.mc.state.cells[1]).toBe(false)
    const p0b = lastFor(ids[0])
    expect(p0b.cell.settings).toEqual(OWN)
    // A TF change from the forked cell keeps its fork.
    act(() => p0b.onChange({ ...p0b.cell, tf: 'W' }))
    expect(GridHost.mc.state.cells[0]).toMatchObject({ tf: 'W', settings: OWN })
    // Reset to my chart.
    const p0c = lastFor(ids[0])
    act(() => p0c.onChange({ ...p0c.cell, settings: null }))
    expect('settings' in GridHost.mc.state.cells[0]).toBe(false)
    // None of this was a global write.
    expect(H.setPref.mock.calls.filter(([k]) => k === 'chart_settings')).toEqual([])
  })

  it('the grid\'s one global action is labelled as shared', async () => {
    render(<GridHost />)
    await act(async () => {})
    act(() => GridHost.mc.setSettingsOpen(true))
    expect(screen.getByRole('dialog').textContent).toBe('Shared Chart Settings')
  })
})

describe('a named multichart layout carries the cells\' settings', () => {
  it('save → apply round-trips a forked cell and leaves an unforked one unforked', async () => {
    const src = renderHook(() => useMultiChartState())
    act(() => src.result.current.enterGrid('1x2'))
    const [a, b] = src.result.current.state.cells
    act(() => src.result.current.updateCellAt(0, { ...a, sym: 'SPY', settings: OWN }))
    act(() => src.result.current.updateCellAt(1, { ...b, sym: 'QQQ' }))
    render(<MultiChartMenu mc={src.result.current} onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Grid name'), { target: { value: 'My grid' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save grid' })) })
    expect(H.saved, 'nothing was saved — vacuous').toHaveLength(1)
    const tpl = JSON.parse(JSON.stringify(H.saved[0]))   // what the server stores
    expect(tpl.layout.kind).toBe('multichart')
    expect(tpl.layout.cells[0].settings).toEqual(OWN)
    expect('settings' in tpl.layout.cells[1]).toBe(false)

    const dst = renderHook(() => useMultiChartState())
    act(() => dst.result.current.applyGridTemplate(tpl))
    const cells = dst.result.current.state.cells
    expect(cells[0]).toMatchObject({ sym: 'SPY', settings: OWN })
    expect('settings' in cells[1]).toBe(false)
  })
})

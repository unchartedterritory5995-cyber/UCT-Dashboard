/* P14b (2026-10-10) — /charts on a phone (<640px): the Compare and version-history doors.
 *
 * MEASURED FIRST (what a phone could reach before this change):
 *   * Multi-Chart grid: Tools sheet "▦ Multi Chart" (2fd16ae9f, multiChartDoor.wire.test.jsx).
 *   * Per-LAYOUT version history + Recently deleted: Layouts sheet (COV-06,
 *     MobileLayoutsSheet.history.test.jsx).
 *   * Compare Symbols: NO door. CompareSymbolsPanel mounted only in the desktop branch of
 *     ChartsWorkspace, and it finds its chart through `chartApiById`, which only ChartWidget
 *     fills; the phone composes ChartPane directly, so even a mounted panel had no chart.
 *   * BOARD version history (TERM-051, VersionHistoryPanel): NO door. The panel already had
 *     phone CSS (a bottom sheet at <=640px) but only the desktop Layouts menu opened it.
 *
 * BUILT: two Tools-sheet rows. This rail proves each renders, opens, and acts, with a
 * non-vacuity control for each.
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { forwardRef } from 'react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import MobileChartsApp from './MobileChartsApp'
import MobileMoreSheet from './MobileMoreSheet'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'

vi.mock('../../../components/chart/pane/ChartPane', () => ({
  default: forwardRef(function ChartPaneMock({ sym, chartId }, ref) {
    void ref
    return <div data-testid="chart-pane" data-sym={sym} data-chartid={chartId} />
  }),
}))
vi.mock('../WidgetHost', () => ({
  default: ({ widget }) => <div data-testid={`widget-body-${widget.type}`}>{widget.type}</div>,
}))
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), loading: false }),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => null }))
vi.mock('../../../hooks/useBreadthSymbols', () => ({ default: () => new Map() }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: vi.fn() }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({
  default: () => ({ createAlert: vi.fn(), deleteAlert: vi.fn(), getAlertsForSym: () => [] }),
}))

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WIDGETS = [{ id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D' } }]

let historyStoreUp = true
beforeEach(() => {
  localStorage.clear()
  historyStoreUp = true
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.startsWith('/api/workspace/doc')) {
      return Promise.resolve(historyStoreUp
        ? { ok: true, status: 200, json: () => Promise.resolve({ versions: [] }) }
        : { ok: false, status: 404, json: () => Promise.resolve({}) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [], groups: [] }) })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

function renderApp(extra = {}) {
  const chartApiById = { current: new Map() }
  const onOptsChange = vi.fn()
  const value = {
    ...WORKSPACE_FALLBACK,
    groupSyms: { A: 'NVDA', B: null, C: null, D: null },
    setGroupSym: vi.fn(),
    chartApiById,
    activeChartRef: { current: null },
  }
  render(
    <WorkspaceContext.Provider value={value}>
      <MobileChartsApp widgets={WIDGETS} onRemove={vi.fn()} onColorChange={vi.fn()}
        onOptsChange={onOptsChange} onAddWidget={vi.fn()} {...extra} />
    </WorkspaceContext.Provider>,
  )
  return { chartApiById, onOptsChange }
}

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve() })

describe('the Tools sheet rows (component)', () => {
  const base = { open: true, onClose: vi.fn(), sym: 'SPY', widgets: [], onOpenSettings: vi.fn() }

  it('renders both doors and each calls its handler', async () => {
    const onOpenCompare = vi.fn()
    const onOpenVersionHistory = vi.fn()
    render(<MobileMoreSheet {...base} onOpenCompare={onOpenCompare} onOpenVersionHistory={onOpenVersionHistory} />)
    await userEvent.click(screen.getByRole('button', { name: 'Compare symbols' }))
    expect(onOpenCompare).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Board version history' }))
    expect(onOpenVersionHistory).toHaveBeenCalledTimes(1)
  })

  it('NON-VACUITY: with no handlers neither row exists, while the sheet still draws', () => {
    render(<MobileMoreSheet {...base} />)
    expect(screen.queryByRole('button', { name: 'Compare symbols' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Board version history' })).toBeNull()
    expect(screen.getByRole('button', { name: /Chart settings/i })).toBeInTheDocument()
  })
})

describe('the phone shell: Compare opens and writes this chart\'s comparisons', () => {
  it('the phone chart is registered for the panel under its widget id', () => {
    const { chartApiById } = renderApp()
    expect(chartApiById.current.has('w-chart')).toBe(true)
    expect(chartApiById.current.get('w-chart').getComparison()).toEqual([])
  })

  it('Tools, Compare symbols, add QQQ: the comparison lands in the chart widget settings', async () => {
    const user = userEvent.setup()
    const { onOptsChange } = renderApp()
    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: 'Compare symbols' }))
    const dialog = await screen.findByRole('dialog', { name: 'Compare Symbols' })
    const input = dialog.querySelector('input[aria-label="Add symbol"]')
    await flush()
    fireEvent.change(input, { target: { value: 'QQQ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const call = onOptsChange.mock.calls.find(([id, o]) => id === 'w-chart' && o?.settings?.comparisonSymbols)
    expect(call, 'no settings write carried comparisonSymbols').toBeTruthy()
    expect(call[1].settings.comparisonSymbols.map((s) => s.sym)).toEqual(['QQQ'])
    expect(call[1].tf).toBe('D')   // the rest of the widget's opts are kept
  })
})

describe('the phone shell: board version history is offered while the store answers', () => {
  it('store up: Tools shows "Board version history" and it calls the host\'s opener', async () => {
    const user = userEvent.setup()
    const onOpenVersionHistory = vi.fn()
    renderApp({ onOpenVersionHistory })
    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await user.click(await screen.findByRole('button', { name: 'Board version history' }))
    expect(onOpenVersionHistory).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: store dark (404) shows no row, though the host passed a handler', async () => {
    historyStoreUp = false
    const user = userEvent.setup()
    renderApp({ onOpenVersionHistory: vi.fn() })
    await user.click(screen.getByRole('button', { name: /more tools/i }))
    await flush()
    expect(screen.getByRole('button', { name: /Chart settings/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Board version history' })).toBeNull()
  })

  it('the wire: ChartsWorkspace hands the phone shell openVersionHistory and mounts the panel there', () => {
    const ws = fs.readFileSync(path.join(HERE, '..', 'ChartsWorkspace.jsx'), 'utf8')
    const start = ws.indexOf('<MobileChartsApp')
    const end = ws.indexOf('{noticeHost}', start)
    expect(start, 'the phone shell mount moved').toBeGreaterThan(-1)
    const mobileBranch = ws.slice(start, end)
    expect(mobileBranch).toContain('onOpenVersionHistory={openVersionHistory}')
    expect(mobileBranch).toMatch(/historyOpen && \(\s*<VersionHistoryPanel/)
  })
})

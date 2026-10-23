/* O1 -- the touch /charts layout had no "Send to Journal".
 *
 * The desktop chart's right-click menu has carried it since Journal Widgets P5. The
 * touch shell (phone, and the 641-1024 px coarse-pointer tablet that /charts routes to
 * MobileChartsApp) composes ChartPane directly, never ChartWidget, so the action never
 * reached it. The Tools sheet now carries the row, and it runs the SAME capture builder
 * and the SAME shared send the desktop handler runs (chartJournalCapture +
 * sendCaptureToJournal). These rails assert what the member SEES: the row, and the
 * confirmation line after a tap.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { forwardRef, useImperativeHandle } from 'react'
import MobileChartsApp from './MobileChartsApp'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'

const sendCaptureToJournal = vi.fn(async () => 'NVDA chart added to your note')
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: (...a) => sendCaptureToJournal(...a),
}))

// The chart engine, with the one imperative read the capture needs: the visible range.
vi.mock('../../../components/chart/pane/ChartPane', () => ({
  default: forwardRef(function ChartPaneMock({ sym, tf }, ref) {
    useImperativeHandle(ref, () => ({
      getViewState: () => ({ range: { from: { year: 2026, month: 3, day: 2 }, to: { year: 2026, month: 9, day: 30 } } }),
      openSettings: () => {},
    }))
    return <div data-testid="chart-pane" data-sym={sym} data-tf={tf} />
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

const WIDGETS = [{ id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'W' } }]

function renderApp(extraProps = {}) {
  const value = { ...WORKSPACE_FALLBACK, groupSyms: { A: 'NVDA', B: null, C: null, D: null }, setGroupSym: vi.fn() }
  return render(
    <WorkspaceContext.Provider value={value}>
      <MobileChartsApp widgets={WIDGETS} onRemove={vi.fn()} onColorChange={vi.fn()}
        onOptsChange={vi.fn()} onAddWidget={vi.fn()} {...extraProps} />
    </WorkspaceContext.Provider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sendCaptureToJournal.mockClear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

describe.each([['tablet (820 px)', { tablet: true }], ['phone', {}]])('Tools sheet, %s', (_name, props) => {
  test('carries Send to Journal, and a tap sends this chart and says so', async () => {
    const user = userEvent.setup()
    renderApp(props)
    await user.click(screen.getByRole('button', { name: /more tools/i }))
    const row = screen.getByRole('button', { name: 'Send to Journal' })
    await user.click(row)
    expect(await screen.findByText('NVDA chart added to your note')).toBeInTheDocument()
    expect(sendCaptureToJournal).toHaveBeenCalledTimes(1)
    const [widgetId, capture] = sendCaptureToJournal.mock.calls[0]
    expect(widgetId).toBe('chart')
    expect(capture).toMatchObject({ symbol: 'NVDA', tf: 'W', from: '2026-03-02', to: '2026-09-30' })
    expect(capture.settings).toBeTruthy()
    // The sheet closed, so the confirmation is on the chart, not under a sheet.
    expect(screen.queryByRole('button', { name: 'Send to Journal' })).not.toBeInTheDocument()
  })
})

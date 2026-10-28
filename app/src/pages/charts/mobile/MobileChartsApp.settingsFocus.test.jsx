/* The touch path into Chart Settings must hand the modal an opener that is still
 * on screen when it closes.
 *
 * "All chart settings…" lives INSIDE the Indicators sheet (and the Tools sheet
 * carries a "Chart settings" row too). Each row closes its own sheet in the same
 * tap, so the row is unmounted before the modal ever closes. The modal returned
 * focus to whatever it captured at open, found it disconnected, and focus fell
 * to <body> (WebKit + axe, 390 and 834, 2026-10-28). ChartPane's openSettings
 * takes its opener from an event's `currentTarget`, exactly the way the gear
 * hands it a click; these rails assert the shell passes the TOOLBAR door that
 * opened the sheet, and that the door is still connected after the sheet closed.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { forwardRef, useImperativeHandle } from 'react'
import MobileChartsApp from './MobileChartsApp'
import { WorkspaceContext, WORKSPACE_FALLBACK } from '../WorkspaceContext'

const openSettings = vi.fn()
vi.mock('../../../components/chart/pane/ChartPane', () => ({
  default: forwardRef(function ChartPaneMock({ sym }, ref) {
    useImperativeHandle(ref, () => ({ openSettings: (...a) => openSettings(...a) }))
    return <div data-testid="chart-pane" data-sym={sym} />
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

const WIDGETS = [{ id: 'w-chart', type: 'chart', color: 'A', opts: { tf: 'D' } }]

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
  openSettings.mockClear()
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
})
afterEach(() => { vi.unstubAllGlobals() })

function openerPassed() {
  expect(openSettings).toHaveBeenCalledTimes(1)
  const [arg] = openSettings.mock.calls[0]
  return arg && arg.currentTarget
}

describe.each([['phone', {}], ['tablet (834 px)', { tablet: true }]])('Chart Settings opener, %s', (_n, props) => {
  test('Indicators sheet → "All chart settings…" hands the modal the Indicators toolbar button', async () => {
    const user = userEvent.setup()
    renderApp(props)
    const door = screen.getByRole('button', { name: 'Indicators' })
    await user.click(door)
    const row = screen.getByRole('button', { name: /All chart settings/ })
    await user.click(row)
    // The row is gone with its sheet; the door is not.
    expect(row.isConnected).toBe(false)
    const opener = openerPassed()
    expect(opener).toBe(door)
    expect(opener.isConnected).toBe(true)
  })

  test('Tools sheet → "Chart settings" hands the modal the More tools button', async () => {
    const user = userEvent.setup()
    renderApp(props)
    const door = screen.getByRole('button', { name: /more tools/i })
    await user.click(door)
    await user.click(screen.getByRole('button', { name: /Chart settings/i }))
    expect(openerPassed()).toBe(door)
  })
})

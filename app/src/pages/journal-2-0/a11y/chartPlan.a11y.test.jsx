// app/src/pages/journal-2-0/a11y/chartPlan.a11y.test.jsx
//
// Wave 13 lane 13H-2: the chart plan through 8A's axe harness. Dark behind
// notebook_chart_plan_enabled, so the editor recipes never render it — hence recipes of its own
// rather than a `coveredBy` that would be untrue. Each proves its state rendered before axe
// runs, so an empty screen can never pass as a clean one:
//   * chart-plan-panel        — three drawn levels, roles set, the plan sized (starter label);
//   * chart-plan-panel-empty  — no level drawn yet (the how-to-start line);
//   * chart-plan-panel-error  — the sizing read refused (role=alert);
//   * bar-replay              — "what happened next" open at the note, stepped once.
import { describe, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { installFetch, Providers } from './fixtures'
import { axeSurface } from './surface'
import ChartPlanPanel from '../components/notebook/ChartPlanPanel'
import { _resetBoundAlertSync } from '../../../components/chart/useBoundDrawingAlerts'

vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData() {}, update() {}, createPriceLine: () => ({}), removePriceLine() {} }),
    timeScale: () => ({ setVisibleRange() {} }),
    remove() {},
  }),
  createSeriesMarkers: () => ({ setMarkers() {} }),
  CandlestickSeries: {},
  LineStyle: { Dashed: 2 },
  ColorType: { Solid: 'solid' },
}))

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const line = (id, price, extra = {}) => ({ id, type: 'horizontal', points: [{ time: 1758000000, price }], ...extra })
const ANNS = [line('e', 101.5, { role: 'entry' }), line('s', 97.25, { role: 'stop' }), line('t', 112)]
const ATTRS = {
  widgetId: 'chart', embedId: 'emb-1', params: { symbol: 'NVDA', tf: 'D', to: '2026-03-13' },
  annotations: ANNS, capturedAt: '2026-03-13T20:00:00Z',
}
const SIZE = {
  plan: { entry: 101.5, stop: 97.25, target: null, shares: null, side: 'long', roles: {}, setup: null },
  account: { accountSize: 100000, riskPct: 1 },
  compass: { ok: false, reason: 'Compass sizing needs a paid plan' },
}
const BARS = [
  { t: '2026-03-12', o: 100, h: 102, l: 99, c: 101 },
  { t: '2026-03-13', o: 101, h: 103, l: 100, c: 102 },
  { t: '2026-03-16', o: 102, h: 104, l: 101, c: 103 },
]

const panel = (props) => render(
  <Providers>
    <ChartPlanPanel attrs={ATTRS} noteId="note-1" updateAttributes={() => {}} {...props} />
  </Providers>,
)

describe('lane 13H-2 surfaces (the chart plan)', () => {
  axeSurface('chart-plan-panel', async () => {
    _resetBoundAlertSync()
    installFetch([[/^\/api\/j2\/chart-plan\/size$/, SIZE], [/^\/api\/watchlist-alerts$/, []]])
    panel({ open: true })
    await screen.findByText(/^Sized by the Position size formula/)
    screen.getByRole('radiogroup', { name: 'Role of the line at 97.25' })
    screen.getByRole('button', { name: 'Arm alert at this level, 112.00' })
    await settle()
  })

  axeSurface('chart-plan-panel-empty', async () => {
    _resetBoundAlertSync()
    installFetch([[/^\/api\/j2\/chart-plan\/size$/, { ...SIZE, plan: { ...SIZE.plan, entry: null, stop: null, side: null } }]])
    panel({ open: true, attrs: { ...ATTRS, annotations: [] } })
    await screen.findByText(/Draw a horizontal line on this chart/)
    await screen.findByText(/Draw an entry and a stop/)
  })

  axeSurface('chart-plan-panel-error', async () => {
    _resetBoundAlertSync()
    installFetch([[/^\/api\/j2\/chart-plan\/size$/, [500, {}]], [/^\/api\/watchlist-alerts$/, []]])
    panel({ open: true })
    await screen.findByRole('alert')
  })

  axeSurface('bar-replay', async () => {
    _resetBoundAlertSync()
    installFetch([
      [/^\/api\/j2\/chart-plan\/size$/, SIZE], [/^\/api\/watchlist-alerts$/, []],
      [/^\/api\/bars\/NVDA$/, { bars: BARS }],
    ])
    panel({ open: false, replayOpen: true, onCloseReplay: () => {} })
    await screen.findByText('At the note — step forward')
    fireEvent.click(screen.getByRole('button', { name: 'Step forward one bar' }))
    screen.getByText('1 bar after the note')
    await settle()
  }, { level: 'page' })
})

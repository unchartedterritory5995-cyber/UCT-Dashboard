// app/src/components/chart/IndicatorAlertPopover.truthful.test.jsx
//
// ─── THE ALERT FORM SAYS WHAT IT IS DOING (2026-10-01) ──────────────────────
//
// Two truthful notes, no behaviour change:
//   1. Opened from a CHART-ONLY study's chip (SuperTrend, Keltner, Dollar Volume,
//      a Moving Average…), there is no alert address to open on; the form still
//      falls back to the catalogue's first indicator, and now says so.
//   2. Opened from an alertable instance, the parameters are the ALERT's own —
//      seeded from the served catalogue, never copied from the chart instance —
//      so a chart's slow 14/3/3 Stochastic arms a 14/3 FAST alert unless edited.
//      The form now says the two are separate.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const H = vi.hoisted(() => ({ catalog: { catalog: [], isLoading: false, error: null }, created: [] }))

vi.mock('../../hooks/useIndicatorAlerts', () => ({
  useIndicatorAlerts: () => ({ alerts: [], isLoading: false, refresh: () => {} }),
  useIndicatorAlertCatalog: () => H.catalog,
  createIndicatorAlert: (payload) => { H.created.push(payload); return Promise.resolve({ ok: true, id: 1 }) },
  deleteIndicatorAlert: () => {},
  toggleIndicatorAlert: () => {},
  fetchCurrentValue: () => Promise.resolve(null),
}))

import IndicatorAlertPopover from './IndicatorAlertPopover'

const COND = [{ value: 'above', label: 'Above threshold', needs_threshold: true }]
// The served catalogue's shape for the two plots that matter here.
const CATALOG = [
  { indicator: 'rsi', label: 'RSI', conditions: COND, default_threshold: 70,
    plots: [{ value: 'rsi', label: 'RSI', conditions: COND, default_threshold: 70, inputs: { period: 14 } }] },
  { indicator: 'stoch', label: 'Stochastic', conditions: COND, default_threshold: 80,
    plots: [
      { value: 'stoch', label: 'Stochastic %K', conditions: COND, default_threshold: 80, inputs: { k_period: 14, d_period: 3 } },
      { value: 'stoch.d', label: 'Stochastic %D', conditions: COND, default_threshold: 80, inputs: { k_period: 14, d_period: 3 } },
    ] },
]
const inst = (instanceId, defId, inputs) => ({ instanceId, defId, inputs, hidden: false })

beforeEach(() => { H.catalog = { catalog: CATALOG, isLoading: false, error: null }; H.created.length = 0 })
afterEach(cleanup)

describe('opened from a chart-only study — the fallback is named', () => {
  it('SuperTrend has no alert address: the form says so, and still offers the catalogue', () => {
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}}
      chartInstances={[inst('st-1', 'superTrend', { atrPeriod: 10, multiplier: 3 })]}
      initial={{ instanceId: 'st-1', plotKey: 'up' }} />)
    expect(screen.getByTestId('alert-unsupported').textContent).toMatch(/aren't available for this indicator/)
    expect(screen.getByLabelText('Indicator').value).toBe('rsi')
    expect(screen.queryByTestId('alert-params-separate')).toBeNull()
  })
  it('no note when the form was not opened from a chip at all', () => {
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}} chartInstances={[]} />)
    expect(screen.queryByTestId('alert-unsupported')).toBeNull()
  })
})

describe('opened from an alertable instance — the parameters are the alert\'s own', () => {
  it('a SLOW 14/3/3 chart Stochastic opens a 14/3 alert form, and the form says they are separate', async () => {
    render(<IndicatorAlertPopover sym="AAPL" onClose={() => {}}
      chartInstances={[inst('stoch-1', 'stoch', { kPeriod: 14, smoothK: 3, dPeriod: 3 })]}
      initial={{ instanceId: 'stoch-1', plotKey: 'k' }} />)
    expect(screen.queryByTestId('alert-unsupported')).toBeNull()
    expect(screen.getByTestId('alert-params-separate').textContent).toMatch(/separate from the chart indicator's settings/)
    // the served parameters, not the instance's — exactly what the server will evaluate
    expect(screen.getByLabelText('k_period input').value).toBe('14')
    expect(screen.getByLabelText('d_period input').value).toBe('3')
    expect(screen.queryByLabelText('smooth_k input')).toBeNull()
    fireEvent.change(screen.getByLabelText('Threshold'), { target: { value: '80' } })
    fireEvent.click(screen.getByRole('button', { name: /add alert/i }))
    await waitFor(() => expect(H.created).toHaveLength(1))
    expect(H.created[0].params).toEqual({ k_period: 14, d_period: 3 })
    expect(H.created[0].instance_id).toBe('stoch-1')
  })
})

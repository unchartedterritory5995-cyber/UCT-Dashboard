// app/src/pages/breadth/MetricReadout.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import MetricReadout from './MetricReadout'

const rows = [
  { date: '2026-08-01', vix: 14, pct_above_50sma: 30 },
  { date: '2026-08-02', vix: 18, pct_above_50sma: 40 },
  { date: '2026-08-03', vix: 22, pct_above_50sma: 50 },
  { date: '2026-08-04', vix: 20, pct_above_50sma: 60 },
]

const setup = (props = {}) =>
  render(<MetricReadout rows={rows} selected={['vix']} hidden={new Set()} onToggle={() => {}} {...props} />)

describe('MetricReadout', () => {
  // A-12: the percentile names its basis — a rank within the window on screen.
  it('shows the label, the latest value, and its percentile with its basis', () => {
    setup()
    expect(screen.getByText('VIX')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('75th of 4 shown')).toBeTruthy()
  })

  // The window is the point: a value extreme over a year can be ordinary this
  // month, and the readout must describe what is on screen.
  it('computes the percentile from the visible rows only', () => {
    render(<MetricReadout rows={rows.slice(2)} selected={['vix']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('50th of 2 shown')).toBeTruthy()
  })

  it('shows a dash rather than inventing a percentile it cannot compute', () => {
    render(<MetricReadout rows={[rows[0]]} selected={['vix']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('handles a metric with no data at all', () => {
    render(<MetricReadout rows={rows} selected={['naaim']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('toggles a series when its row is clicked', () => {
    const onToggle = vi.fn()
    setup({ onToggle })
    fireEvent.click(screen.getByRole('button', { name: /VIX/ }))
    expect(onToggle).toHaveBeenCalledWith('vix')
  })

  it('marks a hidden series so the row reflects the chart', () => {
    setup({ hidden: new Set(['vix']) })
    expect(screen.getByRole('button', { name: /VIX/ }).getAttribute('aria-pressed')).toBe('false')
  })

  // The spans sit flush in the DOM, so the computed name would otherwise run
  // together as "VIX2075th of 4 shown".
  it('spells the row out for a screen reader, basis included', () => {
    setup()
    expect(screen.getByRole('button', { name: 'VIX, 20, 75th percentile of 4 readings shown' })).toBeTruthy()
  })

  it('says so plainly when there is nothing to report', () => {
    render(<MetricReadout rows={rows} selected={['naaim']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: /no value, percentile unavailable/ })).toBeTruthy()
  })

  it('gives each series the same colour the chart uses', () => {
    render(<MetricReadout rows={rows} selected={['pct_above_50sma', 'vix']} hidden={new Set()} onToggle={() => {}} />)
    const swatches = document.querySelectorAll('[data-swatch]')
    expect(swatches).toHaveLength(2)
    expect(swatches[0].getAttribute('data-swatch')).not.toBe(swatches[1].getAttribute('data-swatch'))
  })

  // A-10: CBOE put/call stopped reporting and the readout kept showing its last
  // value as current, with nothing to say how old it was.
  it('dates a daily reading that stopped arriving', () => {
    const r = [
      { date: '2026-08-03', cboe_putcall: 0.8 },
      { date: '2026-08-04', cboe_putcall: 0.9 },
      { date: '2026-08-05' },
      { date: '2026-08-06' },
    ]
    render(<MetricReadout rows={r} selected={['cboe_putcall']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('last Aug 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: /, not reported since Aug 4, / })).toBeTruthy()
  })

  // CONTROL: one session behind is the live row's normal shape, and a weekly
  // survey may trail by a week — so the badge above is a signal, not noise.
  it('does not date a reading that is only its cadence behind', () => {
    const r = [
      { date: '2026-08-03', cboe_putcall: 0.8, aaii_bulls: 40 },
      { date: '2026-08-04', cboe_putcall: 0.85 },
      { date: '2026-08-05', cboe_putcall: 0.9 },
      { date: '2026-08-06' },
    ]
    render(<MetricReadout rows={r} selected={['cboe_putcall', 'aaii_bulls']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.queryByText(/^last /)).toBeNull()
  })
})

// PlaybookCharts — charts of a playbook's best calls and failures, opened on demand.
// Synthetic data only: the repo is public.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const seen = []
vi.mock('../../components/StockChart', () => ({
  default: (props) => {
    seen.push(props)
    return <div data-testid="stock-chart">{props.sym}</div>
  },
}))

import PlaybookCharts, { CHARTS_PER_SIDE, chartFrame } from './PlaybookCharts'

const call = (id, ticker, posted, r20, trader = 'TSDR') => ({
  call_id: id, record_id: id.split('#')[0], ticker, posted, r20, trader, direction: 'long',
})

beforeEach(() => { seen.length = 0 })

describe('PlaybookCharts', () => {
  it('renders nothing when the playbook has no chartable calls', () => {
    const { container } = render(<PlaybookCharts winners={[]} failures={[{ call_id: 't1#0', ticker: '' }]} />)
    expect(container.innerHTML).toBe('')
  })

  it('stays closed until asked, so opening a playbook fetches no bars', () => {
    render(<PlaybookCharts winners={[call('t1#0', 'ZZAA', '2025-01-02', 0.2)]} failures={[call('t2#0', 'ZZBB', '2025-02-03', -0.1)]} />)
    expect(screen.getByRole('button', { name: 'Show the charts (2)' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('pb-chart')).toBeNull()
    expect(seen).toEqual([])
  })

  it('opens one framed chart per call, labelled best or failure, with the posted bar highlighted', async () => {
    render(<PlaybookCharts winners={[call('t1#0', 'ZZAA', '2025-01-02', 0.2)]} failures={[call('t2#0', 'ZZBB', '2025-02-03T15:00:00', -0.1, 'Bracco')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the charts (2)' }))
    const cards = screen.getAllByTestId('pb-chart')
    expect(cards.map((c) => c.dataset.side)).toEqual(['best', 'failure'])
    expect(cards[0].textContent).toContain('Best call')
    expect(cards[1].textContent).toContain('Failure')
    expect(cards[1].textContent).toContain('Bracco')
    expect(cards[1].textContent).toContain('2025-02-03')
    await screen.findAllByTestId('stock-chart')
    const byTicker = Object.fromEntries(seen.map((p) => [p.sym, p]))
    expect(byTicker.ZZAA).toMatchObject({ tf: 'D', liveUpdates: false, backgroundWarm: false, exactDateRange: true,
      entryDate: '2024-09-04', exitDate: '2025-02-16', highlightBarTime: '2025-01-02' })
    expect(byTicker.ZZBB.highlightBarTime).toBe('2025-02-03')
    expect(byTicker.ZZAA.priceLines).toBeUndefined()   // the playbook's examples carry no levels
    fireEvent.click(screen.getByRole('button', { name: 'Hide the charts' }))
    expect(screen.queryByTestId('pb-chart')).toBeNull()
  })

  it(`caps each side at ${CHARTS_PER_SIDE}`, () => {
    const many = Array.from({ length: 6 }, (_, i) => call(`t${i}#0`, `ZZ${i}`, '2025-01-02', 0.1))
    render(<PlaybookCharts winners={many} failures={many.map((c) => ({ ...c, call_id: `f${c.call_id}` }))} />)
    fireEvent.click(screen.getByRole('button', { name: `Show the charts (${CHARTS_PER_SIDE * 2})` }))
    expect(screen.getAllByTestId('pb-chart')).toHaveLength(CHARTS_PER_SIDE * 2)
  })

  it('draws the server reference lines on each call chart, with the team labels', async () => {
    const lines = {
      't1#0': [
        { role: 'entry', kind: 'ema_10', price: 41.2, label: '10 EMA · team entry line' },
        { role: 'entry', kind: 'prior_day_low', price: 39.5, label: 'Prior-day low · team entry line' },
        { role: 'stop', kind: 'prior_day_low', price: 39.5, label: 'Prior-day low · team stop line' },
        { role: 'stop', kind: 'ema_20', price: 38.1, label: '20 EMA · team stop line' },
      ],
      't2#0': [{ role: 'trigger', kind: 'stated_entry', price: 12.5, label: 'Stated entry in this call (2025-02-03)' }],
    }
    render(<PlaybookCharts winners={[call('t1#0', 'ZZAA', '2025-01-02', 0.2)]}
      failures={[call('t2#0', 'ZZBB', '2025-02-03', -0.1)]} lines={lines} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the charts (2)' }))
    await screen.findAllByTestId('stock-chart')
    const byTicker = Object.fromEntries(seen.map((p) => [p.sym, p]))
    expect(byTicker.ZZAA.priceLines.map((l) => [l.price, l.title])).toEqual([
      [41.2, '10 EMA · team entry line'],
      [39.5, 'Prior-day low · team entry line / Prior-day low · team stop line'],   // one line, both roles
      [38.1, '20 EMA · team stop line'],
    ])
    expect(byTicker.ZZBB.priceLines).toEqual([expect.objectContaining({ price: 12.5,
      title: 'Stated entry in this call (2025-02-03)' })])
    expect(screen.getAllByTestId('pb-ref-note')[0].textContent).toContain('where the team usually places')
  })

  it('draws no lines when the field is absent or a call has none', async () => {
    render(<PlaybookCharts winners={[call('t1#0', 'ZZAA', '2025-01-02', 0.2)]} failures={[]} lines={{ 'tX#0': [] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the charts (1)' }))
    await screen.findAllByTestId('stock-chart')
    expect(seen[0].priceLines).toBeUndefined()
    expect(screen.queryByTestId('pb-ref-note')).toBeNull()
  })

  it('never frames past today, and refuses a date it cannot read', () => {
    expect(chartFrame('2026-10-10', '2026-10-16')).toEqual({ day: '2026-10-10', start: '2026-06-12', end: '2026-10-16' })
    expect(chartFrame('2025-01-02', '2026-10-16').end).toBe('2025-02-16')
    expect(chartFrame('not a date', '2026-10-16')).toBeNull()
  })
})

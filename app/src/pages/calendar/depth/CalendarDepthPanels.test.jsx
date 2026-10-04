import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DateStatusStrip from './DateStatusStrip'
import IndexEventsBand from './IndexEventsBand'
import OrderExplain from './OrderExplain'
import { boostParts, impEff } from '../importance'

const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)
const answer = (status, body) => { globalThis.fetch = vi.fn(() => Promise.resolve({ ok: status < 400, status, json: async () => body })) }

beforeEach(() => { answer(200, {}) })

describe('D-1/D-2 DateStatusStrip', () => {
  it('an unreadable store says so, never "nothing recorded"', async () => {
    answer(503, { detail: 'down' })
    wrap(<DateStatusStrip syms={['AAA']} />)
    expect(await screen.findByTestId('date-status-unavailable')).toHaveTextContent('could not be read')
    expect(screen.queryByTestId('date-status-row')).toBeNull()
  })

  it('a move names whether an estimate was revised or a confirmed date changed', async () => {
    answer(200, {
      symbols: {
        AAA: { report_date: '2026-11-12', status: 'estimated', basis: 'fmp', status_at: null, first_confirmed_at: null,
          moved: { from: '2026-11-05', to: '2026-11-12', kind: 'confirmed_date_changed' } },
      },
      unknown: [], company_signaled: { state: 'unavailable', reason: 'r' }, timestamps_are: 't',
    })
    wrap(<DateStatusStrip syms={['AAA']} />)
    expect(await screen.findByTestId('date-status-row')).toHaveTextContent('2026-11-05 → 2026-11-12 · confirmed date changed')
  })
})

describe('D-3 IndexEventsBand', () => {
  it('a rule date on a holiday carries the warning, and a this-week row is shown as this week', async () => {
    answer(200, {
      events: [{ date: '2026-03-20', index: 'S&P 500', event: 'Quarterly rebalance', rule: 'r', notice: 'n', citation: 'c',
        calendar_check: 'holiday', calendar_note: 'The rule date is an exchange holiday; the real date will differ.' }],
      not_covered: [],
    })
    wrap(<IndexEventsBand weekStart="2026-03-16" weekEnd="2026-03-20" />)
    const row = await screen.findByTestId('index-event-row')
    expect(row).toHaveTextContent('real date will differ')
    expect(row).toHaveTextContent('not an announced date')
    expect(screen.getByTestId('index-events-this-week')).toBeTruthy()
  })
})

describe('D-10 OrderExplain', () => {
  const BUCKETS = [{ sources: ['watchlist', 'flagged'], weight: 2 }, { sources: ['positions'], weight: 3 }]

  it('the itemised boost IS the boost the ranking adds', () => {
    const e = { sym: 'X', _sources: ['watchlist', 'flagged', 'positions'] }
    const b = boostParts(e, BUCKETS)
    expect(b.total).toBe(5)                              // a bucket counts once, however many of its names match
    expect(impEff(1.5, e, BUCKETS)).toBe(1.5 + b.total)
    expect(boostParts({ sym: 'Y' }, BUCKETS)).toEqual({ total: 0, parts: [] })
  })

  it('lists who moved and why; the switch reports its new state', () => {
    const onOff = vi.fn()
    render(<OrderExplain entries={[{ sym: 'A', _sources: [] }, { sym: 'B', _sources: ['positions'] }]}
      weightBuckets={BUCKETS} boostOff={false} onBoostOff={onOff} />)
    const rows = screen.getAllByTestId('order-explain-boosted-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('B +3: your positions +3')
    fireEvent.click(screen.getByTestId('order-explain-toggle'))
    expect(onOff).toHaveBeenCalledWith(true)
  })

  it('with no registry loaded it says no boost is applied, rather than listing nothing silently', () => {
    render(<OrderExplain entries={[{ sym: 'B', _sources: ['positions'] }]} weightBuckets={undefined}
      boostOff={false} onBoostOff={() => {}} />)
    expect(screen.getByTestId('order-explain-no-registry')).toBeTruthy()
  })
})

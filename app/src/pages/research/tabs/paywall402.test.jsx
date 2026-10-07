// tq-panels: TECH, TRAN, MB and DR keep their own {ok, httpStatus, body} fetchers, so
// sectionFetcher's `{paywalled: true}` for a 402 never reached them and the paid gate read
// "Couldn't load ...". Each now says it requires a paid plan. Asserted on rendered text,
// through the REAL hooks (only useMobileSWR is stood in for, answering 402 to every key).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../hooks/useMobileSWR', () => ({
  default: () => ({ data: { ok: false, httpStatus: 402, body: null }, isLoading: false, mutate: () => {} }),
}))
vi.mock('../../../components/StockChart', () => ({ default: () => <div>stock-chart</div> }))
vi.mock('../../../components/calendar/SentimentGauge', () => ({ default: () => null }))
vi.mock('../../../components/calendar/TranscriptPanel', () => ({ default: () => null }))
vi.mock('../hooks/useEarningsAudio', () => ({ default: () => ({ data: null }) }))

import TechnicalTab from './TechnicalTab'
import CallsTab from './CallsTab'
import ModelBookTab from './ModelBookTab'
import DecisionRecordTab from './DecisionRecordTab'
import NewsTab from './NewsTab'
import AnalystRatingsTab from './AnalystRatingsTab'
import OwnershipTab from './OwnershipTab'
import RatingsTab from './RatingsTab'

const wrap = (el) => render(<MemoryRouter>{el}</MemoryRouter>)

describe('a 402 is the paid gate, never "couldn’t load"', () => {
  it('TECH', () => {
    wrap(<TechnicalTab sym="NVDA" />)
    expect(screen.getByTestId('technical-paywalled').textContent).toBe('Technical setups require a paid plan.')
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
    expect(screen.queryByTestId('technical-empty-state')).toBeNull()
  })

  it('TRAN', () => {
    wrap(<CallsTab sym="NVDA" />)
    expect(screen.getByTestId('call-recap-paywalled').textContent).toBe('The earnings call recap requires a paid plan.')
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })

  it('MB', () => {
    wrap(<ModelBookTab sym="NVDA" />)
    expect(screen.getByTestId('modelbook-appearances-paywalled').textContent).toBe('Model Book history requires a paid plan.')
    expect(screen.queryByText(/Couldn't load/)).toBeNull()
  })

  it('DR', () => {
    wrap(<DecisionRecordTab sym="NVDA" />)
    expect(screen.getByTestId('decision-record-paywalled').textContent).toBe('The decision record requires a paid plan.')
    expect(screen.queryByText(/unavailable/i)).toBeNull()
  })

  // 2026-10-07 completeness audit: CN, ANR, OWN and RTG kept their own {ok, httpStatus} fetchers
  // too, and the backend 402s all four (api/open_reads_gate.py) -- a free member read
  // "Couldn't load ..." with a Retry that could never work.
  for (const [code, El, id, text] of [
    ['CN', NewsTab, 'news-paywalled', 'Company news requires a paid plan.'],
    ['ANR', AnalystRatingsTab, 'analyst-ratings-paywalled', 'Analyst ratings require a paid plan.'],
    ['OWN', OwnershipTab, 'ownership-paywalled', 'Ownership requires a paid plan.'],
    ['RTG', RatingsTab, 'ratings-paywalled', 'The UCT rating requires a paid plan.'],
  ]) {
    it(code, () => {
      wrap(<El sym="NVDA" />)
      expect(screen.getByTestId(id).textContent).toBe(text)
      expect(screen.queryByText(/Couldn't load/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    })
  }
})

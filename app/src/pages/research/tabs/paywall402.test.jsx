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
})

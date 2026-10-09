// Audit wave 2 (lane A, P2 #9/#22): CATS, CN and ANR name their source and as-of time in the
// terminal panel header, as CF and EEH already do. Asserted on what reaches the header setter.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { PanelFreshnessContext } from '../../../components/terminal/terminalPanel'

let cats, news, anr
vi.mock('../hooks/useCatalystHistory', () => ({ default: () => cats }))
vi.mock('../hooks/useCompanyNews', () => ({ default: () => news }))
vi.mock('../hooks/useAnalystRatings', () => ({ default: () => anr }))
vi.mock('./AnalystRevisions', () => ({ default: () => null }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../components/provenance/AbsenceReceipt', () => ({ default: () => null }))
import CatalystsTab from './CatalystsTab'
import NewsTab from './NewsTab'
import AnalystRatingsTab from './AnalystRatingsTab'

afterEach(cleanup)

const inHeader = (el) => {
  const reports = []
  render(<PanelFreshnessContext.Provider value={(f) => { if (f) reports.push(f) }}>{el}</PanelFreshnessContext.Provider>)
  return reports[reports.length - 1]
}
const T = Date.UTC(2026, 9, 8, 20, 20) / 1000   // 4:20 PM ET

describe('panel header source + as-of', () => {
  it('CATS: UCT Catalyst Engine, through the newest entry', () => {
    cats = { data: { entries: [{ market_date: '2026-09-30', tag: 'News' }, { market_date: '2026-10-07', tag: 'Earnings' }] }, isLoading: false }
    const r = inHeader(<CatalystsTab sym="NVDA" />)
    expect(r.source).toBe('UCT Catalyst Engine')
    expect(r.age.asOfDate).toBe('2026-10-07')
  })

  it('CATS empty state says why most tickers have no entry', () => {
    cats = { data: { entries: [] }, isLoading: false }
    render(<CatalystsTab sym="zzzz" />)
    expect(screen.getByTestId('catalyst-history-empty').textContent).toMatch(/curated daily catalyst list/)
  })

  it('CN: FMP news, read time in ET', () => {
    news = { data: { items: [], _meta: { sourceObservedAt: T } }, isLoading: false }
    const r = inHeader(<NewsTab sym="NVDA" />)
    expect(r.source).toMatch(/FMP company news/)
    expect(r.age.asOfDate).toMatch(/Oct 8.*4:20.*PM ET/)
  })

  it('ANR: FMP ratings, the newest of the three legs', () => {
    anr = { data: { consensus: { _meta: { sourceObservedAt: T - 3600 } }, price_target: { _meta: { sourceObservedAt: T } }, recent_actions: { items: [], _meta: { sourceObservedAt: T - 7200 } } }, isLoading: false }
    const r = inHeader(<AnalystRatingsTab sym="NVDA" />)
    expect(r.source).toMatch(/FMP analyst ratings/)
    expect(r.age.asOfDate).toMatch(/Oct 8.*4:20.*PM ET/)
  })
})

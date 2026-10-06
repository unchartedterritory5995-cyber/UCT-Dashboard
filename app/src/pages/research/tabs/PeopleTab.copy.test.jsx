// Live sweep 2026-10-05: SPY PPL read "Unavailable: FMP returned no rows for this symbol.
// (FMP /stable/key-executives)". A vendor holding nothing is said plainly; the endpoint path
// is never member copy; a pending Form 4 read re-asks by itself and says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import PeopleTab from './PeopleTab'
import { PENDING_REASK_MS } from '../depth/depthFetch'

let body
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })
const wrap = (el) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig>)

const FUND = {
  ticker: 'SPY',
  executives: { state: 'not_found', source: 'FMP /stable/key-executives', rows: null, reason: 'FMP returned no rows for this symbol' },
  compensation: { state: 'not_found', source: 'FMP /stable/governance-executive-compensation (proxy summary compensation table)', rows: null, reason: 'FMP returned no rows for this symbol' },
  insider_roles: { state: 'not_found', source: 'SEC EDGAR Form 4', window_days: 180, rows: null, reason: 'no SEC filer could be matched to this symbol' },
}

describe('PeopleTab member copy', () => {
  it('a fund with no officer or proxy records says so plainly, with no endpoint path', async () => {
    body = FUND
    wrap(<PeopleTab sym="spy" />)
    expect((await screen.findByTestId('people-execs-unavailable')).textContent).toBe('No officer records for SPY.')
    expect(screen.getByTestId('people-comp-unavailable').textContent).toBe('No proxy compensation records for SPY.')
    expect(screen.getByTestId('people-roles-gap').textContent).toBe('No SEC filer could be matched to SPY.')
    expect(document.body.textContent).not.toMatch(/\/stable\/|returned no rows/)
  })

  it('a failed section read is a gap, not a finding', async () => {
    body = { ...FUND, executives: { state: 'unavailable', source: 'FMP /stable/key-executives', rows: null, reason: 'FMP refused this endpoint recently (cooldown)' } }
    wrap(<PeopleTab sym="nvda" />)
    expect((await screen.findByTestId('people-execs-unavailable')).textContent).toMatch(/Officer records could not be read right now.*not a finding about NVDA/)
  })

  it('the source line names the vendor, not the endpoint', async () => {
    body = { ...FUND, executives: { state: 'ok', source: 'FMP /stable/key-executives', as_of: '2026-10-02', rows: [{ name: 'A B', title: 'CEO', since: '2020', pay: 1e6, comp_total: null, insider_role: 'CEO' }] } }
    wrap(<PeopleTab sym="nvda" />)
    expect((await screen.findByTestId('people-execs-source')).textContent).toMatch(/^Source: FMP, read 2026-10-02\./)
  })

  it('a pending Form 4 read says it is reading and asks again by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    body = { ...FUND, insider_roles: { state: 'pending', source: 'SEC EDGAR Form 4', window_days: 180, rows: null, reason: 'the Form 4 read is queued; it appears on a later visit' } }
    wrap(<PeopleTab sym="nvda" />)
    const gap = (await screen.findByTestId('people-roles-gap')).textContent
    expect(gap).toMatch(/updates by itself/)
    expect(gap).not.toMatch(/later visit/)
    const before = fetch.mock.calls.length
    body = { ...FUND, insider_roles: { state: 'ok', source: 'SEC EDGAR Form 4', since: '2026-04-01', window_days: 180, rows: [{ name: 'Jane Doe', role: 'Director', filing_date: '2026-09-01', accession: '0001', cik: '1' }] } }
    await act(async () => { await vi.advanceTimersByTimeAsync(PENDING_REASK_MS + 50) })
    expect(fetch.mock.calls.length).toBeGreaterThan(before)
    expect(await screen.findByText('Jane Doe')).toBeInTheDocument()
  })
})

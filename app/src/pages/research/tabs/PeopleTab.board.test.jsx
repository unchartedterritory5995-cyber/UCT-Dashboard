// COV-05 / FT-076 (dark server flag RESEARCH_PEOPLE_BOARD_ENABLED): directors seen on Form 4
// plus a proxy-statement link for biographies. Asserts RENDERED TEXT. No `board` key, no section.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import PeopleTab from './PeopleTab'

let body
beforeEach(() => {
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })
const wrap = (el) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig>)

const PROXY = 'https://www.sec.gov/Archives/edgar/data/320193/000130817926000008/aapl014016-def14a.htm'
const BASE = {
  ticker: 'AAPL',
  executives: { state: 'ok', source: 'FMP /stable/key-executives', as_of: '2026-10-10', rows: [{ name: 'Timothy D. Cook', title: 'CEO' }] },
  compensation: { state: 'not_found', source: 'FMP', rows: null },
  insider_roles: { state: 'ok', source: 'SEC EDGAR Form 4', window_days: 180, since: '2026-04-13', rows: [] },
}
const BOARD = {
  state: 'ok', source: 'SEC EDGAR Form 4 (reporting owners who declare a director role)', window_days: 180,
  scope: 'directors who filed a Form 4 in the last 180 days; a director who filed none is not listed',
  rows: [{ name: 'LEVINSON ARTHUR D', role: 'Director', filing_date: '2026-05-08', accession: '0001140361-26-020298',
    url: 'https://www.sec.gov/Archives/edgar/data/320193/000114036126020298/0001140361-26-020298-index.htm' }],
  bios: { state: 'ok', source: 'SEC EDGAR DEF 14A (definitive proxy statement)', form: 'DEF 14A',
    filing_date: '2026-01-08', accession: '0001308179-26-000008', url: PROXY },
}

describe('PeopleTab board and biographies', () => {
  it('no board key (flag off): no section', async () => {
    body = BASE
    wrap(<PeopleTab sym="aapl" />)
    await screen.findByTestId('people-execs')
    expect(screen.queryByText('Board and biographies')).toBeNull()
    expect(screen.queryByTestId('people-bios')).toBeNull()
  })

  it('lists directors with their Form 4 and links the proxy for biographies', async () => {
    body = { ...BASE, board: BOARD }
    wrap(<PeopleTab sym="aapl" />)
    const table = await screen.findByTestId('people-board')
    expect(table.textContent).toContain('LEVINSON ARTHUR D')
    expect(screen.getByTestId('people-board-source').textContent).toContain('a director who filed none is not listed')
    const bios = screen.getByTestId('people-bios')
    expect(bios.textContent).toContain('Director and officer biographies: proxy statement filed 2026-01-08')
    expect(bios.querySelector('a').getAttribute('href')).toBe(PROXY)
    expect(screen.getByText('Board and biographies').parentElement.textContent).not.toMatch(/—/)
  })

  it('no director in the window and no proxy are said plainly', async () => {
    body = { ...BASE, board: { ...BOARD, state: 'none_in_window', rows: null,
      bios: { state: 'not_found', source: BOARD.bios.source } } }
    wrap(<PeopleTab sym="aapl" />)
    expect((await screen.findByTestId('people-board-gap')).textContent).toBe('No Form 4 filed for AAPL in the last 180 days declared a director.')
    expect(screen.getByTestId('people-bios').textContent).toBe('Biographies: AAPL has no proxy statement in its recent SEC filings.')
  })

  it('an unread EDGAR is a gap, not a finding', async () => {
    body = { ...BASE, board: { state: 'unavailable', source: BOARD.source, rows: null, reason: 'the Form 4 read is queued',
      bios: { state: 'pending', source: BOARD.bios.source, reason: 'the Form 4 read is queued' } } }
    wrap(<PeopleTab sym="aapl" />)
    expect((await screen.findByTestId('people-board-gap')).textContent).toMatch(/Directors: unavailable right now.*not a finding about AAPL/)
    expect(screen.getByTestId('people-bios').textContent).toMatch(/^Biographies: unavailable right now/)
  })
})

// 2026-10-10 owner: breadth search by keywords and without the colon.
import { describe, it, expect } from 'vitest'
import { matchQ, canonicalTicker } from './symbolSearchModel'

const NA50 = { ticker: 'NASDAQ:A50', display_ticker: null, name: 'Nasdaq · % of Stocks Above 50-Day MA', group_label: 'MA' }
const NY50 = { ticker: 'NYSE:A50', display_ticker: null, name: 'NYSE · % of Stocks Above 50-Day MA', group_label: 'MA' }
const USNA = { ticker: 'US:NA', display_ticker: null, name: 'US · Net Advances', group_label: 'Mom' }
const UCT50 = { ticker: 'UCTA50', display_ticker: 'UCT :A50', name: '% of Stocks Above 50-Day MA', group_label: 'MA' }
const ROWS = [NA50, NY50, USNA, UCT50]

describe('breadth keyword search', () => {
  it('NASDAQ %, NASDAQ%, % of nasdaq stocks find the Nasdaq % series only', () => {
    for (const q of ['NASDAQ %', 'nasdaq%', '% of nasdaq stocks']) {
      expect(ROWS.filter((r) => matchQ(r, q)).map((r) => r.ticker), q).toEqual(['NASDAQ:A50'])
    }
  })
  it('UCT % finds UCT rows; NASDAQA50 finds NASDAQ:A50', () => {
    expect(ROWS.filter((r) => matchQ(r, 'UCT %')).map((r) => r.ticker)).toEqual(['UCTA50'])
    expect(ROWS.filter((r) => matchQ(r, 'NASDAQA50')).map((r) => r.ticker)).toEqual(['NASDAQ:A50'])
  })
})

describe('canonicalTicker without the colon', () => {
  it('maps NASDAQA50 / NASDAQ A50 / NYSE;A50 / UCT:A50 to their canonical ids', () => {
    expect(canonicalTicker('NASDAQA50', ROWS)).toBe('NASDAQ:A50')
    expect(canonicalTicker('nasdaq a50', ROWS)).toBe('NASDAQ:A50')
    expect(canonicalTicker('NYSE;A50', ROWS)).toBe('NYSE:A50')
    expect(canonicalTicker('UCT:A50', ROWS)).toBe('UCTA50')
    expect(canonicalTicker('US A50', ROWS)).toBe('US A50')       // no such row: unchanged
  })
  it('never re-maps a plain stock spelling (USNA is USANA, not US:NA)', () => {
    expect(canonicalTicker('USNA', ROWS)).toBe('USNA')
    expect(canonicalTicker('AAPL', ROWS)).toBe('AAPL')
  })
})

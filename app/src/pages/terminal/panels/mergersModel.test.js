// MNA's pure half (mergersModel.js). Every symbol, name, date and link is invented.
import { describe, it, expect } from 'vitest'
import {
  MNA_COMPUTING_POLL_MS, MNA_HELD_POLL_MS, dealDayWords, mnaCountLine, mnaNoteWords, mnaPollMs, mnaRead, mnaUrl, searchWords, unavailableWords,
} from './mergersModel'

const LINK = 'https://www.sec.gov/Archives/edgar/data/1/made-up.htm'
const deal = (date, acq, target, over = {}) => ({ date, accepted_at: `${date} 16:20:38`, acquirer: { sym: acq, name: `${acq} Works`, cik: '1', covered: true },
  target: target ? { sym: null, name: target, cik: null, covered: false } : null, link: LINK, ...over })
const LATEST = (over = {}) => ({ status: 'ok', scope: 'latest', read_at: '2031-03-12T14:02:00+00:00', source: 'Financial Modeling Prep', check: null,
  pages_read: 1, cut: false, dropped: 0, deals: [deal('2031-03-01', 'QQZB', 'Fernhollow'), deal('2031-03-12', 'QQZA', 'Tinmoor')], ...over })

describe('the read', () => {
  it('urls and pace', () => {
    expect(mnaUrl(null)).toBe('/api/research/mergers')
    expect(mnaUrl('BRK.B')).toBe('/api/research/mergers?sym=BRK.B')
    expect(mnaPollMs({ status: 'computing' })).toBe(MNA_COMPUTING_POLL_MS)
    expect(mnaPollMs({ status: 'ok' })).toBe(MNA_HELD_POLL_MS)
  })

  it('every non-answer is its own state, never an empty list', () => {
    for (const body of [null, [], 'x', { status: 'ok' }, { status: 'odd', deals: [] }]) expect(mnaRead(body).state, JSON.stringify(body)).toBe('failed')
    expect(mnaRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(mnaRead({ status: 'unavailable', reason: 'not_in_plan' })).toEqual({ state: 'unavailable', reason: 'not_in_plan' })
    expect(mnaRead({ status: 'failed', reason: 'source' })).toEqual({ state: 'source', reason: 'source' })
  })

  it('deals newest first; a deal with no day or no acquirer symbol is dropped and counted; a non-sec.gov link is not kept', () => {
    const v = mnaRead(LATEST({ dropped: 2, deals: [...LATEST().deals, deal('soon', 'QQZC', 'X'), deal('2031-03-02', '', 'Y'),
      deal('2031-03-05', 'QQZD', null, { link: 'javascript:alert(1)' })] }))
    expect(v.state).toBe('ok')
    expect(v.deals.map((d) => d.acquirer.sym)).toEqual(['QQZA', 'QQZD', 'QQZB'])
    expect(v.dropped).toBe(4)
    expect(v.deals[1].link).toBeNull()
    expect(v.deals[1].target).toBeNull()
    expect(v.symbols).toEqual(['QQZA', 'QQZD', 'QQZB'])
  })

  it('an answered, empty list is none', () => {
    expect(mnaRead(LATEST({ deals: [] })).state).toBe('none')
  })
})

describe('words', () => {
  it('the count line for the market and for one company', () => {
    expect(mnaCountLine(mnaRead(LATEST()))).toBe('The latest 2 deals, newest first, filed Mar 1, 2031 to Mar 12, 2031.')
    expect(mnaCountLine(mnaRead(LATEST({ deals: [] })))).toBe('No deal is listed in the latest filings.')
    const company = mnaRead(LATEST({ scope: 'company', sym: 'QQZA', name: 'Quillfeather Mills, Inc.', search: 'ok' }))
    expect(mnaCountLine(company)).toBe('2 deals naming QQZA (Quillfeather Mills, Inc.), newest first.')
    expect(mnaCountLine(mnaRead(LATEST({ scope: 'company', sym: 'QQZA', name: null, deals: [] })))).toBe('No deal naming QQZA is listed.')
    expect(dealDayWords('2031-03-12')).toBe('Mar 12, 2031')
    expect(dealDayWords(null)).toBe('Day not given')
  })

  it('what the company search did, and what it left out', () => {
    const c = (over) => mnaRead(LATEST({ scope: 'company', sym: 'QQZA', ...over }))
    expect(searchWords(c({ search: 'no_name' }))).toBe('The server holds no company name for QQZA, so only the latest filings were looked through, by symbol.')
    expect(searchWords(c({ search: 'failed' }))).toContain('That is not the same as no other deals.')
    expect(searchWords(c({ search: 'not_in_plan' }))).toContain('not available from our data provider')
    expect(searchWords(c({ search: 'ok', other_companies: 3 }))).toBe('3 more deals matched the name search but name a different company; they are not shown.')
    expect(searchWords(c({ search: 'ok', other_companies: 1 }))).toBe('1 more deal matched the name search but names a different company; it is not shown.')
    expect(searchWords(mnaRead(LATEST()))).toBe('')
  })

  it('a cut list and dropped rows; a refusal and a switch-off', () => {
    expect(mnaNoteWords(mnaRead(LATEST({ cut: true, dropped: 1 })))).toBe('The feed holds older deals than these. 1 row in the answer had no day or no acquirer symbol and is not shown.')
    expect(mnaNoteWords(mnaRead(LATEST()))).toBe('')
    expect(unavailableWords('not_in_plan')).toBe('Mergers and acquisitions are not available from our data provider.')
    expect(unavailableWords('not_configured')).toBe('Mergers and acquisitions are not switched on for this server yet.')
  })
})

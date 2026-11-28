// INS SELLS / INS BOTH / INS 30D: the pure half (insiderMarketModel.js).
import { describe, it, expect } from 'vitest'
import {
  INSIDER_URL, INS_SIDE_ARG_WORDS, INS_WINDOW_ARG_WORDS, insCommandArgs, insCutNotes, insWhat, insiderRead, insiderUrl,
  normInsSide, normInsWindow, parseInsSide, parseInsWindow, sideWord,
} from './insiderMarketModel'

const BUY = { symbol: 'NVDA', name: 'Jane Doe', title: 'director', type: 'buy', shares: 10, price: 5, amount: 50, date: '2026-11-20', filing_date: '2026-11-21' }
const SELL = { symbol: 'AMD', name: 'John Roe', title: 'officer: CFO', type: 'sell', shares: 100, price: 50, amount: 5000, date: '2026-11-22', filing_date: '2026-11-24' }

describe('the words and what a pick writes back', () => {
  it('parses each word a member types, and nothing else', () => {
    for (const [w, v] of Object.entries(INS_SIDE_ARG_WORDS)) expect(parseInsSide(w.toLowerCase()), w).toBe(v)
    for (const [w, v] of Object.entries(INS_WINDOW_ARG_WORDS)) expect(parseInsWindow(w), w).toBe(v)
    for (const no of ['', 'toString', 'constructor', 'SHORT', '14D', null]) {
      expect(parseInsSide(no), String(no)).toBeNull()
      expect(parseInsWindow(no), String(no)).toBeNull()
    }
    expect(normInsSide(undefined)).toBe('buys')
    expect(normInsSide('sells')).toBe('sells')
    expect(normInsWindow(undefined)).toBe(7)
    expect(normInsWindow(90)).toBe(90)
    expect(normInsWindow('30D')).toBe(30)
  })

  it('the defaults write nothing; every other pick writes its tokens, side first', () => {
    expect(insCommandArgs({})).toEqual([])
    expect(insCommandArgs({ side: 'buys', window: 7 })).toEqual([])
    expect(insCommandArgs({ side: 'sells' })).toEqual(['SELLS'])
    expect(insCommandArgs({ window: 30 })).toEqual(['30D'])
    expect(insCommandArgs({ side: 'both', window: 90 })).toEqual(['BOTH', '90D'])
  })

  it('the default reads the list route it always read; anything else the held route', () => {
    expect(insiderUrl({})).toBe(INSIDER_URL)
    expect(insiderUrl({ side: 'buys', window: 7 })).toBe('/api/insider/feed?scope=market')
    expect(insiderUrl({ side: 'sells' })).toBe('/api/insider/feed?scope=market&side=sells&days=7')
    expect(insiderUrl({ window: 90 })).toBe('/api/insider/feed?scope=market&side=buys&days=90')
  })
})

describe('the read', () => {
  it('the default list keeps only buys, as before', () => {
    const r = insiderRead([BUY, SELL, { name: 'nobody' }])
    expect(r.state).toBe('ok')
    expect(r.rows.map((x) => [x.sym, x.type])).toEqual([['NVDA', 'buy']])
  })

  it('the held answer: a side keeps its own trades, both keeps both, in the server order', () => {
    const body = { status: 'ok', rows: [SELL, BUY], built_at: 1700000000, matched: 2, cap: 50, cut: false, sides: {} }
    expect(insiderRead(body, { side: 'sells' }).rows.map((x) => x.sym)).toEqual(['AMD'])
    expect(insiderRead(body, { side: 'both' }).rows.map((x) => [x.sym, x.type])).toEqual([['AMD', 'sell'], ['NVDA', 'buy']])
    expect(insiderRead(body, { side: 'both' }).meta).toMatchObject({ builtAt: 1700000000, matched: 2, cut: false })
    expect(sideWord('sell')).toBe('Sold')
    expect(sideWord('buy')).toBe('Bought')
  })

  it('computing and failed are states, never an empty list', () => {
    expect(insiderRead({ status: 'computing', rows: null }, { side: 'sells' })).toMatchObject({ state: 'computing', rows: [] })
    expect(insiderRead({ status: 'failed', rows: null, reason: 'x' }, { side: 'sells' })).toMatchObject({ state: 'failed', rows: [] })
  })

  it('a missing number stays missing, never 0', () => {
    const row = insiderRead([{ ...BUY, price: null, amount: '' }]).rows[0]
    expect(row.price).toBeNull()
    expect(row.amount).toBeNull()
  })
})

describe('what it says', () => {
  it('names the side and the window', () => {
    expect(insWhat('sells', 30)).toBe('insider sales in the last 30 days')
    expect(insWhat(undefined, undefined)).toBe('insider purchases in the last 7 days')
  })

  it('says a cut list from its largest end, and a side that did not reach the window', () => {
    const notes = insCutNotes({
      cut: true, matched: 1234, cap: 50,
      sides: { sells: { reached_window: false, covered_from: '2026-11-02', max_pages: 150, complete: true },
        buys: { reached_window: true, complete: false } },
    })
    expect(notes).toEqual([
      'Showing the 50 largest of 1,234 by dollar value.',
      'Sales filed since 2026-11-02 only: the read stops after 150 pages of filings.',
      "Purchases: part of the vendor's feed could not be read on the last build.",
    ])
    expect(insCutNotes({})).toEqual([])
  })
})

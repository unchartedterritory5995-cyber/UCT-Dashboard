// agent-qa — HELD-OUT quote/price phrasings (Sprint 2 RC item 7), through BOTH deterministic matchers, served.
// Written by agent-qa WITHOUT reading marketDataPhrases.js (__fixtures__/program/scores/quote-heldout.json).
//   PASS       the expected action + symbols, or an accepted alternative ("either"), or null where null is required
//   SAFE-MISS  null where a match was expected (it goes to the model: costs a call, never wrong)
//   FAIL       a wrong symbol, a wrong action, both matchers claiming it, or ANY answer where null is required
// The owner's bar: a wrong quote or a wrong symbol is a FAIL; ambiguity must ask or go to the model.
// TODAY'S FAILS ARE PINNED BY ID (strict): a matcher fix moves them to PASS and this file must be updated with it.
import { describe, it, expect, vi } from 'vitest'
import set from '../__fixtures__/program/scores/quote-heldout.json'
vi.mock('../agentClient', async (o) => ({ ...(await o()), serverServesData: () => true, serverDataKinds: () => ['quote', 'quotes', 'bars.daily'] }))
import { match as quoteMatch } from '../capabilities/marketDataQuote'
import { match as barsMatch } from '../capabilities/marketDataBars'

const norm = (m) => (!m ? null : m.action === 'stock.quote' ? { action: m.action, symbols: m.params.symbols }
  : { action: m.action, symbol: m.params.symbol, measure: m.params.measure, ...(m.params.measure === 'change' ? { sessions: m.params.sessions } : {}) })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
function classify(r) {
  const q = quoteMatch(r.text), b = barsMatch(r.text)
  const got = norm(q || b)
  if (q && b) return { cls: 'fail', got, why: 'both matchers claim it' }
  if (same(got, r.expect) || (r.either || []).some(e => same(got, e))) return { cls: 'pass', got }
  if (got === null && r.expect !== null) return { cls: 'safe_miss', got }
  return { cls: 'fail', got }
}
const RESULTS = Object.fromEntries(set.rows.map(r => [r.id, classify(r)]))
const ids = (c) => Object.keys(RESULTS).filter(k => RESULTS[k].cls === c).sort()

// measured on agent/int 608ad6adae (Sprint 2 RC): 35 pass · 2 safe-miss · 7 FAIL of 44
const PINNED_FAIL = ['H19', 'H26', 'H28', 'H29', 'H30', 'H37', 'H40']
const PINNED_SAFE_MISS = ['H06', 'H35']

describe('agent-qa held-out quote phrasings', () => {
  it('non-vacuity: 44 rows, and the matchers DO claim ordinary price questions', () => {
    expect(set.rows).toHaveLength(44)
    expect(ids('pass').length).toBeGreaterThanOrEqual(30)
  })
  it('OPEN (strict pin): today\'s confident misreads at 0 model calls — wrong instrument or symbol', () => {
    // H26 "btc price" -> BTC (an ETF, not bitcoin) · H28 "price of gold" -> GOLD (Barrick) · H37 "s&p" -> S, P
    // H29 "apple and microsoft" -> APPLE (drops MSFT) · H30 "nvdia" -> NVDIA · H19 "price history" -> today's quote
    // H40 "close on friday" -> the latest close whatever day it is. Owner: agent-md (marketDataPhrases.js).
    expect(ids('fail')).toEqual(PINNED_FAIL)
    expect(RESULTS.H26.got).toEqual({ action: 'stock.quote', symbols: ['BTC'] })
    expect(RESULTS.H28.got).toEqual({ action: 'stock.quote', symbols: ['GOLD'] })
  })
  it('safe misses are pinned too (each costs a model call, never a wrong answer)', () => {
    expect(ids('safe_miss')).toEqual(PINNED_SAFE_MISS)
  })
})

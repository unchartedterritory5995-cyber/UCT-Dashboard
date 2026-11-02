// agent-qa — owner rulings 2 and 3 (#691): an explicit ETF ticker is named as the FUND ("BTC (Grayscale Bitcoin Mini
// Trust, an ETF)") and every answer that prices an ETF says the fund's price is not the underlying's. Checked on BOTH
// paths (stock.quote and stock.dailyBars), through the REAL parser, the REAL client answer and instrument.resolve
// answered by the REAL server classifier over QA's OWN index. A stock must carry neither marker (the control).
import { describe, it, expect, vi } from 'vitest'
import IDX from '../__fixtures__/program/md2/resolve-qa-index.json'
import SC from '../__fixtures__/program/md2/scenarios.json'
import BARS from '../__fixtures__/program/envelopes/bars.daily.json'

const st = { reads: [] }
vi.mock('../agentClient', async (o) => ({ ...(await o()), serverServesData: () => true, serverDataKinds: () => ['quote', 'quotes', 'bars.daily', 'instrument.resolve'] }))
vi.mock('../marketdata/client', async (o) => ({ ...(await o()), readData: vi.fn(async (kind, params) => {
  if (kind === 'instrument.resolve') {
    const results = params.symbols.map(c => IDX.entries[`${c.text}|${c.form}`])
    if (results.some(r => !r)) throw new Error(`QA index fixture lacks ${JSON.stringify(params.symbols)}`)
    return { ...IDX.shell, params_echo: params, data: { results, all_symbols: results.every(r => r.class === 'symbol') } }
  }
  st.reads.push({ kind, params })
  if (kind === 'quote') {
    const e = structuredClone(SC.scenarios.live_regular.envelope)
    e.params_echo = { symbol: params.symbol }
    e.data.quote.symbol = params.symbol
    return e
  }
  if (kind === 'bars.daily') {
    const e = structuredClone(BARS.cases.historical)
    e.params_echo = { ...params }
    e.data.symbol = params.symbol
    return e
  }
  return { status: 'unavailable', notes: ['qa stub'], data: null }
}) }))
import { match as quoteMatch, answerQuote } from '../capabilities/marketDataQuote'
import { match as barsMatch, answerDailyBars } from '../capabilities/marketDataBars'
import { FUND_NOTE } from '../capabilities/marketDataResolve'
import { turnStart, turnEnd } from '../trace'

async function ask(text, which) {
  const m = which === 'bars' ? barsMatch(text) : quoteMatch(text)
  expect(m, `parser matched "${text}"`).toBeTruthy()
  st.reads = []
  turnStart('send')
  try {
    const a = which === 'bars' ? await answerDailyBars(m.params) : await answerQuote(m.params)
    return { text: typeof a === 'string' ? a : a?.text || '', reads: st.reads.map(r => r.kind) }
  } finally { turnEnd() }
}
const count = (s, sub) => s.split(sub).length - 1

describe('ETF labelling (owner rulings 2 and 3)', () => {
  it('quote: "BTC price" names the FUND and adds the fund-price sentence exactly once', async () => {
    const r = await ask('BTC price', 'quote')
    expect(r.reads).toEqual(['quote'])
    expect(r.text).toContain('BTC (Grayscale Bitcoin Mini Trust, an ETF)')
    expect(count(r.text, FUND_NOTE)).toBe(1)
    expect(r.text).not.toMatch(/bitcoin('s)? (spot )?price is/i)
  })
  it('quote: an ETF ticker that is not crypto (SPY) is labelled the same way', async () => {
    const r = await ask('SPY price', 'quote')
    expect(r.text).toContain('SPY (SPDR S&P 500 ETF Trust, an ETF)')
    expect(count(r.text, FUND_NOTE)).toBe(1)
  })
  it('quote control: a stock (NVDA) carries neither marker', async () => {
    const r = await ask('NVDA price', 'quote')
    expect(r.text).toContain('NVDA (NVIDIA Corporation)')
    expect(r.text).not.toContain(', an ETF')
    expect(r.text).not.toContain(FUND_NOTE)
  })
  it('bars: an ETF\'s daily answer adds the fund-price sentence; a stock\'s does not', async () => {
    const etf = await ask('SPY 52-week high', 'bars')
    expect(etf.reads).toEqual(['bars.daily'])
    expect(count(etf.text, FUND_NOTE)).toBe(1)
    const stock = await ask('NVDA 52-week high', 'bars')
    expect(stock.reads).toEqual(['bars.daily'])
    expect(stock.text).not.toContain(FUND_NOTE)
  })
  it('lowercase "btc" is the neutral ask: no read, no fund named, no note', async () => {
    const r = await ask('btc price', 'quote')
    expect(r.reads).toEqual([])
    expect(r.text).toMatch(/^I'm not sure which instrument "btc" means\./)
    expect(r.text).not.toContain('Grayscale')
    expect(r.text).not.toContain(FUND_NOTE)
  })
})

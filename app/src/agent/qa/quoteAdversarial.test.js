// agent-qa — ADVERSARIAL quote set 3 (scores/quote-adversarial-3.json), written BLIND before agent-md's general
// lowercase design or code was seen. Same path as qa/quoteHeldout.test.js: the REAL parser → the REAL client answer →
// instrument.resolve answered by the REAL server classifier over QA's OWN index → any quote/quotes/bars.daily read is
// an EXECUTION.
//   FAIL           any execution that is not `expect` or listed in `either` (wrong symbol, coincidental listing,
//                  a current price for a historical request, a collapsed share class). The owner bar is FAIL = 0.
//   MUST-MISS      a `must_execute` row that did not execute (a clear ticker the member has to re-type). Not wrong,
//                  but it is the cost the owner asked to see; the general design is meant to drive it to 0.
//   PASS / SAFE    everything else. `either: [null]` makes "no execution" acceptable on a row that expects one.
import { describe, it, expect, vi } from 'vitest'
import SET3 from '../__fixtures__/program/scores/quote-adversarial-3.json'
import IDX from '../__fixtures__/program/md2/resolve-qa-index.json'

const st = { reads: [] }
vi.mock('../agentClient', async (o) => ({ ...(await o()), serverServesData: () => true, serverDataKinds: () => ['quote', 'quotes', 'bars.daily', 'instrument.resolve'] }))
vi.mock('../marketdata/client', async (o) => ({ ...(await o()), readData: vi.fn(async (kind, params) => {
  if (kind === 'instrument.resolve') {
    const results = params.symbols.map(c => IDX.entries[`${c.text}|${c.form}`])
    if (results.some(r => !r)) throw new Error(`QA index fixture lacks ${JSON.stringify(params.symbols)}: regenerate it`)
    return { ...IDX.shell, params_echo: params, data: { results, all_symbols: results.every(r => r.class === 'symbol') } }
  }
  st.reads.push({ kind, params })
  return { status: 'unavailable', notes: ['qa stub'], data: null }
}) }))
import { match as quoteMatch, answerQuote } from '../capabilities/marketDataQuote'
import { match as barsMatch, answerDailyBars } from '../capabilities/marketDataBars'
import { turnStart, turnEnd } from '../trace'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export async function scoreAdversarial(rows) {
  const out = { pass: [], fail: [], must_miss: [], executed: {}, outcomes: {} }
  for (const r of rows) {
    const q = quoteMatch(r.text), b = barsMatch(r.text)
    const m = q || b
    let executed = null, outcome = 'model'
    if (m) {
      st.reads = []
      turnStart('send')
      try { m.action === 'stock.quote' ? await answerQuote(m.params) : await answerDailyBars(m.params) } finally { turnEnd() }
      if (st.reads.length) {
        const rd = st.reads[0]
        executed = rd.kind === 'bars.daily'
          ? { action: 'stock.dailyBars', symbol: rd.params.symbol, measure: m.params.measure, ...(m.params.measure === 'change' ? { sessions: m.params.sessions } : {}) }
          : { action: 'stock.quote', symbols: rd.params.symbols || [rd.params.symbol] }
        outcome = 'priced'
      } else outcome = 'answered_without_read'
    }
    const ok = [r.expect, ...(r.either || [])]
    const okExec = executed && ok.some(e => e && same(executed, e))
    const okNone = !executed && ok.some(e => e === null)
    if (executed) out.executed[r.id] = executed.symbols ? executed.symbols.join('+') : `${executed.symbol}:${executed.measure}`
    if ((q && b) || (executed && !okExec)) out.fail.push(r.id)
    else {
      out.pass.push(r.id)
      if (!executed && r.must_execute) out.must_miss.push(r.id)
    }
    out.outcomes[outcome] = (out.outcomes[outcome] || 0) + 1
  }
  return out
}

describe('agent-qa adversarial quote set 3 (blind)', () => {
  it('non-vacuity: 97 rows across 9 categories; 22 must execute', () => {
    expect(SET3.rows).toHaveLength(97)
    expect(new Set(SET3.rows.map(r => r.cat)).size).toBe(9)
    expect(SET3.rows.filter(r => r.must_execute)).toHaveLength(22)
  })
  it('#695 (a4a1179044, §4.7.5): ZERO wrong executions; 5 must-execute misses (spy, qqq, googl and their compounds)', async () => {
    const r = await scoreAdversarial(SET3.rows)
    expect(r.fail).toEqual([])
    expect(r).toMatchObject(BASELINE)
  })
})

// #691 (7648fd6631) measured: 0 FAIL, 14 must-miss (every clear lowercase ticker), and $btc/$eth/$sol executed.
// #695 (a4a1179044, §4.7.5) measured below: 0 FAIL, 5 must-miss; lowercase crypto cashtags now ask. FAIL must stay [].
const BASELINE = {
  must_miss: ['A04', 'A05', 'A09', 'C04', 'C06'],
  executed: { A01: 'NVDA', A02: 'AAPL', A03: 'MSFT', A06: 'TSLA', A07: 'AMD', A08: 'NVDA', A10: 'PLTR', A12: 'AMZN',
    C01: 'NVDA+AMD', H12: 'AAPL:range52w', H13: 'AAPL:range52w', K01: 'NVDA', K02: 'NVDA', M10: 'GOOG', W20: 'ON',
    W21: 'GOLD', W22: 'BTC', W23: 'NOW', W24: 'CAT' },
  outcomes: { priced: 19, answered_without_read: 40, model: 38 },
}

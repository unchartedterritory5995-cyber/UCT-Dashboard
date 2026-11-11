// agent-qa — ADVERSARIAL quote set 4 (scores/quote-adversarial-4.json), FRESH: agent-md has not seen it. Scored over
// PRODUCTION rows (md2/resolve-prod-union.json: the two read-only /api/ticker-search probes as one index), not QA's index. Same path as qa/quoteHeldout.test.js: the REAL parser → the REAL client answer →
// instrument.resolve answered by the REAL server classifier over QA's OWN index → any quote/quotes/bars.daily read is
// an EXECUTION.
//   FAIL           any execution that is not `expect` or listed in `either` (wrong symbol, coincidental listing,
//                  a current price for a historical request, a collapsed share class). The owner bar is FAIL = 0.
//   MUST-MISS      a `must_execute` row that did not execute (a clear ticker the member has to re-type). Not wrong,
//                  but it is the cost the owner asked to see; the general design is meant to drive it to 0.
//   PASS / SAFE    everything else. `either: [null]` makes "no execution" acceptable on a row that expects one.
import { describe, it, expect, vi } from 'vitest'
import SET4 from '../__fixtures__/program/scores/quote-adversarial-4.json'
import IDX from '../__fixtures__/program/md2/resolve-prod-union.json'

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
async function scoreAdversarial(rows) {
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

describe('agent-qa adversarial quote set 4 (fresh, production rows)', () => {
  it('non-vacuity: 22 rows; 5 must execute; the index is production-sized', () => {
    expect(SET4.rows).toHaveLength(22)
    expect(SET4.rows.filter(r => r.must_execute)).toHaveLength(5)
    expect(IDX.index_rows).toBeGreaterThan(1000)
  })
  it('BAR: ZERO wrong executions on set 4, and every must-execute row executes', async () => {
    const r = await scoreAdversarial(SET4.rows)
    expect(r.fail).toEqual([])
    expect(r.must_miss).toEqual([])
  })
  it('#695 at f0b1dee621 (F-24 fixed): MEASURED, pinned', async () => {
    // a4a1179044 measured F01-F03 FAIL (NICE+NVDA, NICE+AAPL, NICE+NVDA) and priced F09 nice, F19 mara, F20 asml.
    const r = await scoreAdversarial(SET4.rows)
    expect(r).toMatchObject(MEASURED)
  })
})

const MEASURED = {
  fail: [],
  must_miss: [],
  executed: { F10: 'EAT', F14: 'PINS', F15: 'NKE', F16: 'WMT', F17: 'ADBE+ORCL', F18: 'QCOM+PANW' },
  outcomes: { priced: 6, answered_without_read: 16 },
}

// agent-qa — HELD-OUT quote/price phrasings, scored at the OUTCOME (MD-1 §4.7; owner bar: ZERO wrong executions).
// Two sets written by agent-qa WITHOUT reading the parser: set 1 (44, scores/quote-heldout.json) and set 2 (54,
// scores/quote-heldout-2.json, written blind to agent-md's #664 fix and published once it arrived).
// Path: the REAL parser (match) → the REAL client `answerQuote` / `answerDailyBars` → instrument.resolve answered by
// the REAL server classifier over QA's OWN index (md2/resolve-qa-index.json) → any quote/quotes/bars.daily read is
// an EXECUTION. Outcome: priced(symbols) | ask | limit | model.
//   PASS       an execution equal to `expect` (or an `either`), or no execution where none is required
//   SAFE-MISS  no execution where one was expected (ask / limit / model: a turn or a re-type, never a wrong answer)
//   FAIL       any execution that is not exactly what was meant: wrong symbol, substituted security, wrong date
import { describe, it, expect, vi } from 'vitest'
import set1 from '../__fixtures__/program/scores/quote-heldout.json'
import set2 from '../__fixtures__/program/scores/quote-heldout-2.json'
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
async function score(rows) {
  const out = { pass: [], safe_miss: [], fail: [], outcomes: {}, asks: {} }
  for (const r of rows) {
    const q = quoteMatch(r.text), b = barsMatch(r.text)
    const m = q || b
    let outcome, executed = null, text = ''
    if (!m) outcome = 'model'
    else {
      st.reads = []
      turnStart('send')
      try {
        const a = m.action === 'stock.quote' ? await answerQuote(m.params) : await answerDailyBars(m.params)
        text = typeof a === 'string' ? a : a?.text || ''
      } finally { turnEnd() }
      if (st.reads.length) {
        const rd = st.reads[0]
        executed = rd.kind === 'bars.daily'
          ? { action: 'stock.dailyBars', symbol: rd.params.symbol, measure: m.params.measure, ...(m.params.measure === 'change' ? { sessions: m.params.sessions } : {}) }
          : { action: 'stock.quote', symbols: rd.params.symbols || [rd.params.symbol] }
        outcome = 'priced'
      } else outcome = /Did you mean/.test(text) ? 'ask' : 'limit'
      if (outcome === 'ask') out.asks[r.id] = (text.match(/Did you mean ([A-Z.\-]+)/) || [])[1]
    }
    const cls = (q && b) ? 'fail'
      : outcome === 'priced' ? ((same(executed, r.expect) || (r.either || []).some(e => e && same(executed, e))) ? 'pass' : 'fail')
        : (r.expect === null ? 'pass' : 'safe_miss')
    out.outcomes[outcome] = (out.outcomes[outcome] || 0) + 1
    out[cls].push(r.id)
  }
  return out
}

describe('agent-qa held-out quote phrasings — OUTCOME level', () => {
  it('non-vacuity: 44 + 54 rows; the QA index fixture covers every candidate the parser hands over', () => {
    expect(set1.rows).toHaveLength(44)
    expect(set2.rows).toHaveLength(54)
    expect(Object.keys(IDX.entries).length).toBeGreaterThan(300)
  })
  it('SET 1 (44): ZERO wrong executions — measured on c9fd4437ea: 35 pass · 9 safe-miss · 0 FAIL', async () => {
    const r = await score(set1.rows)
    expect(r.fail).toEqual([])
    expect(r.outcomes).toEqual({ ask: 11, priced: 6, model: 26, limit: 1 })
    expect(r.safe_miss.sort()).toEqual(['H01', 'H02', 'H05', 'H06', 'H09', 'H13', 'H22', 'H23', 'H36'])
  })
  it('SET 2 (54): ZERO wrong executions — measured on c9fd4437ea: 52 pass · 2 safe-miss · 0 FAIL', async () => {
    const r = await score(set2.rows)
    expect(r.fail).toEqual([])
    expect(r.outcomes).toEqual({ priced: 8, ask: 7, limit: 12, model: 27 })
    expect(r.safe_miss.length).toBe(2)
  })
  it('OBSERVATION (owner judgment, not a FAIL): asks that NAME a security the member probably did not mean', async () => {
    // Nothing executes, and the ask names the security, so the member sees it is not what they meant. A stricter
    // policy would answer these words with the §4.7.3 limit sentence instead. Pinned so a change is visible.
    const a = { ...(await score(set1.rows)).asks, ...(await score(set2.rows)).asks }
    expect({ H26: a.H26, H28: a.H28, V12: a.V12, V22: a.V22, V24: a.V24 })
      .toEqual({ H26: 'BTC', H28: 'GOLD', V12: 'DOW', V22: 'ETH', V24: 'SOL' })
  })
})

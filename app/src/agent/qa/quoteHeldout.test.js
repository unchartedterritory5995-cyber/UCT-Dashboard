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

const st = { reads: [], resolved: [] }
vi.mock('../agentClient', async (o) => ({ ...(await o()), serverServesData: () => true, serverDataKinds: () => ['quote', 'quotes', 'bars.daily', 'instrument.resolve'] }))
vi.mock('../marketdata/client', async (o) => ({ ...(await o()), readData: vi.fn(async (kind, params) => {
  if (kind === 'instrument.resolve') {
    const results = params.symbols.map(c => IDX.entries[`${c.text}|${c.form}`])
    if (results.some(r => !r)) throw new Error(`QA index fixture lacks ${JSON.stringify(params.symbols)}: regenerate it`)
    st.resolved.push(...results)
    return { ...IDX.shell, params_echo: params, data: { results, all_symbols: results.every(r => r.class === 'symbol') } }
  }
  st.reads.push({ kind, params })
  return { status: 'unavailable', notes: ['qa stub'], data: null }
}) }))
import { match as quoteMatch, answerQuote } from '../capabilities/marketDataQuote'
import { match as barsMatch, answerDailyBars } from '../capabilities/marketDataBars'
import { turnStart, turnEnd } from '../trace'
import { clarifyText } from '../capabilities/marketDataResolve'

// MD-1 §4.7.3 after #691 (owner ruling 1): the ask is NEUTRAL. It names the word as typed and never a security.
const ASK = /^I'm not sure which instrument "/
const ASK_WORD = /^I'm not sure which instrument "(.*?)" means\./
// Rows whose expect is null (no execution is acceptable) but whose meaning is unambiguous: agent-qa's judgment,
// stated here so the trade-off count is not decided by how a row's expect was written.
const MEANT_WHEN_NULL = { V05: ['TSLA'], V06: ['NVDA'], V09: ['NFLX'], V47: ['NVDA', 'TSLA'] }
// Measured on a4a1179044 (§4.7.5): of the 13 helpful suggestions #691 gave up (7648fd6631), 6 now EXECUTE (H01 msft,
// H05 amzn, H09 nflx, H13 nvda, H22 msft, H36 brk.b); 7 still ask neutrally. The 5 unintended stay asks.
const TRADE_OFF = {
  helpful: ['H02:GOOGL', 'H23:GOOGL', 'H29:AAPL', 'V05:TSLA', 'V06:NVDA', 'V09:NFLX', 'V47:TSLA'],
  unintended: ['H26:BTC', 'H28:GOLD', 'V12:DOW', 'V22:ETH', 'V24:SOL'],
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export async function score(rows) {
  const out = { pass: [], safe_miss: [], fail: [], outcomes: {}, asks: {}, askText: {}, askCandidate: {} }
  for (const r of rows) {
    const q = quoteMatch(r.text), b = barsMatch(r.text)
    const m = q || b
    let outcome, executed = null, text = ''
    if (!m) outcome = 'model'
    else {
      st.reads = []; st.resolved = []
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
      } else outcome = ASK.test(text) ? 'ask' : 'limit'
      if (outcome === 'ask') {
        out.askText[r.id] = text
        // the security the index offered (what the OLD wording named); the member is no longer shown it
        const c = st.resolved.find(x => x.class === 'symbol_typed_lowercase' || x.class === 'name_match')
        out.askCandidate[r.id] = c?.candidate?.symbol || null
      }
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
  it('SET 1 (44): ZERO wrong executions — measured on a4a1179044 (§4.7.5): 41 pass · 3 safe-miss · 0 FAIL', async () => {
    const r = await score(set1.rows)
    expect(r.fail).toEqual([])
    expect(r.outcomes).toEqual({ priced: 12, ask: 5, model: 26, limit: 1 })
    expect(r.safe_miss.sort()).toEqual(['H02', 'H06', 'H23'])
  })
  it('SET 2 (54): ZERO wrong executions — measured on a4a1179044 (§4.7.5): 52 pass · 2 safe-miss · 0 FAIL', async () => {
    const r = await score(set2.rows)
    expect(r.fail).toEqual([])
    expect(r.outcomes).toEqual({ priced: 8, ask: 7, limit: 12, model: 27 })
    expect(r.safe_miss.length).toBe(2)
  })
  it('every ask is the neutral §4.7.3 clarification: it names the word as typed and NO security (owner ruling 1)', async () => {
    const r1 = await score(set1.rows), r2 = await score(set2.rows)
    const texts = { ...r1.askText, ...r2.askText }
    expect(Object.keys(texts).length, 'non-vacuity: 5 + 7 asks').toBe(12)
    const syms = new Set(IDX.index.map(x => x.ticker))
    for (const [id, t] of Object.entries(texts)) {
      expect(t.startsWith(clarifyText(t.match(ASK_WORD)[1])), id).toBe(true)
      expect(t, `${id} offers no candidate`).not.toMatch(/Did you mean/)
      for (const sym of syms) expect(t, `${id} names ${sym}`).not.toContain(`${sym} (`)
    }
    // the five that used to NAME a probably-unintended security (BTC / GOLD / DOW / ETH / SOL) are now neutral
    for (const id of ['H26', 'H28', 'V12', 'V22', 'V24']) expect(Object.keys(texts)).toContain(id)
  })
  it('TRADE-OFF (owner): asks whose OLD wording named the security the member meant, now neutral', async () => {
    // A named ask is "helpful" when the index's candidate is in the row's expect (or an either). Those members used
    // to see their own ticker suggested; now they see the neutral sentence. Measured on a4a1179044, pinned.
    const helpful = [], unintended = []
    for (const rows of [set1.rows, set2.rows]) {
      const r = await score(rows)
      for (const row of rows) {
        if (!(row.id in r.askCandidate)) continue
        const meant = [row.expect, ...(row.either || [])].filter(Boolean).flatMap(e => e.symbols || [e.symbol])
          .concat(MEANT_WHEN_NULL[row.id] || [])
        ;(meant.includes(r.askCandidate[row.id]) ? helpful : unintended).push(`${row.id}:${r.askCandidate[row.id]}`)
      }
    }
    expect({ helpful: helpful.sort(), unintended: unintended.sort() }).toEqual(TRADE_OFF)
  })
})

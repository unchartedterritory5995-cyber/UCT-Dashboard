// agent-qa STUDY — a stricter contextual ticker rule for the quote reader (owner-approved for investigation and testing
// ONLY; production behaviour does not change: the switch in capabilities/marketDataPhrases.js defaults to 'off').
//
// Rule studied: a word typed in LOWER case is a ticker candidate only after a clear price frame ("price of", "quote",
// "how much is", "trading at", premarket, after hours) or when $-prefixed; UPPERCASE words still count.
//   'frame'  the frame may be anywhere in the sentence   ("nvda price" passes)
//   'after'  the lowercase word must follow the frame    ("price of nvda" passes, "nvda price" does not)
//
// Held-out comparison, old ('off') vs new, over:
//   - agent-qa held-out sets 1 + 2 and adversarial sets 3 + 4, scored at the OUTCOME exactly as qa/quoteHeldout.test.js
//     and qa/quoteAdversarial*.test.js do (real parser → real client answer → server classifier over the QA index);
//   - the capability-regression corpus (every phrasing; only stock.quote intents may claim a quote);
//   - everyday phrasings from #771's tests (agentMultiActionFollowups.test.jsx string literals, extracted once).
// Run with STUDY_PRINT=1 to print the per-row table. The assertions pin only what the study relies on.
import { describe, it, expect, vi, afterEach } from 'vitest'
import SET1 from '../__fixtures__/program/scores/quote-heldout.json'
import SET2 from '../__fixtures__/program/scores/quote-heldout-2.json'
import SET3 from '../__fixtures__/program/scores/quote-adversarial-3.json'
import SET4 from '../__fixtures__/program/scores/quote-adversarial-4.json'
import QA_IDX from '../__fixtures__/program/md2/resolve-qa-index.json'
import PROD_IDX from '../__fixtures__/program/md2/resolve-prod-union.json'
import CORPUS from './capabilityRegression/baseline/corpus.json'
import EVERYDAY from '../__fixtures__/program/scores/strict-ticker-everyday-771.json'

const st = { reads: [], idx: null }
vi.mock('../agentClient', async (o) => ({ ...(await o()), serverServesData: () => true, serverDataKinds: () => ['quote', 'quotes', 'bars.daily', 'instrument.resolve'] }))
vi.mock('../marketdata/client', async (o) => ({ ...(await o()), readData: vi.fn(async (kind, params) => {
  if (kind === 'instrument.resolve') {
    const results = params.symbols.map(c => st.idx.entries[`${c.text}|${c.form}`])
    if (results.some(r => !r)) throw new Error(`index fixture lacks ${JSON.stringify(params.symbols)}`)
    return { ...st.idx.shell, params_echo: params, data: { results, all_symbols: results.every(r => r.class === 'symbol') } }
  }
  st.reads.push({ kind, params })
  return { status: 'unavailable', notes: ['qa stub'], data: null }
}) }))
import { match as quoteMatch, answerQuote } from '../capabilities/marketDataQuote'
import { match as barsMatch, answerDailyBars } from '../capabilities/marketDataBars'
import { parsePriceSentence, setStrictTickerRule, strictTickerRule } from '../capabilities/marketDataPhrases'
import { turnStart, turnEnd } from '../trace'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const MODES = ['off', 'frame', 'after']

/** One row → { exec: 'NVDA' | 'AAPL:range52w' | null, ok: matches expect/either, wanted: a real quote was expected }. */
async function outcome(r) {
  const q = quoteMatch(r.text), b = barsMatch(r.text)
  const m = q || b
  let executed = null
  if (m) {
    st.reads = []
    turnStart('send')
    try { m.action === 'stock.quote' ? await answerQuote(m.params) : await answerDailyBars(m.params) } finally { turnEnd() }
    if (st.reads.length) {
      const rd = st.reads[0]
      executed = rd.kind === 'bars.daily'
        ? { action: 'stock.dailyBars', symbol: rd.params.symbol, measure: m.params.measure, ...(m.params.measure === 'change' ? { sessions: m.params.sessions } : {}) }
        : { action: 'stock.quote', symbols: rd.params.symbols || [rd.params.symbol] }
    }
  }
  const okList = [r.expect, ...(r.either || [])]
  const ok = executed ? okList.some(e => e && same(executed, e)) : true
  return {
    claimed: !!q, exec: executed ? (executed.symbols ? executed.symbols.join('+') : `${executed.symbol}:${executed.measure}`) : null,
    wrong: !!executed && !ok, wanted: !!(r.expect && r.expect.action === 'stock.quote') || !!r.must_execute,
  }
}

async function scoreSet(name, rows, idx) {
  st.idx = idx
  const by = {}
  for (const mode of MODES) {
    setStrictTickerRule(mode)
    by[mode] = {}
    for (const r of rows) by[mode][r.id] = await outcome(r)
  }
  setStrictTickerRule('off')
  const out = { set: name, rows: rows.length }
  for (const mode of ['frame', 'after']) {
    const changed = rows.filter(r => !same(by.off[r.id], by[mode][r.id]))
    out[mode] = {
      changed: changed.map(r => `${r.id} "${r.text}" ${by.off[r.id].exec || (by.off[r.id].claimed ? 'claim' : '-')}→${by[mode][r.id].exec || (by[mode][r.id].claimed ? 'claim' : '-')}`),
      falseRemoved: changed.filter(r => by.off[r.id].wrong && !by[mode][r.id].wrong).map(r => r.id),
      // an execution the row expected (a correct price) that no longer happens: the member re-types
      realLost: changed.filter(r => by.off[r.id].exec && !by.off[r.id].wrong && !by[mode][r.id].exec).map(r => r.id),
      newWrong: rows.filter(r => by[mode][r.id].wrong && !by.off[r.id].wrong).map(r => r.id),
      wrongBefore: rows.filter(r => by.off[r.id].wrong).length,
    }
  }
  return out
}

/** Parser-level: does the quote reader claim the phrasing? `quoteOk` marks phrasings that ARE price questions. */
function claimSet(name, items) {
  const by = {}
  for (const mode of MODES) {
    setStrictTickerRule(mode)
    by[mode] = items.map(i => parsePriceSentence(i.text)?.intent === 'quote')
  }
  setStrictTickerRule('off')
  const out = { set: name, rows: items.length, offClaims: items.filter((_, k) => by.off[k]).map(i => i.text) }
  for (const mode of ['frame', 'after']) {
    const changed = items.map((i, k) => ({ ...i, k })).filter(i => by.off[i.k] !== by[mode][i.k])
    out[mode] = {
      changed: changed.map(i => `"${i.text}" ${by.off[i.k] ? 'quote' : '-'}→${by[mode][i.k] ? 'quote' : '-'}`),
      falseRemoved: changed.filter(i => by.off[i.k] && !i.quoteOk).map(i => i.text),
      realLost: changed.filter(i => by.off[i.k] && i.quoteOk).map(i => i.text),
    }
  }
  return out
}

// Phrasings in #771's tests that ARE price questions (everything else there is a board, drawing, alert or look request).
const QUOTE_OK_771 = new Set(['what is NVDA trading at', 'how much is NVDA right now', 'nvda up today', 'price of nvda and set'])
// The owner's named examples of real quotes the rule could lose, plus the plainest lowercase reads.
const NAMED = ['doge', 'doge price', 'apple', 'apple price', 'price of apple', 'how much is a share of apple',
  'how much is apple', 'what is apple trading at', 'nvda price', 'price of nvda', "what's msft at", 'qqq right now',
  'nvda up today', 'tsla premarket', 'premarket tsla', '$nvda', 'NVDA up today'].map(text => ({ text, quoteOk: true }))

afterEach(() => setStrictTickerRule('off'))

describe('STUDY: stricter contextual ticker rule (switch OFF in production)', () => {
  it('the switch defaults to OFF and rejects unknown modes', () => {
    expect(strictTickerRule()).toBe('off')
    expect(() => setStrictTickerRule('on')).toThrow()
  })

  it('held-out + adversarial + corpus + #771 everyday: old vs new', async () => {
    const corpusItems = CORPUS.intents.flatMap(g => g.phrasings.map(p => ({ text: p.text, quoteOk: g.capabilities.includes('stock.quote') })))
    const results = [
      await scoreSet('held-out 1', SET1.rows, QA_IDX),
      await scoreSet('held-out 2', SET2.rows, QA_IDX),
      await scoreSet('adversarial 3', SET3.rows, QA_IDX),
      await scoreSet('adversarial 4', SET4.rows, PROD_IDX),
      claimSet('capreg corpus', corpusItems),
      claimSet('#771 everyday', EVERYDAY.map(text => ({ text, quoteOk: QUOTE_OK_771.has(text) }))),
      claimSet('named examples', NAMED),
    ]
    if (globalThis.process?.env?.STUDY_PRINT) console.log(JSON.stringify(results, null, 1))
    // the safety property the study relies on: the stricter rule only ever REMOVES quote reads, never adds a wrong one
    for (const r of results) for (const mode of ['frame', 'after']) expect(r[mode].newWrong || [], `${r.set} ${mode}`).toEqual([])
    expect(strictTickerRule()).toBe('off')
  }, 120000)
})

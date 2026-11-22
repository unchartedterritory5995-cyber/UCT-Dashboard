// CHARTS OUTCOME — the corpus intent `earnings.date` with a STRICT oracle (pl-exec round 6). The corpus's only check is
// `expect.reads: ['earnings.*NVDA']` over the canonical REQUEST lines (run.jsx checkExpect): it passes once an earnings request
// for NVDA RAN, whatever came back, so a refusal or a not-found answer passes it. Here each corpus phrasing (and the round 6 held-out ones) must answer with the NEXT REPORT DATE, and a refusal
// fails. With the gateway's earnings kind served (a fixture), they answer; with nothing served, the strict oracle says so.
// ⛔ THE MODEL IS SCRIPTED (the corpus intent's own canonical plan). Evidence: LOCAL, jsdom, BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { open, outcomeSuite, afterEachOutcome, chart, must } from './outcomeHarness'
import { corpus, phrasingsOf } from '../capabilityRegression/testing/corpus'
import { EARNINGS_HELD_OUT } from '../../agentExecHeldOut6.test.js'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()
afterEach(() => afterEachOutcome())

const intent = corpus.intents.find(i => i.id === 'earnings.date')
const LOOSE = new RegExp(intent.expect.reads[0], 'i')                   // the corpus's own oracle
// the answer's own lead: "<SYM> earnings — next report: Nov 19, 2026 (…)". (The harness's say() returns the text AFTER the
// member's words, so for "NVDA earnings" the lead's own "NVDA earnings" is consumed: the date and the read's symbol are the check.)
const strict = (out) => /next report: [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(out) && !/couldn't read|couldn't find|not available/i.test(out.split('Latest reported')[0])
const calls = []
const callLine = (c) => `${c[0]} ${c[1]}${c[2] ? ` ${JSON.stringify(c[2])}` : ''}`
const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
function serve(on) {
  const base = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), body = init.body ? JSON.parse(init.body) : null
    if (/earnings/.test(u) || body?.kind === 'earnings') calls.push([init.method || 'GET', u, body])
    if (on && u === '/api/agent/data' && body?.kind === 'earnings') return json({ contract: 'MD-1.0', kind: 'earnings', params_echo: body.params, status: 'ok', freshness: 'fresh', as_of: '2026-11-03', stale: false, notes: [], data: { reported: [{ quarter: 'Q2 FY2027', rev_actual: 1e9, eps_actual: 1 }], next_report: { report_date: '2026-11-19', quarter: 'Q3 FY2027', kind: 'scheduled' }, reported_through: 'Q2 FY2027' } })
    if (on && u.startsWith('/api/earnings-intel/')) return json({ quarters: [{ label: 'Q2 FY2027', revenue_actual: 1e9, eps_actual: 1 }], summary: { next_report_date: '2026-11-19' } })
    return base(url, init)
  }
}
const plan = (c) => [{ action: 'stock.earnings', target: must(c.stockData?.[0]?.ref, 'stockData'), args: { symbol: 'NVDA' } }]
// "what did NVDA report last quarter" asks for the reported figures, not the date: the strict oracle is the date's
const DATE_PHRASINGS = phrasingsOf(intent).map(ph => ph.text).filter(t => !/last quarter/i.test(t))

describe('earnings.date, strict: the next report date or a failure', () => {
  it('the corpus oracle checks a request line, not the answer', () => {
    expect(LOOSE.test('GET /api/earnings-intel/NVDA')).toBe(true)
    expect(intent.expect.receipt).toBeUndefined()
  })
  it.each([...DATE_PHRASINGS, ...EARNINGS_HELD_OUT.map(c => c.text)])('"%s" with the earnings kind served: the next report date', async (text) => {
    const m = open([chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' })
    serve(true)
    calls.length = 0
    const out = await m.say(text, plan)
    expect(strict(out), out).toBe(true)
    expect(JSON.stringify(calls), 'the read was for NVDA').toMatch(/NVDA/)
  }, 40000)
  it.each(DATE_PHRASINGS)('what the strict oracle catches: "%s" with no earnings served — the corpus check passes, this one fails', async (text) => {
    const m = open([chart('c1', 0, 0, 24, 20)], { 'N:c1': 'NVDA' })
    serve(false)
    calls.length = 0
    const out = await m.say(text, plan)
    expect(calls.map(callLine).some(l => LOOSE.test(l)), 'the corpus oracle passes').toBe(true)
    expect(strict(out), out).toBe(false)
  }, 40000)
})

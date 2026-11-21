// OWNER D16 item 3 — TICKER RESOLUTION from CONTEXT (deixis.resolveTickerTokens): a word is a ticker by its SLOT ("the ON chart",
// "ON: weekly", "take ON to weekly", "switch to ON"), its CASING (a signal, not a gate), MEMBERSHIP (the board, the member's lists,
// the ticker search's verdict) and whether it is also an ordinary word (a HOMOGRAPH — a signal, never the decision alone).
// Through the REAL panel (panelHarness; its ticker search answers from the fixture table — ON, ALL, NOW, IT are real fixture
// tickers; GO, ARE, BE, AS are added as known tickers here), scripted plans on the SPY chart:
//   LOWERCASE   off-board lowercase tickers × ticker slots × boards → asked, 0 writes
//   HOMOGRAPH   homograph tickers in a ticker slot → asked (lowercase: "Did you mean the ticker ON …, or the word …?"), 0 writes
//   ORDINARY    the same words in ordinary use ("show all charts", "turn it on", "go weekly", "make it weekly now") → never a
//               ticker: the change runs
//   UNRESOLVED  a ticker-slot word the search does not answer in time → asked ("I couldn't confirm …"), 0 writes
//   VALUES      a homograph or lowercase ticker that is the plan's symbol VALUE ("switch to on") → the symbol change runs
//   LATENCY     no ticker search when nothing needs one; when one is needed it is sent BEFORE the model call (in parallel)
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, fixture ticker search, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { _resetGrounding } from './nl/tickers'
import { resolveTickerTokens } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

const EXTRA = ['GO', 'ARE', 'BE', 'AS']
let p
beforeEach(() => { _resetGrounding(); p = setupPanel({ tickers: EXTRA }) })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const mount = (syms, sel) => {
  const widgets = syms.map((_, i) => ({ id: `w${i}`, x: i * 12, y: 0, w: 12, h: 20, type: 'chart', color: 'N', opts: { tf: 'D', settings: bareSettings() } }))
  const m = p.mount(widgets, Object.fromEntries(widgets.map((w, i) => [`N:${w.id}`, syms[i]])))
  if (sel) p.select(sel)
  return m
}
const transcript = () => screen.getByTestId('agent-transcript').textContent
const asked = () => /Which chart|Did you mean|couldn’t confirm/i.test(transcript())
const stored = (b, id) => JSON.stringify(b.state.widgets.find(w => w.id === id))
const symOf = (b, id) => b.state.groupSyms[`N:${id}`]
const snapshot = (b, n) => Array.from({ length: n }, (_, i) => [stored(b, `w${i}`), symOf(b, `w${i}`)])
const spyRef = (body) => body.context.charts.find(c => c.label === 'Chart (SPY)').ref
const weekly = (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: spyRef(body), args: { timeframe: 'W' } }])
const tickerCalls = () => p.st.calls.filter(c => /ticker-search/.test(c[1]))
const BOARDS = [['one chart', ['SPY'], null], ['SPY clicked', ['SPY', 'NVDA'], 'w0'], ['three charts', ['SPY', 'NVDA', 'QQQ'], null]]

// ── LOWERCASE tickers × ticker slots × boards ─────────────────────────────────────────────────────────────────────────
const LOWER = ['amd', 'tsla', 'aapl']
const TICKER_SLOTS = [(t) => `take ${t} to weekly`, (t) => `the ${t} chart on weekly`, (t) => `${t}: weekly`, (t) => `add a 20 EMA to ${t}`, (t) => `${t} weekly please`, (t) => `move ${t} up to weekly`]
describe('LOWERCASE tickers in a ticker slot → asked, 0 writes', () => {
  const CASES = LOWER.flatMap(t => TICKER_SLOTS.flatMap(say => BOARDS.map(([bn, syms, sel]) => [say(t), bn, syms, sel])))
  it('generated: 3 tickers × 6 slots × 3 boards', () => expect(CASES).toHaveLength(54))
  it.each(CASES)('"%s" (%s)', async (t, bn, syms, sel) => {
    const m = mount(syms, sel)
    const before = snapshot(m.board, syms.length)
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, syms.length), transcript()).toEqual(before)
  }, 60000)
})

// ── HOMOGRAPH tickers in a ticker slot ─────────────────────────────────────────────────────────────────────────────────
// (pronoun-class words — all, it, one, this — are read as pronouns in lowercase: "change all to weekly" is every chart)
const HOMOGRAPHS = ['on', 'now', 'go', 'are', 'be', 'as']
// (the chart-name slot "the X chart" reads a lowercase English word as the chart's adjective — "my own chart", "the new one" —
// so it is held in capitals only: "the ON chart")
const HOMO_SLOTS = [(h) => `change ${h} to weekly`, (h, up) => (up ? `the ${h} chart on weekly` : `switch ${h} to the hourly`), (h) => `${h}: weekly`, (h) => `take ${h} to 1h`]
describe('HOMOGRAPH tickers in a ticker slot → asked, 0 writes; lowercase names both readings', () => {
  const CASES = HOMOGRAPHS.flatMap(h => HOMO_SLOTS.flatMap(say => [['lower', say(h, false)], ['upper', say(h.toUpperCase(), true)]])
    .flatMap(([cn, t]) => BOARDS.slice(0, 2).map(([bn, syms, sel]) => [t, `${cn} · ${bn}`, syms, sel, cn])))
  it('generated: 6 homographs × 4 slots × 2 casings × 2 boards', () => expect(CASES).toHaveLength(96))
  it.each(CASES)('"%s" (%s)', async (t, label, syms, sel, cn) => {
    const m = mount(syms, sel)
    const before = snapshot(m.board, syms.length)
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(asked(), transcript()).toBe(true)
    expect(snapshot(m.board, syms.length), transcript()).toEqual(before)
    if (cn === 'lower') expect(transcript()).toMatch(/Did you mean the ticker [A-Z]+/)
  }, 60000)
})

// ── ORDINARY use of the same words → never a ticker ────────────────────────────────────────────────────────────────────
const ORDINARY_USE = ['put it on weekly', 'make it weekly now', 'go weekly', 'are you able to put it on weekly', 'be on weekly please',
  'make it weekly as well', 'switch it on weekly', 'it should be on weekly', 'set it to weekly now please', 'put this one on weekly']
describe('ORDINARY use of homographs → never read as a ticker: the change runs', () => {
  const CASES = ORDINARY_USE.flatMap(t => BOARDS.slice(0, 2).map(([bn, syms, sel]) => [t, bn, syms, sel || (syms.length > 1 ? 'w0' : null)]))
  it.each(CASES)('"%s" (%s)', async (t, bn, syms, sel) => {
    const m = mount(syms, sel)
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(m.board.state.widgets[0].opts.tf, transcript()).toBe('W')
  }, 60000)
  it('"show all charts weekly" (every chart in the plan) → all weekly, no question', async () => {
    const m = mount(['SPY', 'NVDA'], null)
    p.st.envelopes.push((body) => p.env('apply', body.context.charts.map(c => ({ action: 'chart.setTimeframe', target: c.ref, args: { timeframe: 'W' } }))))
    await m.say('show all charts weekly')
    expect(asked(), transcript()).toBe(false)
    expect(m.board.state.widgets.map(w => w.opts.tf), transcript()).toEqual(['W', 'W'])
  }, 60000)
})

// ── the reader itself: ordinary slots never read a homograph as a ticker, whatever the search knows ────────────────────────
describe('resolveTickerTokens: slot decides a homograph; membership and casing are signals', () => {
  const ALL_KNOWN = (w) => ({ kind: 'ticker', ticker: w.toUpperCase() })
  const read = (t) => resolveTickerTokens(t, { charts: [{ symbol: 'SPY' }], verdict: ALL_KNOWN }).filter(r => r.decision !== 'word').map(r => `${r.ticker}:${r.decision}`)
  it.each([
    ['show all charts weekly', []], ['turn it on', []], ['switch it on please', []], ['make it weekly NOW', []], ['put this one on weekly', []],
    ['go weekly', []], ['put the 20 EMA on and go weekly', []], ['take it to weekly', []], ['add rsi to all', []], ['make ALL charts weekly', []],
    ['change on to weekly', ['ON:ambiguous']], ['change ON to weekly', ['ON:ticker']], ['the on chart', []], ['the ON chart', ['ON:ticker']], ['my own chart weekly', []], ['ON: weekly', ['ON:ticker']],
    ['take amd to weekly', ['AMD:ticker']], ['CHANGE AMD TO WEEKLY', ['AMD:ticker']], ['the IT chart to weekly', ['IT:ticker']],
  ])('"%s" → %j', (t, want) => expect(read(t)).toEqual(want))
  // (a symbol ON THE BOARD in an ordinary slot is ASKED, never silently a word: agentTickerClasses R3 holds it over the class)
  it('a ticker-slot word the search has not answered is unresolved (asked), never a word', () => {
    const r = resolveTickerTokens('take xyzq to weekly', { charts: [{ symbol: 'SPY' }], verdict: () => 'pending' })
    expect(r.filter(x => x.decision !== 'word').map(x => `${x.upper}:${x.decision}`)).toEqual(['XYZQ:unresolved'])
  })
  it('the same word outside a ticker slot is a word, answered or not', () => {
    expect(resolveTickerTokens('make it weekly xyzq', { charts: [{ symbol: 'SPY' }], verdict: () => 'pending' }).filter(x => x.decision !== 'word')).toEqual([])
  })
})

// ── UNRESOLVED: the search never answers in time → asked, 0 writes ───────────────────────────────────────────────────────
describe('UNRESOLVED: a ticker-slot word the search does not answer in time → asked, never a stand-in chart', () => {
  it.each([['take amd to weekly', ['SPY'], null], ['the tsla chart on weekly', ['SPY', 'NVDA'], 'w0'], ['add a 20 EMA to aapl', ['SPY'], null]])('"%s"', async (t, syms, sel) => {
    const real = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (/ticker-search/.test(String(url)) ? new Promise(() => {}) : real(url, init)))   // never answers
    const m = mount(syms, sel)
    const before = snapshot(m.board, syms.length)
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(transcript()).toMatch(/couldn’t confirm/)
    expect(snapshot(m.board, syms.length)).toEqual(before)
  }, 60000)
})

// ── VALUES: a homograph / lowercase ticker that is the plan's symbol → the symbol change runs ───────────────────────────
describe('VALUES: the plan sets the symbol → it runs', () => {
  it.each([['switch to on', 'ON'], ['change this chart to all', 'ALL'], ['load now here instead', 'NOW'], ['switch to amd', 'AMD'], ['make this one go', 'GO']])('"%s" → %s', async (t, sym) => {
    const m = mount(['SPY'], null)
    p.st.envelopes.push((body) => p.env('apply', [{ action: 'chart.setSymbol', target: spyRef(body), args: { symbol: sym } }]))
    await m.say(t)
    expect(asked(), transcript()).toBe(false)
    expect(symOf(m.board, 'w0'), transcript()).toBe(sym)
  }, 60000)
})

// ── LATENCY: no search when nothing needs one; a needed one is sent BEFORE the model call ───────────────────────────────
describe('LATENCY: the ticker search is off the hot path', () => {
  it.each(['make it weekly', 'take SPY to weekly', 'put it on weekly now'])('"%s": no ticker search at all', async (t) => {
    const m = mount(['SPY'], null)
    p.st.envelopes.push(weekly)
    await m.say(t)
    expect(tickerCalls(), JSON.stringify(p.st.calls.map(c => c[1]))).toEqual([])
  }, 60000)
  it('"take amd to weekly": the search for "amd" is sent before /api/agent/turn (in parallel with the model)', async () => {
    const m = mount(['SPY'], null)
    p.st.envelopes.push(weekly)
    await m.say('take amd to weekly')
    const urls = p.st.calls.map(c => String(c[1]))
    const search = urls.findIndex(u => /ticker-search\?q=amd/i.test(u)), turn = urls.indexOf('/api/agent/turn')
    expect(search, urls.join(' | ')).toBeGreaterThanOrEqual(0)
    expect(search, urls.join(' | ')).toBeLessThan(turn)
  }, 60000)
})

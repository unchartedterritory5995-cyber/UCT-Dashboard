// AUDIT (#1283 early read) — an ORDINARY-slot reading never causes a WRONG chart write. Ordinary slots (a determiner before a
// chart plural, a particle after a pronoun, a preposition with its object, a verb after a modal, the chart-name adjective, the
// word after a chart noun, "at N", "for now") can hold real tickers: NOW, ALL, IT, ON, ARE, A. The outcome must be CORRECT (the
// plan that names the ticker — a symbol VALUE, or the ticker's own chart on the board — runs) or an ASK; never the plan landing
// on another chart while the named symbol is on the board.
// Generated through the REAL panel (panelHarness), scripted plans:
//   OFF BOARD  (SPY only)        stand-in plan on SPY → the ordinary reading (writes SPY) or asked; a VALUE plan (setSymbol T) runs
//   ON BOARD   (SPY clicked + T) stand-in plan on SPY → ASKED, 0 writes; plan on T's chart → runs there only; VALUE plan runs
// × 8 ordinary-slot rules × 6 tickers × 2 casings. (A single LOWERCASE letter "a" is the article: never read as a ticker, so the
// lowercase A cells are left out — the capital A is held.)
// Plus the NAMED rails: a signal (the homograph set, the app lexicon) is never on its own the reason a TICKER-SLOT word is not a
// ticker; and the neutral-slot app-word rule held directly (T10).
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans, fixture ticker search, no model call.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings, TICKERS as FIXTURE_TICKERS } from './testing/panelHarness'
import { _resetGrounding } from './nl/tickers'
import { resolveTickerTokens, tickerGroundingCandidates, NOT_TICKER_CAPS } from './deixis'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

// the tickers are DERIVED (owner: no hand-picked rows): every fixture ticker that is also an English word by the reader's own
// signal, plus single-letter acronym hints made real tickers here (the search is told they exist)
const TICKERS = [...FIXTURE_TICKERS.map(([t]) => t).filter(t => /^[A-Z]{2,5}$/.test(t) && resolveTickerTokens(t.toLowerCase())[0]?.homograph),
  ...[...NOT_TICKER_CAPS].filter(t => t.length === 1 && t !== 'I').slice(0, 1)]
let p
beforeEach(() => { _resetGrounding(); p = setupPanel({ tickers: TICKERS }) })
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
const refOf = (body, sym) => body.context.charts.find(c => c.label === `Chart (${sym})`).ref
const weeklyOn = (sym) => (body) => p.env('apply', [{ action: 'chart.setTimeframe', target: refOf(body, sym), args: { timeframe: 'W' } }])
const valueOf = (sym) => (body) => p.env('apply', [{ action: 'chart.setSymbol', target: refOf(body, 'SPY'), args: { symbol: sym } }])

// the ordinary-slot rules, each as a sentence with the word in that slot
const RULES = [
  ['determiner + plural', (T) => `make ${T} charts weekly`],
  ['particle after a pronoun', (T) => `switch it ${T}`],
  ['preposition with its object', (T) => `put it ${T} weekly`],
  ['verb after a modal', (T) => `it should ${T} weekly`],
  ['chart-name adjective', (T) => `make my ${T} chart weekly`],
  ['after the chart noun', (T) => `the chart ${T} to weekly`],
  ['"at N"', (T) => `put ${T} at 100 on weekly`],
  ['"for now"', (T) => `make it weekly for ${T}`],
]
const CASINGS = [['upper', (t) => t], ['lower', (t) => t.toLowerCase()]]
const CELLS = []
for (const [rule, say] of RULES) for (const T of TICKERS) for (const [cn, cased] of CASINGS) {
  if (T.length === 1 && cn === 'lower') continue                            // a lowercase single letter ("a"): the article
  CELLS.push([say(cased(T)), rule, T, cn])
}

describe('ORDINARY slots × homograph tickers: correct or ASK, never a wrong write', () => {
  it(`generated: 8 rules × ${TICKERS.length} derived tickers × 2 casings (lowercase single letters left out) = ${CELLS.length}`, () => expect(CELLS.length).toBe(RULES.length * (TICKERS.length * 2 - TICKERS.filter(t => t.length === 1).length)))

  // OFF BOARD: SPY is the only chart — a stand-in plan on SPY is the ordinary reading or asked (no other chart could be meant)
  it.each(CELLS)('OFF BOARD · stand-in plan on SPY · "%s" (%s, %s, %s): the ordinary reading or asked', async (t) => {
    const m = mount(['SPY'], null)
    const before = stored(m.board, 'w0')
    p.st.envelopes.push(weeklyOn('SPY'))
    await m.say(t)
    if (asked()) expect(stored(m.board, 'w0')).toBe(before)
    else expect(m.board.state.widgets[0].opts.tf, transcript()).toBe('W')
  }, 60000)

  // ON BOARD: SPY clicked and a chart showing T — a stand-in plan on SPY (or the instant path on the click) is ASKED with 0
  // writes; the only other outcome allowed is one that ALSO changed T's chart ("make all charts weekly" on every chart). A WRONG
  // write = SPY changed while T's chart was left as it was.
  it.each(CELLS)('ON BOARD · stand-in plan on SPY · "%s" (%s, %s, %s): asked (0 writes) or T\'s chart changed too — never a wrong write', async (t, rule, T) => {
    const m = mount(['SPY', T], 'w0')
    const before = [stored(m.board, 'w0'), stored(m.board, 'w1')]
    p.st.envelopes.push(weeklyOn('SPY'))
    await m.say(t)
    const after = [stored(m.board, 'w0'), stored(m.board, 'w1')]
    const wrong = after[0] !== before[0] && after[1] === before[1]
    expect(wrong, transcript()).toBe(false)
    if (asked()) expect(after).toEqual(before)
  }, 60000)

  // ON BOARD: the plan lands on T's own chart — correct (or asked); SPY never changes
  it.each(CELLS)('ON BOARD · plan on the ticker\'s own chart · "%s" (%s, %s, %s): correct or asked, SPY untouched', async (t, rule, T) => {
    const m = mount(['SPY', T], 'w0')
    const spy0 = stored(m.board, 'w0'), t0 = stored(m.board, 'w1')
    p.st.envelopes.push(weeklyOn(T))
    await m.say(t)
    expect(stored(m.board, 'w0'), transcript()).toBe(spy0)
    if (!asked()) expect(m.board.state.widgets[1].opts.tf, transcript()).toBe('W')
    else expect(stored(m.board, 'w1')).toBe(t0)
  }, 60000)

  // a VALUE plan (the symbol change the words may mean): it runs, or the instant path reads the ordinary words instead (SPY
  // keeps its symbol), or asked — the one chart there is never given a third symbol
  it.each(CELLS.filter(([, rule]) => /for now|preposition|after the chart/.test(rule)))('VALUE plan · "%s" (%s, %s, %s): the symbol change, the ordinary reading, or asked', async (t, rule, T) => {
    const m = mount(['SPY'], null)
    p.st.envelopes.push(valueOf(T))
    await m.say(t)
    expect(['SPY', T], transcript()).toContain(symOf(m.board, 'w0'))
    if (asked()) expect(symOf(m.board, 'w0')).toBe('SPY')
  }, 60000)
})

// ── NAMED: a signal is never on its own the reason a ticker-slot word is not a ticker ───────────────────────────────────────
describe('NAMED: a homograph or an app word in a TICKER slot always reaches the ask — membership alone decides', () => {
  const SLOTS = [(w) => `change ${w} to weekly`, (w) => `take ${w} to 1h`, (w) => `${w}: weekly`, (w) => `switch to ${w}`]
  const WORDS = ['on', 'now', 'go', 'are', 'study', 'grid', 'left']               // English homographs and app words
  const LEX = new Set(['study', 'grid', 'left'])
  const opts = (verdict) => ({ charts: [{ symbol: 'SPY' }], ordinary: LEX, plainWord: (w) => !LEX.has(w), verdict })
  const CASES = WORDS.flatMap(w => SLOTS.map(s => [s(w), w]))
  it.each(CASES)('"%s": unanswered → unresolved (asked); a ticker answer → asked; only a NO from the search makes it a word', (t, w) => {
    const read = (verdict) => resolveTickerTokens(t, opts(verdict)).find(r => r.upper === w.toUpperCase())
    expect(read(() => 'pending')?.decision).toBe('unresolved')
    expect(['ambiguous', 'ticker']).toContain(read((x) => (x === w ? { kind: 'ticker', ticker: w.toUpperCase() } : null))?.decision)
    expect(read((x) => (x === w ? { kind: 'unknown' } : null))?.decision).toBe('word')
  })
  it.each(CASES)('"%s": the ticker search is asked about it (the app lexicon never filters a ticker slot)', (t, w) => {
    expect(tickerGroundingCandidates(t, { charts: [{ symbol: 'SPY' }], ordinary: LEX, isSymbolWord: (x) => !LEX.has(x), slotsOnly: true })).toContain(w)
  })
  it('panel: "change now to weekly" with a ticker search that never answers → asked, 0 writes', async () => {
    const real = globalThis.fetch
    globalThis.fetch = vi.fn((url, init) => (/ticker-search/.test(String(url)) ? new Promise(() => {}) : real(url, init)))
    const m = mount(['SPY'], null)
    const before = stored(m.board, 'w0')
    p.st.envelopes.push(weeklyOn('SPY'))
    await m.say('change now to weekly')
    expect(asked(), transcript()).toBe(true)
    expect(stored(m.board, 'w0')).toBe(before)
  }, 60000)
})

// ── T10 held directly: in a NEUTRAL slot an app word typed in lowercase is the app's word, even if the search knows it ────────
describe('neutral-slot app word (T10): a lowercase app word outside a ticker slot is a word, whatever the search says', () => {
  const ALL_KNOWN = (w) => ({ kind: 'ticker', ticker: w.toUpperCase() })
  it.each([['make it weekly with the study view', 'STUDY'], ['show the grid view weekly', 'GRID'], ['open the left view hourly', 'LEFT']])('"%s": %s is a word', (t, w) => {
    const LEX = new Set(['study', 'grid', 'left'])
    const r = resolveTickerTokens(t, { charts: [{ symbol: 'SPY' }], ordinary: LEX, plainWord: (x) => !LEX.has(x), verdict: ALL_KNOWN }).find(x => x.upper === w)
    expect(r?.decision).toBe('word')
  })
})

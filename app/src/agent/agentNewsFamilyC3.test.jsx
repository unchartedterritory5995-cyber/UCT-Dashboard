// NEWS FAMILY (Charts Part C3, pl-newsfam) — CLASS-GENERATED readings: every phrasing below is built from templates × verbs ×
// references × destinations, and read by the REAL fast path (fastParse) over a host whose News widget door publishes rows the
// way TradeExchangeNewsWidget's door does (rows it renders + the one the member has open) and whose watchlists are the fixture
// server's. Each generated phrasing must produce EXACTLY the capability + args named; each near-miss must not claim it.
//   C3-147  newsLibrary.toNotebook { headline }            (the row ⋯ menu's Send to Notebook)
//   C3-144  watchlist.add { symbols } → that list          (the row ⋯ menu's Add to Watchlist, its referent: the headline)
// Execution of both is proven on the REAL widget and panel in qa/chartsOutcome/teNewsFamily.outcome.test.jsx; C3-139's routing
// reach (the first model call carries widget.setOption + the News widget's category / linked controls) is measured below.
// Evidence: LOCAL native Windows Node, jsdom, deterministic layers only (no model call).
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { open, outcomeSuite, chart } from './qa/chartsOutcome/outcomeHarness'
import { publishWidgetDoor } from '../pages/charts/widgetDoors'
import { fastParse } from './fastPath'
import { getCapability } from './capabilities'
import { wordsSelect } from './routing'
import { _resetNewsLibraryForTests } from './capabilities/newsLibrary'
import { setupPanel, ONE } from './testing/panelHarness'
import { loadAgentConfig, _resetAgentConfig } from './agentClient'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await outcomeSuite()

const ROWS = [
  { id: 'r1', text: 'SYNTHETIC: TSLA deliveries beat today', tickers: ['TSLA'], time: 1 },
  { id: 'r2', text: 'SYNTHETIC: NVDA and AMD rally on chip demand', tickers: ['NVDA', 'AMD'], time: 2 },
  { id: 'r3', text: 'SYNTHETIC: Fed holds rates steady', tickers: [], time: 3 },
  { id: 'r4', text: 'SYNTHETIC: AAPL unusual call volume', tickers: ['AAPL'], time: 4 },
]
let host
let selected = 'r1'
function board() {
  _resetNewsLibraryForTests()
  const m = open([chart('c1', 0, 0, 12, 20), { id: 'tn', type: 'tradeExchangeNews', x: 12, y: 0, w: 12, h: 20, color: 'N', opts: {} }], { 'N:c1': 'NVDA' },
    { extra: { watchlists: [{ id: 'w1', name: 'Momentum', symbols: ['MSFT'] }, { id: 'w2', name: 'Core', symbols: ['SPY'] }] } })
  publishWidgetDoor('tn', () => ({ read: () => ({ search: '', visible: ROWS, selected }) }))
  return m.h
}
const read = (text) => fastParse(text, { host })
const opOf = (r) => (r?.kind === 'ops' && r.ops.length === 1 ? r.ops[0] : null)
const cross = (...xs) => xs.reduce((acc, x) => acc.flatMap(a => x.map(b => [...a, b])), [[]])

// ── C3-147: the generated phrasings ──
const NB_VERBS = ['send', 'put', 'add', 'drop', 'clip', 'copy', 'capture', 'save', 'stick', 'throw', 'pop']
const NB_POINTERS = ['this headline', 'that headline', 'the selected headline', 'this story', 'that story', 'this article', 'the open headline', 'this news item']
const NB_TICKERS = [['the TSLA headline', 'TSLA'], ['the tsla story', 'TSLA'], ['the aapl article', 'AAPL'], ['my TSLA headline', 'TSLA']]
const NB_QUOTED = [['the "TSLA deliveries beat" headline', 'tsla deliveries beat'], ['"Fed holds rates steady"', 'fed holds rates steady'], ['the "unusual call volume" story', 'unusual call volume']]
const NB_PREPS = ['to', 'into', 'in']
const NB_DESTS = ['my notebook', 'the notebook', 'my journal', 'the journal', 'my notebook inbox', 'my current note', 'my uct notebook']
const NB_CASES = [
  ...cross(NB_VERBS, NB_POINTERS, NB_PREPS, NB_DESTS).map(([v, r, p, d]) => [`${v} ${r} ${p} ${d}`, 'selected']),
  ...cross(NB_VERBS, NB_TICKERS, ['to', 'into'], NB_DESTS.slice(0, 4)).map(([v, [r, want], p, d]) => [`${v} ${r} ${p} ${d}`, want]),
  ...cross(['send', 'clip', 'put'], NB_QUOTED, ['to', 'into'], ['my notebook', 'my journal']).map(([v, [r, want], p, d]) => [`${v} ${r} ${p} ${d}`, want]),
  ...['please send this headline to my notebook', 'Send this headline to my Notebook', 'send this headline to my notebook please', 'now send this headline to my notebook'].map(t => [t, 'selected']),
]
const NB_NEAR = [
  'send the news widget to my notebook', 'send this chart to my journal', 'add a note to the TSLA headline: watch it', 'save the TSLA headline',
  'save this headline', 'send the headline to my notebook', 'send it to my notebook', 'send this to my notebook', 'put the TSLA headline in my Momentum collection',
  'send the TSLA headline to Momentum', 'open my notebook', 'add TSLA to my notebook', 'send all the headlines to my notebook', 'send this headline to my email',
  'send this one to my notebook', 'send the story to my journal', 'put the article in my notebook',
]

// ── C3-144: the generated phrasings ──
const WL_VERBS = ['add', 'put', 'drop', 'stick', 'throw']
const WL_ONE = ['ticker', 'symbol', 'stock', 'name', 'company']
const WL_MANY = ['tickers', 'symbols', 'stocks', 'names', 'companies']
const WL_FROM = ['from', 'in', 'of', 'on']
const WL_PTR = ['this headline', 'the selected headline', 'that story', 'the open article', 'this news item', 'the highlighted headline']
const WL_LISTS = [['Momentum', 'w1'], ['my Momentum list', 'w1'], ['the Momentum watchlist', 'w1'], ['momentum', 'w1'], ['Core', 'w2'], ['my core watchlist', 'w2']]
const WL_ONE_TICKER = [
  // the shape "<verb> the <noun> from <headline> to <list>"
  ...cross(WL_VERBS, [...WL_ONE, ...WL_MANY], WL_FROM, WL_PTR, ['to', 'onto', 'into'], WL_LISTS).map(([v, n, f, r, p, [l, id]]) => [`${v} the ${n} ${f} ${r} ${p} ${l}`, id]),
  // "<verb> <headline>'s <noun> to <list>"
  ...cross(WL_VERBS, WL_PTR, [...WL_ONE, ...WL_MANY], ['to', 'on'], WL_LISTS).map(([v, r, n, p, [l, id]]) => [`${v} ${r}'s ${n} ${p} ${l}`, id]),
  // "<verb> <headline> to <list> watchlist / list"
  ...cross(WL_VERBS, WL_PTR, ['to', 'onto'], [['my Momentum list', 'w1'], ['the Momentum watchlist', 'w1'], ['my core watchlist', 'w2']]).map(([v, r, p, [l, id]]) => [`${v} ${r} ${p} ${l}`, id]),
]
const WL_NEAR = [
  'add the TSLA headline to my Momentum collection', 'add this headline to Momentum', 'add this headline to my notebook', 'add TSLA to Momentum',
  'add the ticker to Momentum', 'add this chart\'s ticker to Momentum', 'add this headline\'s ticker to my Biotech list', 'add the stocks from my screen to Momentum',
  'remove this headline\'s ticker from Momentum', 'save this headline',
]

describe('C3-147: "send <a headline> to my notebook" — generated phrasings → newsLibrary.toNotebook', () => {
  beforeAll(() => { selected = 'r1'; host = board() })
  afterEach(() => { /* the host stays mounted for the whole set */ })
  it(`${NB_CASES.length} generated phrasings each read as newsLibrary.toNotebook with the headline reference`, () => {
    const bad = []
    for (const [text, want] of NB_CASES) {
      const o = opOf(read(text))
      const ok = o?.action === 'newsLibrary.toNotebook' && (want === 'selected' ? o.args.headline === 'selected' : String(o.args.headline).toLowerCase() === want.toLowerCase())
      if (!ok) bad.push(`${text} → ${JSON.stringify(o)}`)
    }
    expect(bad).toEqual([])
    expect(NB_CASES.length).toBeGreaterThan(700)
  }, 120000)
  it.each(NB_NEAR)('near-miss "%s" is NOT read as a Notebook send', (text) => {
    expect(opOf(read(text))?.action).not.toBe('newsLibrary.toNotebook')
  })
  it('the capability is a card with no Undo (it writes into the member\'s notes)', () => {
    const c = getCapability('newsLibrary.toNotebook')
    expect(c.risk).toBe('confirm')
    expect(c.undo).toBe('none')
  })
  it('routing: the words name the newsLibrary group (its context is built), never for a widget capture', () => {
    for (const [text] of NB_CASES.filter(([t]) => /headline|story|article/.test(t) && /notebook|journal/.test(t)).slice(0, 200)) expect(wordsSelect('newsLibrary', text), text).toBe(true)
    expect(wordsSelect('newsLibrary', 'put the news and catalysts feed in a fresh journal note')).toBe(false)
    expect(wordsSelect('newsLibrary', 'send the alerts widget to my journal')).toBe(false)
  })
})

describe('C3-144: "add <a headline>\'s ticker to <list>" — generated phrasings → watchlist.add over that headline\'s own tickers', () => {
  it(`${WL_ONE_TICKER.length} generated phrasings, the open headline naming ONE ticker: watchlist.add [TSLA] on the named list`, () => {
    selected = 'r1'; host = board()
    const bad = []
    for (const [text, id] of WL_ONE_TICKER) {
      const r = read(text)
      const o = opOf(r)
      if (!(o?.action === 'watchlist.add' && JSON.stringify(o.args) === JSON.stringify({ symbols: ['TSLA'] }) && o.target === id)) bad.push(`${text} → ${JSON.stringify(r)}`)
    }
    expect(bad).toEqual([])
    expect(WL_ONE_TICKER.length).toBeGreaterThan(2000)
  }, 240000)
  it('the open headline naming TWO tickers: a plural noun adds both; a singular one asks which, in fixed words (no op)', () => {
    selected = 'r2'; host = board()
    const bad = []
    for (const [text] of WL_ONE_TICKER) {
      const r = read(text)
      const noun = /\b(tickers?|symbols?|stocks?|names?|compan(?:y|ies))\b/.exec(text)?.[1] || null
      const plural = !!noun && /(?:s|ies)$/.test(noun)
      if (plural) { const o = opOf(r); if (!(o?.action === 'watchlist.add' && JSON.stringify(o.args.symbols) === '["NVDA","AMD"]')) bad.push(`${text} → ${JSON.stringify(r)}`) } else if (!(r?.kind === 'say' && /NVDA and AMD/.test(r.text) && /Nothing was changed/.test(r.text))) bad.push(`${text} → ${JSON.stringify(r)}`)
    }
    expect(bad).toEqual([])
  }, 240000)
  it('a headline that names no ticker: said in fixed words, no op', () => {
    selected = 'r3'; host = board()
    const r = read('add this headline\'s ticker to Momentum')
    expect(r?.kind).toBe('say')
    expect(r.text).toMatch(/names no ticker/)
  })
  it('a headline named by its ticker or a quoted phrase (nothing open): that row\'s own tickers', () => {
    selected = null; host = board()
    expect(opOf(read('add the tickers from the AAPL headline to Core'))?.args).toEqual({ symbols: ['AAPL'] })
    expect(opOf(read('add the tickers from the "chip demand" story to Core'))).toBe(null)          // < 3 words: not a phrase
    expect(opOf(read('add the tickers from the "rally on chip demand" story to Core'))?.args).toEqual({ symbols: ['NVDA', 'AMD'] })
    expect(read('add this headline\'s ticker to Core')?.kind).toBe('say')                      // "this" with nothing open: asked
  })
  it.each(WL_NEAR)('near-miss "%s" does not add a headline\'s tickers', (text) => {
    selected = 'r1'; host = board()
    const o = opOf(read(text))
    expect(o?.action === 'watchlist.add' && JSON.stringify(o.args.symbols) === '["TSLA"]' && !/\bTSLA\b/.test(text)).toBe(false)
  })
})

// ── C3-139: routing reach of the first model call for generated category / linked phrasings (as agentExecReach measures) ──
const CAT_VERBS = ['only show', 'filter the news widget to', 'show just', 'just show me']
const CATS = ['earnings', 'macro', 'options', 'press release', 'filing']
const CAT_TAIL = ['headlines in the news widget', 'news on the trade exchange feed', 'headlines on the news feed']
const LINKED = ['link the news widget to my chart', 'only show news for the linked symbol in the news widget', 'turn on linked on the news widget', 'make the news widget follow my chart symbol',
  'stop showing only the linked symbol\'s news in the news widget', 'turn off the linked filter on the news widget']
// (not generated: "unlink the news widget from the chart" — that is the board's colour-group link, workspace widget.color, not
// the widget's Linked filter; it reaches the workspace group, as it should)
const REACH_CASES = [...cross(CAT_VERBS.slice(0, 2), CATS, CAT_TAIL.slice(0, 2)).map(([v, c, t]) => `${v} ${c} ${t}`), ...LINKED]
const w = (id, type, x, y, opts = {}) => ({ id, type, x, y, w: 2, h: 4, color: 'N', opts })
describe('C3-139: the first model call for a category / linked filter carries widget.setOption and the News widget\'s controls', () => {
  afterEach(() => { cleanup(); localStorage.clear(); _resetAgentConfig() })
  for (const v2 of [false, true]) {
    it(`routing ${v2 ? 'v2' : 'v1'}: ${REACH_CASES.length} generated phrasings`, async () => {
      const miss = []
      for (const text of REACH_CASES) {
        const p = setupPanel()
        const base = globalThis.fetch
        globalThis.fetch = async (url, init) => (url === '/api/agent/config'
          ? new Response(JSON.stringify({ conversations: [], routing_v2: v2 }), { status: 200, headers: { 'content-type': 'application/json' } }) : base(url, init))
        localStorage.setItem('uct.agent.routingV2', v2 ? '1' : '0')
        _resetAgentConfig()
        await loadAgentConfig()
        const [[c], syms] = ONE('NVDA')
        const { say } = p.mount([{ ...c, w: 12 }, w('tn', 'tradeExchangeNews', 12, 0)], syms)
        await say(text)
        const first = p.st.calls.find(x => x[1] === '/api/agent/turn')?.[2] || null
        const controls = first?.context?.widgetControls?.[0]?.controls?.tradeExchangeNews || null
        const ok = !!first && first.capabilities.some(x => x.name === 'widget.setOption') && !!controls
        if (!ok) miss.push(text)
        cleanup(); localStorage.clear()
      }
      console.log(`[reach C3-139 ${v2 ? 'v2' : 'v1'}] ${REACH_CASES.length - miss.length}/${REACH_CASES.length} misses: ${JSON.stringify(miss)}`)
      expect(miss).toEqual([])
    }, 240000)
  }
})

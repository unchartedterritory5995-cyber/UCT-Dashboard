// HELD-OUT family (pl-grid, after #1016 ROUTE-NOUN and #1027's "narrow the price column" pin): the CHART-GEOMETRY words
// (width / wide / widen / narrow / header / resize, every inflection) are chart vocabulary. A request that uses one:
//   1. is never read as a TICKER by the pre-model price fast path (marketDataPhrases.js parsePriceSentence → null);
//   2. routes to the CHART: the charts group and the board's resize (workspace group) both reach the model;
//   3. "widen / narrow <a chart>" is read like "make <that chart> wider / narrower" (boardPhrase), and only for a chart:
//      the same verbs on another widget ("narrow the watchlist", which may mean a filter) are left to the model;
//   4. SAFETY (#988 style): a request that names an EXCLUDED chart is never applied to it locally.
// Phrasings are generated from the word family, not tuned per sentence. LOCAL: unit + jsdom panel, scripted model.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, FOUR, bareSettings } from './testing/panelHarness'
import { fastParse } from './fastPath'
import { parsePriceSentence } from './capabilities/marketDataPhrases'
import { selectGroups, wordsSelect } from './routing'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const FAMILY = ('width widths wide wider widest widen widens widened widening narrow narrows narrower narrowest narrowed '
  + 'narrowing header headers resize resizes resized resizing').split(' ')

describe('1. a chart-geometry word is never a ticker (pre-model price fast path)', () => {
  const FRAMES = [
    (w) => `${w} the price column to 50`,
    (w) => `show the price ${w}`,
    (w) => `what is the price ${w}`,
    (w) => `${w} the price chart`,
  ]
  it.each(FAMILY.flatMap(w => FRAMES.map(f => [w, f(w)])))('%s: "%s" is not a price question', (_w, text) => {
    expect(parsePriceSentence(text), JSON.stringify(parsePriceSentence(text))).toBeNull()
  })
  it.each([['what is the price of WIDE', 'WIDE'], ['price of $NARROW', 'NARROW'], ['what is the price of NVDA', 'NVDA'], ['nvda price', 'NVDA']])(
    'control: "%s" is still a quote for %s', (text, sym) => {
      const r = parsePriceSentence(text)
      expect(r?.intent).toBe('quote')
      expect(r.candidates.map(c => c.text.toUpperCase().replace(/^\$/, ''))).toContain(sym)
    })
})

describe('2. a chart-geometry request routes to the chart (charts + the board resize), never to a list or the screener', () => {
  const VERBS = ['widen', 'narrow', 'resize']
  const GERUNDS = ['widening', 'narrowing', 'resizing']
  const CHARTS = ['the chart', 'the AAPL chart', 'this chart', 'my NVDA chart']
  const CASES = [
    ...VERBS.flatMap(v => CHARTS.map(c => `${v} ${c}`)),
    ...VERBS.flatMap(v => CHARTS.map(c => `can you ${v} ${c} a bit`)),
    ...GERUNDS.flatMap(g => CHARTS.map(c => `try ${g} ${c}`)),
    ...CHARTS.map(c => `change the width of ${c}`), ...CHARTS.map(c => `set ${c} width to half`),
    ...CHARTS.map(c => `make ${c} twice as wide`), ...CHARTS.map(c => `${c} is too narrow`),
  ]
  it.each(CASES)('"%s" → charts and workspace', (text) => {
    const { selected } = selectGroups(text)
    expect(selected).toEqual(expect.arrayContaining(['charts', 'workspace']))
    expect(selected).not.toContain('screener')
    expect(selected).not.toContain('lists')
    expect(parsePriceSentence(text)).toBeNull()
  })
  it.each(['hide the chart header', 'hide the chart headers', 'show the headers on this chart', 'turn off the header on the AAPL chart'])(
    'a chart HEADER is the chart\'s display: "%s" → charts', (text) => {
      expect(selectGroups(text).selected).toContain('charts')
      expect(parsePriceSentence(text)).toBeNull()
    })
  it.each(['make the price axis wider', 'widen the price axes'])('a chart AXIS is the chart\'s: "%s" → charts too', (text) => {
    expect(selectGroups(text).selected).toContain('charts')
  })
  // controls: "narrow" of a screen / list is a refinement — the board's resize is not brought for it
  it.each(['narrow my screen to tech stocks', 'narrow the screen results to large caps', 'narrow it down to semis', 'narrow the scan to stocks above the 50 day'])('control: "%s" does not bring the board resize', (text) => {
    expect(wordsSelect('workspace', text)).toBe(false)
  })
})

const chartW = (id, x, w) => ({ id, type: 'chart', x, y: 0, w, h: 20, color: 'N', opts: { settings: bareSettings() } })
const wl = (x) => ({ id: 'wl', type: 'watchlist', x, y: 0, w: 6, h: 20, color: 'N', opts: {} })
const CHART_WL = () => [[chartW('c', 0, 18), wl(18)], { 'N:c': 'BRCB' }]

describe('3. "widen / narrow <a chart>" reads as "make <that chart> wider / narrower" — for a chart only', () => {
  const NAMES = ['the chart', 'my chart', 'the left chart', 'this chart']
  const MODS = ['', ' a little', ' slightly', ' a lot', ' by 3']
  const AS_MAKE = { widen: 'wider', narrow: 'narrower' }
  const cases = Object.keys(AS_MAKE).flatMap(v => NAMES.flatMap(n => MODS.map(m => [v, n, m])))
  it.each(cases)('"%s %s%s" = the "make … wider / narrower" reading', (v, n, m) => {
    const p = setupPanel()
    const { board } = p.mount(...CHART_WL())
    const want = fastParse(`make ${n} ${m.trim() && !m.startsWith(' by') ? `${m.trim()} ` : ''}${AS_MAKE[v]}${m.startsWith(' by') ? m : ''}`, { host: board.host })
    expect(want?.ops?.[0]?.action, 'the make-reading this is compared with').toBe('widget.resize')
    const got = fastParse(`${v} ${n}${m}`, { host: board.host })
    expect(got?.ops).toEqual(want.ops)
    expect(got.ops[0].args.widget).toBe('c')
  })
  it.each(['widen the watchlist', 'narrow the watchlist', 'narrow my watchlist a little'])('"%s": not a chart, left to the model', (text) => {
    const p = setupPanel()
    const { board } = p.mount(...CHART_WL())
    expect(fastParse(text, { host: board.host })).toBeNull()
  })
})

describe('4. SAFETY (#988 style): a request naming an EXCLUDED chart never applies to it locally', () => {
  const EXCLUDED = [
    ['widen every chart except the top left one', 'c0'],
    ['narrow the top left chart, not the top right one', 'c1'],
    ['widen the charts but not the top left chart', 'c0'],
    ['narrow all the charts other than the bottom right one', 'c3'],
    ['make every chart but the top left one narrower', 'c0'],
    ['resize the charts except the top right chart', 'c1'],
    ['widen the chart that is not the top left one', 'c0'],
    ['narrow everything except the top left chart', 'c0'],
  ]
  it.each(EXCLUDED)('"%s": %s is never the local target, and nothing moves without the model', async (text, ex) => {
    const p = setupPanel()
    const { board, say } = p.mount(...FOUR())
    const f = fastParse(text.toLowerCase(), { host: board.host })
    for (const op of f?.ops || []) expect(op.args?.widget, JSON.stringify(op)).not.toBe(ex)
    const before = JSON.stringify(board.state.widgets)
    await say(text)
    expect(JSON.stringify(board.state.widgets)).toBe(before)        // the scripted model planned nothing
    expect(p.turns()).toBe(1)                                        // the request went to the model, not a fast path
  }, 30000)
})

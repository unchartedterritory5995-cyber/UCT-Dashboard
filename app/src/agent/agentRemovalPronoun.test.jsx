// ⛔ REMOVAL PRONOUN · AUDIT held-out probe 61a (2026-11-16, LIVE safety gap): board SPY · QQQ · IWM, nothing selected, no
// conversation chart, the member says "close it", the model plan removes QQQ → APPLIED. "it" is no chart noun, so the fail-closed
// rule of #1416 (SPECIFIC_CHART) never fired.
//
// RULE (chartRail removalPronouns / removalTargets — the SAME removal reader): a bare object PRONOUN of a removal verb resolves as a
// deixis: (1) the selected chart; (2) else the conversation's chart; (3) else 2+ chart OBJECTS (a link group is one) → asked, never
// applied; (4) else the sole chart object. "them" / "those" → the selection + conversation chart set, else asked. A plan closing any
// other chart is refused. GENERATED: pronoun × verb × context × board size × plan target.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, removalTargets, removalPronouns, REMOVAL_PRONOUNS } from './chartRail'
import { AuthContext } from './../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const settings = () => ({ settings: mergeChartSettings(null) })
const SYMS = ['SPY', 'QQQ', 'IWM', 'DIA']
const layoutOf = (n) => (n === 4
  ? [0, 1, 2, 3].map(i => ({ x: (i % 2) * 12, y: Math.floor(i / 2) * 10, w: 12, h: 10 }))
  : Array.from({ length: n }, (_, i) => ({ x: i * Math.floor(24 / n), y: 0, w: Math.floor(24 / n), h: 20 })))
function boardOf(syms, { colors = null, selected = null } = {}) {
  const lay = layoutOf(syms.length)
  const widgets = syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', ...lay[i], color: colors?.[i] || 'N', opts: settings() }))
  const groupSyms = {}
  syms.forEach((s, i) => { groupSyms[(colors?.[i] || 'N') === 'N' ? `N:c${i + 1}` : colors[i]] = s })
  const b = makeBoard(widgets, groupSyms)
  b.host = { ...b.host, charts: { ...b.host.charts, selected: () => selected } }
  return b
}
const removal = (b, refs) => planOps(collectTargets(b.host, ['board']), [].concat(refs).map(ref => ({ action: 'widget.remove', target: 'board', args: { widget: ref } })), {}, { surface: 'charts' })
const rail = (b, refs, words, opts = {}) => {
  const p = removal(b, refs)
  expect(p.ok, `plan widget.remove ${refs}`).toBe(true)
  return chartRailRefusal(p, { words, host: b.host, mode: 'apply', ...opts })
}
const ASKED = /^Which chart should I close\? Nothing is selected, so I can’t tell which chart “[^”]+” means/
const REFUSED = /^Which chart should I close\?/
const GATE = /you didn’t ask to remove a chart/
const NOT_CHART = /^I didn’t close a chart: “[^”]+” here (?:means the |is about something on the chart)/

// ── the removal verbs, each in the place it takes its object ──
const VERBS = {
  close: (p) => `close ${p}`,
  remove: (p) => `remove ${p}`,
  delete: (p) => `delete ${p}`,
  'get rid of': (p) => `get rid of ${p} please`,
  drop: (p) => `drop ${p}`,
  'take off': (p) => `take ${p} off`,
  'take down': (p) => `take down ${p}`,
}
const PLURAL = new Set(['them', 'those'])

describe('the pronoun reader', () => {
  it('reads every pronoun form under every verb, with its own span', () => {
    for (const p of REMOVAL_PRONOUNS) for (const [v, f] of Object.entries(VERBS)) {
      const w = f(p)
      const got = removalPronouns(w)
      expect(got.length, `${v}: ${w}`).toBe(1)
      expect(w.slice(got[0].index, got[0].index + got[0].length), w).toBe(p)
      expect(got[0].plural, w).toBe(PLURAL.has(p))
    }
  })
  it.each(['make it weekly and close the SPY chart', 'close the SPY chart and make it weekly', 'close that SPY chart', 'close this chart',
    'close all of them', 'close both of them', 'close the one I just changed'])('"%s" → no pronoun object', (w) => {
    expect(removalPronouns(w)).toEqual([])
  })
  it('probe 64a-7: "remove it from my watchlist" is a pronoun taken out of a THING container (no chart)', () => {
    expect(removalPronouns('remove it from my watchlist').map(p => [p.phrase, p.from, p.container])).toEqual([['it', 'thing', 'watchlist']])
  })
})

// ── GENERATED: pronoun × verb × context × board size × plan target ──
// contexts: none (no selection, no conversation chart), selected chart k, conversation chart k; a 1-chart board under "none" is the
// SOLE chart
const CASES = []
for (const p of REMOVAL_PRONOUNS) for (const verb of Object.keys(VERBS)) for (const n of [1, 2, 3, 4]) {
  const ctxs = [['none', null], ...Array.from({ length: n }, (_, k) => [['selected', k], ['conversation', k]]).flat()]
  for (const [ctx, k] of ctxs) for (let j = 0; j < n; j++) CASES.push([p, verb, n, ctx === 'none' && n === 1 ? 'sole' : ctx, k, j])
}
describe(`PRONOUN · generated: pronoun × verb × context × board × plan target (${CASES.length} cases)`, () => {
  it.each(CASES)('"%s" · %s · %i charts · %s #%s · plan closes #%i', (p, verb, n, ctx, k, j) => {
    const words = VERBS[verb](p)
    const b = boardOf(SYMS.slice(0, n), { selected: ctx === 'selected' ? `c${k + 1}` : null })
    const subject = ctx === 'conversation' ? `c${k + 1}` : null
    const got = rail(b, `c${j + 1}`, words, { subject })
    if (ctx === 'none' || (ctx === 'sole' && PLURAL.has(p))) {
      // nothing resolves it → asked, never applied (them / those on the sole chart: no set named → asked)
      expect(got, words).toMatch(ASKED)
    } else if ((ctx === 'sole' || j === k) && verb === 'take off' && !/ one$/.test(p)) {
      // ⛔ probe 62 A1: "take <it> off" alone is no chart removal (it may be the indicator just added) — the removal gate refuses
      // it as on master, whatever the pronoun resolves to; never applied ("take that one off": #1416's REMOVAL_TAKE, as before)
      expect(got, words).toMatch(GATE)
    } else if (ctx === 'sole') {
      expect(got, words).toBeNull()
    } else if (j === k) {
      expect(got, words).toBeNull()
    } else {
      expect(got, words).toMatch(REFUSED)
    }
  })
})

describe('PRONOUN · precedence and sets', () => {
  const words = (p) => `close ${p}`
  it.each(['it', 'that', 'this', 'that one', 'this one'])('"%s" with a selection AND a conversation chart → the selected chart only', (p) => {
    for (const j of [0, 1, 2]) {
      const got = rail(boardOf(SYMS.slice(0, 3), { selected: 'c1' }), `c${j + 1}`, words(p), { subject: 'c3' })
      if (j === 0) expect(got, `${p} #${j}`).toBeNull()
      else expect(got, `${p} #${j}`).toMatch(REFUSED)
    }
    expect([...removalTargets(words(p), boardOf(SYMS.slice(0, 3), { selected: 'c1' }).host, { selected: 'c1', subject: 'c3' }).ids]).toEqual(['c1'])
  })
  it.each(['them', 'those'])('"%s" → the selection + conversation chart set; a plan closing that set applies, any other chart refused', (p) => {
    const B = () => boardOf(SYMS.slice(0, 3), { selected: 'c1' })
    expect(rail(B(), ['c1', 'c3'], words(p), { subject: 'c3' })).toBeNull()
    expect(rail(B(), 'c3', words(p), { subject: 'c3' })).toBeNull()
    expect(rail(B(), 'c2', words(p), { subject: 'c3' })).toMatch(REFUSED)
    expect(rail(B(), ['c1', 'c2'], words(p), { subject: 'c3' })).toMatch(REFUSED)
  })
  it('a link group is ONE object: no context on SPY(A) · SPY(A) · QQQ → asked; on NVDA(A) ×3 → the sole object', () => {
    for (const j of [0, 1, 2]) expect(rail(boardOf(['SPY', 'SPY', 'QQQ'], { colors: ['A', 'A', 'N'] }), `c${j + 1}`, 'close it')).toMatch(ASKED)
    for (const j of [0, 1, 2]) expect(rail(boardOf(['NVDA', 'NVDA', 'NVDA'], { colors: ['A', 'A', 'A'] }), `c${j + 1}`, 'close it')).toBeNull()
  })
  it('the selected chart of a link group names its group: the pair closes, the other chart is refused', () => {
    const B = () => boardOf(['SPY', 'SPY', 'QQQ'], { colors: ['A', 'A', 'N'], selected: 'c1' })
    expect(rail(B(), 'c1', 'remove that')).toBeNull()
    expect(rail(B(), 'c2', 'remove that')).toBeNull()
    expect(rail(B(), 'c3', 'remove that')).toMatch(REFUSED)
  })
  it('probe 62 A1: "take it off" (an indicator was just added) never closes the selected chart — refused as on master', () => {
    expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c2' }), 'c2', 'take it off')).toMatch(GATE)
    expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c2' }), 'c1', 'take it off')).toMatch(REFUSED)
  })
})

// ── CONTROLS: a pronoun in a non-removal clause; named removals; whole-board removals — unchanged ──
describe('PRONOUN · controls', () => {
  it.each([null, 'c2', 'c3'])('"make it weekly and close the SPY chart" (selected %s) → only the SPY chart is the target', (sel) => {
    for (const j of [0, 1, 2]) {
      const got = rail(boardOf(SYMS.slice(0, 3), { selected: sel }), `c${j + 1}`, 'make it weekly and close the SPY chart')
      if (j === 0) expect(got).toBeNull()
      else expect(got).toMatch(REFUSED)
    }
  })
  it('"close the SPY chart and make it weekly" with a conversation chart QQQ → only SPY', () => {
    expect(rail(boardOf(SYMS.slice(0, 3)), 'c1', 'close the SPY chart and make it weekly', { subject: 'c2' })).toBeNull()
    expect(rail(boardOf(SYMS.slice(0, 3)), 'c2', 'close the SPY chart and make it weekly', { subject: 'c2' })).toMatch(REFUSED)
  })
  it.each([['close the SPY chart', 0], ['remove the QQQ chart', 1], ['get rid of the right chart', 2], ['delete the middle one', 1]])('named: "%s" unchanged', (words, k) => {
    for (const j of [0, 1, 2]) {
      const got = rail(boardOf(SYMS.slice(0, 3)), `c${j + 1}`, words)
      if (j === k) expect(got, words).toBeNull()
      else expect(got, words).toMatch(REFUSED)
    }
  })
  it.each(['close all my charts', 'clear the board', 'close all of them', 'close them all', 'close everything'])('whole board: "%s" → applies', (words) => {
    for (const j of [0, 1, 2]) expect(rail(boardOf(SYMS.slice(0, 3)), `c${j + 1}`, words), words).toBeNull()
  })
  // (D31 P2 safety, 11-17: "both of them" on THREE charts with nothing pointed names no two — asked, never a pick; on two: applies)
  it('"remove both of them": three charts, nothing pointed → asked; two charts → applies', () => {
    for (const j of [0, 1, 2]) expect(rail(boardOf(SYMS.slice(0, 3)), `c${j + 1}`, 'remove both of them')).toMatch(/^Which chart should I close\?/)
    for (const j of [0, 1]) expect(rail(boardOf(SYMS.slice(0, 2)), `c${j + 1}`, 'remove both of them')).toBeNull()
  })
  it('a pronoun with no removal plan changes nothing: "make it weekly" is no removal', () => {
    expect(rail(boardOf(SYMS.slice(0, 3)), 'c1', 'make it weekly')).toMatch(/you didn’t ask to remove a chart/)
  })
})

// ── ⛔ AUDIT probe 62 · ANTECEDENT: words that name a thing ON a chart before the pronoun → the pronoun is THAT thing; a plan closing a
// chart is refused. GENERATED: each vocabulary source × a sample of its nouns × pronoun × removal verb × context × plan target.
// (the sources are the Agent's own readers: deixis PLACED / ONE_IS_A_THING / the live indicator catalog's ids, stateRail CLASS)
const ANTECEDENTS = {
  'deixis PLACED (chart-surface nouns)': ['an alert', 'a note', 'a level', 'volume', 'a label', 'a marker', 'a drawing', 'an overlay'],
  'deixis ONE_IS_A_THING': ['a pane', 'a study', 'an indicator', 'a list'],
  'indicator catalog ids (knownIndicator)': ['an RSI', 'a MACD', 'the vwap', 'an ATR', 'the obv', 'an adx', 'a supertrend', 'a stochrsi'],
  'stateRail CLASS.indicator': ['a 50 day moving average', 'an ema', 'a 20 sma', 'bollinger bands', 'a signal line'],
  'stateRail CLASS.drawing': ['a trendline', 'a fib', 'a rectangle', 'an annotation', 'a ray', 'a horizontal', 'a pitchfork'],
}
// (never a verb list: the clause that names the thing takes any verb, or none)
const LEADS = [(t) => `add ${t}, then `, (t) => `I just put ${t} on there and now `, (t) => `${t}? `]
const ANT_CASES = []
for (const [src, nouns] of Object.entries(ANTECEDENTS)) for (const noun of nouns) for (const p of ['it', 'that', 'this', 'them']) for (const verb of Object.keys(VERBS)) {
  for (const ctx of ['none', 'selected', 'conversation', 'sole']) ANT_CASES.push([src, noun, p, verb, ctx])
}
describe(`ANTECEDENT · a pronoun after a non-chart thing never closes a chart (${ANT_CASES.length} cases × 3 leads × each plan target)`, () => {
  it.each(ANT_CASES)('%s · "%s" · "%s" · %s · %s', (_src, noun, p, verb, ctx) => {
    const n = ctx === 'sole' ? 1 : 3
    for (const lead of LEADS) for (let j = 0; j < n; j++) {
      const words = `${lead(noun)}${VERBS[verb](p)}`
      const b = boardOf(SYMS.slice(0, n), { selected: ctx === 'selected' ? 'c2' : null })
      const got = rail(b, `c${j + 1}`, words, { subject: ctx === 'conversation' ? 'c2' : null })
      expect(got, `${words} · plan closes #${j + 1}`).not.toBeNull()
      expect(got, words).toMatch(NOT_CHART)
    }
  })
  it.each(['I put an RSI on the SPY chart, now delete it', 'add a trendline to my SPY chart and get rid of it', 'set an alert on the left chart, then close it'])('a chart word that only says WHERE a thing went is a place: "%s" → the thing; no chart closes', (words) => {
    for (const j of [0, 1, 2]) expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c1' }), `c${j + 1}`, words), words).toMatch(NOT_CHART)
  })
  it('a chart word nearer the pronoun wins: "I added an rsi earlier; the SPY chart is done, close it" closes SPY, never another', () => {
    const words = 'I added an rsi earlier; the SPY chart is done, close it'
    expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c1' }), 'c1', words)).toBeNull()
    expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c1' }), 'c2', words)).toMatch(REFUSED)
  })
  it('a chart named elsewhere in the words is still closed: "add an RSI, delete it, and close the SPY chart"', () => {
    expect(rail(boardOf(SYMS.slice(0, 3)), 'c1', 'add an RSI, delete it, and close the SPY chart')).toBeNull()
    expect(rail(boardOf(SYMS.slice(0, 3)), 'c2', 'add an RSI, delete it, and close the SPY chart')).toMatch(REFUSED)
  })
})

// ── ⛔ probe 62 · CONTINUATIONS: a pronoun (or its particle) the words go on past — to / of / a / an / by / into, "from the chart" —
// is no removal object. GENERATED: continuation × pronoun × verb × context × plan target → never applied.
const CONTS = ['to weekly', 'to the 5 minute', 'a timeframe', 'a notch', 'of drawings', 'of all the lines', 'by one timeframe', 'into the daily', 'from the chart']
const CONT_VERBS = {
  close: (p, c) => `close ${p} ${c}`,
  remove: (p, c) => `remove ${p} ${c}`,
  delete: (p, c) => `delete ${p} ${c}`,
  'get rid of': (p, c) => `get rid of ${p} ${c}`,
  drop: (p, c) => `drop ${p} ${c}`,
  'take off': (p, c) => `take ${p} off ${c}`,
  'take down': (p, c) => `take ${p} down ${c}`,
  'take down (verb first)': (p, c) => `take down ${p} ${c}`,
  clear: (p, c) => `clear ${p} ${c}`,
}
const CONT_CASES = []
for (const c of CONTS) for (const p of REMOVAL_PRONOUNS) for (const verb of Object.keys(CONT_VERBS)) for (const ctx of ['none', 'selected', 'conversation', 'sole']) CONT_CASES.push([c, p, verb, ctx])
describe(`CONTINUATION · a pronoun the words go on past is no removal (${CONT_CASES.length} cases × each plan target)`, () => {
  it.each(CONT_CASES)('"… %s" · "%s" · %s · %s', (c, p, verb, ctx) => {
    const words = CONT_VERBS[verb](p, c)
    const n = ctx === 'sole' ? 1 : 3
    // (probe 64a-7: "take it off of drawings" reads as an item taken out of a THING container — no chart either way)
    expect(removalPronouns(words).some(x => x.cont || x.from === 'thing'), words).toBe(true)
    for (let j = 0; j < n; j++) {
      const b = boardOf(SYMS.slice(0, n), { selected: ctx === 'selected' ? 'c2' : null })
      const got = rail(b, `c${j + 1}`, words, { subject: ctx === 'conversation' ? 'c2' : null })
      expect(got, `${words} · plan closes #${j + 1}`).not.toBeNull()
    }
  })
  it.each(['take this down a timeframe', 'take it down to weekly', 'clear it of drawings', 'take that off of the chart'])('probe 62: "%s" with QQQ selected and a plan closing QQQ → refused', (words) => {
    expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c2' }), 'c2', words)).not.toBeNull()
  })
})

// ── END TO END · the REAL panel (AgentPanel + useAgent + planner + rail + runtime): AUDIT's 61a sentence ──
function mountPanel({ selected = null } = {}) {
  const b = boardOf(['SPY', 'QQQ', 'IWM'])
  const envelopes = []
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift() || { disposition: 'answer', reply: 'NO SCRIPTED MODEL TURN', question: null, ops: [], unsupported_category: null }, usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  const h = { ...b.host, charts: { ...b.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => selected }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const plan = (ref) => envelopes.push({ disposition: 'apply', reply: '', question: null, ops: [{ action: 'widget.remove', target: 'board', args: { widget: ref } }], unsupported_category: null })
  const left = () => b.state.widgets.filter(w => w.type === 'chart').map(w => h.charts.read(w.id).symbol)
  return { say, plan, left, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
describe('PRONOUN · end to end on SPY · QQQ · IWM (AUDIT probe 61a)', () => {
  it.each(['close it', 'remove that', 'get rid of them', 'close that one'])('"%s", nothing selected, a plan closing QQQ → asked, the board unchanged', async (words) => {
    const p = mountPanel()
    p.plan('c2')
    await p.say(words)
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    expect(p.transcript()).toMatch(/Which chart should I close\? Nothing is selected, so I can’t tell which chart/)
  }, 30000)
  it('"close it" with QQQ selected and a plan closing QQQ → QQQ closed; a plan closing SPY → refused', async () => {
    const a = mountPanel({ selected: 'c2' })
    a.plan('c2')
    await a.say('close it')
    expect(a.left()).toEqual(['SPY', 'IWM'])
    cleanup()
    const r = mountPanel({ selected: 'c2' })
    r.plan('c1')
    await r.say('close it')
    expect(r.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    expect(r.transcript()).toMatch(/Which chart should I close\?/)
  }, 60000)  // ⛔ AUDIT probe 62a-type: QQQ selected, a plan closing QQQ, words whose pronoun is NOT the chart → the board unchanged
  it.each([
    ['take it off', /you didn’t ask to remove a chart/],
    ['take this down a timeframe', /I didn’t close a chart/],
    ['take it down to weekly', /I didn’t close a chart/],
    ['draw a trendline and delete it', /I didn’t close a chart: “it” here means the trendline/],
    ['set an alert, then get rid of it', /I didn’t close a chart: “it” here means the alert/],
    ['I just added an RSI, close it', /I didn’t close a chart: “it” here means the rsi/],
    ['clear it of drawings', /I didn’t close a chart/],
  ])('probe 62a: "%s" with QQQ selected and a plan closing QQQ → refused, the board unchanged', async (words, said) => {
    const p = mountPanel({ selected: 'c2' })
    p.plan('c2')
    await p.say(words)
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    expect(p.transcript()).toMatch(said)
  }, 30000)
})

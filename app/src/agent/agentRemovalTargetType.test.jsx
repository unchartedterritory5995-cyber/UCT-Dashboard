// ⛔ REMOVAL TARGET TYPE / IDENTITY · AUDIT H14 (live wrong-target on prod) — the D31 oracle's masterGap rows, fixed in the RAILS
// (chartRail removalTargetRefusal / stateRail permits; no resolver code). Four rules, each GENERATED (nouns × verbs × contexts × plan
// targets), with controls that must still apply, and the REAL panel per rule:
//   1. TYPE      every removal object the words hold is a THING ("delete the trendline", "remove the RSI from the SPY chart") → no
//                chart is closed (a chart after from / on / off is the PLACE).
//   2. NEGATED   "don't close SPY, close the IWM chart" — the object of a negated removal verb is set aside.
//   3. RELATION  "the chart next to the QQQ chart" — the anchor is never the target.
//   4. IDENTITY  a named indicator absent from the chart; a thing placed on chart X with a plan on chart Y's; a named list row ≠ the
//                plan's row → refused.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { stateFixture, settingsWithRsi } from './__fixtures__/stateBoard'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets, prepareOps } from './executor'
import { buildContext } from './capabilities'
import { chartRailRefusal, removalObjects } from './chartRail'
import { stateRailRefusal } from './stateRail'
import { AuthContext } from './../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const SYMS = ['SPY', 'QQQ', 'IWM']
function boardOf(syms = SYMS, { selected = null, rsi = false } = {}) {
  const widgets = syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * 8, y: 0, w: 8, h: 20, color: 'N', opts: { settings: rsi ? settingsWithRsi() : mergeChartSettings(null) } }))
  const g = {}
  syms.forEach((s, i) => { g[`N:c${i + 1}`] = s })
  const b = makeBoard(widgets, g)
  b.host = { ...b.host, charts: { ...b.host.charts, selected: () => selected } }
  return b
}
const closePlan = (b, ref) => planOps(collectTargets(b.host, ['board']), [{ action: 'widget.remove', target: 'board', args: { widget: ref } }], {}, { surface: 'charts' })
const chartRail = (b, ref, words, opts = {}) => chartRailRefusal(closePlan(b, ref), { words, host: b.host, mode: 'apply', ...opts })
const CTX = { none: {}, selected: { selected: 'c2' }, 'conversation chart': { subject: 'c2' } }
const boardIn = (ctx) => boardOf(SYMS, { selected: ctx === 'selected' ? 'c2' : null })

// ── RULE 1 · TYPE ──
const VERBS = { remove: (o) => `remove ${o}`, delete: (o) => `delete ${o}`, 'get rid of': (o) => `get rid of ${o}`, drop: (o) => `drop ${o}`, clear: (o) => `clear ${o}`, 'take … off': (o) => `take ${o} off` }
const THINGS = ['the trendline', 'the RSI', 'my alerts', 'the MACD', 'the fib', 'my Tech watchlist', 'the note', 'the drawings', 'the moving average', 'that horizontal line']
const PLACES = ['', ' from the SPY chart', ' on the QQQ chart', ' off the IWM chart', ' from the left chart']
const T_CASES = []
for (const verb of Object.keys(VERBS)) for (const np of THINGS) for (const place of PLACES) for (const ctx of Object.keys(CTX)) {
  if (verb === 'take … off' && place) continue                      // ("take X off the Y chart": the split form takes its own place)
  T_CASES.push([verb, np, place, ctx])
}
describe(`RULE 1 · TYPE: a removal whose objects are all THINGS never closes a chart (${T_CASES.length} cases × each plan target)`, () => {
  it.each(T_CASES)('%s · "%s"%s · %s', (verb, np, place, ctx) => {
    const words = `${VERBS[verb](np)}${place}`
    for (let j = 1; j <= 3; j++) expect(chartRail(boardIn(ctx), `c${j}`, words, CTX[ctx]), `${words} · c${j}`).toMatch(/^I didn’t close a chart/)
  })
  it('the object reader types each removal object (the place after from / on / off is cut)', () => {
    const isSym = (x) => ['spy', 'qqq', 'iwm'].includes(x)
    expect(removalObjects('remove the RSI from the SPY chart', isSym)).toEqual([{ np: 'the RSI', type: 'thing' }])
    expect(removalObjects('close the IWM chart', isSym)).toEqual([{ np: 'the IWM chart', type: 'chart' }])
    expect(removalObjects("don't close SPY, close the IWM chart", isSym)).toEqual([{ np: 'the IWM chart', type: 'chart' }])
    expect(removalObjects('close it', isSym)).toEqual([])
  })
  // controls: a CHART object — alone, or beside a thing object — still closes exactly that chart
  const CONTROLS = [['close the IWM chart', 'c3'], ['remove the IWM chart', 'c3'], ['get rid of the right chart', 'c3'], ['take the IWM chart off', 'c3'],
    ['remove the RSI and close the IWM chart', 'c3'], ['delete the trendline, then close the SPY chart', 'c1'], ['close IWM chart please', 'c3'], ['drop the SPY chart', 'c1']]
  it.each(CONTROLS)('control: "%s" → %s closes; another chart refused', (words, ref) => {
    expect(chartRail(boardOf(), ref, words)).toBeNull()
    expect(chartRail(boardOf(), ref === 'c2' ? 'c1' : 'c2', words)).not.toBeNull()
  })
})

// ── RULE 2 · NEGATED removal verbs ──
const NEGATORS = ["don't", 'do not', 'never', 'don’t']
const NVERBS = ['close', 'remove', 'delete', 'get rid of', 'drop']
const NEGATED = { SPY: 'c1', 'the left chart': 'c1', 'the QQQ chart': 'c2', 'the middle one': 'c2' }
const N_CASES = []
for (const n of NEGATORS) for (const v of NVERBS) for (const [np, ref] of Object.entries(NEGATED)) N_CASES.push([n, v, np, ref])
describe(`RULE 2 · NEGATED: the object of a negated removal verb is never closed (${N_CASES.length} cases)`, () => {
  it.each(N_CASES)('"%s %s %s, close the IWM chart"', (n, v, np, ref) => {
    const words = `${n} ${v} ${np}, close the IWM chart`
    expect(chartRail(boardOf(), ref, words), `${words} · ${ref}`).not.toBeNull()
    // control: the chart the words DO name still closes
    expect(chartRail(boardOf(), 'c3', words), `${words} · c3`).toBeNull()
  })
  it.each(NVERBS)('"don’t %s SPY" alone with a plan closing SPY → refused', (v) => {
    expect(chartRail(boardOf(), 'c1', `don’t ${v} SPY`)).not.toBeNull()
  })
})

// ── RULE 3 · RELATION: the anchor is never the target ──
const RELS = ['next to', 'beside', 'to the right of', 'to the left of', 'right of', 'left of', 'near', 'alongside']
const ANCHORS = { 'the QQQ chart': 'c2', QQQ: 'c2', 'the SPY chart': 'c1', 'the middle chart': 'c2' }
const R_CASES = []
for (const r of RELS) for (const [a, ref] of Object.entries(ANCHORS)) for (const lead of ['close the chart', 'remove the one', 'get rid of the chart']) R_CASES.push([lead, r, a, ref])
describe(`RULE 3 · RELATION: a plan closing the ANCHOR is refused (${R_CASES.length} cases)`, () => {
  it.each(R_CASES)('"%s %s %s" × plan closing the anchor', (lead, r, a, ref) => {
    const words = `${lead} ${r} ${a}`
    expect(chartRail(boardOf(), ref, words), words).not.toBeNull()
  })
  it('control: the click as anchor — "close the chart to the right of this one" with QQQ clicked → IWM closes, QQQ refused', () => {
    const b = () => boardOf(SYMS, { selected: 'c2' })
    expect(chartRail(b(), 'c3', 'close the chart to the right of this one')).toBeNull()
    expect(chartRail(b(), 'c2', 'close the chart to the right of this one')).not.toBeNull()
    expect(chartRail(b(), 'c1', 'remove the chart left of the one I clicked')).toBeNull()
    expect(chartRail(b(), 'c2', 'remove the chart left of the one I clicked')).not.toBeNull()
  })
})

// ── RULE 4 · IDENTITY (state rail) ──
async function planOf(fx, ops) {
  buildContext(fx.host, { surface: 'charts' })
  const kinds = [...new Set(ops.map(o => (String(o.target).startsWith('ixe:') ? 'indicatorEdits' : /^wl\d$/.test(o.target) ? 'watchlist' : /^[A-Z]+$/.test(o.target) ? 'drawing' : 'chart')))]
  return planOps(collectTargets(fx.host, kinds), ops, { ...(await prepareOps(ops)), boundDrawingIds: new Set(), boundAlerts: [] }, { surface: 'charts' })
}
const op = (action, target, args) => ({ action, target, args })
const RSI_ON = { c1: 'SPY', c2: 'NVDA' }
const IND_PLACES = [(s) => `remove the RSI from the ${s} chart`, (s) => `delete the RSI on ${s}`, (s) => `get rid of the RSI off the ${s} chart`, (s) => `take the RSI off ${s}`, (s) => `drop the RSI in the ${s} chart`]
describe('RULE 4 · IDENTITY: an indicator placed on chart X never licenses removing chart Y’s (generated) + controls', () => {
  it.each(IND_PLACES.flatMap(f => Object.entries(RSI_ON).map(([ref, sym]) => [f(sym), ref])))('"%s" → that chart’s RSI only (%s)', async (words, ref) => {
    const fx = stateFixture()
    for (const [r] of Object.entries(RSI_ON)) {
      const plan = await planOf(fx, [op('indicator.remove', `ixe:${r}`, { instance: 'inst:rsi:1' })])
      expect(plan.ok).toBe(true)
      const got = stateRailRefusal(plan, { words })
      if (r === ref) expect(got, `${words} · plan on ${r}`).toBeNull()
      else expect(got, `${words} · plan on ${r}`).toMatch(/^I didn’t change anything/)
    }
  })
  it.each(['get rid of the MACD', 'remove the ATR', 'delete the VWAP', 'remove the bollinger bands', 'take the MACD off'])('absent: "%s" never licenses removing the RSI', async (words) => {
    const fx = stateFixture()
    const plan = await planOf(fx, [op('indicator.remove', 'ixe:c1', { instance: 'inst:rsi:1' })])
    expect(stateRailRefusal(plan, { words })).toMatch(/^I didn’t change anything/)
  })
  it.each([['remove the horizontal line on SPY', 'SPY', 'dr-h'], ['delete the horizontal on NVDA', 'NVDA', 'dr-n'], ['get rid of the horizontal line from SPY', 'SPY', 'dr-h']])('drawing: "%s" → only the %s one', async (words, _sym, id) => {
    const fx = stateFixture()
    for (const [target, d] of [['SPY', 'dr-h'], ['NVDA', 'dr-n']]) {
      const got = stateRailRefusal(await planOf(fx, [op('drawing.remove', target, { drawing: d })]), { words })
      if (d === id) expect(got, `${words} · ${d}`).toBeNull()
      else expect(got, `${words} · ${d}`).toMatch(/^I didn’t change anything/)
    }
  })
  it.each([['remove AMD from the Tech list', false], ['take SPY off my Tech watchlist', false], ['drop AMD and SPY from Tech', false], ['remove NVDA from the Tech list', true], ['take NVDA off Tech', true]])('list row: "%s" with a plan removing NVDA → allowed %s', async (words, ok) => {
    const fx = stateFixture()
    const got = stateRailRefusal(await planOf(fx, [op('watchlist.remove', 'wl1', { symbols: ['NVDA'] })]), { words })
    if (ok) expect(got, words).toBeNull()
    else expect(got, words).toMatch(/^I didn’t change anything/)
  })
  it('controls: a row the words KEEP is no row they remove ("drop all but SPY")', async () => {
    const fx = stateFixture()
    const keep = await planOf(fx, [op('watchlist.keepOnly', 'wl1', { symbols: ['SPY'] })])
    if (keep.ok) for (const w of ['drop all but SPY', 'remove everything except SPY']) expect(stateRailRefusal(keep, { words: w }), w).toBeNull()
  })
})

// ── AUDIT rows (D31 oracle A1b / A10 / A12): pointer vs words, the conversation's last chart, a described set ──
describe('AUDIT rows · the rails no longer apply the wrong chart', () => {
  it('A1: "close this IWM chart" with QQQ clicked → asked, whichever chart the plan closes', () => {
    for (const ref of ['c2', 'c3']) expect(chartRail(boardOf(SYMS, { selected: 'c2' }), ref, 'close this IWM chart')).toMatch(/^Which chart do you mean — the QQQ chart you clicked, or the IWM chart\?/)
    expect(chartRail(boardOf(SYMS, { selected: 'c3' }), 'c3', 'close this IWM chart')).toBeNull()
  })
  it('A10: "close the last chart I opened" is the conversation’s chart — never the last by order', () => {
    expect(chartRail(boardOf(), 'c3', 'close the last chart I opened', { previous: 'chart:c2' })).not.toBeNull()
    expect(chartRail(boardOf(), 'c2', 'close the last chart I opened', { previous: 'chart:c2' })).toBeNull()
    expect(chartRail(boardOf(), 'c3', 'close the last chart I opened')).toMatch(/^Which chart should I close\?/)
  })
  it('A12: "close both index charts" — a set no chart answers to by name is asked', () => {
    const b4 = () => boardOf(['SPY', 'QQQ', 'NVDA', 'AMD'])
    const plan = (b) => planOps(collectTargets(b.host, ['board']), ['c1', 'c3'].map(w => ({ action: 'widget.remove', target: 'board', args: { widget: w } })), {}, { surface: 'charts' })
    const b = b4()
    expect(chartRailRefusal(plan(b), { words: 'close both index charts', host: b.host, mode: 'apply' })).toMatch(/^Which charts should I close\?/)
    // controls: a set the words name
    const c = b4()
    expect(chartRailRefusal(plan(c), { words: 'close both the SPY and NVDA charts', host: c.host, mode: 'apply' })).toBeNull()
    const d = b4()
    expect(chartRailRefusal(plan(d), { words: 'close the SPY chart and the NVDA chart', host: d.host, mode: 'apply' })).toBeNull()
  })
})

// ── END TO END · the REAL panel, one case per rule ──
function mountPanel({ selected = null, rsi = false } = {}) {
  const b = boardOf(SYMS, { rsi })
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
  const script = (ops) => envelopes.push({ disposition: 'apply', reply: '', question: null, ops, unsupported_category: null })
  const left = () => b.state.widgets.filter(w => w.type === 'chart').map(w => h.charts.read(w.id).symbol)
  const rsiOn = (ref) => JSON.stringify(h.charts.read(ref)?.cs || {}).includes('"rsi"')
  return { say, script, left, rsiOn, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
describe('END TO END · the real panel: a model plan on the wrong target never runs', () => {
  it('RULE 1: "delete the trendline" with a plan closing the clicked QQQ chart → QQQ stays', async () => {
    const p = mountPanel({ selected: 'c2' })
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }])
    await p.say('delete the trendline')
    expect(p.left()).toEqual(SYMS)
  }, 30000)
  it('RULE 2: "don’t close SPY, close the IWM chart" with a plan closing SPY → SPY stays', async () => {
    const p = mountPanel()
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c1' } }])
    await p.say('don’t close SPY, close the IWM chart')
    expect(p.left()).toContain('SPY')
  }, 30000)
  it('RULE 3: "close the chart next to the QQQ chart" with a plan closing QQQ → QQQ stays', async () => {
    const p = mountPanel()
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }])
    await p.say('close the chart next to the QQQ chart')
    expect(p.left()).toContain('QQQ')
  }, 30000)
  it('RULE 4: "remove the RSI from the SPY chart" with a plan removing the QQQ chart’s RSI → it stays', async () => {
    const p = mountPanel({ rsi: true })
    expect(p.rsiOn('c2')).toBe(true)
    p.script([{ action: 'indicator.remove', target: 'ixe:c2', args: { instance: 'inst:rsi:1' } }])
    await p.say('remove the RSI from the SPY chart')
    expect(p.rsiOn('c2')).toBe(true)
  }, 30000)
})

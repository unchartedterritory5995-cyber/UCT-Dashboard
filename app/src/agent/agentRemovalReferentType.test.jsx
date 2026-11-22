// ⛔ REFERENT TYPE · owner directive 2026-11-16 (#1426, after AUDIT held-out probe 62): "destructive references such as 'close it',
// 'take it off', 'delete it' resolve to the correct OBJECT TYPE using conversational context; if the target is ambiguous, ask instead
// of acting; fix the underlying action-family behavior, not just the specific failed examples".
//
// RULE (chartRail pronounReferent / pronounAntecedent — the ONE reader both rails share): a destroying pronoun refers to an object of a
// TYPE — from the words (the nearest noun before its verb: a chart word, or a thing on a chart from the Agent's own vocabularies),
// else from the conversation (the ONE object the previous applied turn made or changed: stateRail `previous`, typed chart: / ind: /
// draw: / list:). A plan destroying an object of another type is refused; a thing just made while a chart is pointed at is asked.
// The chart rail (chart removal) and the state rail (indicator / drawing / list destroys) both read it.
// GENERATED: referent type × pronoun × verb × context × plan kind; plus the REAL panel over two turns.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets, prepareOps } from './executor'
import { buildContext } from './capabilities'
import { chartRailRefusal, REMOVAL_PRONOUNS, pronounReferent, removalAskedFor } from './chartRail'
import { stateRailRefusal, stateEffects } from './stateRail'
import { stateFixture } from './__fixtures__/stateBoard'
import { AuthContext } from './../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const SYMS = ['SPY', 'QQQ', 'IWM']
function boardOf(syms, { selected = null } = {}) {
  const widgets = syms.map((_, i) => ({ id: `c${i + 1}`, type: 'chart', x: i * 8, y: 0, w: 8, h: 20, color: 'N', opts: { settings: mergeChartSettings(null) } }))
  const g = {}
  syms.forEach((s, i) => { g[`N:c${i + 1}`] = s })
  const b = makeBoard(widgets, g)
  b.host = { ...b.host, charts: { ...b.host.charts, selected: () => selected } }
  return b
}
const closePlan = (b, ref) => planOps(collectTargets(b.host, ['board']), [{ action: 'widget.remove', target: 'board', args: { widget: ref } }], {}, { surface: 'charts' })
const chartRail = (b, ref, words, opts) => chartRailRefusal(closePlan(b, ref), { words, host: b.host, mode: 'apply', ...opts })

// the destroying verbs, each with its object where it takes it
const VERBS = {
  close: (p) => `close ${p}`,
  remove: (p) => `remove ${p}`,
  delete: (p) => `delete ${p}`,
  'get rid of': (p) => `get rid of ${p}`,
  drop: (p) => `drop ${p}`,
  clear: (p) => `clear ${p}`,
  'take off': (p) => `take ${p} off`,
  'take down': (p) => `take down ${p}`,
}
const ASK_WHICH = /^Which do you mean by “[^”]+” — the RSI, or the (?:SPY|QQQ|IWM) chart\? Nothing was changed/
const NOT_CHART = /^I didn’t close a chart: “[^”]+” here means the RSI, not a chart/
const REFUSED = /^Which chart should I close\?|you didn’t ask to remove a chart/

// ── CHART RAIL · the conversation's referent typed: previous object × pronoun × verb × pointer context × plan target ──
const PREVIOUS = { 'an indicator (ind:)': 'ind:c2:inst:rsi:1', 'a drawing (draw:)': 'draw:QQQ:dr-1', 'a list (list:)': 'list:wl1' }
const C_CASES = []
for (const [kind, prev] of Object.entries(PREVIOUS)) for (const p of REMOVAL_PRONOUNS) for (const verb of Object.keys(VERBS)) for (const ctx of ['none', 'selected', 'conversation chart']) C_CASES.push([kind, p, verb, ctx, prev])
describe(`CHART RAIL · a pronoun whose conversational referent is a THING never closes a chart (${C_CASES.length} cases × each plan target)`, () => {
  it.each(C_CASES)('previous = %s · "%s" · %s · %s', (_k, p, verb, ctx, prev) => {
    const words = VERBS[verb](p)
    for (let j = 0; j < 3; j++) {
      const b = boardOf(SYMS, { selected: ctx === 'selected' ? 'c2' : null })
      const got = chartRail(b, `c${j + 1}`, words, { previous: prev, previousLabel: 'the RSI', subject: ctx === 'conversation chart' ? 'c2' : null })
      // a thing just made, and a chart pointed at (clicked / the conversation's chart): ASKED which one — never acted on
      if (ctx === 'none') expect(got, `${words} · #${j + 1}`).toMatch(NOT_CHART)
      else expect(got, `${words} · #${j + 1}`).toMatch(ASK_WHICH)
    }
  })
})
const CH_CASES = []
for (const p of REMOVAL_PRONOUNS) for (const verb of Object.keys(VERBS)) for (let k = 0; k < 3; k++) CH_CASES.push([p, verb, k])
describe(`CHART RAIL · a CHART the previous turn made or changed is the referent (${CH_CASES.length} cases × each plan target)`, () => {
  it.each(CH_CASES)('"%s" · %s · previous = chart #%i', (p, verb, k) => {
    const words = VERBS[verb](p)
    for (let j = 0; j < 3; j++) {
      const got = chartRail(boardOf(SYMS), `c${j + 1}`, words, { previous: `chart:c${k + 1}` })
      // ("take <it> off" alone never passes the removal gate — probe 62 A1; "take that one off" is #1416's REMOVAL_TAKE)
      if (j === k && !(verb === 'take off' && !/ one$/.test(p))) expect(got, `${words} · #${j + 1}`).toBeNull()
      else expect(got, `${words} · #${j + 1}`).toMatch(REFUSED)
    }
  })
  it('the words outrank the conversation: "draw a trendline and delete it" after a chart was made → the trendline; no chart closes', () => {
    for (let j = 0; j < 3; j++) expect(chartRail(boardOf(SYMS), `c${j + 1}`, 'draw a trendline and delete it', { previous: 'chart:c1' })).toMatch(/means the trendline/)
  })
  it('the words outrank the conversation: "the SPY chart is done, close it" after an RSI was added → the SPY chart', () => {
    expect(chartRail(boardOf(SYMS), 'c1', 'the SPY chart is done, close it', { previous: 'ind:c2:inst:rsi:1', previousLabel: 'the RSI' })).toBeNull()
    expect(chartRail(boardOf(SYMS), 'c2', 'the SPY chart is done, close it', { previous: 'ind:c2:inst:rsi:1', previousLabel: 'the RSI' })).toMatch(REFUSED)
  })
  it('controls: no conversational referent → as before (selected → that chart; nothing selected → asked)', () => {
    expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c2', 'close it', {})).toBeNull()
    expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c1', 'close it', {})).toMatch(REFUSED)
    expect(chartRail(boardOf(SYMS), 'c2', 'close it', {})).toMatch(/^Which chart should I close\? Nothing is selected/)
    expect(chartRail(boardOf(SYMS), 'c2', 'close it', { subject: 'c2' })).toBeNull()
  })
})

// ── STATE RAIL · the same referent for every destroying plan kind it licenses (indicator / drawing / list) ──
async function planOf(fx, ops) {
  buildContext(fx.host, { surface: 'charts' })
  const kinds = [...new Set(ops.map(o => (String(o.target).startsWith('ixe:') ? 'indicatorEdits' : /^wl\d$/.test(o.target) ? 'watchlist' : /^[A-Z]+$/.test(o.target) ? 'drawing' : 'chart')))]
  return planOps(collectTargets(fx.host, kinds), ops, { boundDrawingIds: new Set(), boundAlerts: [], ...(await prepareOps(ops)) }, { surface: 'charts' })
}
const op = (action, target, args) => ({ action, target, args })
const KINDS = {
  'indicator.remove (the RSI)': { ops: [op('indicator.remove', 'ixe:c1', { instance: 'inst:rsi:1' })], other: 'draw:SPY:dr-t', thing: 'add an RSI' },
  // (a drawing.remove plan is not buildable off the panel on this fixture — the drawing kind is covered by the chart-rail words cases
  //  and the state rail's own drawing suites; a list is the third destroying kind here)
  'watchlist.delete (Swing)': { ops: [op('watchlist.delete', 'wl2', {})], other: 'ind:c1:inst:rsi:1', thing: 'make a watchlist' },
  'watchlist.remove (NVDA from Tech)': { ops: [op('watchlist.remove', 'wl1', { symbols: ['NVDA'] })], other: 'ind:c1:inst:rsi:1', thing: 'make a watchlist' },
}
const S_FORMS = {
  'the plan’s own object, just made': { words: (v) => v, prev: 'own', ok: true },
  'a CHART just made': { words: (v) => v, prev: 'chart:c1' },
  'another kind of thing just made': { words: (v) => v, prev: 'other' },
  'the words name a chart': { words: (v) => `the SPY chart is done, ${v}`, prev: 'own' },
  'the words go on past the pronoun': { words: (v) => `${v} to weekly`, prev: 'own' },
}
const S_CASES = []
for (const kind of Object.keys(KINDS)) for (const form of Object.keys(S_FORMS)) for (const p of REMOVAL_PRONOUNS) for (const verb of Object.keys(VERBS)) S_CASES.push([kind, form, p, verb])
describe(`STATE RAIL · a destroying pronoun binds to an object of the referent's TYPE (${S_CASES.length} cases)`, () => {
  it.each(S_CASES)('%s · %s · "%s" · %s', async (kind, form, p, verb) => {
    const fx = stateFixture()
    const plan = await planOf(fx, KINDS[kind].ops)
    expect(plan.ok).toBe(true)
    const own = stateEffects(plan)[0].id
    const f = S_FORMS[form]
    const words = f.words(VERBS[verb](p))
    const previous = f.prev === 'own' ? own : f.prev === 'other' ? KINDS[kind].other : f.prev
    const got = stateRailRefusal(plan, { words, previous })
    if (f.ok && words !== `clear ${p}`) {
      // the type matches: the existing licence ("remove it" right after the turn that made it) holds — never weakened
      if (got !== null) expect(pronounReferent(words, { previous }).kind, words).not.toMatch(/^(?:chart|cont)$/)
    } else if (!f.ok) {
      expect(got || 'LET THROUGH', `${words} · previous ${previous}`).toMatch(/^I didn’t change anything/)
    }
  })
  it('the licence itself still holds for the plain forms ("remove it" / "delete it" / "take it off" / "get rid of it" right after)', async () => {
    for (const kind of Object.keys(KINDS)) {
      const fx = stateFixture()
      const plan = await planOf(fx, KINDS[kind].ops)
      const own = stateEffects(plan)[0].id
      for (const w of ['remove it', 'delete it', 'take it off', 'get rid of it', 'drop it', 'delete that one']) expect(stateRailRefusal(plan, { words: w, previous: own }), `${kind} · ${w}`).toBe(null)
    }
  })
})

// ── END TO END · the REAL panel over TWO turns: an RSI added on the clicked QQQ chart, then a destroying pronoun ──
function mountPanel({ selected = 'c2' } = {}) {
  const b = boardOf(SYMS)
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
  return { say, script, left, rsiOn, envelopes, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
describe('REFERENT TYPE · end to end: an RSI just added on the clicked QQQ chart, then a destroying pronoun', () => {
  it.each(['take it off', 'close it', 'delete it', 'get rid of it', 'remove that', 'drop it'])('"%s" with a plan closing QQQ → asked / refused, QQQ stays', async (words) => {
    const p = mountPanel()
    p.script([{ action: 'indicator.add', target: 'ixe:c2', args: { defId: 'rsi', inputs: null } }])
    await p.say('could you put an rsi on the qqq chart for me')
    p.envelopes.length = 0
    expect(p.rsiOn('c2'), 'the RSI was added').toBe(true)
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }])
    await p.say(words)
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    // asked (the rail), or the instant reader took "it" as the RSI it just added — removed, or proposed on a card — never the chart
    const t = p.transcript().slice(p.transcript().lastIndexOf(words))
    expect(/Which do you mean by “[^”]+” — the RSI[^,]*, or the QQQ chart\?|you didn’t ask to remove a chart|Proposed changes\s*Remove RSI[^—]*from Chart c2/.test(t) || !p.rsiOn('c2'), t).toBe(true)
    expect(t).not.toMatch(/Removed? (?:the )?(?:QQQ )?chart|Closed/)
  }, 60000)
  it('with nothing clicked, "close it" after the RSI was added on QQQ → the RSI or the QQQ chart is asked (or refused as the RSI); no chart closes', async () => {
    const p = mountPanel({ selected: null })
    p.script([{ action: 'indicator.add', target: 'ixe:c2', args: { defId: 'rsi', inputs: null } }])
    await p.say('could you put an rsi on the qqq chart for me')
    p.envelopes.length = 0
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }])
    await p.say('close it')
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    // (the RSI went on QQQ, so QQQ is the conversation's chart too: "it" is asked between them — or refused as the RSI)
    const t = p.transcript().slice(p.transcript().lastIndexOf('close it'))
    expect(/I didn’t close a chart: “it” here means the RSI|Which do you mean by “it” — the RSI[^,]*, or the QQQ chart\?/.test(t), t).toBe(true)
  }, 60000)
})

// ── ⛔ AUDIT probe 64a-1 · APPOSITIVE: the noun phrase said right AFTER the pronoun clause types it, exactly as one before it does ──
const APPOS_FORMS = {
  ', the X I mean': (v, np) => `${v}, ${np} I mean`,
  ' — the X': (v, np) => `${v} — ${np}`,
  ', I mean the X': (v, np) => `${v}, I mean ${np}`,
  ' (the X)': (v, np) => `${v} (${np})`,
}
const APPOS_NPS = { 'the RSI': 'thing', 'the trendline': 'thing', 'the alert': 'thing', 'the MACD': 'thing', 'the note': 'thing', 'the SPY chart': 'chart', 'the IWM chart': 'chart' }
const AP_CASES = []
for (const form of Object.keys(APPOS_FORMS)) for (const [np, type] of Object.entries(APPOS_NPS)) for (const p of REMOVAL_PRONOUNS) for (const verb of Object.keys(VERBS)) for (const ctx of ['none', 'selected', 'conversation chart']) AP_CASES.push([form, np, type, p, verb, ctx])
describe(`APPOSITIVE · "delete it, the RSI I mean" types the pronoun (${AP_CASES.length} cases × each plan target)`, () => {
  it.each(AP_CASES)('%s · "%s" (%s) · "%s" · %s · %s', (form, np, type, p, verb, ctx) => {
    const words = APPOS_FORMS[form](VERBS[verb](p), np)
    const named = np === 'the SPY chart' ? 0 : 2
    for (let j = 0; j < 3; j++) {
      const b = boardOf(SYMS, { selected: ctx === 'selected' ? 'c2' : null })
      const got = chartRail(b, `c${j + 1}`, words, { subject: ctx === 'conversation chart' ? 'c2' : null })
      if (type === 'thing') expect(got, `${words} · #${j + 1}`).toMatch(/^I didn’t close a chart: “[^”]+” here means the /)
      else if (j !== named) expect(got, `${words} · #${j + 1}`).toMatch(REFUSED)
      // (the named chart closes — "take <it> off" alone never passes the removal gate, probe 62 A1)
      else if (verb === 'take off' && !/ one$/.test(p)) expect(got, `${words} · #${j + 1}`).toMatch(/you didn’t ask to remove a chart/)
      else expect(got, `${words} · #${j + 1}`).toBeNull()
    }
  })
})

// ── ⛔ AUDIT probe 64a-7 · CONTAINER: "remove it from my watchlist" — the pronoun is an ITEM of a thing container, never a chart ──
const CONTAINERS = ['my watchlist', 'the Tech list', 'my notes', 'my alerts', 'my drawing board', 'my tech watchlist']
const CONT_FORMS = {
  'remove … from': (p, c) => `remove ${p} from ${c}`,
  'delete … from': (p, c) => `delete ${p} from ${c}`,
  'drop … from': (p, c) => `drop ${p} from ${c}`,
  'get rid of … from': (p, c) => `get rid of ${p} from ${c}`,
  'take … off': (p, c) => `take ${p} off ${c}`,
  'take … out of': (p, c) => `take ${p} out of ${c}`,
  'remove … out of': (p, c) => `remove ${p} out of ${c}`,
}
const CN_CASES = []
for (const c of CONTAINERS) for (const form of Object.keys(CONT_FORMS)) for (const p of REMOVAL_PRONOUNS) for (const ctx of ['none', 'selected', 'conversation chart']) CN_CASES.push([c, form, p, ctx])
describe(`CONTAINER · an item taken out of a thing container is no chart (${CN_CASES.length} cases × each plan target)`, () => {
  it.each(CN_CASES)('"%s" · %s · "%s" · %s', (c, form, p, ctx) => {
    const words = CONT_FORMS[form](p, c)
    for (let j = 0; j < 3; j++) {
      const b = boardOf(SYMS, { selected: ctx === 'selected' ? 'c2' : null })
      expect(chartRail(b, `c${j + 1}`, words, { subject: ctx === 'conversation chart' ? 'c2' : null }), `${words} · #${j + 1}`).toMatch(/^I didn’t close a chart: “[^”]+” here means something in your /)
    }
  })
  // the chart CONTAINER: the board / layout / screen — a chart removed from it is closed
  it.each(['remove it from the board', 'take it off the board', 'drop that from my layout', 'get rid of this from the screen', 'delete that one from the board', 'take it out of my layout'])('control: "%s" with QQQ selected → QQQ closes, another chart refused', (words) => {
    expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c2', words, {})).toBeNull()
    expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c1', words, {})).toMatch(REFUSED)
  })
  it.each(['the SPY chart is done, remove it from the board', 'the SPY chart is done, take it off the board'])('control: "%s" (a chart antecedent) → the SPY chart closes, the clicked QQQ refused', (words) => {
    expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c1', words, {})).toBeNull()
    expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c2', words, {})).toMatch(REFUSED)
  })
  it('control: "remove it from the board" with nothing selected on 3 charts → asked', () => {
    expect(chartRail(boardOf(SYMS), 'c2', 'remove it from the board', {})).toMatch(/^Which chart should I close\? Nothing is selected/)
  })
  it('the state rail reads the same container: "remove it from my watchlist" is a list item, never a chart', () => {
    expect(pronounReferent('remove it from my watchlist')).toEqual({ kind: 'thing', word: 'watchlist' })
    expect(pronounReferent('take it off the board').kind).toBe('chart')
    expect(pronounReferent('delete it, the RSI I mean')).toEqual({ kind: 'thing', word: 'rsi' })
  })
})

// ── END TO END · probes 64a-1 and 64a-7 on the REAL panel over two turns (an RSI added on the clicked QQQ chart first) ──
describe('REFERENT TYPE · end to end: probes 64a-1 and 64a-7', () => {
  it.each([
    ['delete it, the RSI I mean', /I didn’t close a chart: “it” here means the rsi|Which do you mean by “it”|Proposed changes\s*Remove RSI[^—]*from Chart c2/],
    ['remove it from my watchlist', /I didn’t close a chart: “it” here means something in your watchlist|Which do you mean by “it”/],
  ])('"%s" with QQQ clicked and a plan closing QQQ → QQQ stays', async (words, said) => {
    const p = mountPanel()
    p.script([{ action: 'indicator.add', target: 'ixe:c2', args: { defId: 'rsi', inputs: null } }])
    await p.say('could you put an rsi on the qqq chart for me')
    p.envelopes.length = 0
    expect(p.rsiOn('c2')).toBe(true)
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }])
    await p.say(words)
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    const t = p.transcript().slice(p.transcript().lastIndexOf(words))
    expect(said.test(t) || !p.rsiOn('c2'), t).toBe(true)
  }, 60000)
})

// ── ⛔ AUDIT probe 66a · a THING appositive OUTRANKS the board / layout / screen container: "take it off the board (the trendline)" ──
const BOARD_FORMS = {
  'take … off the C': (p, c) => `take ${p} off the ${c}`,
  'remove … from the C': (p, c) => `remove ${p} from the ${c}`,
  'get rid of … from my C': (p, c) => `get rid of ${p} from my ${c}`,
  'delete … from the C': (p, c) => `delete ${p} from the ${c}`,
  'drop … from my C': (p, c) => `drop ${p} from my ${c}`,
  'take … out of my C': (p, c) => `take ${p} out of my ${c}`,
}
const THING_NPS = ['the trendline', 'the RSI', 'the alert', 'the MACD', 'the note']
const BA_CASES = []
for (const form of Object.keys(APPOS_FORMS)) for (const np of THING_NPS) for (const c of ['board', 'layout', 'screen']) for (const bf of Object.keys(BOARD_FORMS)) for (const p of ['it', 'that', 'this', 'that one']) for (const ctx of ['none', 'selected', 'conversation chart']) BA_CASES.push([form, np, c, bf, p, ctx])
describe(`BOARD + THING APPOSITIVE · the appositive outranks the chart container (${BA_CASES.length} cases × each plan target)`, () => {
  it.each(BA_CASES)('%s · "%s" · %s · %s · "%s" · %s', (form, np, c, bf, p, ctx) => {
    const words = APPOS_FORMS[form](BOARD_FORMS[bf](p, c), np)
    for (let j = 0; j < 3; j++) {
      const b = boardOf(SYMS, { selected: ctx === 'selected' ? 'c2' : null })
      const got = chartRail(b, `c${j + 1}`, words, { subject: ctx === 'conversation chart' ? 'c2' : null })
      expect(got, `${words} · #${j + 1}`).not.toBeNull()
      expect(got, words).toMatch(/^I didn’t close a chart: “[^”]+” here means the |^Which do you mean by/)
    }
  })
  it.each(Object.keys(APPOS_FORMS))('a CHART appositive with the board (%s) → that chart closes, the clicked QQQ refused', (form) => {
    for (const bf of Object.keys(BOARD_FORMS)) {
      const words = APPOS_FORMS[form](BOARD_FORMS[bf]('it', 'board'), 'the SPY chart')
      expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c1', words, {}), words).toBeNull()
      expect(chartRail(boardOf(SYMS, { selected: 'c2' }), 'c2', words, {}), words).toMatch(REFUSED)
    }
  })
  it('the state rail reads the same precedence', () => {
    expect(pronounReferent('take it off the board (the trendline)')).toEqual({ kind: 'thing', word: 'trendline' })
    expect(pronounReferent('remove it from the board, the RSI I mean')).toEqual({ kind: 'thing', word: 'rsi' })
    expect(pronounReferent('take it off the board').kind).toBe('chart')
  })
})
describe('BOARD + THING APPOSITIVE · end to end, NO prior turn (probe 66a-1 / 66a-2)', () => {
  it.each(['take it off the board (the trendline)', 'remove it from the board, the RSI I mean', 'take it off the layout — the alert'])('"%s" with QQQ clicked and a plan closing QQQ → refused, QQQ stays', async (words) => {
    const p = mountPanel()
    p.script([{ action: 'widget.remove', target: 'board', args: { widget: 'c2' } }])
    await p.say(words)
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    expect(p.transcript().slice(p.transcript().lastIndexOf(words))).toMatch(/I didn’t close a chart: “it” here means the (?:trendline|rsi|alert)/)
  }, 30000)
})

// ── ⛔ AUDIT mutant K5 · the REMOVAL GATE on its own (removalAskedFor — the second guard behind removalTargets): a pronoun taken off
// the board / layout / screen asks to remove a chart, UNLESS an appositive says it is a THING ──
describe('REMOVAL GATE · a thing appositive keeps a board-container pronoun from asking to remove a chart (K5)', () => {
  it.each(['take it off the board (the trendline)', 'take that off the layout — the alert', 'take this off the screen, the RSI I mean', 'take it out of my layout, I mean the note', 'take it off the board (the MACD)'])('"%s" → no chart removal asked', (words) => {
    expect(removalAskedFor(words), words).toBe(false)
  })
  it.each(['take it off the board', 'take it off the board, the SPY chart I mean', 'take that out of my layout', 'take it off the screen (the left chart)'])('control: "%s" → a chart removal asked', (words) => {
    expect(removalAskedFor(words), words).toBe(true)
  })
  it.each(['take it off', 'take it down a timeframe'])('control: "%s" → no chart removal asked (probe 62 A1 / A2)', (words) => {
    expect(removalAskedFor(words), words).toBe(false)
  })
})

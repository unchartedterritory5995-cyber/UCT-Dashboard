// ⛔ AUDIT T2 HOLD (#1304, wrong-target class): boardDetach.intoTabs is licensed by the state rail ONLY when the words name the
// widget that MOVES (outside the destination phrase) and the widget whose TABS it joins (inside "into the X tabs" / "into the tabs
// of X") — the same source / destination split as the chart rail (chartRail INTO_TABS_DEST). Before the fix any "into … tabs"
// licensed ANY widget's move: "tuck the news widget into the watchlist tabs" applied to a plan moving the CALENDAR, "put the
// watchlist into the news tabs" to the REVERSED plan.
//
// GENERATED, never a phrase list: verbs × the ways a widget is named on THIS board (its type when it is the only one of that type,
// its own list / scan name, its position word — positionWord, as the receipts say it) × the destination forms × board shapes
// (2–4 widgets, duplicate types). For every (source, destination) pair the CORRECT plan is licensed; every plan moving another
// widget, the REVERSED plan and every plan into another widget's tabs is refused. A naming that fits several widgets (two news
// widgets, nothing telling them apart) refuses every plan. Then through the panel: the correct plan is the existing card, the
// wrong ones refused — nothing written, no card.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, bareSettings } from './testing/panelHarness'
import { moveIntoTabs } from '../pages/charts/widgetTabs'
import { BOARD_DETACH_ACTIONS } from './capabilities/boardDetach'
import { stateRailRefusal, intoTabsLicensed } from './stateRail'
import { positionWord } from './host'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

// ── the unit rail, generated ─────────────────────────────────────────────────────────────────────────────────────────────
const WORD = { news: 'news', watchlist: 'watchlist', calendar: 'calendar', scanner: 'scanner', chart: 'chart' }
const cell = (id, type, x, y, w, h, opts = {}) => ({ id, type, x, y, w, h, color: 'A', opts })
const BOARDS = {
  'two widgets': [cell('news', 'news', 0, 0, 12, 10), cell('wl', 'watchlist', 12, 0, 12, 10, { watchName: 'Momentum' })],
  'three widgets (the AUDIT board)': [cell('news', 'news', 0, 0, 8, 10), cell('wl', 'watchlist', 8, 0, 8, 10, { watchName: 'Momentum' }), cell('cal', 'calendar', 16, 0, 8, 10)],
  'four widgets': [cell('news', 'news', 0, 0, 12, 10), cell('wl', 'watchlist', 12, 0, 12, 10, { watchName: 'Momentum' }), cell('cal', 'calendar', 0, 10, 12, 10), cell('sc', 'scanner', 12, 10, 12, 10, { scanKey: 'gap', scanName: 'Gappers' })],
  'duplicate types': [cell('n1', 'news', 0, 0, 12, 10), cell('n2', 'news', 12, 0, 12, 10), cell('w1', 'watchlist', 0, 10, 12, 10, { watchName: 'Momentum' }), cell('w2', 'watchlist', 12, 10, 12, 10, { watchName: 'Swing' })],
}
const VERBS = ['tuck', 'put', 'move', 'merge', 'drop', 'send']
// each way the words can name a widget on this board → the phrase, and whether it names it ALONE
function namings(w, all) {
  const out = []
  const sameType = all.filter(o => o.type === w.type).length
  out.push({ how: 'type', np: `the ${WORD[w.type]} widget`, poss: `the ${WORD[w.type]}’s`, unique: sameType === 1 })
  const name = w.opts?.watchName || w.opts?.scanName
  if (name) out.push({ how: 'name', np: `my ${name} ${WORD[w.type]}`, poss: `my ${name} ${WORD[w.type]}’s`, unique: true })
  const pos = positionWord(w, all)
  if (pos) out.push({ how: 'position', np: `the ${pos.replace('-', ' ')} widget`, poss: `the ${pos.replace('-', ' ')} widget’s`, unique: all.filter(o => positionWord(o, all) === pos).length === 1 })
  return out
}
const DEST_FORMS = [
  ['into the X tabs', (d) => `into ${d.np.replace(/ widget$/, '')} tabs`],
  ['into the X’s tabs', (d) => `into ${d.poss} tabs`],
  ['into the tabs of X', (d) => `into the tabs of ${d.np}`],
]
const planOf = (W, src, dst) => {
  const after = moveIntoTabs(W, src, dst, { tabId: `wtm${src}` })
  const t = after.find(w => w.id === dst)
  return { ok: true, plans: [{ kind: 'board', ref: 'board', snap: { detached: [], charts: new Map() }, before: { board: W }, after: { board: after }, patch: { remove: [src], set: { [dst]: { wtabs: t.wtabs, activeWtab: t.activeWtab } } } }] }
}
const licensed = (W, src, dst, words) => stateRailRefusal(planOf(W, src, dst), { words }) === null

const CASES = []          // [label, board, words, src, dst, expectedLicensedPlan | null]
for (const [shape, W] of Object.entries(BOARDS)) {
  for (const s of W) for (const d of W) {
    if (s.id === d.id) continue
    for (const sn of namings(s, W)) for (const dn of namings(d, W)) for (const [form, dest] of DEST_FORMS) {
      const verb = VERBS[CASES.length % VERBS.length]
      const words = `${verb} ${sn.np} ${dest(dn)}`
      CASES.push({ shape, W, words, s: s.id, d: d.id, ok: sn.unique && dn.unique, why: `${sn.how}→${dn.how} · ${form}` })
    }
  }
}

describe('generated: source × destination naming × verbs × board shapes — exactly the plan the words say', () => {
  it('the generator covers every shape, verb, naming and destination form', () => {
    expect(new Set(CASES.map(c => c.shape)).size).toBe(Object.keys(BOARDS).length)
    for (const v of VERBS) expect(CASES.some(c => c.words.startsWith(`${v} `))).toBe(true)
    for (const h of ['type→type', 'name→name', 'position→position', 'type→name', 'name→position']) expect(CASES.some(c => c.why.startsWith(h))).toBe(true)
    expect(CASES.filter(c => c.ok).length).toBeGreaterThan(100)
    expect(CASES.filter(c => !c.ok).length).toBeGreaterThan(20)        // the ambiguous namings (duplicate types)
  })
  it.each(CASES.filter(c => c.ok).map(c => [c.shape, c.words, c.why, c]))('%s · "%s" (%s): the correct plan is licensed; a wrong source, the reversed plan and a wrong destination are refused', (_s, words, _w, c) => {
    expect(licensed(c.W, c.s, c.d, words)).toBe(true)
    expect(licensed(c.W, c.d, c.s, words)).toBe(false)                                     // reversed
    for (const o of c.W) {
      if (o.id !== c.s && o.id !== c.d) expect(licensed(c.W, o.id, c.d, words)).toBe(false)  // wrong source
      if (o.id !== c.s && o.id !== c.d) expect(licensed(c.W, c.s, o.id, words)).toBe(false)  // wrong destination
    }
  })
  it.each(CASES.filter(c => !c.ok).map(c => [c.shape, c.words, c.why, c]))('%s · "%s" (%s): an AMBIGUOUS source or destination licenses no plan at all', (_s, words, _w, c) => {
    for (const a of c.W) for (const b of c.W) if (a.id !== b.id) expect(licensed(c.W, a.id, b.id, words)).toBe(false)
  })
})

// ⛔ AUDIT mutant T3: ONE clause with TWO destination phrases ("move the news widget into the watchlist tabs into the calendar
// tabs") says no single destination — every plan is refused, whichever widget the second phrase names (another one, the
// source itself, the first destination again), in every destination form, either order
const TWO_DEST = []
for (const [shape, W] of Object.entries(BOARDS)) {
  for (const s of W) for (const d of W) {
    if (s.id === d.id) continue
    const sn = namings(s, W).find(n => n.unique), dn = namings(d, W).find(n => n.unique)
    if (!sn || !dn) continue
    for (const o of W) {
      const on = namings(o, W).find(n => n.unique)
      if (!on) continue
      for (const [f1, dest1] of DEST_FORMS) for (const [f2, dest2] of DEST_FORMS) {
        const verb = VERBS[TWO_DEST.length % VERBS.length]
        TWO_DEST.push({ shape, W, words: `${verb} ${sn.np} ${dest1(dn)} ${dest2(on)}`, why: `${f1} + ${f2}${o.id === s.id ? ' · the source again' : o.id === d.id ? ' · the destination again' : ''}` })
        TWO_DEST.push({ shape, W, words: `${verb} ${sn.np} ${dest1(on)} ${dest2(dn)}`, why: `${f1} + ${f2} (swapped)${o.id === s.id ? ' · the source again' : o.id === d.id ? ' · the destination again' : ''}` })
      }
    }
  }
}
describe('generated: TWO destination phrases in one clause — no plan is licensed', () => {
  it('the generator covers a third widget, the source again and the destination again as the second phrase', () => {
    expect(TWO_DEST.length).toBeGreaterThan(300)
    expect(TWO_DEST.some(c => / · the source again$/.test(c.why))).toBe(true)
    expect(TWO_DEST.some(c => / · the destination again$/.test(c.why))).toBe(true)
    expect(TWO_DEST.some(c => !/ again$/.test(c.why))).toBe(true)
  })
  it.each([
    'move the news widget into the watchlist tabs into the calendar tabs',
    'put the news into the tabs of the watchlist into the calendar’s tabs',
    'move the news widget into the watchlist tabs into the news tabs',
    'move the news widget into the tabs of the watchlist into the tabs of the news widget',
  ])('the AUDIT wording "%s": every plan refused', (words) => {
    const W = BOARDS['three widgets (the AUDIT board)']
    for (const a of W) for (const b of W) if (a.id !== b.id) expect(licensed(W, a.id, b.id, words)).toBe(false)
  })
  it.each(TWO_DEST.map(c => [c.shape, c.words, c.why, c]))('%s · "%s" (%s): every plan refused', (_s, words, _w, c) => {
    for (const a of c.W) for (const b of c.W) if (a.id !== b.id) expect(licensed(c.W, a.id, b.id, words)).toBe(false)
  })
})

describe('the AUDIT probes (3 widgets: news, watchlist, calendar)', () => {
  const W = BOARDS['three widgets (the AUDIT board)']
  it('"tuck the news widget into the watchlist tabs" with a plan moving the CALENDAR: refused', () => {
    expect(stateRailRefusal(planOf(W, 'cal', 'wl'), { words: 'tuck the news widget into the watchlist tabs' })).toMatch(/^I didn’t change anything/)
    expect(licensed(W, 'news', 'wl', 'tuck the news widget into the watchlist tabs')).toBe(true)
  })
  it('"put the watchlist into the news tabs" with the REVERSED plan: refused', () => {
    expect(stateRailRefusal(planOf(W, 'news', 'wl'), { words: 'put the watchlist into the news tabs' })).toMatch(/^I didn’t change anything/)
    expect(licensed(W, 'wl', 'news', 'put the watchlist into the news tabs')).toBe(true)
  })
  it.each([
    ['no destination phrase', 'move the news widget'],
    ['no source named', 'move it into the watchlist tabs'],
    ['no destination named', 'move the news widget into the other tabs'],
    ['the destination outside its phrase only', 'move the news widget and the watchlist into the tabs'],
    ['two destination phrases', 'move the news widget into the watchlist tabs and into the calendar tabs'],
    ['negated', 'don’t move the news widget into the watchlist tabs'],
    ['additive only', 'add another news widget'],
    ['a modify verb on the class, no into-tabs', 'move the news widget to the right'],
    ['both named as the source', 'move the news widget and the calendar into the watchlist tabs'],
  ])('fails closed: %s ("%s") licenses no plan', (_n, words) => {
    for (const a of W) for (const b of W) if (a.id !== b.id) expect(licensed(W, a.id, b.id, words)).toBe(false)
  })
  it('the merge words never license the move', () => {
    expect(licensed(W, 'news', 'wl', 'merge the board')).toBe(false)
  })
  it('the effect is read straight (intoTabsLicensed) — the board it was planned on, the ids it moves', () => {
    const board = W.map(w => ({ id: w.id, type: w.type, name: w.opts?.watchName || null, symbol: null, position: positionWord(w, W) }))
    expect(intoTabsLicensed({ src: 'news', dst: 'wl', board }, 'move the news widget into the Momentum watchlist’s tabs')).toBe(true)
    expect(intoTabsLicensed({ src: 'news', dst: 'cal', board }, 'move the news widget into the Momentum watchlist’s tabs')).toBe(false)
  })
  it('a chart destination named by the ticker it shows; two charts with nothing telling them apart are asked of nobody — refused', () => {
    const B = [cell('c0', 'chart', 0, 0, 12, 10), cell('c1', 'chart', 12, 0, 12, 10), cell('news', 'news', 0, 10, 24, 10)]
    const withSyms = (pl) => ({ ...pl, plans: pl.plans.map(x => ({ ...x, snap: { detached: [], charts: new Map([['c0', { symbol: 'SPY' }], ['c1', { symbol: 'NVDA' }]]) } })) })
    const ok = (src, dst, words) => stateRailRefusal(withSyms(planOf(B, src, dst)), { words }) === null
    expect(ok('news', 'c0', 'move the news widget into the SPY chart’s tabs')).toBe(true)
    expect(ok('news', 'c1', 'move the news widget into the SPY chart’s tabs')).toBe(false)
    expect(ok('news', 'c1', 'move the news widget into the tabs of the NVDA chart')).toBe(true)
    expect(ok('news', 'c0', 'move the news widget into the chart’s tabs')).toBe(false)
    expect(ok('news', 'c1', 'move the news widget into the chart’s tabs')).toBe(false)
    expect(ok('news', 'c1', 'move the news widget into the top right chart’s tabs')).toBe(true)
  })
})

// ── through the panel: the correct plan is the existing card; a wrong one is refused, nothing written, no card ───────────
const TABS = BOARD_DETACH_ACTIONS[2]
let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })
// c0 TL chart (SPY), news TR, wl BL (Momentum), cal BR (the calendar)
const panelBoard = () => [
  { id: 'c0', type: 'chart', x: 0, y: 0, w: 12, h: 10, color: 'N', opts: { settings: bareSettings() } },
  { id: 'news', type: 'news', x: 12, y: 0, w: 12, h: 10, color: 'A', opts: {} },
  { id: 'wl', type: 'watchlist', x: 0, y: 10, w: 12, h: 10, color: 'A', opts: { watchName: 'Momentum' } },
  { id: 'cal', type: 'calendar', x: 12, y: 10, w: 12, h: 10, color: 'A', opts: {} },
]
const mount = () => p.mount(panelBoard(), { N: 'SPY', A: 'AAPL' }, { decorate: (s) => ({ ...s, label: `Chart (${s.ref})` }), geometry: { detach: {} } })
const propose = (args) => (body) => p.env('propose', [{ action: TABS, target: body.context.board[0].ref, args }])
const pendingCards = () => screen.queryAllByTestId('agent-proposal').filter(e => e.getAttribute('data-status') === 'pending')
const widgetsJson = (b) => JSON.stringify(b.state.widgets)

describe('through the panel (the AUDIT board + a chart)', () => {
  it.each([
    ['move the news widget into the watchlist tabs', { widget: 'news', into: 'wl' }, /Move the News .* into the Watchlist .*’s tabs/],
    ['put the watchlist into the news tabs', { widget: 'wl', into: 'news' }, /Move the Watchlist .* into the News .*’s tabs/],
    ['merge the calendar into the tabs of my Momentum watchlist', { widget: 'cal', into: 'wl' }, /into the Watchlist .*’s tabs/],
    ['move the news widget into the SPY chart’s tabs', { widget: 'news', into: 'c0' }, /Move the News .* into the Chart .*’s tabs/],
  ])('"%s" with the plan it says → the existing confirm card, nothing written before Apply', async (t, args, re) => {
    const { say, board: b } = mount()
    const was = widgetsJson(b)
    p.st.envelopes.push(propose(args))
    await say(t)
    expect(screen.getAllByTestId('agent-proposal').at(-1).textContent).toMatch(re)
    expect(widgetsJson(b)).toBe(was)
  }, 40000)
  it.each([
    ['wrong source', 'move the news widget into the watchlist tabs', { widget: 'cal', into: 'wl' }],
    ['reversed', 'put the watchlist into the news tabs', { widget: 'news', into: 'wl' }],
    ['wrong destination', 'move the news widget into the watchlist tabs', { widget: 'news', into: 'cal' }],
    ['no source named', 'move it into the watchlist tabs', { widget: 'news', into: 'wl' }],
    ['two destinations (T3)', 'move the news widget into the watchlist tabs into the calendar tabs', { widget: 'news', into: 'wl' }],
    ['two destinations (T3)', 'move the news widget into the watchlist tabs into the calendar tabs', { widget: 'news', into: 'cal' }],
    ['two destinations, the source again (T3)', 'move the news widget into the watchlist tabs into the news tabs', { widget: 'news', into: 'wl' }],
    ['two destinations (T3)', 'put the news into the tabs of the watchlist into the calendar’s tabs', { widget: 'news', into: 'wl' }],
  ])('%s: "%s" → refused, nothing written, no card', async (_n, t, args) => {
    const { say, board: b } = mount()
    const was = widgetsJson(b)
    p.st.envelopes.push(propose(args))
    expect(await say(t)).toMatch(/I didn’t change anything/)
    expect(widgetsJson(b)).toBe(was)
    expect(pendingCards()).toHaveLength(0)
  }, 40000)
})

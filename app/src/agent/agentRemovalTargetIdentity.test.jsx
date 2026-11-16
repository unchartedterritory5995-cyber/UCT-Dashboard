// ⛔ REMOVAL TARGET IDENTITY · AUDIT held-out probe 59 (2026-11-16, LIVE safety bug, pre-existing — predates H14): board
// SPY · QQQ · IWM, the words "close the SPY chart" (remove / get rid of / delete my …), a model plan `widget.remove` on the QQQ chart
// → APPLIED, QQQ removed. Unique identification covered re-symbols only; a removal's TARGET was never checked against the words.
//
// RULE (chartRail removalTargets / removalTargetRefusal — the SAME reader as a re-symbol: identifiesChart, the deixis ordinal, the
// spatialCheck exclusions): a removal whose words NAME a chart (its ticker, its position / ordinal, a deixis on the selected chart,
// a linked pair by its ticker) closes ONLY the chart(s) those words identify; any other target → refused "Which chart …?".
// Words naming no chart: as before. Every case below is GENERATED: verb × naming form × board size × named position × plan target.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings } from '../components/chart/chartDefaults'
import { planOps, collectTargets } from './executor'
import { chartRailRefusal, removalTargets } from './chartRail'
import { AuthContext } from './../context/AuthContext'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import AgentPanel from './AgentPanel'

registerBuiltins()
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const settings = () => ({ settings: mergeChartSettings(null) })
const SYMS = ['SPY', 'QQQ', 'IWM', 'DIA']
// 2 and 3 charts side by side; 4 charts as a 2×2 — every chart has its own position word on the real host (positionWord)
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
const removal = (b, ref) => planOps(collectTargets(b.host, ['board']), [{ action: 'widget.remove', target: 'board', args: { widget: ref } }], {}, { surface: 'charts' })
const rail = (b, ref, words) => {
  const p = removal(b, ref)
  expect(p.ok, `plan widget.remove ${ref}`).toBe(true)
  return chartRailRefusal(p, { words, host: b.host, mode: 'apply' })
}

// ── the removal verbs, each in the place it takes its object ──
const VERBS = {
  close: (np) => `close ${np}`,
  remove: (np) => `remove ${np}`,
  delete: (np) => `delete ${np}`,
  'get rid of': (np) => `get rid of ${np} please`,
  drop: (np) => `drop ${np}`,
  'take off': (np) => `take ${np} off the board`,
  'take down': (np) => `take down ${np}`,
}
// ── the naming forms: how the words name the chart at index k of the board ──
const FORMS = {
  caps: (b, k, syms) => `the ${syms[k]} chart`,
  dollar: (b, k, syms) => `the $${syms[k].toLowerCase()} chart`,
  lower: (b, k, syms) => `my ${syms[k].toLowerCase()} chart`,
  position: (b) => (k) => `the ${b.host.charts.read(`c${k + 1}`).position.replace('-', ' ')} chart`,
  deixis: () => 'this chart',
}
const npOf = (form, b, k, syms) => (form === 'position' ? FORMS.position(b)(k) : FORMS[form](b, k, syms))

const CASES = []
for (const n of [2, 3, 4]) {
  const syms = SYMS.slice(0, n)
  for (let k = 0; k < n; k++) for (const form of Object.keys(FORMS)) for (const verb of Object.keys(VERBS)) for (let j = 0; j < n; j++) {
    CASES.push([`${n} charts`, `named #${k + 1} (${syms[k]})`, form, verb, `plan closes #${j + 1} (${syms[j]})`, { n, k, j, form, verb }])
  }
}
describe(`REMOVAL TARGET · generated: verb × naming form × board size × named position × plan target (${CASES.length} cases)`, () => {
  it.each(CASES)('%s · %s · %s · %s · %s', (_n, _k, _f, _v, _j, { n, k, j, form, verb }) => {
    const syms = SYMS.slice(0, n)
    const b = boardOf(syms, { selected: form === 'deixis' ? `c${k + 1}` : null })
    const words = VERBS[verb](npOf(form, b, k, syms))
    const got = rail(b, `c${j + 1}`, words)
    if (j === k) expect(got, words).toBeNull()
    else expect(got, words).toMatch(/^Which chart should I close\?/)
    // the reader names exactly the one chart
    expect([...removalTargets(words, b.host, { selected: form === 'deixis' ? `c${k + 1}` : null }).ids], words).toEqual([`c${k + 1}`])
  })
})

// ── ORDINALS (the deixis ordinal reader): first / second / last on a row ──
const ORD = [[2, 'first', 0], [2, 'second', 1], [2, 'last', 1], [3, 'first', 0], [3, 'second', 1], [3, 'third', 2], [3, 'last', 2], [3, 'middle', 1]]
const ORD_CASES = []
for (const [n, word, k] of ORD) for (const verb of ['close', 'remove', 'get rid of']) for (let j = 0; j < n; j++) ORD_CASES.push([n, word, verb, j, k])
describe(`REMOVAL TARGET · ordinal words (${ORD_CASES.length} cases)`, () => {
  it.each(ORD_CASES)('%i charts · "the %s chart" · %s · plan closes #%i', (n, word, verb, j, k) => {
    const b = boardOf(SYMS.slice(0, n))
    const words = VERBS[verb](`the ${word} chart`)
    const got = rail(b, `c${j + 1}`, words)
    if (j === k) expect(got, words).toBeNull()
    else expect(got, words).toMatch(/^Which chart should I close\?/)
  })
})

// ── SEVERAL POSITIONS in one removal ("close the middle and right charts"), independent and linked boards ──
const MULTI_POS = [['the left and middle charts', [0, 1]], ['the middle and right charts', [1, 2]], ['the left and right charts', [0, 2]], ['the center and right charts', [1, 2]]]
const MP_CASES = []
for (const [np, ks] of MULTI_POS) for (const linkedBoard of [false, true]) for (const verb of ['close', 'remove', 'get rid of']) MP_CASES.push([np, linkedBoard ? 'linked NVDA ×3' : 'SPY · QQQ · IWM', verb, ks, linkedBoard])
describe(`REMOVAL TARGET · several positions in one removal (${MP_CASES.length} cases)`, () => {
  it.each(MP_CASES)('"%s" on %s · %s', (np, _b, verb, ks, linkedBoard) => {
    const B = () => (linkedBoard ? boardOf(['NVDA', 'NVDA', 'NVDA'], { colors: ['A', 'A', 'A'] }) : boardOf(['SPY', 'QQQ', 'IWM']))
    const words = VERBS[verb](np)
    expect([...removalTargets(words, B().host).ids].sort(), words).toEqual(ks.map(k => `c${k + 1}`))
    const both = (b) => planOps(collectTargets(b.host, ['board']), ks.map(k => ({ action: 'widget.remove', target: 'board', args: { widget: `c${k + 1}` } })), {}, { surface: 'charts' })
    const b = B()
    expect(chartRailRefusal(both(b), { words, host: b.host, mode: 'apply' }), words).toBeNull()
    const other = [0, 1, 2].find(j => !ks.includes(j))
    expect(rail(B(), `c${other + 1}`, words), words).toMatch(/^Which chart should I close\?/)
  })
})

// ── LINKED PAIR: naming the ticker of a link group names every chart in it (a link group is ONE object, sameSymbolObjects) ──
describe('REMOVAL TARGET · a linked pair named by its ticker', () => {
  const PAIR_CASES = []
  for (const verb of Object.keys(VERBS)) for (const np of ['the SPY charts', 'the SPY chart', 'my linked SPY charts']) for (const j of [0, 1, 2]) PAIR_CASES.push([verb, np, j])
  it.each(PAIR_CASES)('%s "%s" on SPY(A) · SPY(A) · QQQ · plan closes #%i', (verb, np, j) => {
    const b = boardOf(['SPY', 'SPY', 'QQQ'], { colors: ['A', 'A', 'N'] })
    const words = VERBS[verb](np)
    const got = rail(b, `c${j + 1}`, words)
    if (j < 2) expect(got, words).toBeNull()
    else expect(got, words).toMatch(/^Which chart should I close\?/)
    expect([...removalTargets(words, b.host).ids].sort()).toEqual(['c1', 'c2'])
  })
})

// ── TWO INDEPENDENT SPY CHARTS: "both SPY charts" names each; the singular is ambiguous → asked; a position narrows it ──
describe('REMOVAL TARGET · two independent SPY charts', () => {
  const B = () => boardOf(['SPY', 'QQQ', 'SPY'])
  it.each(['close both SPY charts', 'remove both of the SPY charts', 'delete the SPY charts', 'get rid of all the SPY charts'])('"%s" → each SPY chart named, QQQ refused', (words) => {
    expect([...removalTargets(words, B().host).ids].sort()).toEqual(['c1', 'c3'])
    expect(rail(B(), 'c1', words)).toBeNull()
    expect(rail(B(), 'c3', words)).toBeNull()
    expect(rail(B(), 'c2', words)).toMatch(/^Which chart should I close\?/)
  })
  it.each(['close the SPY chart', 'remove my SPY chart', 'get rid of the $spy chart'])('"%s" → ambiguous: asked, whichever chart the plan closes', (words) => {
    for (const j of [0, 1, 2]) expect(rail(B(), `c${j + 1}`, words), words).toMatch(/^Which SPY chart should I close\? 2 charts show SPY/)
  })
  it.each([['close the left SPY chart', 0], ['close the SPY chart on the right', 2]])('"%s" → the position narrows it', (words, k) => {
    for (const j of [0, 1, 2]) {
      const got = rail(B(), `c${j + 1}`, words)
      if (j === k) expect(got, words).toBeNull()
      else expect(got, words).toMatch(/^Which chart should I close\?/)
    }
  })
  it('a plan closing both SPY charts under "close both SPY charts" applies', () => {
    const b = B()
    const p = planOps(collectTargets(b.host, ['board']), [{ action: 'widget.remove', target: 'board', args: { widget: 'c1' } }, { action: 'widget.remove', target: 'board', args: { widget: 'c3' } }], {}, { surface: 'charts' })
    expect(p.ok).toBe(true)
    expect(chartRailRefusal(p, { words: 'close both SPY charts', host: b.host, mode: 'apply' })).toBeNull()
  })
})

// ── KEPT BEHAVIOUR: words naming no chart, the bare ticker, the removal gate, the additive rule ──
describe('REMOVAL TARGET · existing protections unchanged', () => {
  const B = () => boardOf(['SPY', 'QQQ', 'IWM'])
  it.each(['close a chart', 'remove one of the charts', 'get rid of a chart please'])('"%s" names no chart → as before (applies)', (words) => {
    for (const j of [0, 1, 2]) expect(rail(B(), `c${j + 1}`, words)).toBeNull()
  })
  it('the bare ticker ("remove SPY") is still asked to say "chart"', () => {
    expect(rail(B(), 'c1', 'remove SPY')).toMatch(/alone doesn’t say to close a chart/)
  })
  it('no removal word → still refused as before', () => {
    expect(rail(B(), 'c1', 'make the SPY chart weekly')).toMatch(/you didn’t ask to remove a chart/)
  })
  it('"close the SPY chart but not QQQ" → QQQ (set aside) is never the target', () => {
    expect(rail(B(), 'c1', 'close the SPY chart but not QQQ')).toBeNull()
    expect(rail(B(), 'c2', 'close the SPY chart but not QQQ')).toMatch(/^Which chart should I close\?/)
  })
  it('"close the SPY and IWM charts" names both', () => {
    expect(rail(B(), 'c1', 'close the SPY and IWM charts')).toBeNull()
    expect(rail(B(), 'c3', 'close the SPY and IWM charts')).toBeNull()
    expect(rail(B(), 'c2', 'close the SPY and IWM charts')).toMatch(/^Which chart should I close\?/)
  })
  it('an approved card is not re-asked', () => {
    const b = B()
    expect(chartRailRefusal(removal(b, 'c2'), { words: 'close the SPY chart', host: b.host, mode: 'approved' })).toBeNull()
  })
})

// ── END TO END · the REAL panel (AgentPanel + useAgent + planner + rail + runtime) on the fixture board: AUDIT's probe-59 words ──
const PROBE59 = ['close the SPY chart', 'remove the SPY chart', 'get rid of the SPY chart please', 'delete my SPY chart']
function mountPanel() {
  const b = boardOf(['SPY', 'QQQ', 'IWM'])
  const envelopes = []
  globalThis.fetch = vi.fn(async (url) => {
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', envelope: envelopes.shift() || { disposition: 'answer', reply: 'NO SCRIPTED MODEL TURN', question: null, ops: [], unsupported_category: null }, usage: { research_calls: 0, citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/live-prices')) return json({})
    return json({ conversations: [] })
  })
  const h = { ...b.host, charts: { ...b.host.charts, canManageIndicators: () => true, canCreateIndicator: () => true, previewHost: () => null, selected: () => null }, persist: async () => ({ ok: true }) }
  render(<AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}><AgentPanel host={h} onClose={() => {}} /></AuthContext.Provider>)
  const box = screen.getByLabelText('Message UCT Agent')
  const idle = () => waitFor(() => expect(screen.queryByTestId('agent-typing')).toBeNull(), { timeout: 10000 })
  const say = async (t) => { await idle(); fireEvent.change(box, { target: { value: t } }); fireEvent.keyDown(box, { key: 'Enter' }); await idle() }
  const plan = (ref) => envelopes.push({ disposition: 'apply', reply: '', question: null, ops: [{ action: 'widget.remove', target: 'board', args: { widget: ref } }], unsupported_category: null })
  const left = () => b.state.widgets.filter(w => w.type === 'chart').map(w => h.charts.read(w.id).symbol)
  return { say, plan, left, transcript: () => screen.getByTestId('agent-transcript').textContent }
}
describe('REMOVAL TARGET · end to end on SPY · QQQ · IWM (AUDIT probe 59)', () => {
  it.each(PROBE59)('"%s" with a plan closing QQQ → refused, the board unchanged', async (words) => {
    const p = mountPanel()
    p.plan('c2')
    await p.say(words)
    expect(p.left()).toEqual(['SPY', 'QQQ', 'IWM'])
    expect(p.transcript()).toMatch(/Which chart should I close\?/)
  }, 30000)
  it.each(PROBE59)('control: "%s" with a plan closing SPY → SPY closed, QQQ and IWM stay', async (words) => {
    const p = mountPanel()
    p.plan('c1')
    await p.say(words)
    expect(p.left()).toEqual(['QQQ', 'IWM'])
  }, 30000)
})

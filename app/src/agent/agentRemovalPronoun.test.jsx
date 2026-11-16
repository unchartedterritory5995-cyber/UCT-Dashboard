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
    'close all of them', 'close both of them', 'remove it from my watchlist', 'close the one I just changed'])('"%s" → no pronoun object', (w) => {
    expect(removalPronouns(w)).toEqual([])
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
  it('"take it off" passes the removal gate (the target is checked)', () => {
    expect(rail(boardOf(SYMS.slice(0, 3), { selected: 'c2' }), 'c2', 'take it off')).toBeNull()
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
  it.each(['close all my charts', 'clear the board', 'close all of them', 'remove both of them', 'close them all', 'close everything'])('whole board: "%s" → applies', (words) => {
    for (const j of [0, 1, 2]) expect(rail(boardOf(SYMS.slice(0, 3)), `c${j + 1}`, words), words).toBeNull()
  })
  it('a pronoun with no removal plan changes nothing: "make it weekly" is no removal', () => {
    expect(rail(boardOf(SYMS.slice(0, 3)), 'c1', 'make it weekly')).toMatch(/you didn’t ask to remove a chart/)
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
  }, 60000)
})

// re-merged onto master 2401f01d62 (2026-11-14): this line starts the Agent CI push run for the merge head.
// ⛔ MULTI-STEP CONTINUITY (2026-11-14, owner: multi-step tasks keep their intent, constraints and references across steps and
// turns) — through the REAL panel (panelHarness: AgentPanel + useAgent + registry, routing, planner, policy, runtime, receipts
// and Undo) on the REAL board writer. Stand-in: the Agent model (/api/agent/turn), scripted. No paid model call.
//   B  CONSTRAINTS CARRIED. "Change the price scale on all my charts except the TSLA one" → the Agent asks log or percent →
//      "log". The reply turn's plan (a model that forgot the exclusion: all four charts) never reaches TSLA — not applied, not
//      on the card, not by Apply / "do it". The excluded-chart gate reads the request the answered question carried
//      (useAgent carriedWordsRef → turnWords). A reply that is a NEW request carries nothing (control).
//   C  THE CREATED SET. After a request CREATED several charts, "make the new charts weekly" / "the new ones" / "the charts you
//      just added" / "both new charts" / "the three new charts" mean exactly those charts — instant, no model call, the board's
//      other charts untouched (useAgent asCreatedSetWords). Fail-closed: a count that does not match, or "both" for three, is
//      never guessed (it goes on as typed, nothing changes instantly); "add two new charts for …" is still a creation.
// Evidence: LOCAL / SIMULATED (BROWSER-MOCK-MODEL): jsdom, scripted plans.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerBuiltins } from './builtins'
import { setupPanel, FOUR, MODEL_SENTINEL } from './testing/panelHarness'
import { asCreatedSetWords } from './useAgent'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()

let p
beforeEach(() => { p = setupPanel() })
afterEach(() => { vi.restoreAllMocks(); cleanup() })

const chartOf = (b, sym) => b.context.charts.find(c => c.label === `Chart (${sym})`).ref
const clarify = (q) => ({ disposition: 'clarify', reply: q, question: { text: q, choices: [] }, ops: [], unsupported_category: null })
const logged = (board) => board.state.widgets.filter(x => x.opts?.settings?.logScale).map(x => x.id).sort()
const allLog = (disp) => (b) => p.env(disp, ['SPY', 'QQQ', 'NVDA', 'TSLA'].map(s => ({ action: 'chart.setScale', target: chartOf(b, s), args: { scale: 'log' } })))
const QUESTION = 'Which scale do you want — log or percent?'

// ── B · the pending task's exclusions hold on the reply turn ──────────────────────────────────────────────────────────
const ASKS = [
  'Change the price scale on all my charts except the TSLA one',
  'Change the price scale on every chart except TSLA',
  'Switch the price scale on all my charts, but leave TSLA alone',
]
const REPLIES = ['log', 'logarithmic please']
const HOW = [['the model applies', 'apply', null], ['Apply clicked', 'propose', 'click'], ['"do it" typed', 'propose', 'do it']]
const B_CASES = ASKS.flatMap(a => REPLIES.flatMap(r => HOW.map(([how, disp, approve]) => [a, r, how, disp, approve])))

describe('B · an exclusion in the request a question was about holds on the answer turn', () => {
  it.each(B_CASES)('"%s" → asked → "%s" (%s): TSLA never changes; the others do', async (ask, reply, _how, disp, approve) => {
    const m = p.mount(...FOUR())
    p.st.envelopes.push(clarify(QUESTION))
    await m.say(ask)
    expect(logged(m.board)).toEqual([])
    p.st.envelopes.push(allLog(disp))
    await m.say(reply)
    expect(p.turns()).toBe(2)
    expect(p.lastTurnBody().context?.conversation_memory?.question_set_aside).not.toBe(true)
    expect(logged(m.board), p.transcript()).not.toContain('c3')
    const cards = p.proposals().map(c => c.textContent).join(' ')
    expect(cards, 'the excluded chart is never on a card').not.toContain('Chart (TSLA)')
    if (p.proposals().length) {
      if (approve === 'do it' || approve === null) await m.say('do it')
      else await m.click('Apply')
    }
    expect(logged(m.board), p.transcript()).toEqual(['c0', 'c1', 'c2'])
  }, 40000)
  it('control: the same answer to a request with NO exclusion changes all four', async () => {
    const m = p.mount(...FOUR())
    p.st.envelopes.push(clarify(QUESTION))
    await m.say('Change the price scale on all my charts')
    p.st.envelopes.push(allLog('apply'))
    await m.say('log')
    if (p.proposals().length) await m.say('do it')
    expect(logged(m.board), p.transcript()).toEqual(['c0', 'c1', 'c2', 'c3'])
  }, 40000)
  it('control: a NEW request typed instead of an answer carries nothing of the set-aside one', async () => {
    const m = p.mount(...FOUR())
    p.st.envelopes.push(clarify(QUESTION))
    await m.say('Change the price scale on all my charts except the TSLA one')
    p.st.envelopes.push(b => p.env('apply', b.context.indicatorEdits.map(e => ({ action: 'indicator.add', target: e.ref, args: { defId: 'rsi', inputs: null } }))))
    await m.say('Put the RSI on all my charts')
    if (p.proposals().length) await m.say('do it')
    expect(p.lastTurnBody()?.context?.conversation_memory?.question_set_aside, p.transcript()).toBe(true)
    expect(['c0', 'c1', 'c2', 'c3'].filter(id => p.instancesOn(m.board, id).some(i => i.defId === 'rsi')), p.transcript()).toEqual(['c0', 'c1', 'c2', 'c3'])
  }, 40000)
})

// ── C · "the new charts" = the set the latest creating request made ───────────────────────────────────────────────────
const tfOf = (m) => m.board.state.widgets.filter(w => w.type === 'chart').map(w => [m.h.charts.read(w.id).symbol, m.h.charts.read(w.id).tf])
const TWO_OLD = () => FOUR().map((x, i) => (i === 0 ? x.slice(0, 2) : x))
const MADE = {
  2: ['open charts for AAPL and MSFT', ['AAPL', 'MSFT']],
  3: ['open charts for AAPL, MSFT and AMD', ['AAPL', 'MSFT', 'AMD']],
}
const REFS = {
  2: ['make the new charts weekly', 'make the new ones weekly', 'switch the charts you just added to weekly', 'put all the new charts on the weekly', 'make both new charts weekly', 'make the two new charts weekly'],
  3: ['make the new charts weekly', 'set the new ones to weekly', 'switch the charts you just added to weekly', 'make all of the new charts weekly', 'make the three new charts weekly'],
}
const C_CASES = [2, 3].flatMap(n => REFS[n].map(t => [n, t]))

describe('C · after a request created several charts, "the new charts" means exactly those', () => {
  it.each(C_CASES)('%i created → "%s": only the created charts change, no model call', async (n, said) => {
    const m = p.mount(...TWO_OLD())
    await m.say(MADE[n][0])
    expect(tfOf(m).map(x => x[0])).toEqual(['SPY', 'QQQ', ...MADE[n][1]])
    expect(p.turns()).toBe(0)
    const out = await m.say(said)
    expect(out).not.toContain(MODEL_SENTINEL)
    expect(p.turns()).toBe(0)
    expect(tfOf(m), out).toEqual([['SPY', 'D'], ['QQQ', 'D'], ...MADE[n][1].map(s => [s, 'W'])])
    await m.say('undo')
    expect(tfOf(m)).toEqual([['SPY', 'D'], ['QQQ', 'D'], ...MADE[n][1].map(s => [s, 'D'])])
  }, 40000)
  it.each([
    [2, 'make the three new charts weekly'], [2, 'make the four new ones weekly'], [3, 'make both new charts weekly'], [3, 'make the two new charts weekly'],
  ])('fail-closed: %i created → "%s" (the count does not match) is never read instantly; nothing changes', async (n, said) => {
    const m = p.mount(...TWO_OLD())
    await m.say(MADE[n][0])
    const before = JSON.stringify(tfOf(m))
    const out = await m.say(said)
    expect(out).toContain(MODEL_SENTINEL)                     // handed on as typed (the scripted model planned nothing)
    expect(JSON.stringify(tfOf(m))).toBe(before)
  }, 40000)
  it('a request that created two charts AND changed an existing one: "the new charts" are the created two only', async () => {
    const m = p.mount(...TWO_OLD())
    const ws = (b) => (Object.values(b.context || {}).flat().find(e => /workspace/i.test(String(e?.label || e?.ref)))?.ref) || 'workspace'
    p.st.envelopes.push(b => p.env('apply', [
      { action: 'widget.addCharts', target: ws(b), args: { symbols: ['AAPL', 'MSFT'], timeframe: null, chart_type: null, exact: null } },
      { action: 'chart.setTimeframe', target: chartOf(b, 'SPY'), args: { timeframe: 'W' } },
    ]))
    await m.say('put up AAPL and MSFT next to these, and flip SPY over to the weekly while you are at it')
    expect(tfOf(m), p.transcript()).toEqual([['SPY', 'W'], ['QQQ', 'D'], ['AAPL', 'D'], ['MSFT', 'D']])
    const out = await m.say('make the new charts monthly')
    expect(out).not.toContain(MODEL_SENTINEL)
    expect(tfOf(m), out).toEqual([['SPY', 'W'], ['QQQ', 'D'], ['AAPL', 'M'], ['MSFT', 'M']])
  }, 40000)
  it('"add two new charts for AMD and AVGO" after a creation is still a creation, never a reference', async () => {
    const m = p.mount(...TWO_OLD())
    await m.say(MADE[2][0])
    await m.say('add two new charts for AMD and AVGO')
    expect(tfOf(m).map(x => x[0])).toEqual(['SPY', 'QQQ', 'AAPL', 'MSFT', 'AMD', 'AVGO'])
    expect(tfOf(m).every(x => x[1] === 'D')).toBe(true)
  }, 40000)
})

describe('C · asCreatedSetWords (pure)', () => {
  const host = { charts: { read: (r) => (['a', 'b', 'c'].includes(r) ? { ref: r } : null) } }
  it.each([
    ['make the new charts weekly', ['a', 'b'], 'make them weekly'],
    ['add RSI to the new ones', ['a', 'b', 'c'], 'add RSI to them'],
    ['switch the charts you just added to weekly', ['a', 'b'], 'switch them to weekly'],
    ['make both new charts weekly', ['a', 'b'], 'make them weekly'],
    ['make the three new charts weekly', ['a', 'b', 'c'], 'make them weekly'],
  ])('"%s" over %j → "%s"', (t, refs, out) => {
    expect(asCreatedSetWords(t, refs, host)).toEqual({ text: out, refs })
  })
  it.each([
    ['make the new charts weekly', ['a']],                    // one created chart: the singular reader's (asSubjectWords)
    ['make the new charts weekly', []],
    ['make the new charts weekly', ['a', 'gone']],            // a created chart is no longer on the board
    ['make the three new charts weekly', ['a', 'b']],
    ['make both new charts weekly', ['a', 'b', 'c']],
    ['add two new charts for AMD and AVGO', ['a', 'b']],      // no determiner: a creation
    ['make my charts weekly', ['a', 'b']],
  ])('"%s" over %j → null', (t, refs) => {
    expect(asCreatedSetWords(t, refs, host)).toBeNull()
  })
})

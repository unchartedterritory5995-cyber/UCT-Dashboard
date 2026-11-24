// ⭐ AUDIT 11-23 (reproduced on production code): a CORRECT two-chart correction plan was ALWAYS stopped by the target rail.
// After a change on chart A, "no, the B one" planned as [A put back exactly as it was, B changed] was asked "You named B, but Chart (A)
// shows A" — in routing v1 and v2, apply and propose — so a correct correction could never run in one step. The rails, in BOTH
// directions, so the fix cannot trade one for the other (deixis.correctionReverts states the rule):
//   (a) a WRONG plan still ASKS and changes nothing: another property on A (setScale), another value on A (monthly, not the daily it
//       was), or a setSymbol taken from a lowercase verb word ("fix", "go": P0.2);
//   (b) the CORRECT plan (A put back as it was + the change on the named B) EXECUTES (apply) / is a card that applies (propose);
//   (c) controls: the same undo-half plan WITHOUT correction words is asked; a correction that only changes B runs.
// Generated over correction frames × ticker kinds (real tickers; ticker-like English words on the board) × routing v1 / v2 (the
// harness default is v2, as production) × apply / propose, through the REAL panel with a scripted model. No market values.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
import { setupPanel, TWO } from './testing/panelHarness'
import { registerBuiltins } from './builtins'
import { _resetAgentConfig } from './agentClient'
import { routingV2Active } from './nlm1/flag'

registerBuiltins()
afterEach(() => { cleanup(); localStorage.clear(); _resetAgentConfig() })

// [A, B]: the chart the first change landed on, and the chart the correction names
const PAIRS = [
  ['real', 'META', 'MSFT'], ['real', 'NVDA', 'AMD'], ['real', 'AAPL', 'TSLA'],
  ['word', 'ON', 'NOW'], ['word', 'GO', 'SO'], ['word', 'FIX', 'RUN'],
]
// ("not that one, B" and "not A, B" are left out: their exclusion makes the target rails ask even for a plan on B ALONE, on master
// too — a separate family, G4 in the report. "sorry, I meant the B chart" is often read on the instant path (its own correction:
// Undo + the change), so the scripted plan is never consulted there — the end state is still checked.)
const FRAMES = [
  (B) => `no, the ${B} one`, (B) => `no wait, ${B} instead`, (B) => `i meant ${B}`,
  (B) => `wrong chart, ${B}`, (B) => `nope, do ${B} instead`, (B) => `sorry, I meant the ${B} chart`, (B) => `no — ${B}, not that`,
]
// a real ticker is typed either way; a ticker-like English word is typed as a ticker (in capitals)
const cased = (kind, B, k) => (kind === 'real' && k % 2 ? B.toLowerCase() : B)

let p
function mountPair(A, B, { v2, tickers = [] }) {
  p = setupPanel({ routingV2: v2, tickers: [A, B, ...tickers] })
  const [ws, syms] = TWO(A, B)
  const m = p.mount(ws.map(w => ({ ...w, opts: { ...w.opts, tf: 'D' } })), syms)
  return m
}
const ref = (body, sym) => body.context.charts.find(c => c.label === `Chart (${sym})`).ref
const tfOf = (board, id) => board.state.widgets.find(w => w.id === id).opts.tf
const tf = (sym, t) => (body) => ({ action: 'chart.setTimeframe', target: ref(body, sym), args: { timeframe: t } })
const plan = (mode, ...ops) => (body) => p.env(mode, ops.map(o => o(body)), '')
// turn 1: A to weekly (whichever path reads it), then the correction turn with the scripted plan
async function dialogue({ A, B, v2, text, mode, ops, tickers }) {
  const m = mountPair(A, B, { v2, tickers })
  p.st.envelopes.push(plan('apply', tf(A, 'W')))
  await m.say(`make the ${A} chart weekly`)
  expect(routingV2Active()).toBe(v2)
  expect([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]).toEqual(['W', 'D'])
  p.st.envelopes.length = 0
  const t0 = p.turns()
  p.st.envelopes.push(plan(mode, ...ops))
  const reply = await m.say(text)
  return { m, reply, model: p.turns() - t0 }
}
const ASKED = /You named|Which chart do you mean|Did you mean/

const combos = []
for (const [kind, A, B] of PAIRS) for (const v2 of [false, true]) for (const mode of ['apply', 'propose']) combos.push({ kind, A, B, v2, mode })
const tag = (c) => `${c.kind} ${c.A}→${c.B} · routing ${c.v2 ? 'v2' : 'v1'} · ${c.mode}`

describe('(b) a CORRECT correction plan executes — A put back as it was, the change on the named B', () => {
  const rows = []
  combos.forEach((c, i) => { for (const k of [i, i + 3]) rows.push([tag(c), FRAMES[k % FRAMES.length](cased(c.kind, c.B, k), cased(c.kind, c.A, k)), c, k % FRAMES.length]) })
  it('covers every frame, both routings, both modes, both ticker kinds', () => {
    expect(new Set(rows.map(r => r[3])).size).toBe(FRAMES.length)
    expect(new Set(rows.map(r => `${r[2].v2}${r[2].mode}${r[2].kind}`)).size).toBe(8)
  })
  it.each(rows)('%s: "%s"', async (_t, text, c) => {
    const { m, reply } = await dialogue({ ...c, text, ops: [tf(c.A, 'D'), tf(c.B, 'W')] })
    expect(reply).not.toMatch(ASKED)
    // propose: the plan is a card that applies (routing v2 may also run the correction itself, NLM-1's "I meant …": no card then)
    if (c.mode === 'propose' && p.proposals().length) {
      expect(p.proposals().length).toBe(1)
      expect([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]).toEqual(['W', 'D'])        // a card: nothing yet
      await m.click('Apply')
    }
    expect([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]).toEqual(['D', 'W'])
  }, 40000)
})

describe('(a) a WRONG plan still asks and changes nothing', () => {
  const WRONG = [
    ['another property on A (log scale)', (c) => [(body) => ({ action: 'chart.setScale', target: ref(body, c.A), args: { scale: 'log' } }), tf(c.B, 'W')]],
    ['another value on A (monthly, not the daily it was)', (c) => [tf(c.A, 'M'), tf(c.B, 'W')]],
  ]
  const rows = []
  combos.forEach((c, i) => { const [name, ops] = WRONG[i % WRONG.length]; rows.push([tag(c), name, FRAMES[i % FRAMES.length](cased(c.kind, c.B, i), cased(c.kind, c.A, i)), c, ops]) })
  it.each(rows)('%s · %s: "%s"', async (_t, _n, text, c, ops) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: ops(c) })
    if (model) {
      expect(reply).toMatch(ASKED)
      expect(p.proposals().length).toBe(0)
      expect([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]).toEqual(['W', 'D'])
    } else {
      // read on the instant path (the wrong plan was never consulted): only its own correction may have run
      expect([['W', 'D'], ['D', 'W']]).toContainEqual([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')])
    }
    expect(JSON.stringify(m.board.state.widgets.map(w => w.opts.settings))).not.toMatch(/"scale":"log"|"logScale":true/)
  }, 40000)
  // a setSymbol the model took from a lowercase verb word in the correction: asked (P0.2), the symbol never changes
  const VERB = [['fix', 'FIX'], ['go', 'GO'], ['run', 'RUN']]
  const vrows = combos.filter(c => c.kind === 'real').map((c, i) => [tag(c), `no, ${VERB[i % 3][0]} it on the ${c.B} one`, c, VERB[i % 3][1]])
  it.each(vrows)('%s · setSymbol from a verb word: "%s"', async (_t, text, c, T) => {
    const { m, reply } = await dialogue({ ...c, text, tickers: [T], ops: [(body) => ({ action: 'chart.setSymbol', target: ref(body, c.B), args: { symbol: T } })] })
    expect(m.board.state.groupSyms['N:cr']).toBe(c.B)
    expect(reply).not.toContain(`Changed symbol to ${T}`)
    expect(reply).toMatch(new RegExp(`Did you mean the ticker ${T}\\?|${ASKED.source}`))
    if (c.mode === 'apply' && /Did you mean the ticker/.test(reply)) expect(p.proposals().length).toBe(1)
  }, 40000)
})

describe('(c) controls', () => {
  const rows = combos.map((c, i) => [tag(c), c, i])
  it.each(rows)('%s: the undo-half plan WITHOUT correction words is asked', async (_t, c) => {
    const { m, reply, model } = await dialogue({ ...c, text: `make the ${c.B} one weekly too`, ops: [tf(c.A, 'D'), tf(c.B, 'W')] })
    if (model) expect(reply).toMatch(ASKED)                                      // the model's plan reverts A: asked
    expect(tfOf(m.board, 'cl')).toBe('W')                                         // A is never put back without being asked to
  }, 40000)
  it.each(rows)('%s: a correction that only changes B runs (A keeps its change)', async (_t, c, i) => {
    const { m, reply, model } = await dialogue({ ...c, text: FRAMES[i % FRAMES.length](cased(c.kind, c.B, i), cased(c.kind, c.A, i)), ops: [tf(c.B, 'W')] })
    expect(reply).not.toMatch(ASKED)
    if (c.mode === 'propose' && p.proposals().length) await m.click('Apply')
    // the model's plan changes only B; the instant path's own correction (when it reads the words) also puts A back
    expect([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]).toEqual(model ? ['W', 'W'] : ['D', 'W'])
  }, 40000)
})

// ── AUDIT NO-GO F1 (11-23, SAFETY): an ADDITIVE request never puts the earlier change back ─────────────────────────────────────
// Turn 1 makes A weekly; turn 2 ADDS ("actually make MSFT weekly too") and the model's plan is [A back to daily, B weekly]. On
// f4c64d59e1 A silently went back to daily in 14 of 16 apply cases (master asked 32/32): a bare "actually / wait / not / rather"
// licensed the undo half. Now the words must REJECT the earlier change. Every row: A is never put back without being asked; when
// the model's plan was read, nothing changed and it was asked (a question or a card).
const ADDITIVE = [
  // AUDIT's seven
  (B) => `actually make ${B} weekly too`, (B) => `wait, also make ${B} weekly`, (B, A) => `${B} weekly as well, not just ${A}`,
  (B) => `no problem, now do ${B} weekly too`, (B) => `make the ${B} one weekly too, not monthly`, (B) => `${B} weekly too rather than daily`,
  (B, A) => `do ${B} weekly too, keep ${A} weekly, not daily`,
  // variations
  // ("both A and B weekly" is left out: it NAMES A as a target, so a plan on A is identified by the words — the plan's wrong VALUE
  // for A is the model's mistake, which no target rail reads, on master too)
  (B) => `also ${B} weekly`, (B) => `and ${B} weekly as well`, (B) => `plus ${B} weekly`,
  (B, A) => `keep ${A} and do ${B} weekly`, (B, A) => `not only ${A}, ${B} weekly`, (B) => `in addition, ${B} weekly`,
  (B) => `actually, ${B} weekly`, (B) => `wait, ${B} weekly`, (B) => `${B} weekly, not monthly`, (B) => `${B} weekly rather than daily`,
  (B) => `no worries, ${B} weekly`, (B) => `another one: ${B} weekly`,
]
const PUT_BACK = /You named|Which chart do you mean|Did you mean|wasn.t sure/
describe('F1: an additive request with an undo-half plan is asked, and the earlier change is never silently put back', () => {
  const rows = []
  // AUDIT's seven on their own pair, every routing × mode
  for (const c of combos.filter(x => x.A === 'META')) for (let k = 0; k < 7; k++) rows.push([tag(c), ADDITIVE[k](c.B, c.A), c, k])
  // every wording, rotated over the other pairs (real tickers and ticker-like words), every routing × mode
  combos.filter(x => x.A !== 'META').forEach((c, i) => { for (const k of [i, i + 9]) rows.push([tag(c), ADDITIVE[k % ADDITIVE.length](cased(c.kind, c.B, k), cased(c.kind, c.A, k)), c, k % ADDITIVE.length]) })
  it('covers every wording, both routings, both modes, both ticker kinds', () => {
    expect(new Set(rows.map(r => r[3])).size).toBe(ADDITIVE.length)
    expect(new Set(rows.map(r => `${r[2].v2}${r[2].mode}${r[2].kind}`)).size).toBe(8)
  })
  it.each(rows)('%s: "%s"', async (_t, text, c) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: [tf(c.A, 'D'), tf(c.B, 'W')] })
    expect(tfOf(m.board, 'cl')).toBe('W')                                         // A is never put back without being asked
    if (model) {
      expect([tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]).toEqual(['W', 'D'])      // nothing changed
      expect(PUT_BACK.test(reply) || p.proposals().length > 0, reply).toBe(true)  // asked: a question, or a card to decide on
    }
  }, 40000)
})

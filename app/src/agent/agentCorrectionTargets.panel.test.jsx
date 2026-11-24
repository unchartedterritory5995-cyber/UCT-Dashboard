// ⭐ P0.2 correction design (owner + AUDIT, 11-24): NO SILENT REVERT, EVER. After a change on chart A, a model plan that puts A back
// exactly as it was (deixis.revertsLastChange) never runs on the model's word: it is a CARD with fixed UCT sentences —
//   [Apply] runs the whole plan · [Just <the other chart>] runs only the rest · [Cancel]
// — on routing v1 and v2, apply and propose, whatever the member's words (corrections, additive requests, CAPS, D1–D4, keep / preserve,
// negated or questioned undo). Only an EXPLICIT, un-negated "put A back" / "undo that" runs it directly. Plans that revert nothing
// are unchanged (the target rails ask about a wrong chart exactly as before; a correction that only changes B runs).
// Generated over wording classes × ticker kinds (real tickers; ticker-like English words on the board) × routing v1 / v2 (the harness
// default is v2, as production) × apply / propose, through the REAL panel with a scripted model. No market values.
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
// a real ticker is typed either way; a ticker-like English word is typed as a ticker (in capitals)
const cased = (kind, X, k) => (kind === 'real' && k % 2 ? X.toLowerCase() : X)

let p
function mountPair(A, B, { v2, tickers = [] }) {
  p = setupPanel({ routingV2: v2, tickers: [A, B, ...tickers] })
  const [ws, syms] = TWO(A, B)
  return p.mount(ws.map(w => ({ ...w, opts: { ...w.opts, tf: 'D' } })), syms)
}
const ref = (body, sym) => body.context.charts.find(c => c.label === `Chart (${sym})`).ref
const tfOf = (board, id) => board.state.widgets.find(w => w.id === id).opts.tf
const tfs = (m) => [tfOf(m.board, 'cl'), tfOf(m.board, 'cr')]
const widget = (m, id) => JSON.stringify(m.board.state.widgets.find(w => w.id === id))
const tf = (sym, t) => (body) => ({ action: 'chart.setTimeframe', target: ref(body, sym), args: { timeframe: t } })
const plan = (mode, ...ops) => (body) => p.env(mode, ops.map(o => o(body)), '')
// turn 1: A to weekly (whichever path reads it), then turn 2 with the scripted plan
async function dialogue({ A, B, v2, text, mode, ops, tickers }) {
  const m = mountPair(A, B, { v2, tickers })
  p.st.envelopes.push(plan('apply', tf(A, 'W')))
  await m.say(`make the ${A} chart weekly`)
  expect(routingV2Active()).toBe(v2)
  expect(tfs(m)).toEqual(['W', 'D'])
  const a0 = widget(m, 'cl')
  p.st.envelopes.length = 0
  const t0 = p.turns()
  p.st.envelopes.push(plan(mode, ...ops))
  const reply = await m.say(text)
  return { m, reply, model: p.turns() - t0, a0 }
}
const CARD = 'back the way it was before my last change'
const ASKED = /You named|Which chart do you mean|Did you mean/

const combos = []
for (const [kind, A, B] of PAIRS) for (const v2 of [false, true]) for (const mode of ['apply', 'propose']) combos.push({ kind, A, B, v2, mode })
const tag = (c) => `${c.kind} ${c.A}→${c.B} · routing ${c.v2 ? 'v2' : 'v1'} · ${c.mode}`

// ── every wording class whose plan reverts A ──
const CLASSES = {
  correction: [(B) => `no, the ${B} one`, (B) => `no wait, ${B} instead`, (B) => `i meant ${B}`, (B) => `wrong chart, ${B}`,
    (B) => `nope, do ${B} instead`, (B) => `no — ${B}, not that`, (B, A) => `${B}, not ${A}`, (B, A) => `${B} instead of ${A}`],
  additive: [(B) => `actually make ${B} weekly too`, (B) => `wait, also make ${B} weekly`, (B, A) => `${B} weekly as well, not just ${A}`,
    (B) => `no problem, now do ${B} weekly too`, (B) => `make the ${B} one weekly too, not monthly`, (B) => `${B} weekly too rather than daily`,
    (B) => `also ${B} weekly`, (B) => `plus ${B} weekly`, (B) => `make the ${B} one weekly too`, (B) => `in addition, ${B} weekly`],
  keep: [(B, A) => `do ${B} weekly too, keep ${A} weekly, not daily`, (B, A) => `keep ${A} and do ${B} weekly`, (B, A) => `preserve ${A}, ${B} weekly`,
    (B, A) => `leave ${A} as it is and make ${B} weekly`],
  caps: [(B) => `no, ${B} weekly TOO`, (B) => `nope ALSO ${B}`, (B) => `oops ADD ${B} weekly`, (B, A) => `no wait KEEP ${A}, ${B} weekly`,
    (B) => `sorry, ${B} AS WELL`, (B) => `nope, ${B} TOO`, (B, A) => `NOPE, KEEP ${A} AND ${B}`, (B) => `no, ${B} weekly as WELL`],
  d1d4: [(B) => `no, add RSI to ${B}`, (B) => `nope, looks great, now ${B} weekly`, (B) => `what I meant was add RSI to ${B}`, (B) => `sorry, make ${B} weekly`,
    (B) => `no — make ${B} weekly`, (B) => `no, that's perfect, now ${B} on log`, (B) => `what i meant was make ${B} weekly`, (B) => `sorry — switch ${B} to weekly please`],
  negatedOrQuestion: [(B, A) => `don't undo ${A}, make ${B} weekly`, (B) => `do not revert that, ${B} weekly`, (B, A) => `never put ${A} back, ${B} weekly`,
    (B) => `no need to undo that, ${B} weekly`, (B) => `${B} weekly without undoing it`, (B) => `should I undo that and do ${B}?`,
    (B, A) => `can you put ${A} back and make ${B} weekly?`, (B) => `undo that? ${B} weekly`, (B, A) => `if you undo ${A}, make ${B} weekly`,
    (B) => `rather than undo it, ${B} weekly`],
}
const ROWS = []
for (const [cls, frames] of Object.entries(CLASSES)) {
  combos.forEach((c, i) => {
    for (const k of [i, i + 5]) {
      const f = frames[k % frames.length]
      ROWS.push([`${cls} · ${tag(c)}`, f(cased(c.kind, c.B, k), cased(c.kind, c.A, k)), c, k % 3, `${cls}:${k % frames.length}`])
    }
  })
}
describe('a plan that reverts the last change is a CARD — never silent; Apply runs both, Just runs only the other chart', () => {
  it('covers every wording of every class, both routings, both modes, both ticker kinds', () => {
    for (const [cls, frames] of Object.entries(CLASSES)) expect(new Set(ROWS.filter(r => r[4].startsWith(`${cls}:`)).map(r => r[4])).size).toBe(frames.length)
    expect(new Set(ROWS.map(r => `${r[2].v2}${r[2].mode}${r[2].kind}`)).size).toBe(8)
  })
  it.each(ROWS)('%s: "%s"', async (_t, text, c, pick) => {
    const { m, reply, model, a0 } = await dialogue({ ...c, text, ops: [tf(c.A, 'D'), tf(c.B, 'W')] })
    if (!model) {
      // read on the instant path (the scripted plan is never consulted): A is never put back by the model's plan
      expect([['W', 'D'], ['W', 'W'], ['D', 'W']]).toContainEqual(tfs(m))
      return
    }
    if (!reply.includes(CARD)) {
      // the REST of the plan did not pass a target rail (B is not named: a ticker-like word in a non-ticker role, a bare "it") — the
      // rail asks first, and nothing changed: still never a silent revert
      expect(reply).toMatch(ASKED)
      expect(tfs(m)).toEqual(['W', 'D'])
      expect(widget(m, 'cl')).toBe(a0)
      return
    }
    expect(reply).toContain(CARD)                                                  // the card — fixed UCT sentences
    expect(reply).toContain(`Chart (${c.A})`)
    expect(tfs(m)).toEqual(['W', 'D'])                                             // nothing changed yet: 0 silent reverts
    expect(widget(m, 'cl')).toBe(a0)
    // the words themselves EXCLUDE A ("not GO", "keep META", "don't undo NVDA"): the card said A goes back, and Apply is the member's
    // consent to exactly that — the exclusion gates may still hold A (then it stays); either way nothing happened before the pick
    const excludesA = new RegExp(`\\b(?:not|instead of|rather than|keep|leave|preserve|don't|do not|never|no need to)\\b[^,.]*\\b${c.A}\\b`, 'i').test(text)
    if (pick === 1) {
      await m.click('Apply')
      if (excludesA) expect(['W', 'D']).toContain(tfOf(m.board, 'cl'))
      else expect(tfs(m)).toEqual(['D', 'W'])                                      // Apply → both
    } else if (pick === 2) {
      await m.click(`Just Chart (${c.B})`)
      expect(tfs(m)).toEqual(['W', 'W'])                                           // Just → only B
      expect(widget(m, 'cl')).toBe(a0)                                             // A untouched, field by field
    }
  }, 40000)
})

// ── the EXPLICIT revert runs directly (no card) ──
const EXPLICIT = [(B, A) => `put ${A} back and make ${B} weekly`, (B) => `undo that and make ${B} weekly`, (B, A) => `revert ${A}, then make ${B} weekly`,
  (B) => `undo my last change, ${B} weekly please`, (B, A) => `put the ${A} chart back, ${B} weekly`, (B) => `undo it and do ${B} weekly`]
describe('an explicit, un-negated "put A back" / "undo that" runs the plan with no revert card', () => {
  const rows = []
  combos.forEach((c, i) => rows.push([tag(c), EXPLICIT[i % EXPLICIT.length](cased(c.kind, c.B, i), cased(c.kind, c.A, i)), c]))
  it.each(rows)('%s: "%s"', async (_t, text, c) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: [tf(c.A, 'D'), tf(c.B, 'W')] })
    if (!model) return                                                             // an instant reader took it (its own Undo)
    expect(reply).not.toContain(CARD)
    if (c.mode === 'propose' && p.proposals().length) await m.click('Apply')       // propose: the model's own card
    expect(tfs(m)).toEqual(['D', 'W'])
  }, 40000)
})

// ── plans that revert nothing are unchanged ──
describe('a plan that reverts nothing is unchanged: wrong targets are asked by the rails, a B-only correction runs', () => {
  const WRONG = [
    ['another property on A (log scale)', (c) => [(body) => ({ action: 'chart.setScale', target: ref(body, c.A), args: { scale: 'log' } }), tf(c.B, 'W')]],
    ['another value on A (monthly, not the daily it was)', (c) => [tf(c.A, 'M'), tf(c.B, 'W')]],
  ]
  const rows = combos.map((c, i) => [tag(c), WRONG[i % 2][0], CLASSES.correction[i % CLASSES.correction.length](cased(c.kind, c.B, i), cased(c.kind, c.A, i)), c, WRONG[i % 2][1]])
  it.each(rows)('%s · %s: "%s" → asked, nothing changed, no revert card', async (_t, _n, text, c, ops) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: ops(c) })
    if (!model) return
    expect(reply).not.toContain(CARD)
    expect(ASKED.test(reply) || p.proposals().length > 0, reply).toBe(true)      // asked, or the model's own proposal card
    expect(tfs(m)).toEqual(['W', 'D'])
  }, 40000)
  const only = combos.map((c, i) => [tag(c), CLASSES.correction[i % CLASSES.correction.length](cased(c.kind, c.B, i), cased(c.kind, c.A, i)), c])
  it.each(only)('%s: "%s" with a plan that only changes B → runs, no card', async (_t, text, c) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: [tf(c.B, 'W')] })
    if (!model) return
    expect(reply).not.toContain(CARD)
    if (c.mode === 'propose' && p.proposals().length) await m.click('Apply')
    expect(tfs(m)).toEqual(['W', 'W'])
  }, 40000)
  // a setSymbol the model took from a lowercase verb word: asked (P0.2), never applied
  const VERB = [['fix', 'FIX'], ['go', 'GO'], ['run', 'RUN']]
  const vrows = combos.filter(c => c.kind === 'real').map((c, i) => [tag(c), `no, ${VERB[i % 3][0]} it on the ${c.B} one`, c, VERB[i % 3][1]])
  it.each(vrows)('%s · setSymbol from a verb word: "%s"', async (_t, text, c, T) => {
    const { m, reply } = await dialogue({ ...c, text, tickers: [T], ops: [(body) => ({ action: 'chart.setSymbol', target: ref(body, c.B), args: { symbol: T } })] })
    expect(m.board.state.groupSyms['N:cr']).toBe(c.B)
    expect(reply).not.toContain(`Changed symbol to ${T}`)
  }, 40000)
})

// ── the rest of a revert-bearing plan goes through every target rail BEFORE any card ──
describe('the card is offered only when the rest of the plan passes every target rail', () => {
  const rows = combos.map((c, i) => [tag(c), ['nope, weekly please', 'no, do weekly instead', 'wait, weekly'][i % 3], c])
  it.each(rows)('%s: "%s" (the other chart is never named) → the rail asks; no card, nothing changed', async (_t, text, c) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: [tf(c.A, 'D'), tf(c.B, 'W')] })
    if (!model) return
    expect(reply).not.toContain(CARD)
    expect(tfs(m)).toEqual(['W', 'D'])
  }, 40000)
})

// ── a plan that is NOTHING BUT the revert is the member's request for the earlier state: it runs as before (no card) ─────────────
// ("leave replay mode", "close it", "delete that line" right after making it — owner rule 2026-10-27). A revert riding WITH another
// change is the card (above).
describe('a revert-only plan runs as before, with no card', () => {
  const WORDS = [(A) => `put the ${A} chart on daily again`, (A) => `${A} back to daily`, () => 'make it daily again', (A) => `daily on ${A}`]
  const rows = combos.map((c, i) => [tag(c), WORDS[i % WORDS.length](cased(c.kind, c.A, i)), c])
  it.each(rows)('%s: "%s"', async (_t, text, c) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: [tf(c.A, 'D')] })
    expect(reply).not.toContain(CARD)
    if (!model) return
    if (ASKED.test(reply)) { expect(tfs(m)).toEqual(['W', 'D']); return }       // a rail asked which chart (an ordinary-word ticker)
    if (c.mode === 'propose' && p.proposals().length) await m.click('Apply')
    expect(tfs(m)).toEqual(['D', 'D'])
  }, 40000)
})

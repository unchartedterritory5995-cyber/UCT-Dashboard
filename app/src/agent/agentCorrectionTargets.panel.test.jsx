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

// ── a plan that is NOTHING BUT the revert: the card, unless the words NAME its action (or explicitly undo) ───────────────────────
// PL 11-24: keyed on plan shape alone, "fix that" / "that's wrong" / "try again" with a revert-only plan would undo silently — the
// implicit Undo the owner ruled out. Revert-only × vague corrections × field kinds (timeframe, symbol, scale) × routing × mode: the
// one-change card ("That would put Chart (A) back … Nothing has changed yet." [Apply] [Cancel]), 0 changes before the pick. A verb that
// names ANOTHER action ("close the indicator panel") is no license. Verbs that name the op's own action: the 16 existing outcome
// tests (delete that line, clear my drawings, leave replay, close the tab, collapse the list) — they run as before.
const VAGUE = ['fix that', "that's wrong", 'no', 'hmm, try again', 'not like that', 'redo it', 'nope', "that's not right", 'wrong', 'try that again',
  'close the indicator panel', 'no, the other way', 'again please', 'hmm no']
const FIELDS = [
  ['timeframe', () => tf('A', 'W'), () => ({ action: 'chart.setTimeframe', target: 'cl', args: { timeframe: 'D' } }), (m) => tfOf(m.board, 'cl'), 'W', 'D'],
  ['symbol', () => () => ({ action: 'chart.setSymbol', target: 'cl', args: { symbol: 'PLTR' } }), (A) => ({ action: 'chart.setSymbol', target: 'cl', args: { symbol: A } }),
    (m) => m.board.state.groupSyms['N:cl'], 'PLTR', null],
]
async function dialogueField({ A, B, v2, mode, text, field }) {
  const [, first, back, read, changed] = field
  const m = mountPair(A, B, { v2, tickers: ['PLTR'] })
  p.st.envelopes.push((body) => p.env('apply', [field[0] === 'timeframe' ? tf(A, 'W')(body) : first()(body)], ''))
  await m.say(field[0] === 'timeframe' ? `make the ${A} chart weekly` : `put PLTR on the ${A} chart`)
  expect(read(m)).toBe(changed)
  const a0 = widget(m, 'cl')
  p.st.envelopes.length = 0
  const t0 = p.turns()
  p.st.envelopes.push(() => p.env(mode, [back(A)], ''))
  const reply = await m.say(text)
  return { m, reply, model: p.turns() - t0, a0 }
}
describe('a revert-only plan after a vague correction is the one-change card, 0 changes before the pick', () => {
  const rows = []
  combos.forEach((c, i) => FIELDS.forEach((f, j) => { for (const k of [i + j, i + j + 7]) rows.push([`${f[0]} · ${tag(c)}`, VAGUE[k % VAGUE.length], c, f, k % 2]) }))
  it('covers every vague wording, both fields, both routings, both modes', () => {
    expect(new Set(rows.map(r => r[1])).size).toBe(VAGUE.length)
    expect(new Set(rows.map(r => `${r[3][0]}${r[2].v2}${r[2].mode}`)).size).toBe(8)
  })
  it.each(rows)('%s: "%s"', async (_t, text, c, f, pick) => {
    const { m, reply, model, a0 } = await dialogueField({ ...c, text, field: f })
    if (!model) return
    // the plan is ONLY the revert: no rest for a rail to ask about — the card, always (never a silent revert, never a rail's guess).
    // (P0.2's ticker-word question comes first when the revert's symbol IS the verb typed: "fix that" → FIX — nothing changed either)
    if (reply.includes('Did you mean the ticker')) { expect(widget(m, 'cl')).toBe(a0); return }
    expect(reply).toContain(CARD)
    expect(reply).toContain(`That would put Chart (`)
    expect(reply).toContain('back the way it was before my last change. Nothing has changed yet.')   // the one-change sentence
    expect(reply).not.toContain('and also change')
    expect(widget(m, 'cl')).toBe(a0)                                               // 0 changes before the pick
    if (pick) {
      await m.click('Apply')
      if (f[0] === 'timeframe') expect(tfOf(m.board, 'cl')).toBe('D')
      // a symbol change on a board of several charts also passes execute's own symbol rail ("Which chart should change to …?"):
      // the card never bypasses it — either the revert ran, or that question is asked with nothing changed
      else if (/Which chart should change to/.test(p.transcript())) expect(widget(m, 'cl')).toBe(a0)
      else expect(m.board.state.groupSyms['N:cl']).toBe(c.A)
    } else {
      await m.click('Cancel')
      expect(widget(m, 'cl')).toBe(a0)
    }
  }, 40000)
})
describe('a revert-only plan with an EXPLICIT revert runs with no card', () => {
  const rows = combos.map((c, i) => [tag(c), ['undo that', 'revert it', 'undo my last change', `put ${c.A} back`][i % 4], c])
  it.each(rows)('%s: "%s"', async (_t, text, c) => {
    const { m, reply, model } = await dialogue({ ...c, text, ops: [tf(c.A, 'D')] })
    expect(reply).not.toContain(CARD)
    if (!model) return
    if (c.mode === 'propose' && p.proposals().length) await m.click('Apply')
    expect(tfOf(m.board, 'cl')).toBe('D')
  }, 40000)
})

// ── AUDIT NO-GO X (11-24): an explicit revert licenses ONLY the revert ops bound to it ──────────────────────────────────────────
// Turn 1 changes BOTH charts. A NAMED explicit revert ("put A back") licenses only A's revert op: a crossed plan [B back] or a plan that
// puts both back is the card, nothing changed before the pick; the correct plan [A back] runs. "undo that / my last change" licenses only
// the EXACT last change set (both charts); a plan that puts back only part of it is the card. Boards × routing × mode.
const X_PAIRS = [['real', 'META', 'NVDA'], ['real', 'AAPL', 'TSLA'], ['word', 'ON', 'NOW']]
const NAMED_FORMS = [(A) => `put ${A} back`, (A) => `undo ${A}`, (A) => `revert ${A}`, (A) => `put the ${A} chart back`]
const LAST_FORMS = ['undo that', 'undo my last change', 'revert it', 'undo the last change']
async function bothThen({ A, B, v2, mode, text, ops }) {
  const m = mountPair(A, B, { v2 })
  p.st.envelopes.push(plan('apply', tf(A, 'W'), tf(B, 'W')))
  await m.say('make both charts weekly')
  expect(tfs(m)).toEqual(['W', 'W'])
  const a0 = widget(m, 'cl'), b0 = widget(m, 'cr')
  p.st.envelopes.length = 0
  const t0 = p.turns()
  p.st.envelopes.push(plan(mode, ...ops))
  const reply = await m.say(text)
  return { m, reply, model: p.turns() - t0, a0, b0 }
}
const xCombos = []
for (const [kind, A, B] of X_PAIRS) for (const v2 of [false, true]) for (const mode of ['apply', 'propose']) xCombos.push({ kind, A, B, v2, mode })
describe('X: a named explicit revert licenses only the named chart; "undo that" only the exact last change set', () => {
  const rows = []
  xCombos.forEach((c, i) => {
    const named = NAMED_FORMS[i % NAMED_FORMS.length](cased(c.kind, c.A, i))
    rows.push([`crossed · ${tag(c)}`, named, c, 'crossed'], [`both · ${tag(c)}`, named, c, 'both'], [`correct · ${tag(c)}`, named, c, 'correct'])
    const last = LAST_FORMS[i % LAST_FORMS.length]
    rows.push([`last-exact · ${tag(c)}`, last, c, 'last-exact'], [`last-partial · ${tag(c)}`, last, c, 'last-partial'])
  })
  it.each(rows)('%s: "%s"', async (_t, text, c, shape) => {
    const ops = { crossed: [tf(c.B, 'D')], both: [tf(c.A, 'D'), tf(c.B, 'D')], correct: [tf(c.A, 'D')],
      'last-exact': [tf(c.A, 'D'), tf(c.B, 'D')], 'last-partial': [tf(c.A, 'D')] }[shape]
    const { m, reply, model, a0, b0 } = await bothThen({ ...c, text, ops })
    if (!model) return
    if (shape === 'correct' || shape === 'last-exact') {
      expect(reply).not.toContain(CARD)
      if (c.mode === 'propose' && p.proposals().length) await m.click('Apply')
      expect(tfs(m)).toEqual(shape === 'correct' ? ['D', 'W'] : ['D', 'D'])
      return
    }
    // a revert the words did not license: the card, and NOTHING changed before the pick (field by field)
    expect(reply).toContain(CARD)
    expect(widget(m, 'cl')).toBe(a0)
    expect(widget(m, 'cr')).toBe(b0)
    await m.click('Cancel')
    expect(tfs(m)).toEqual(['W', 'W'])
  }, 40000)
})

// ── board drift: a card picked on a board whose carded target changed since is refused ─────────────────────────────────────────
describe('drift: the pick re-reads each carded op\'s own target and refuses on a change', () => {
  const rows = combos.filter(c => c.kind === 'real').map(c => [tag(c), c])
  it.each(rows)('%s: the chart moved to monthly after the card → Apply refused, nothing applied', async (_t, c) => {
    const { m, reply, model } = await dialogue({ ...c, text: 'fix that', ops: [tf(c.A, 'D')] })
    if (!model) return
    expect(reply).toContain(CARD)
    m.board.state.widgets.find(w => w.id === 'cl').opts.tf = 'M'                  // the board drifts under the card
    await m.click('Apply')
    expect(p.transcript()).toContain('Your board changed since I asked')
    expect(tfOf(m.board, 'cl')).toBe('M')
  }, 40000)
})

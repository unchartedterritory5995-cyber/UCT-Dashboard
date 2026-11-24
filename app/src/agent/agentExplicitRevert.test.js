// ⭐ P0.2 correction design (owner + AUDIT, 11-24): the ONLY words that let a model plan undo the last change without the revert card
// are an EXPLICIT, imperative, un-negated revert of that change (deixis.explicitRevertRequested). Generated as a property:
//   every explicit revert form × every earlier-chart spelling × lead-ins / trailers → explicit;
//   the same forms negated ("don't", "do not", "never", "no need to", "without", "not", "rather than", "instead of", "if", "unless"…),
//   as questions ("should I…?", "can you…?", "…?") or hypothetical → NOT explicit (the card asks);
//   every non-revert message (corrections, additive, CAPS, D1–D4, keep / preserve) → NOT explicit (a revert in its plan is carded).
// Plus the revert detector itself: only an op that puts the earlier chart back exactly as it was is a revert.
import { describe, it, expect } from 'vitest'
import { explicitRevertRequested, revertsLastChange, actionNamedIn } from './deixis'
import { registerBuiltins } from './builtins'
import { getCapability } from './capabilities'

const A = 'META'
const EXPLICIT = [
  (a) => `put ${a} back`, (a) => `put the ${a} chart back`, (a) => `put the ${a} one back`, () => 'undo that', () => 'undo it', () => 'undo this',
  () => 'revert that', () => 'revert it', () => 'undo the last change', () => 'undo my last change', () => 'revert your last change',
  (a) => `undo ${a}`, (a) => `revert ${a}`, (a) => `revert the ${a} chart`,
]
const SPELL = [A, A.toLowerCase(), `$${A}`]
const LEAD = ['', 'ok, ', 'please ', 'no, ', 'actually, ', 'sorry, ', 'right, ']
const TRAIL = ['', ' and make MSFT weekly', ', then MSFT weekly', '. MSFT weekly please', ' please', ' and do MSFT']
const NEG = ["don't ", 'do not ', 'never ', 'no need to ', 'please do not ', "you don't need to ", "let's not ", 'rather than ', 'instead of having to ', 'if you ', 'unless you ', 'before you ']
const QUESTION = [(s) => `should I ${s}?`, (s) => `can you ${s}?`, (s) => `could you ${s}?`, (s) => `${s}?`, (s) => `would you ${s} for me?`, (s) => `why did you ${s}`, (s) => `do you want to ${s}`]
const NOT_REVERT = ['no, the MSFT one', 'I meant MSFT', 'wrong chart, MSFT', 'actually make MSFT weekly too', 'no, MSFT weekly TOO', 'nope ALSO MSFT',
  'no, add RSI to MSFT', 'nope, looks great, now MSFT weekly', 'what I meant was add RSI to MSFT', 'sorry, make MSFT weekly', 'keep META and do MSFT weekly',
  'preserve META, MSFT weekly', 'MSFT weekly without undoing it', 'put MSFT on weekly', 'put it on the right one', 'undoing it would be bad', 'META back to daily? no', '']

describe('explicitRevertRequested: only an explicit, imperative, un-negated revert of the earlier change', () => {
  it('explicit forms × spellings × lead-ins × trailers → explicit', () => {
    const wrong = []
    for (const f of EXPLICIT) for (const a of SPELL) for (const l of LEAD) for (const t of TRAIL) { const s = l + f(a) + t; if (!explicitRevertRequested(s, [A])) wrong.push(s) }
    expect(wrong).toEqual([])
  })
  it('the same forms negated, hypothetical or asked → NOT explicit', () => {
    const wrong = []
    for (const f of EXPLICIT) for (const a of SPELL) {
      for (const n of NEG) for (const t of TRAIL) { const s = n + f(a) + t; if (explicitRevertRequested(s, [A])) wrong.push(s) }
      for (const q of QUESTION) { const s = q(f(a)); if (explicitRevertRequested(s, [A])) wrong.push(s) }
      // the old hole: a negated revert of the earlier chart followed by another instruction
      for (const n of NEG) { const s = `${n}${f(a)}, make MSFT weekly`; if (explicitRevertRequested(s, [A])) wrong.push(s) }
    }
    expect(wrong).toEqual([])
  })
  it('non-revert messages → NOT explicit', () => {
    expect(NOT_REVERT.filter(s => explicitRevertRequested(s, [A]))).toEqual([])
  })
  it('"put <a chart the last turn did NOT change> back" is not a revert of the earlier change', () => {
    expect(explicitRevertRequested('put MSFT back', [A])).toBe(false)
    expect(explicitRevertRequested('put META back', [A])).toBe(true)
  })
})

describe('revertsLastChange: only an op that puts the earlier chart back exactly as it was', () => {
  const kind = {
    read: (_h, r) => ({ ref: r, tf: 'W', symbol: 'META' }),
    stateOf: (s) => ({ tf: s.tf, symbol: s.symbol }),
    patch: (b, a) => (b.tf !== a.tf || b.symbol !== a.symbol ? { ...(b.tf !== a.tf ? { tf: a.tf } : {}), ...(b.symbol !== a.symbol ? { symbol: a.symbol } : {}) } : null),
  }
  const cap = { target: 'chart', apply: (st, a) => (a.timeframe ? { ...st, tf: a.timeframe } : a.symbol ? { ...st, symbol: a.symbol } : st) }
  const items = [{ ref: 'cl', before: { ref: 'cl', tf: 'D', symbol: 'META' } }]
  const r = revertsLastChange({ items, host: {}, getCapability: () => cap, getTargetKind: () => kind })
  it('back to the value it had → revert; any other value, field or chart → not', () => {
    expect(r({ action: 'chart.setTimeframe', target: 'cl', args: { timeframe: 'D' } })).toBe(true)
    expect(r({ action: 'chart.setTimeframe', target: 'cl', args: { timeframe: 'M' } })).toBe(false)
    expect(r({ action: 'chart.setSymbol', target: 'cl', args: { symbol: 'AAPL' } })).toBe(false)
    expect(r({ action: 'chart.setTimeframe', target: 'cr', args: { timeframe: 'D' } })).toBe(false)
    expect(revertsLastChange({ items: [], host: {}, getCapability: () => cap, getTargetKind: () => kind })).toBe(null)
  })
})

// ── actionNamedIn: a verb the op's OWN capability declares, never negated, never asked ──
registerBuiltins()
// ⭐ AUDIT NO-GO R (11-24) + PL: only the drawing kinds (owner 10-27) declare verbs AND nouns; the verb must HEAD an imperative clause
// and GOVERN the declared noun (after a few modifiers) or a lone pronoun. Generated: every declared verb × governing frames (noun /
// pronoun) vs the same verb used as a NOUN, as an ADJECTIVE / other part of speech, with ANOTHER object, bare, negated, asked —
// in vague-complaint frames. Every other kind declares none (its revert-only plan is the card).
const KINDS = ['drawing.remove', 'drawing.clear']
const GOVERNED = [(v, n) => `${v} the ${n}`, (v, n) => `${v} that ${n}`, (v, n) => `ok, ${v} the ${n} please`, (v, n) => `please ${v} my ${n}`,
  (v, n) => `${v} the 200 ${n}`, (v, n) => `go ahead and ${v} the old ${n}`, (v) => `${v} it`, (v) => `${v} that`, (v) => `now ${v} it please`]
const NOT_GOVERNED = [
  // the verb as a NOUN or another part of speech, in a complaint
  (v) => `the ${v} was wrong`, (v) => `that ${v} is not right`, (v) => `no, the ${v} part is off`, (v) => `hmm, ${v} is not what I meant`,
  // as an ADJECTIVE / modifier
  (v) => `that's not ${v}`, (v) => `${v}, but not quite`, (v) => `it was a ${v} mistake`, (v) => `no — ${v} enough?`,
  // with ANOTHER object
  (v) => `${v} the guesswork`, (v) => `${v} my doubts`, (v) => `${v} the rsi`, (v) => `${v} the weekly timeframe`, (v) => `${v} the confusion`,
  // bare, negated, asked, hypothetical
  (v) => `no, wrong, ${v}`, (v) => `don't ${v} it`, (v, n) => `never ${v} the ${n}`, (v, n) => `should I ${v} the ${n}?`, (v) => `can you ${v} it?`,
  (v, n) => `if you ${v} the ${n} I will be upset`,
  // vague complaints with no verb
  () => 'fix that', () => "that's wrong", () => 'hmm, try again', () => 'not like that', () => 'redo it',
]
describe('actionNamedIn: a drawing verb that GOVERNS a drawing object, and nothing else', () => {
  it('only the drawing kinds declare verbs and nouns; every other kind with a revert-only path declares none', () => {
    for (const a of KINDS) { expect(getCapability(a)?.verbs?.length).toBeGreaterThan(0); expect(getCapability(a)?.nouns?.length).toBeGreaterThan(0) }
    for (const a of ['chart.replay', 'widget.closeTab', 'widget.setOption', 'widget.selectTab', 'watchlist.setColumns', 'chart.setTimeframe', 'chart.setSymbol', 'chart.setScale', 'indicatorStyle.set'])
      expect([a, getCapability(a)?.verbs || null, getCapability(a)?.nouns || null]).toEqual([a, null, null])
  })
  it('every declared verb × governing frames × declared nouns → named', () => {
    const wrong = []
    for (const a of KINDS) {
      const { verbs, nouns } = getCapability(a)
      for (const v of verbs) for (const n of nouns) for (const f of GOVERNED) { const t = f(v, n); if (!actionNamedIn(t, verbs, nouns)) wrong.push(`${a}: ${t}`) }
    }
    expect(wrong).toEqual([])
  })
  it('the same verbs as a noun / adjective / with another object / bare / negated / asked, and vague complaints → NOT named', () => {
    const wrong = []
    for (const a of KINDS) {
      const { verbs, nouns } = getCapability(a)
      for (const v of verbs) for (const f of NOT_GOVERNED) { const t = f(v, nouns[0]); if (actionNamedIn(t, verbs, nouns)) wrong.push(`${a}: ${t}`) }
    }
    expect(wrong).toEqual([])
  })
  it('a capability that declares no nouns names nothing, whatever the words', () => {
    expect(actionNamedIn('delete that line', ['delete'], undefined)).toBe(false)
    expect(actionNamedIn('leave replay mode', undefined, undefined)).toBe(false)
  })
})

// ── AUDIT NO-GO X (11-24): the explicit span licenses only the revert ops bound to it (structure, not words) ─────────────────────
import { licensedReverts, explicitRevertSpan as spanOf, boardPrintOf } from './deixis'
describe('licensedReverts: a named revert licenses the named chart only; "undo that" only the exact last change set', () => {
  const charts = [{ ref: 'cl', symbol: 'META' }, { ref: 'cr', symbol: 'NVDA' }]
  const host = { charts: { list: () => charts } }
  const kind = { list: () => charts.map(c => ({ ref: c.ref })) }
  const gk = () => kind
  const gc = () => ({ target: 'chart' })
  const items = [{ ref: 'cl', before: { symbol: 'META', tf: 'D' } }, { ref: 'cr', before: { symbol: 'NVDA', tf: 'D' } }]
  const A = { action: 'chart.setTimeframe', target: 'cl', args: { timeframe: 'D' } }
  const B = { action: 'chart.setTimeframe', target: 'cr', args: { timeframe: 'D' } }
  const lic = (text, reverts) => licensedReverts({ span: spanOf(text, ['META', 'NVDA']), reverts, items, host, getCapability: gc, getTargetKind: gk })
  it('named: only the named chart\'s revert op', () => {
    for (const t of ['put META back', 'undo META', 'revert META', 'put the META chart back', 'undo meta please', 'revert $META']) {
      expect([t, lic(t, [B])]).toEqual([t, []])                              // crossed: NVDA is not licensed
      expect([t, lic(t, [A, B])]).toEqual([t, [A]])                          // both: only META
      expect([t, lic(t, [A])]).toEqual([t, [A]])                             // correct
    }
  })
  it('"undo that / it / my last change": only the exact last change set (every chart of it, nothing else)', () => {
    for (const t of ['undo that', 'undo it', 'revert it', 'undo my last change', 'undo the last change']) {
      expect([t, lic(t, [A, B])]).toEqual([t, [A, B]])
      expect([t, lic(t, [A])]).toEqual([t, []])                              // part of the change set is not "that"
      expect([t, licensedReverts({ span: spanOf(t, ['META']), reverts: [A], items: [items[0]], host, getCapability: gc, getTargetKind: gk })]).toEqual([t, [A]])
    }
  })
})

// ── board drift: the print covers each carded op's OWN target state, per kind ───────────────────────────────────────────────────
describe('boardPrintOf: a change to the carded op\'s own target (any kind) changes the print', () => {
  const host = { charts: { list: () => [{ ref: 'c', symbol: 'SPY', label: 'Chart (SPY)', tf: 'D' }] } }
  for (const [name, target, a, b] of [
    ['widget option', 'board', { tbdOpen: true }, { tbdOpen: false }],
    ['drawing set', 'drawings:SPY', { ids: ['d1'] }, { ids: ['d1', 'd2'] }],
    ['replay', 'chart:c', { replay: '2026-10-15' }, { replay: null }],
    ['list columns', 'watchlist:w', { columns: ['rvol'] }, { columns: [] }],
  ]) {
    it(name, () => {
      let state = a
      const kind = { read: () => ({ ...state }), stateOf: (x) => x }
      const opts = { getCapability: () => ({ target: 'k' }), getTargetKind: () => kind }
      const ops = [{ action: 'x.y', target, args: {} }]
      const p0 = boardPrintOf(host, ops, opts)
      expect(boardPrintOf(host, ops, opts)).toBe(p0)
      state = b
      expect(boardPrintOf(host, ops, opts)).not.toBe(p0)
    })
  }
})

// ⭐ P0.2 correction design (owner + AUDIT, 11-24): the ONLY words that let a model plan undo the last change without the revert card
// are an EXPLICIT, imperative, un-negated revert of that change (deixis.explicitRevertRequested). Generated as a property:
//   every explicit revert form × every earlier-chart spelling × lead-ins / trailers → explicit;
//   the same forms negated ("don't", "do not", "never", "no need to", "without", "not", "rather than", "instead of", "if", "unless"…),
//   as questions ("should I…?", "can you…?", "…?") or hypothetical → NOT explicit (the card asks);
//   every non-revert message (corrections, additive, CAPS, D1–D4, keep / preserve) → NOT explicit (a revert in its plan is carded).
// Plus the revert detector itself: only an op that puts the earlier chart back exactly as it was is a revert.
import { describe, it, expect } from 'vitest'
import { explicitRevertRequested, revertsLastChange } from './deixis'

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
    patch: () => null,
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

// app/src/components/chart/engine/ast/pineH3TupleOpaque.test.js
//
// ⭐ H3 (2026-10-02) — `[a, b] = helper(...)` where this engine could not read the
// helper names the HELPER's wall, not a list of builtins.
//
// The member door used to say "this engine has no tuple form for
// `calculateRegression` — the ones it can take apart are `ta.bb`, `ta.dmi`,
// `ta.kc`, `ta.macd`" about the member's own function (linear-regression-channel-200),
// whose real wall — a `for` running total — was already recorded on its binding.
// The guard stays `pine:tuple` (the destructure is still what refuses); the
// sentence now carries the helper's own refusal.
import { describe, it, expect } from 'vitest'
import { translatePine } from './pine'

const V5 = '//@version=5\nindicator("h3")\n'
const msgOf = (src) => {
  const t = translatePine(src, { strict: true })
  return { t, r: t.refusal || {} }
}

describe('H3 — a destructure of a refused helper names the helper', () => {
  it('a helper with a `for` total: the sentence carries the helper\'s own wall', () => {
    const { t, r } = msgOf(V5 + 'f(len) =>\n    dev = 0.0\n    for x = 0 to len - 1\n        dev += close[x]\n    [dev, len]\n[a, b] = f(10)\nplot(a)\n')
    expect(t.ok).toBe(false)
    expect(r.guard).toBe('pine:tuple')
    expect(r.message).toMatch(/`f` is a function this script defines and this engine could not read/)
    expect(r.message).toMatch(/block spans several statements/)
    expect(r.message).not.toMatch(/the ones it can take apart are/)
  })

  it('⛔ control: an unknown builtin keeps the builtin list', () => {
    const { r } = msgOf(V5 + '[a, b] = ta.nosuch(close)\nplot(a)\n')
    expect(r.guard).toBe('pine:tuple')
    expect(r.message).toMatch(/the ones it can take apart are/)
  })

  it('⛔ control: a readable helper returning a tuple still translates', () => {
    const { t } = msgOf(V5 + 'f(x) =>\n    u = x + 1\n    [u, x - 1]\n[a, b] = f(close)\nplot(a)\n')
    expect(t.ok).toBe(true)
    expect(t.outputs[t.selected].formula).toBe('close + 1')
  })
})

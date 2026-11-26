// app/src/components/chart/engine/ast/refusalReplay.test.js
//
// ─── ⭐⭐ e99 U2 — A KEPT REFUSAL IS THROWN AGAIN, NEVER BUILT AGAIN, AND NEVER WHERE IT WOULD DIFFER ────────────────
//
// `Resolver.resolveProbed` keeps a probe's REFUSAL as well as its tree, and a comparison C24 gives no probe map gets a
// refusals-only one (`RefusalReplays`). A replay is a speed change only if it is exactly what the repeat would have
// done, so this file pins:
//   1. THE TRANSLATION IS THE SAME: on scripts whose comparisons read a refusing `var`, the result and the call's step
//      count are identical with refusals kept and with nothing kept (the translator before U2), replays really happen,
//      and the verify mode (resolve for real where a replay would happen, compare) finds no difference, including on a
//      refusal whose first resolution fills a memo a repeat finds full (`RESOLVE_MEMO_FILLS`);
//   2. NEVER ACROSS SCOPES: a refusal kept under one environment is not thrown under another, where the name resolves;
//   3. A FRESH REFUSAL EACH TIME, same guard, message and location: a catcher that marks one throw marks only that one;
//   4. CHARGED AS IF IT HAD RUN: a replay adds the steps the refusal took, and one whose steps would pass the
//      Resolver's cap resolves for real, so the cap's own refusal fires where it always did.
import { describe, it, expect, afterEach } from 'vitest'
import {
  translatePine, lastTranslateWindow, Resolver, PineRefusal, parseWholeExpression, lexPine,
  __refusalReplayForTests, __newRefusalReplaysForTests,
} from './pine'
import { TABLE } from './parse.js'

afterEach(() => { __refusalReplayForTests() })

// a `var` whose update reads itself inside a window call refuses (`pine:state`); every comparison reading it refuses
const SCRIPTS = {
  'two comparisons over a refusing var': [
    '//@version=5', 'indicator("u2a")',
    'var float lvl = close', 'lvl := ta.crossover(close, lvl) ? high : lvl',
    'var float lvl2 = close', 'lvl2 := close > lvl ? close : lvl2',
    'c = close > lvl2 and close > lvl', 'plot(c ? 1 : 0)',
  ].join('\n'),
  'a refusing var read through another var': [
    '//@version=5', 'indicator("u2b")',
    'var float top = na', 'top := ta.crossunder(close, top) ? low : high > top ? high : top',
    'var float bot = na', 'bot := close < top ? low : bot',
    'up = close > top', 'dn = close < bot', 'plot(up ? 1 : dn ? -1 : 0)',
  ].join('\n'),
  // ⚰️ the shape of corpus/committed `renko-candles-overlay`: the first `array.size(r)` settles the vector's size
  // (one step, `foldVectorSize`), a repeat does not, so a refusal kept from the first would over-charge a replay
  'a refusal whose first resolution settles a vector size': [
    '//@version=5', 'indicator("u2e", overlay=true)',
    'var r = array.new_float(1, close)', 'f(a) =>', '    array.unshift(a, close)', '    0',
    'if close > open', '    f(r)', 'while array.size(r) > 5', '    array.pop(r)',
    'if array.size(r) >= 2', '    label.new(bar_index, high, "x")', 'plot(close)',
  ].join('\n'),
}
// the scripts whose comparisons really replay (the third may keep nothing: what it pins is the verify mode)
const REPLAYS = new Set(['two comparisons over a refusing var', 'a refusing var read through another var'])
const HOST = { strict: true, paramManifest: true, enumInputs: true, declareInputs: 'all' }
const run = (src, opts) => {
  const t = translatePine(src, opts)
  return { json: JSON.stringify(t), steps: lastTranslateWindow().steps }
}
const expr = (text) => parseWholeExpression(lexPine(text).tokens)
const resolverOver = (env, opts = {}) => new Resolver(env, TABLE, new Map(), { pineVersion: 5, pineScript: true, ...opts })
const REFUSE = { kind: 'opaque', guard: 'pine:block', message: 'a block this engine could not fold', at: null }

describe('e99 U2: kept refusals', () => {
  for (const [name, src] of Object.entries(SCRIPTS)) {
    it(`1. the same translation and step count, kept or not: ${name}`, () => {
      for (const opts of [HOST, {}]) {
        __refusalReplayForTests({ off: true })
        const before = run(src, opts)
        const kept = __refusalReplayForTests()
        const after = run(src, opts)
        expect(after.json).toBe(before.json)
        expect(after.steps).toBe(before.steps)
        if (opts === HOST && REPLAYS.has(name)) expect(kept.replays).toBeGreaterThan(0)
        const verify = __refusalReplayForTests({ verify: true })
        const verified = run(src, opts)
        expect(verified.json).toBe(before.json)
        expect(verify.mismatches).toEqual([])
        expect(verify.mismatchCount).toBe(0)
        if (opts === HOST && REPLAYS.has(name)) expect(verify.verified).toBeGreaterThan(0)
      }
    })
  }

  it('2. never across scopes: kept under one env, not thrown under another', () => {
    __refusalReplayForTests()
    const node = { type: 'name', name: 'x', tok: null }
    const refusing = new Map([['x', REFUSE]])
    const answering = new Map([['x', { kind: 'expr', node: expr('5'), env: new Map() }]])
    const r = resolverOver(refusing)
    const memo = __newRefusalReplaysForTests()
    expect(() => r.resolveProbed(node, memo)).toThrow(PineRefusal)
    r.env = answering
    expect(r.resolveProbed(node, memo)).toEqual({ type: 'num', value: 5 })
  })

  it('3. a fresh refusal each time, with the same guard, message and location', () => {
    const stats = __refusalReplayForTests()
    const node = { type: 'name', name: 'x', tok: null }
    const r = resolverOver(new Map([['x', REFUSE]]))
    const memo = __newRefusalReplaysForTests()
    const caught = () => { try { r.resolveProbed(node, memo) } catch (e) { return e } return null }
    const first = caught()
    first.afterLoop = true // an outer catcher marks the throw it caught
    const second = caught()
    const third = caught()
    expect(stats.replays).toBe(2)
    for (const e of [second, third]) {
      expect(e).toBeInstanceOf(PineRefusal)
      expect(e).not.toBe(first)
      expect([e.guard, e.message, e.at]).toEqual([first.guard, first.message, first.at])
      expect(e.afterLoop).toBeUndefined()
      expect(typeof e.stack).toBe('string')
    }
    expect(second).not.toBe(third)
  })

  it('4. charged as if it had run; past the Resolver\'s cap it resolves for real', () => {
    __refusalReplayForTests()
    // `y` refuses only after resolving `a + a + a` (some steps), so a replay has steps to charge
    const env = new Map([
      ['a', { kind: 'expr', node: expr('1'), env: new Map() }],
      ['y', { kind: 'expr', node: expr('a + a + a + z'), env: null }],
      ['z', REFUSE],
    ])
    env.get('y').env = env
    const node = { type: 'name', name: 'y', tok: null }
    const r = resolverOver(env)
    const memo = __newRefusalReplaysForTests()
    expect(() => r.resolveProbed(node, memo)).toThrow(PineRefusal)
    const cost = r.budgetSteps
    expect(cost).toBeGreaterThan(2)
    expect(() => r.resolveProbed(node, memo)).toThrow(/block this engine could not fold/)
    expect(r.budgetSteps).toBe(2 * cost)
    // a fresh Resolver whose cap admits the first resolution but not a replay of it: the cap's refusal fires
    const capped = resolverOver(env, { maxSteps: cost + Math.floor(cost / 2) })
    const memo2 = __newRefusalReplaysForTests()
    expect(() => capped.resolveProbed(node, memo2)).toThrow(/block this engine could not fold/)
    let err = null
    try { capped.resolveProbed(node, memo2) } catch (e) { err = e }
    expect(err && err.guard).toBe('pine:timeout')
  })
})

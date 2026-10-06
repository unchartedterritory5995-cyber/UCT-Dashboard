// Owner decision A (2026-10-06) — the RESULT identity, browser lane.
// Twin of tests/test_semantics_consumers.py's fixture case; both read
// tests/fixtures/ast/semantics_result_identity.json (generated from the Python rule).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resultIdentity, semanticIdentity, SEMANTICS_IDENTITY_SUFFIX } from '../definitionSemantics'
import { astHash } from '../ast/parse'

// the repo idiom (barIndexShift.test.js): a path relative to app/, vitest's cwd
const FIXTURE = JSON.parse(readFileSync('../tests/fixtures/ast/semantics_result_identity.json', 'utf8'))

describe('result identity — maths + definition semantics (browser = server)', () => {
  it.each(FIXTURE.cases.map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(resultIdentity(c.definition)).toBe(c.expect)
  })

  it('semantics 1 is the bare tree hash (every existing key unchanged); 2 is suffixed', () => {
    const [legacy, two] = FIXTURE.cases
    const bare = astHash(legacy.definition.compute.ast)
    expect(resultIdentity(legacy.definition)).toBe(bare)
    expect(resultIdentity(two.definition)).toBe(bare + SEMANTICS_IDENTITY_SUFFIX)
    expect(semanticIdentity(bare, 1)).toBe(bare)
    expect(resultIdentity(two.definition)).not.toBe(resultIdentity(legacy.definition))
  })

  it('a forged stamp never reaches the semantics-2 key (Pine, "2", true, 3)', () => {
    const forged = FIXTURE.cases.filter((c) => c.name.startsWith('forged'))
    expect(forged.length).toBe(4)
    for (const c of forged) expect(resultIdentity(c.definition).endsWith(SEMANTICS_IDENTITY_SUFFIX)).toBe(false)
  })
})

// ─── #1 #2 #13 #15 — THE CHART LANE AGREES WITH THE CONSUMERS ────────────────
// The same data-made holes `tests/test_semantics_consumers.py` sweeps (a bar with
// volume 0 makes `close / (volume / volume)` unknown on exactly that bar), run
// through the CHART's own evaluator under `semanticsOptsFor(def)`. The outcomes
// equal the sweep's: UNKNOWN — hit under 1, not computable under 2; WILDER — no
// hit under 1 (RSI restarts), hit under 2 (RSI holds).
import { interpret } from '../ast/interpret'
import { semanticsOptsFor } from '../definitionSemantics'

const S = (n) => ({ type: 'series', name: n })
const N = (v) => ({ type: 'num', value: v })
const OP = (n, ...a) => ({ type: 'op', name: n, args: a })
const CALL = (n, ...a) => ({ type: 'call', name: n, args: a })
const HOLE = OP('/', S('close'), OP('/', S('volume'), S('volume')))
const UNK = OP('!', OP('>', S('close'), HOLE))
const WIL = OP('>', CALL('rsi', HOLE, N(14)), N(0))
const barsWithHoles = (holes, n = 60) => Array.from({ length: n }, (_, i) => {
  const c = 10 + i + (i % 3) * 0.5 - (i % 5) * 0.7
  return { t: 1700000000 + i * 86400, o: 10 + i, h: 11 + i, l: 9 + i, c, v: holes.includes(i) ? 0 : 1e6 }
})
const doc = (semantics) => ({ meta: semantics ? { semantics } : {} })
const last = (tree, bars, d) => {
  const v = interpret(tree, bars, {}, undefined, undefined, semanticsOptsFor(d)).at(-1)
  return v === null || v === undefined || Number.isNaN(v) ? 'nc' : (v ? 'hit' : 'no')
}

describe('chart lane = consumers, per definition semantics', () => {
  it('UNKNOWN: legacy keeps compare-vs-unknown = 0 (negated → hit); semantics 2 propagates', () => {
    const bars = barsWithHoles([59])
    expect(last(UNK, bars, doc(null))).toBe('hit')
    expect(last(UNK, bars, doc(2))).toBe('nc')
  })
  it('WILDER: legacy restarts RSI after the hole; semantics 2 holds it', () => {
    const bars = barsWithHoles([57])
    expect(last(WIL, bars, doc(null))).toBe('no')
    expect(last(WIL, bars, doc(2))).toBe('hit')
  })
  it('Pine carrying 2 stays Pine (legacy) in the chart lane too', () => {
    const pine = { meta: { semantics: 2, recurrenceOrigin: 'pine' } }
    expect(last(UNK, barsWithHoles([59]), pine)).toBe('hit')
  })
})

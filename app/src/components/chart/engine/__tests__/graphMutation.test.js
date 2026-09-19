// app/src/components/chart/engine/__tests__/graphMutation.test.js
//
// ─── C2C.17: THE ELEVEN WAYS TO BUILD THIS WRONG ────────────────────────────
//
// Every test below names the BAD IMPLEMENTATION it kills, so that a future
// reader can tell coverage from decoration. A shared representation fails
// silently in all eleven — the chart still draws, the save still succeeds, and
// the number is wrong — which is why they get their own file rather than being
// scattered through the happy-path suites.
//
// ⛔ THE ONES WITH A NAMED FIXTURE ARE THE ONES THAT MATTER. A test that only
// asserts "something threw" is green on a refusal that names the wrong cause;
// each of these asserts the specific outcome, and several carry a CONTROL that
// fails if the fixture stops being able to tell the two implementations apart.
import { describe, it, expect } from 'vitest'
import {
  buildGraph, expandGraph, assertGraph, graphTreesHash, GRAPH_VERSION,
} from '../ast/graph'
import { interpret } from '../ast/interpret'
import { DEFAULT_BUDGET } from '../ast/budget'
import { computeFor } from '../nativeRegistry'
import { parseFormula, astHash } from '../ast/parse'
import { treesHash } from '../ast/trees'
import { toGraphDocument, reduceIfOversized } from '../ast/graphDocument'

const parse = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`fixture does not parse: ${src}`)
  return r.ast
}
const tag = (n, id) => {
  Object.defineProperty(n, '__uctParamId', { value: id, enumerable: false, configurable: true })
  return n
}
const bars = (n, seed = 0) => Array.from({ length: n }, (_, i) => ({
  t: 1500000000 + i * 86400,
  o: 100 + seed + Math.sin(i / 11) * 8, h: 106 + seed + Math.sin(i / 11) * 8,
  l: 94 + seed + Math.sin(i / 11) * 8, c: 100 + seed + Math.sin(i / 7) * 9,
  v: 1_000_000 + (i % 53) * 5000,
}))

describe('C2C.17 — bad implementation 1: sharing keyed on structure alone', () => {
  it('two parameters with equal literals must not become one node', () => {
    const a = parse('sma(close, 14)')
    const b = parse('sma(close, 14)')
    tag(a.args[1], '__uct_param_1')
    tag(b.args[1], '__uct_param_2')
    const g = buildGraph({ value: a, out2: b })
    expect(g.outputRoots.value).not.toBe(g.outputRoots.out2)
  })

  it('CONTROL — with the tags gone the same fixture DOES collapse', () => {
    const g = buildGraph({ value: parse('sma(close, 14)'), out2: parse('sma(close, 14)') })
    expect(g.outputRoots.value).toBe(g.outputRoots.out2)
  })
})

describe('C2C.17 — bad implementation 2: a hash taken over the node table', () => {
  it('two legal spellings of one program hash the same', () => {
    const a = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'series', name: 'close' }, { type: 'num', value: 2 },
        { type: 'op', name: '*', args: [0, 1] }, { type: 'op', name: '+', args: [2, 0] }],
      outputRoots: { value: 3, up: 2 },
      parameters: {},
    }
    const b = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 2 }, { type: 'series', name: 'close' },
        { type: 'op', name: '*', args: [1, 0] }, { type: 'op', name: '+', args: [2, 1] }],
      outputRoots: { value: 3, up: 2 },
      parameters: {},
    }
    expect(JSON.stringify(a.nodes)).not.toBe(JSON.stringify(b.nodes))
    expect(graphTreesHash(a)).toBe(graphTreesHash(b))
  })

  it('CONTROL — a real change of maths still moves the hash', () => {
    const one = buildGraph({ value: parse('sma(close, 20)'), out2: parse('close') })
    const two = buildGraph({ value: parse('sma(close, 21)'), out2: parse('close') })
    expect(graphTreesHash(one)).not.toBe(graphTreesHash(two))
  })
})

describe('C2C.17 — bad implementation 3: expanding before bounding', () => {
  it('an exponential graph is refused from arithmetic, in milliseconds', () => {
    const nodes = [{ type: 'series', name: 'close' }]
    for (let i = 0; i < 45; i += 1) {
      nodes.push({ type: 'op', name: '+', args: [nodes.length - 1, nodes.length - 1] })
    }
    const g = { graphVersion: GRAPH_VERSION, nodes, outputRoots: { value: nodes.length - 1, up: 0 }, parameters: {} }
    const t0 = Date.now()
    expect(() => expandGraph(g)).toThrow(/expands to/)
    expect(Date.now() - t0).toBeLessThan(500)
  })
})

describe('C2C.17 — bad implementation 4: cycles merely detected, not excluded', () => {
  it('a forward edge is refused by field path', () => {
    expect(() => assertGraph({
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'op', name: '+', args: [1, 1] }, { type: 'num', value: 1 }],
      outputRoots: { value: 0, up: 1 },
      parameters: {},
    })).toThrow(/nodes\[0\]\.args\[0\]/)
  })
})

describe('C2C.17 — bad implementation 5: the tag leaking into the persisted form', () => {
  it('an expanded tree serialises and hashes exactly like a plain one', () => {
    const a = parse('sma(close, 14)')
    tag(a.args[1], '__uct_param_1')
    const g = buildGraph({ value: a, out2: parse('close') }, {
      params: [{ id: '__uct_param_1', sourceName: 'len', title: 'L', type: 'int', default: 14, min: 1, max: 99, step: 1, options: null }],
    })
    const back = expandGraph(g)
    // ⛔ IF THE TAG WERE ENUMERABLE it would widen the canonical grammar by one
    // key and `assertCanonical` would refuse the tree — silently breaking every
    // hash, every save and every alert for a parameterised document.
    expect(() => astHash(back.value)).not.toThrow()
    expect(JSON.parse(JSON.stringify(back.value))).toEqual(a)
    expect(back.value.args[1].__uctParamId).toBe('__uct_param_1')
  })
})

describe('C2C.17 — bad implementation 6: the cross-column memo outliving its pass', () => {
  const def = () => {
    const trees = { value: parse('sma(close, 5) + close'), out2: parse('sma(close, 5) - open') }
    const shared = expandGraph(buildGraph(trees))
    return {
      id: 'u_memo00000001',
      schemaVersion: 2,
      plots: [{ key: 'value', label: 'v', style: 'line' }, { key: 'out2', label: 'o', style: 'line' }],
      compute: { kind: 'ast', fn: 'sha256:memo', trees: shared, budget: DEFAULT_BUDGET },
    }
  }

  it('⛔⛔ a second call with DIFFERENT bars gets different numbers', () => {
    // The memo holds columns computed against one set of bars. If it were module
    // state, or keyed and cached, the second call would serve the first call's
    // numbers — a chart frozen at whatever it first drew, with nothing red.
    const d = def()
    const first = computeFor(d, bars(120, 0), {}, {})
    const second = computeFor(d, bars(120, 50), {}, {})
    expect(first.value[100]).not.toBe(second.value[100])
  })

  it('and the same bars twice give the same numbers', () => {
    const d = def()
    const a = computeFor(d, bars(120, 0), {}, {})
    const b = computeFor(d, bars(120, 0), {}, {})
    expect(Array.from(a.value)).toEqual(Array.from(b.value))
  })
})

describe('C2C.17 — bad implementation 7: memoising a recurrence', () => {
  it('a self-reading subtree shared by two plots is not frozen', () => {
    // ⚠️ THE UPDATE MUST BE CONDITIONAL. `accum(0, self + 1, 30)` re-runs its
    // thirty warm-up steps for EVERY bar, so it reads a flat 30 on every one —
    // a fixture that cannot distinguish a working recurrence from a frozen one.
    // Counting UP-BARS in the window varies, which is what makes the control
    // below able to fail.
    const accum = {
      type: 'call',
      name: 'accum',
      args: [
        { type: 'num', value: 0 },
        {
          type: 'op',
          name: '?:',
          args: [
            { type: 'op', name: '>', args: [{ type: 'series', name: 'close' }, { type: 'series', name: 'open' }] },
            { type: 'op', name: '+', args: [{ type: 'series', name: 'self' }, { type: 'num', value: 1 }] },
            { type: 'series', name: 'self' },
          ],
        },
        { type: 'num', value: 30 },
      ],
    }
    const memo = new Map()
    const a = interpret(accum, bars(200), {}, DEFAULT_BUDGET, undefined, { crossMemo: memo })
    const b = interpret(accum, bars(200), {}, DEFAULT_BUDGET, undefined, { crossMemo: memo })
    const plain = interpret(accum, bars(200), {}, DEFAULT_BUDGET)
    expect(Array.from(a)).toEqual(Array.from(plain))
    expect(Array.from(b)).toEqual(Array.from(plain))
    // CONTROL: the column really does MOVE, so a freeze would be visible.
    expect(new Set(Array.from(plain).filter(Number.isFinite)).size).toBeGreaterThan(2)
  })
})

describe('C2C.17 — bad implementations 8-11: the document lane', () => {
  const doc = (trees, manifest) => {
    const compute = {
      kind: 'ast',
      ast: trees.value,
      trees,
      scanPlot: 'value',
      treesHash: treesHash(trees),
      fn: astHash(trees.value),
      source: 'x',
      sources: Object.fromEntries(Object.keys(trees).map((k) => [k, 'x'])),
    }
    if (manifest) compute.paramManifest = manifest
    return { id: 'u_mut000000001', compute, plots: Object.keys(trees).map((k) => ({ key: k, style: 'line' })) }
  }

  it('8 — a parameter that cannot be placed is carried DISABLED, never dropped', () => {
    const d = doc({ value: parse('sma(close, 14)'), out2: parse('close') }, {
      __uct_param_1: {
        sourceName: 'len', title: 'L', type: 'int', default: 14, min: 1, max: 99, step: 1, options: null,
        locators: [{ treeIndex: 'ghost', astPath: ['args', 1] }],
      },
    })
    const attempt = toGraphDocument(d)
    expect(attempt.ok, attempt.reason).toBe(true)
    expect(attempt.definition.compute.graph.parameters.__uct_param_1.locators).toEqual([])
  })

  it('9 — the conversion never mutates the document it was handed', () => {
    const d = doc({ value: parse('sma(close, 14)'), out2: parse('sma(close, 14)') })
    const before = JSON.stringify(d)
    toGraphDocument(d)
    expect(JSON.stringify(d)).toBe(before)
  })

  it('10 — a document that fits is sent untouched', () => {
    const d = doc({ value: parse('sma(close, 14)'), out2: parse('close') })
    expect(reduceIfOversized(d)).toBe(d)
  })

  it('11 — the identity is carried, not recomputed under a new rule', () => {
    const trees = { value: parse('sma(close, 14) + ema(close, 14)'), out2: parse('sma(close, 14) - ema(close, 14)') }
    const d = doc(trees)
    const g = toGraphDocument(d).definition
    expect(g.compute.fn).toBe(astHash(trees.value))
    expect(g.compute.treesHash).toBe(treesHash(trees))
    expect(graphTreesHash(g.compute.graph)).toBe(d.compute.treesHash)
  })
})

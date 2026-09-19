// app/src/components/chart/engine/ast/__tests__/graph.test.js
//
// ─── C2C: THE SHARED GRAPH, AND THE FOUR WAYS IT COULD BE WRONG ─────────────
//
// A shared representation has exactly four interesting failure modes and every
// one of them is silent:
//
//   1. it does not round-trip — the expanded program is not the program;
//   2. it shares TOO MUCH — two distinct parameters collapse onto one node and
//      one member's slider moves someone else's plot (the owner's explicit
//      "DO NOT deduplicate parameterized computation merely because expanded
//      ASTs happen to contain equal literals");
//   3. its hash sees LAYOUT — two spellings of one program get different
//      identities, and every member's alerts migrate for a storage change;
//   4. it shares too much of the WRONG kind — an exponential expansion bomb.
//
// Each has a test below, and each of those has a control so it cannot pass for
// the wrong reason.
import { describe, it, expect } from 'vitest'
import {
  buildGraph, expandGraph, assertGraph, expandedSizes, graphTreesHash,
  GRAPH_VERSION, MAX_EXPANDED_NODES,
} from '../graph'
import { astHash } from '../parse'
import { treesHash } from '../trees'
import { parseFormula } from '../parse'

const parse = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`fixture does not parse: ${src} — ${r.error}`)
  return r.ast
}

/** The exact shape a member's multi-plot import produces: one expensive
 *  consensus expression, several views of it. */
const CONSENSUS = 'sma(close, 20) + ema(close, 20) + rsi(close, 14)'
const REPEATED = {
  value: parse(`${CONSENSUS} / 3`),
  out2: parse(`(${CONSENSUS} / 3) + atr(14)`),
  out3: parse(`(${CONSENSUS} / 3) - atr(14)`),
  out4: parse(`${CONSENSUS} / 3`),
}

const tag = (node, id) => {
  Object.defineProperty(node, '__uctParamId', { value: id, enumerable: false, configurable: true })
  return node
}

describe('C2C.2/.3 — the graph is the program, losslessly', () => {
  it('expandGraph(buildGraph(trees)) is byte-identical to trees', () => {
    const g = buildGraph(REPEATED)
    const back = expandGraph(g)
    expect(Object.keys(back).sort()).toEqual(Object.keys(REPEATED).sort())
    for (const k of Object.keys(REPEATED)) {
      expect(JSON.stringify(back[k])).toBe(JSON.stringify(REPEATED[k]))
      expect(astHash(back[k])).toBe(astHash(REPEATED[k]))
    }
  })

  it('⭐ and it actually SHARES — the point of the wave, measured', () => {
    const g = buildGraph(REPEATED)
    const inlineNodes = Object.values(REPEATED)
      .reduce((n, t) => n + expandedSizes(buildGraph({ one: t }))[buildGraph({ one: t }).outputRoots.one], 0)
    // ⛔ NON-VACUITY. A "graph" that shared nothing would round-trip perfectly
    // and pass every other test in this file. The saving is the feature.
    expect(g.nodes.length).toBeLessThan(inlineNodes / 2)
    const inlineBytes = JSON.stringify(REPEATED).length
    const graphBytes = JSON.stringify(g).length
    expect(graphBytes).toBeLessThan(inlineBytes)
  })

  it('two plots that compute the same thing land on ONE root', () => {
    const g = buildGraph(REPEATED)
    expect(g.outputRoots.value).toBe(g.outputRoots.out4)
  })

  it('the hash is the PROGRAM hash — unchanged from storing trees inline', () => {
    const g = buildGraph(REPEATED)
    expect(graphTreesHash(g)).toBe(treesHash(REPEATED))
  })
})

describe('C2C.3 — parameter identity is logical, and sharing must not launder it', () => {
  /** Two DIFFERENT Pine inputs that happen to default to the same number, each
   *  feeding a structurally identical expression. */
  const twoParams = () => {
    const a = parse('sma(close, 14)')
    const b = parse('sma(close, 14)')
    tag(a.args[1], '__uct_param_1')
    tag(b.args[1], '__uct_param_2')
    return { value: a, out2: b }
  }

  it('⛔⛔ they are NOT collapsed — one slider must never move the other plot', () => {
    const trees = twoParams()
    const g = buildGraph(trees, {
      params: [
        { id: '__uct_param_1', sourceName: 'fast', title: 'Fast', type: 'int', default: 14, min: 1, max: 200, step: 1, options: null },
        { id: '__uct_param_2', sourceName: 'slow', title: 'Slow', type: 'int', default: 14, min: 1, max: 200, step: 1, options: null },
      ],
    })
    expect(g.outputRoots.value).not.toBe(g.outputRoots.out2)
    expect(g.parameters.__uct_param_1.locators).toHaveLength(1)
    expect(g.parameters.__uct_param_2.locators).toHaveLength(1)
    expect(g.parameters.__uct_param_1.locators[0].node)
      .not.toBe(g.parameters.__uct_param_2.locators[0].node)
  })

  it('⭐ THE CONTROL: strip the tags and the SAME two trees DO collapse', () => {
    // Without provenance these are one expression, and sharing them is correct.
    // This is what proves the test above is measuring the tag and not something
    // incidental about the fixture.
    const g = buildGraph({ value: parse('sma(close, 14)'), out2: parse('sma(close, 14)') })
    expect(g.outputRoots.value).toBe(g.outputRoots.out2)
  })

  it('an untagged literal never shares a node with a tagged one', () => {
    const a = parse('sma(close, 14)')
    tag(a.args[1], '__uct_param_1')
    const g = buildGraph({ value: a, out2: parse('sma(close, 14)') })
    expect(g.outputRoots.value).not.toBe(g.outputRoots.out2)
  })

  it('⭐ ONE input used in many places is ONE parameter with ONE locator', () => {
    // The V1 shape gave this parameter one `astPath` locator per occurrence —
    // four here — every one of which the server walked and could find in
    // disagreement. Sharing makes `conflicted` structurally impossible.
    const shared = parse('sma(close, 14)')
    tag(shared.args[1], '__uct_param_1')
    const trees = {
      value: { type: 'op', name: '+', args: [shared, parse('close')] },
      out2: { type: 'op', name: '-', args: [shared, parse('open')] },
      out3: { type: 'op', name: '*', args: [shared, parse('high')] },
      out4: shared,
    }
    const g = buildGraph(trees, {
      params: [{ id: '__uct_param_1', sourceName: 'len', title: 'Length', type: 'int', default: 14, min: 1, max: 200, step: 1, options: null }],
    })
    expect(g.parameters.__uct_param_1.locators).toHaveLength(1)
    const loc = g.parameters.__uct_param_1.locators[0]
    expect(g.nodes[loc.node]).toEqual({ type: 'num', value: 14 })
  })

  it('a parameter with nowhere to point is never advertised', () => {
    const g = buildGraph({ value: parse('sma(close, 14)') }, {
      params: [{ id: '__uct_param_9', sourceName: 'gone', title: 'Gone', type: 'int', default: 3, min: 1, max: 9, step: 1, options: null }],
    })
    expect(g.parameters.__uct_param_9).toBeUndefined()
  })

  it('the tag survives expansion, so V1 locators stay derivable', () => {
    const a = parse('sma(close, 14)')
    tag(a.args[1], '__uct_param_1')
    const g = buildGraph({ value: a }, {
      params: [{ id: '__uct_param_1', sourceName: 'len', title: 'Length', type: 'int', default: 14, min: 1, max: 200, step: 1, options: null }],
    })
    const back = expandGraph(g)
    expect(back.value.args[1].__uctParamId).toBe('__uct_param_1')
    // and it stays INVISIBLE to hashing and serialization
    expect(JSON.stringify(back.value)).toBe(JSON.stringify(a))
    expect(Object.keys(back.value.args[1])).toEqual(['type', 'value'])
  })
})

describe('C2C.7 — the hash sees semantic content, never serialization layout', () => {
  it('a differently-numbered graph for the same program hashes the same', () => {
    // Both are legal graphs (references run strictly backwards) and both
    // expand to `1 + 2`; they differ only in table order.
    const a = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 1 }, { type: 'num', value: 2 },
        { type: 'op', name: '+', args: [0, 1] }],
      outputRoots: { value: 2 },
      parameters: {},
    }
    const b = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 2 }, { type: 'num', value: 1 },
        { type: 'op', name: '+', args: [1, 0] }],
      outputRoots: { value: 2 },
      parameters: {},
    }
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b))
    expect(graphTreesHash(a)).toBe(graphTreesHash(b))
  })

  it('⛔ THE CONTROL: a real semantic change DOES move the hash', () => {
    const a = buildGraph({ value: parse('sma(close, 20)') })
    const b = buildGraph({ value: parse('sma(close, 21)') })
    expect(graphTreesHash(a)).not.toBe(graphTreesHash(b))
  })

  it('the build itself is canonical — traversal order cannot move an id', () => {
    const keys = Object.keys(REPEATED)
    const shuffled = {}
    for (const k of [...keys].reverse()) shuffled[k] = REPEATED[k]
    expect(JSON.stringify(buildGraph(shuffled))).toBe(JSON.stringify(buildGraph(REPEATED)))
  })
})

describe('C2C — the expansion bomb, refused before it runs', () => {
  /** k doubling nodes: the classic DAG blow-up. */
  const bomb = (k) => {
    const nodes = [{ type: 'series', name: 'close' }]
    for (let i = 0; i < k; i += 1) {
      nodes.push({ type: 'op', name: '+', args: [nodes.length - 1, nodes.length - 1] })
    }
    return { graphVersion: GRAPH_VERSION, nodes, outputRoots: { value: nodes.length - 1 }, parameters: {} }
  }

  it('⛔⛔ 40 doubling nodes is refused, and the refusal is instant', () => {
    const g = bomb(40)
    expect(JSON.stringify(g).length).toBeLessThan(4096)
    const t0 = Date.now()
    expect(() => expandGraph(g)).toThrow(/expands to/)
    // The point of computing sizes in integers: nothing was ever built.
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('a graph just under the ceiling still expands', () => {
    const g = bomb(9) // 2^9 = 512 leaves, 1023 nodes
    expect(expandedSizes(g)[g.outputRoots.value]).toBeLessThan(MAX_EXPANDED_NODES)
    expect(expandGraph(g).value.type).toBe('op')
  })

  it('a forward reference is not a legal graph — a cycle is unrepresentable', () => {
    const g = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'op', name: '+', args: [1, 1] }, { type: 'num', value: 1 }],
      outputRoots: { value: 0 },
      parameters: {},
    }
    expect(() => assertGraph(g)).toThrow(/declared BEFORE it/)
  })

  it('a self reference is refused for the same reason', () => {
    const g = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 1 }, { type: 'op', name: '+', args: [0, 1] }],
      outputRoots: { value: 1 },
      parameters: {},
    }
    expect(() => assertGraph(g)).toThrow(/declared BEFORE it/)
  })

  it('a non-canonical node shape is refused with its own field path', () => {
    const g = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 1, extra: 2 }],
      outputRoots: { value: 0 },
      parameters: {},
    }
    expect(() => assertGraph(g)).toThrow(/compute\.graph\.nodes\[0\]/)
  })

  it('an output root pointing outside the table is refused', () => {
    const g = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 1 }],
      outputRoots: { value: 7 },
      parameters: {},
    }
    expect(() => assertGraph(g)).toThrow(/outputRoots\.value/)
  })

  it('a parameter locator pointing outside the table is refused', () => {
    const g = {
      graphVersion: GRAPH_VERSION,
      nodes: [{ type: 'num', value: 1 }],
      outputRoots: { value: 0 },
      parameters: { __uct_param_1: { locators: [{ node: 5, path: ['value'] }] } },
    }
    expect(() => assertGraph(g)).toThrow(/locators\[0\]\.node/)
  })
})

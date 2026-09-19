// app/src/components/chart/engine/ast/__tests__/graphDocument.test.js
//
// ─── C2C.15/.16: THE ROUND TRIP, AND WHAT MUST SURVIVE IT ───────────────────
//
// A definition that is stored as a graph and read back must be the SAME
// indicator: the same maths, the same identity, the same source text, the same
// adjustable controls, and the same presentation. Anything less is a smaller
// document, not a working one.
//
// ⛔ THE ROUND TRIP GOES THROUGH REAL JSON. `__uctParamId` is non-enumerable
// and would survive an in-process object hand-off while vanishing over a wire;
// a test that skipped `JSON.parse(JSON.stringify(...))` would prove the
// migration works everywhere except where it actually runs.
import { describe, it, expect } from 'vitest'
import {
  toGraphDocument, hydrateGraphDocument, reduceIfOversized, documentBytes,
  DOCUMENT_BYTE_BUDGET,
} from '../graphDocument'
import { parseFormula, astHash } from '../parse'
import { treesHash } from '../trees'

const parse = (src) => {
  const r = parseFormula(src)
  if (!r.ok) throw new Error(`fixture does not parse: ${src} — ${r.error}`)
  return r.ast
}

const CONSENSUS = 'sma(close, 20) + ema(close, 20) + rsi(close, 14)'

/** A multi-plot document of the shape a real Pine import produces. */
function doc({ manifest = null, plots = null, trees = null } = {}) {
  const t = trees || {
    value: parse(`${CONSENSUS} / 3`),
    out2: parse(`(${CONSENSUS} / 3) + atr(14)`),
    out3: parse(`(${CONSENSUS} / 3) - atr(14)`),
  }
  const sources = {}
  for (const k of Object.keys(t)) sources[k] = null
  const compute = {
    kind: 'ast',
    ast: t.value,
    trees: t,
    scanPlot: 'value',
    treesHash: treesHash(t),
    fn: astHash(t.value),
    source: 'placeholder',
    sources: Object.fromEntries(Object.keys(t).map((k) => [k, 'placeholder'])),
  }
  if (manifest) compute.paramManifest = manifest
  return {
    id: 'u_doc000000001',
    schemaVersion: 2,
    label: 'fixture',
    plots: plots || Object.keys(t).sort().map((k) => ({
      key: k, label: k, style: 'line', legend: { decimals: 2 },
    })),
    compute,
  }
}

/** Store and read: exactly what the wire and SQLite do to a document. */
const persist = (d) => JSON.parse(JSON.stringify(d))

describe('C2C.15 — a graph document is the same indicator after a round trip', () => {
  it('trees, identity and presentation all survive', () => {
    const original = doc()
    const attempt = toGraphDocument(original)
    expect(attempt.ok, attempt.reason).toBe(true)
    const graphDoc = attempt.definition
    expect(graphDoc.compute.trees).toBeUndefined()
    expect(graphDoc.compute.sources).toBeUndefined()

    const back = hydrateGraphDocument(persist(graphDoc))
    expect(back.compute.trees).toEqual(original.compute.trees)
    expect(back.compute.ast).toEqual(original.compute.ast)
    expect(back.compute.treesHash).toBe(original.compute.treesHash)
    expect(back.compute.fn).toBe(original.compute.fn)
    expect(back.plots).toEqual(original.plots)
  })

  it('⭐ the re-derived source text PARSES BACK to the tree that runs', () => {
    // Stronger than "the text came back": a graph document stores no source, so
    // the read-back is computed from the maths and cannot disagree with it —
    // which is more than the inlined form could promise, since nothing on the
    // server lane was ever able to hold `sources[k]` to `trees[k]`.
    const back = hydrateGraphDocument(persist(toGraphDocument(doc()).definition))
    for (const [k, text] of Object.entries(back.compute.sources)) {
      const r = parseFormula(text)
      expect(r.ok, `${k}: ${text}`).toBe(true)
      expect(astHash(r.ast)).toBe(astHash(back.compute.trees[k]))
    }
    expect(back.compute.source).toBe(back.compute.sources[back.compute.scanPlot])
  })

  it('a single-tree document is never converted', () => {
    const t = { value: parse('sma(close, 20)') }
    const d = doc({ trees: t })
    const attempt = toGraphDocument(d)
    expect(attempt.ok).toBe(false)
    expect(attempt.reason).toMatch(/multi-tree/)
  })

  it('an already-hydrated document passes through hydrate unchanged', () => {
    const d = doc()
    expect(hydrateGraphDocument(d)).toBe(d)
  })
})

describe('C2C.16 — parameters survive the migration, including the ones that must NOT merge', () => {
  const twoSameValued = () => {
    const t = {
      value: parse('sma(close, 14)'),
      out2: parse('sma(close, 14)'),
    }
    return doc({
      trees: t,
      manifest: {
        __uct_param_1: {
          sourceName: 'fast', title: 'Fast', type: 'int', default: 14,
          min: 1, max: 200, step: 1, options: null,
          locators: [{ treeIndex: null, astPath: ['args', 1] }],
        },
        __uct_param_2: {
          sourceName: 'slow', title: 'Slow', type: 'int', default: 14,
          min: 1, max: 200, step: 1, options: null,
          locators: [{ treeIndex: 'out2', astPath: ['args', 1] }],
        },
      },
    })
  }

  it('⛔⛔ two DIFFERENT inputs that both read 14 stay two nodes', () => {
    // The owner's named defect: "DO NOT deduplicate parameterized computation
    // merely because expanded ASTs happen to contain equal literals." The
    // provenance is non-enumerable and therefore ABSENT from a stored document,
    // so the migration has to put it back before it shares anything.
    const attempt = toGraphDocument(twoSameValued())
    expect(attempt.ok, attempt.reason).toBe(true)
    const g = attempt.definition
    const p = g.compute.graph.parameters
    expect(Object.keys(p).sort()).toEqual(['__uct_param_1', '__uct_param_2'])
    expect(p.__uct_param_1.locators[0].node).not.toBe(p.__uct_param_2.locators[0].node)
    expect(g.compute.graph.outputRoots.value).not.toBe(g.compute.graph.outputRoots.out2)
  })

  it('⭐ THE CONTROL: with no manifest the same two trees DO share', () => {
    const g = toGraphDocument(doc({
      trees: { value: parse('sma(close, 14)'), out2: parse('sma(close, 14)') },
    })).definition
    expect(g.compute.graph.outputRoots.value).toBe(g.compute.graph.outputRoots.out2)
  })

  it('the roster comes back at its V1 address, pointing at the right literals', () => {
    const back = hydrateGraphDocument(persist(toGraphDocument(twoSameValued()).definition))
    const m = back.compute.paramManifest
    expect(Object.keys(m).sort()).toEqual(['__uct_param_1', '__uct_param_2'])
    expect(m.__uct_param_1.title).toBe('Fast')
    for (const [pid, entry] of Object.entries(m)) {
      for (const loc of entry.locators) {
        const tree = loc.treeIndex === null
          ? back.compute.ast : back.compute.trees[loc.treeIndex]
        let node = tree
        for (const step of loc.astPath) node = node[step]
        expect(node, `${pid}`).toEqual({ type: 'num', value: 14 })
      }
    }
  })

  it('one input used by every plot collapses to ONE locator in the graph', () => {
    const shared = parse('sma(close, 14)')
    const t = {
      value: { type: 'op', name: '+', args: [shared, parse('close')] },
      out2: { type: 'op', name: '-', args: [JSON.parse(JSON.stringify(shared)), parse('open')] },
    }
    const g = toGraphDocument(doc({
      trees: t,
      manifest: {
        __uct_param_1: {
          sourceName: 'len', title: 'Length', type: 'int', default: 14,
          min: 1, max: 200, step: 1, options: null,
          locators: [
            { treeIndex: null, astPath: ['args', 0, 'args', 1] },
            { treeIndex: 'out2', astPath: ['args', 0, 'args', 1] },
          ],
        },
      },
    })).definition
    expect(g.compute.graph.parameters.__uct_param_1.locators).toHaveLength(1)
    // and it still comes back as BOTH occurrences for the V1 surfaces
    const back = hydrateGraphDocument(persist(g))
    expect(back.compute.paramManifest.__uct_param_1.locators).toHaveLength(2)
  })

  it('⛔⛔ a parameter that cannot be placed is CARRIED, disabled — never dropped', () => {
    // ⚰️ MEASURED ON THE LIVE CORPUS. `…03-supertrend`'s "Periods" parameter
    // carries an astPath that does not resolve against the tree the document
    // actually saves — a PRE-EXISTING Track F defect (the manifest is built from
    // a different translation than the one that is stored), which the V1 server
    // already reports as `partially_detached`. The first version of this
    // conversion REFUSED such a document outright, and the live journey then
    // showed the member the original "exceeds 65,536 bytes" refusal for a
    // document the fix had quietly declined to fix.
    //
    // The faithful answer is neither refusing nor dropping: keep the control,
    // with no locators, which both lanes' `reconcile` already answer as
    // `detached` with a reason — the same disabled-with-an-explanation state the
    // V1 document was in.
    const d = doc({
      manifest: {
        __uct_param_1: {
          sourceName: 'len', title: 'Length', type: 'int', default: 14,
          min: 1, max: 200, step: 1, options: null,
          locators: [{ treeIndex: 'nosuchtree', astPath: ['args', 1] }],
        },
      },
    })
    const attempt = toGraphDocument(d)
    expect(attempt.ok, attempt.reason).toBe(true)
    expect(attempt.definition.compute.graph.parameters.__uct_param_1).toEqual({
      sourceName: 'len', title: 'Length', type: 'int', default: 14,
      min: 1, max: 200, step: 1, options: null, locators: [],
    })
    // and it survives the round trip as a control the member can still SEE
    const back = hydrateGraphDocument(persist(attempt.definition))
    expect(back.compute.paramManifest.__uct_param_1.locators).toEqual([])
  })

  it('⛔ a HALF-placeable parameter is placed NOWHERE, not partially', () => {
    // V1 reports this as `partially_detached` and says why: "it has been
    // disabled rather than shown partially working". Tagging only the locator
    // that resolves would hand the member a slider that edits one of its two
    // occurrences — exactly the state that sentence refuses.
    const t = { value: parse('sma(close, 14)'), out2: parse('close') }
    const d = doc({
      trees: t,
      manifest: {
        __uct_param_1: {
          sourceName: 'len', title: 'Length', type: 'int', default: 14,
          min: 1, max: 200, step: 1, options: null,
          locators: [
            { treeIndex: null, astPath: ['args', 1] },
            { treeIndex: 'out2', astPath: ['args', 1] },
          ],
        },
      },
    })
    const attempt = toGraphDocument(d)
    expect(attempt.ok, attempt.reason).toBe(true)
    expect(attempt.definition.compute.graph.parameters.__uct_param_1.locators).toEqual([])
  })

  it('the caller\'s document is never mutated by a failed conversion', () => {
    const d = doc({
      manifest: {
        __uct_param_1: {
          sourceName: 'len', title: 'Length', type: 'int', default: 14,
          min: 1, max: 200, step: 1, options: null,
          locators: [{ treeIndex: 'nosuchtree', astPath: ['args', 1] }],
        },
      },
    })
    const before = JSON.stringify(d)
    toGraphDocument(d)
    expect(JSON.stringify(d)).toBe(before)
  })
})

describe('C2C — the save-door rule', () => {
  it('a document that fits is sent exactly as it is', () => {
    const d = doc()
    expect(documentBytes(d)).toBeLessThan(DOCUMENT_BYTE_BUDGET)
    expect(reduceIfOversized(d)).toBe(d)
  })

  it('a document that does not fit is sent as a graph, and then fits', () => {
    // Twelve plots of one heavy consensus expression: the corpus' own shape,
    // and deliberately sized past the cap so the branch under test is the one
    // a real oversized import takes rather than a forced threshold.
    const heavy = Array.from({ length: 9 }, (_, n) =>
      `sma(close, ${n + 5}) + ema(close, ${n + 5}) + rsi(close, ${n + 5}) + atr(${n + 5})`).join(' + ')
    const big = {}
    for (let i = 0; i < 12; i += 1) {
      big[i === 0 ? 'value' : `out${i + 1}`] = parse(
        `(${heavy}) * ${i + 1} + (${heavy}) / ${i + 2} - (${heavy})`)
    }
    const d = doc({ trees: big })
    expect(documentBytes(d)).toBeGreaterThan(DOCUMENT_BYTE_BUDGET)
    const sent = reduceIfOversized(d)
    expect(sent).not.toBe(d)
    expect(documentBytes(sent)).toBeLessThan(DOCUMENT_BYTE_BUDGET)
    // ⭐ AND THE IDENTITY DID NOT MOVE — the property that lets the threshold
    // be a threshold at all.
    expect(sent.compute.treesHash).toBe(d.compute.treesHash)
    expect(sent.compute.fn).toBe(d.compute.fn)
  })

  it('⛔⛔ a document sent INLINED never carries a leftover graph', () => {
    // Reachable by ordinary editing: read a stored graph document (hydrate adds
    // `trees` + `paramManifest` beside the `graph` it came with), delete plots
    // until it fits, save. Sending both would be refused by the server for
    // declaring its parameters twice — two rosters over one tree.
    const big = toGraphDocument(doc()).definition
    const hydrated = hydrateGraphDocument(persist(big))
    expect(hydrated.compute.graph, 'the graph rides along on a read').toBeTruthy()
    expect(hydrated.compute.trees).toBeTruthy()
    const sent = reduceIfOversized(hydrated)
    expect(sent.compute.graph).toBeUndefined()
    expect(sent.compute.trees).toBeTruthy()
  })

  it('a conversion that does not help is not used', () => {
    const d = doc()
    // Budget of 1 forces the attempt; the graph of a tiny document is not
    // smaller than the document, so the original is sent and the member sees
    // the refusal they would have seen before this wave existed.
    const sent = reduceIfOversized(d, 1)
    expect(sent === d || documentBytes(sent) < documentBytes(d)).toBe(true)
  })
})

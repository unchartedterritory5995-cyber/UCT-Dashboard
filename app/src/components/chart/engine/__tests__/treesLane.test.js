// app/src/components/chart/engine/__tests__/treesLane.test.js
//
// W1b.4 — THE REGISTRY AND BOTH LINTERS READ **ONE TREE PER PLOT**.
//
// `compute.trees` exists (W1b.2); this file is the lane that USES it. Three
// doors change and each is measured here from the outside:
//   HB-2 `astColumnsFor`   — one `interpret` per plot, keyed by the plot.
//   HB-2 `validateAstLane` — gates 2/3/6 run per tree; the badge compared is the
//                            WORST tree, and it is still refused in BOTH directions.
//   HB-3 `lintDefinition`  — a plot lints ITS tree, not the scan alias.
//
// ⛔ THE v1 TRAP IS PINNED IN `the SINGLE-TREE document` BELOW, AND IT IS THE
// REASON THIS FILE EXISTS AT ALL. `worstRepaint`/`stalestFreshness` fail CLOSED
// on an EMPTY list — deliberately, "no tree makes no promise" — so a lane that
// aggregated `Object.values(compute.trees || {})` would hand them `[]` for every
// document saved before today and brand it `repaints`/`unknown`. Every existing
// saved definition, worst badge, silently. The case below measures that the
// empty list really does aggregate to the worst AND that a v1 document keeps its
// own measurement, so the trap cannot be re-entered without a red test.
import { describe, it, expect, afterEach } from 'vitest'
import {
  validateUserDefinitions, installUserDefinitions, clearUserDefinitions, getDefinition, computeFor,
  validateAstLane,
} from '../nativeRegistry'
import { interpret } from '../ast/interpret'
import { parseFormula, astHash } from '../ast/parse'
import { lintDefinition, lintRepaint } from '../ast/lint'
import { freshnessFor } from '../ast/freshness'
import { worstRepaint, stalestFreshness, treesHash } from '../ast/trees'
import { makeBars } from './fakeChart'
import { macdV2Doc, MACD_SRC } from './macdV2'

const bars = makeBars(300)
afterEach(() => clearUserDefinitions())

// ─── a document whose trees DISAGREE, so "the worst" is a real choice ────────
// `flag` is the scan tree: pure price, so `non-repainting` + `live`.
// `lag` reads 26 bars AHEAD (`ichimokuChikou`'s declared `forward`) → preview-repaints.
// `cap` reads a nightly per-symbol scalar                          → as-of-snapshot.
// So the WORST repaint and the STALEST freshness each come from a tree that is
// NOT `compute.ast` — which is exactly what a lane reading only the scan alias
// gets wrong, in the direction that under-claims.
const MIXED_SRC = Object.freeze({
  flag: 'close > sma(close, 20)',
  lag: 'ichimokuChikou(high, low, close, 9, 26, 52)',
  cap: 'market_cap',
})

const MIXED_INPUTS = Object.freeze([
  { key: 'color', type: 'color', label: 'Color', default: '#c9a84c' },
  { key: 'lineWidth', type: 'int', label: 'Line width', default: 1, min: 1, max: 4, step: 1 },
])
const MIXED_SCOPE = { inputs: { color: true, lineWidth: true } }

function mixedDoc(over = {}) {
  const trees = Object.fromEntries(Object.entries(MIXED_SRC).map(([k, s]) => [k, parseFormula(s).ast]))
  const doc = {
    schemaVersion: 1,
    id: 'u_000000000mix',
    version: 1,
    compute: {
      kind: 'ast', fn: astHash(trees.flag), rev: 1, ast: trees.flag, source: MIXED_SRC.flag,
      trees, treesHash: treesHash(trees), scanPlot: 'flag', sources: { ...MIXED_SRC },
    },
    meta: {
      name: 'Mixed', shortName: 'Mixed', category: 'Custom', description: 'three trees that disagree',
      tags: ['custom'], tier: 'premium',
      repaint: worstRepaint(Object.values(trees).map((t) => lintRepaint(t, MIXED_SCOPE).mode)),
      freshness: stalestFreshness(Object.values(trees).map((t) => freshnessFor(t, MIXED_SCOPE).mode)),
    },
    placement: { target: 'pane', pane: { height: 0.17 } },
    inputs: MIXED_INPUTS.map((i) => ({ ...i })),
    plots: [
      { key: 'flag', label: 'Flag', style: 'line', color: '$color', width: '$lineWidth', role: 'signal', hidden: true, legend: { hide: true } },
      { key: 'lag', label: 'Lag', style: 'line', color: '$color', width: '$lineWidth', role: 'primary', legend: { decimals: 4 } },
      { key: 'cap', label: 'Cap', style: 'line', color: '$color', width: '$lineWidth', role: 'secondary', legend: { decimals: 0 } },
    ],
  }
  return { ...doc, ...over, meta: { ...doc.meta, ...(over.meta || {}) } }
}

/** The SAME document with ONE tree: the v2 keys dropped and one data plot kept.
 *  This is the shape every definition saved before today carries. */
function singleTreeDoc(over = {}) {
  const v2 = macdV2Doc()
  const { trees, treesHash: _treesHash, scanPlot, sources, ...single } = v2.compute
  const scope = { inputs: Object.fromEntries(v2.inputs.map((i) => [i.key, true])) }
  const doc = {
    ...v2,
    compute: single,
    meta: {
      ...v2.meta,
      repaint: lintRepaint(single.ast, scope).mode,
      freshness: freshnessFor(single.ast, scope).mode,
    },
    plots: [
      { key: 'hist_up', label: 'Signal up', style: 'line', color: '$hist_upColor', width: '$hist_upWidth', role: 'primary', legend: { hide: true } },
      v2.plots[4],
    ],
  }
  return { ...doc, ...over, meta: { ...doc.meta, ...(over.meta || {}) } }
}

describe('HB-2 — an `ast` definition with compute.trees is ONE column PER TREE', () => {
  it('🔴 a 4-tree MACD passes validateUserDefinitions', () => {
    const { defs, errors } = validateUserDefinitions([macdV2Doc()])
    expect(errors, JSON.stringify(errors, null, 1)).toEqual([])
    expect(defs).toHaveLength(1)
  })

  it('computeFor routes plot k to tree k — the routing oracle is the single-tree interpreter', () => {
    const doc = macdV2Doc()
    const { installed, errors } = installUserDefinitions([doc])
    expect(errors, JSON.stringify(errors, null, 1)).toEqual([])
    const cols = computeFor(getDefinition(installed[0].id), bars, {})
    expect(Object.keys(cols).sort()).toEqual(['hist', 'hist_up', 'macd', 'signal'])
    const inputs = Object.fromEntries(doc.inputs.map((i) => [i.key, i.default]))
    const own = (k) => [...interpret(doc.compute.trees[k], bars, inputs, undefined, undefined, { tf: undefined })]
    expect([...cols.signal]).toEqual(own('signal'))
    expect([...cols.signal], 'every plot got the SAME column').not.toEqual(own('macd'))
    expect([...cols.macd]).toEqual(own('macd'))
    // an arithmetic identity no seeding rule can fake:
    let finite = 0
    for (let i = 0; i < bars.length; i++) {
      if (!Number.isFinite(cols.hist[i])) continue
      finite += 1
      expect(Math.abs(cols.hist[i] - (cols.macd[i] - cols.signal[i]))).toBeLessThan(1e-9)
      expect([0, 1]).toContain(cols.hist_up[i])
    }
    expect(finite).toBeGreaterThan(200)
    // …and every SOURCE round-trips to the tree it is stored beside, which is what
    // makes a multi-plot document re-openable at all: `compute.source` is ONE
    // string — the scan tree's — and cannot answer for four plots.
    for (const [k, src] of Object.entries(MACD_SRC)) {
      expect(astHash(parseFormula(src).ast), k).toBe(astHash(doc.compute.trees[k]))
    }
  })

  it('without trees, two data plots are STILL refused with the one-data-bearing-plot sentence', () => {
    const doc = macdV2Doc()
    const { trees, treesHash: _treesHash, scanPlot, sources, ...single } = doc.compute
    const twoPlots = { ...doc, compute: single, plots: doc.plots.slice(0, 2) }
    expect(validateUserDefinitions([twoPlots]).errors.join('\n')).toMatch(/one data-bearing plot/i)
  })

  it('a plot with no tree is refused BY NAME — at defSchema, and again where the column would be filled', () => {
    const doc = macdV2Doc()
    delete doc.compute.trees.signal
    const errors = validateUserDefinitions([doc]).errors.join('\n')
    expect(errors).toMatch(/signal/)
    expect(validateUserDefinitions([doc]).defs).toEqual([])

    // ⭐ THE BACKSTOP IS MEASURED SEPARATELY BECAUSE THE DOOR ABOVE IS NOT THIS
    // DOOR. `defSchema.validateTreesAgainstPlots` refuses the key-set
    // disagreement, so nothing that walked through `validateUserDefinitions` can
    // reach `astColumnsFor` short a tree. `computeFor` takes a definition object
    // from anyone — the same reason its "computes ONE column" throw has always
    // existed — so the miss is refused there too, BY THE PLOT'S NAME rather than
    // as an undefined tree the interpreter would blame on the bars.
    expect(() => computeFor(doc, bars, {})).toThrow(/signal/)
    expect(() => computeFor(doc, bars, {})).toThrow(/compute\.trees/)
  })

  it('⭐ the badge compared is the WORST tree — and it is still refused in BOTH directions', () => {
    // The trees really do disagree — without this the case would pass vacuously.
    const modes = Object.entries(MIXED_SRC).map(([k, s]) => [k, lintRepaint(parseFormula(s).ast, MIXED_SCOPE).mode])
    const fresh = Object.entries(MIXED_SRC).map(([k, s]) => [k, freshnessFor(parseFormula(s).ast, MIXED_SCOPE).mode])
    expect(new Set(modes.map(([, m]) => m)).size, `every tree measured the same repaint mode: ${JSON.stringify(modes)}`)
      .toBeGreaterThan(1)
    expect(new Set(fresh.map(([, m]) => m)).size, `every tree measured the same freshness: ${JSON.stringify(fresh)}`)
      .toBeGreaterThan(1)

    // ⛔ THE SCAN TREE'S OWN BADGE IS THE UNDER-CLAIM THIS GATE EXISTS TO CATCH.
    // `compute.ast` is `flag`, which measures the CLEANEST of the three on both
    // fields; a lane reading only the alias would accept both of these.
    const aliasRepaint = lintRepaint(parseFormula(MIXED_SRC.flag).ast, MIXED_SCOPE).mode
    const aliasFresh = freshnessFor(parseFormula(MIXED_SRC.flag).ast, MIXED_SCOPE).mode

    const honest = mixedDoc()
    const ok = validateUserDefinitions([honest])
    expect(ok.errors, JSON.stringify(ok.errors, null, 1)).toEqual([])
    // Derived, never retyped — and the second line of each pair is what stops
    // the case measuring nothing if the closed table ever moves under it.
    expect(honest.meta.repaint).toBe(worstRepaint(modes.map(([, m]) => m)))
    expect(honest.meta.repaint, 'the WORST tree is the scan tree — nothing is being aggregated')
      .not.toBe(aliasRepaint)
    expect(honest.meta.freshness).toBe(stalestFreshness(fresh.map(([, m]) => m)))
    expect(honest.meta.freshness, 'the STALEST tree is the scan tree — nothing is being aggregated')
      .not.toBe(aliasFresh)

    // ⛔ THE NAME IS MATCHED WHOLE, WITH THE OTHER TWO EXCLUDED, AND THAT IS NOT
    // FUSSINESS. `/lag/` matched `compute.trees.flag` too — `'flag'` CONTAINS
    // `'lag'` — so a lane that named the FIRST tree instead of the worst one
    // passed this line while calling itself a test of which tree was named.
    // (Measured in review: `verdicts.find(…)` → `verdicts[0]` left this green and
    // only the freshness sibling went red.) It is the same defect as the `let`
    // offset pin two commits back: a comparison that cannot fail for its own
    // reason. The path prefix pins WHICH key, and the negative pins that no
    // other tree's name is what actually matched.
    const underRepaint = validateUserDefinitions([mixedDoc({ meta: { repaint: aliasRepaint } })])
    expect(underRepaint.defs).toEqual([])
    expect(underRepaint.errors.join('\n')).toMatch(
      new RegExp(`the linter MEASURES "${honest.meta.repaint}"`))
    expect(underRepaint.errors.join('\n'), 'the message never names the tree that measured it')
      .toMatch(/compute\.trees\.lag/)
    expect(underRepaint.errors.join('\n'), 'it named a tree that is NOT the worst one')
      .not.toMatch(/compute\.trees\.(flag|cap)/)

    const underFresh = validateUserDefinitions([mixedDoc({ meta: { freshness: aliasFresh } })])
    expect(underFresh.defs).toEqual([])
    expect(underFresh.errors.join('\n')).toMatch(/meta\.freshness/)
    expect(underFresh.errors.join('\n'), 'the message never names the tree that measured it')
      .toMatch(/compute\.trees\.cap/)
    expect(underFresh.errors.join('\n'), 'it named a tree that is NOT the stalest one')
      .not.toMatch(/compute\.trees\.(flag|lag)/)

    // …and over-claiming is refused with the same sentence, one field over.
    expect(validateUserDefinitions([mixedDoc({ meta: { repaint: 'repaints' } })]).defs).toEqual([])
    expect(validateUserDefinitions([mixedDoc({ meta: { freshness: 'unknown' } })]).defs).toEqual([])
  })

  it('⭐ GATE 5 shows a plot ITS OWN tree\'s window — not the worst tree\'s', () => {
    // `plots[].forward` is refused on this lane because the linter HAS the tree,
    // so the window is an answer rather than a claim. Which answer it prints is
    // the thing this pins: with three trees the document has three windows, and
    // showing the worst tree's number beside another plot's name would tell a
    // member their clean plot reads 26 bars ahead.
    const windowOf = (k) => lintRepaint(parseFormula(MIXED_SRC[k]).ast, MIXED_SCOPE).forward
    expect(windowOf('flag'), 'the two trees measure the SAME window — nothing is being distinguished')
      .not.toBe(windowOf('lag'))

    const doc = mixedDoc()
    doc.plots = doc.plots.map((p) => (p.key === 'flag' ? { ...p, forward: 3 } : p))
    const errors = validateUserDefinitions([doc]).errors.join('\n')
    expect(errors).toMatch(/plots\[\]\.forward — declared on "flag"/)
    expect(errors, 'the window shown is not the flag tree\'s own')
      .toMatch(new RegExp(`\\("${windowOf('flag')}" bars, measured\\)`))
    expect(errors, 'the WORST tree\'s window was printed beside another plot\'s name')
      .not.toMatch(new RegExp(`"${windowOf('lag')}" bars`))
  })

  it('⛔ the SINGLE-TREE document keeps its own badge — the empty-list trap, pinned', () => {
    // The failure this pins: `Object.values(compute.trees || {})` is `[]` for a
    // v1 document (one data plot, no trees), and the aggregators fail CLOSED.
    expect(worstRepaint([]), 'the empty list no longer aggregates to the worst — re-read this case')
      .toBe('repaints')
    expect(stalestFreshness([])).toBe('unknown')

    const v1 = singleTreeDoc()
    expect(v1.compute.trees, 'the v1 fixture carries trees — it is not v1').toBeUndefined()
    expect(v1.meta.repaint).toBe('non-repainting')
    expect(v1.meta.freshness).toBe('live')
    const res = validateUserDefinitions([v1])
    expect(res.errors, JSON.stringify(res.errors, null, 1)).toEqual([])
    expect(res.defs).toHaveLength(1)

    // …and the gate is not merely permissive: the worst badges are still refused
    // on the same document, so "it validated" is a measurement, not a shrug.
    expect(validateUserDefinitions([singleTreeDoc({ meta: { repaint: 'repaints' } })]).defs).toEqual([])
    expect(validateUserDefinitions([singleTreeDoc({ meta: { freshness: 'unknown' } })]).defs).toEqual([])
  })
})

describe('⛔ the registry\'s key-set BACKSTOP, watched firing — because nothing else can reach it', () => {
  // `validateAstLane` is exported for exactly this. Every other gate in it is
  // reachable through `validateUserDefinitions` and is tested there; the
  // `compute.trees` key-set check is NOT, because `defSchema` refuses the same
  // document first, with a better message. A guard nobody has watched fire is
  // not a guard — so it is called directly here, and the case beside it records
  // which door a member actually meets so the redundancy stays visible instead
  // of being a comment claiming the code is unreachable.
  const dropTree = (doc, key) => {
    const trees = { ...doc.compute.trees }
    delete trees[key]
    return { ...doc, compute: { ...doc.compute, trees } }
  }

  it('a MISSING tree, an EXTRA tree, and NO data plots each refuse by name', () => {
    const missing = validateAstLane(dropTree(mixedDoc(), 'cap')).join('\n')
    expect(missing).toMatch(/compute\.trees — the data-bearing plots and the trees must be ONE key set/)
    expect(missing).toMatch(/missing cap/)
    expect(missing).toMatch(/extra none/)

    const doc = mixedDoc()
    const extra = validateAstLane({
      ...doc,
      compute: { ...doc.compute, trees: { ...doc.compute.trees, ghost: doc.compute.trees.flag } },
    }).join('\n')
    expect(extra).toMatch(/missing none/)
    expect(extra).toMatch(/extra ghost/)

    // No data plot at all: `lanes` would be empty, and the aggregators fail
    // CLOSED on an empty list — so this is the same trap as the tree-less
    // document, arriving from the other side.
    const guidesOnly = validateAstLane({
      ...doc,
      plots: [{ key: 'zero', label: '0', style: 'hlines', levels: [0], color: '$color', width: 1, role: 'context' }],
    }).join('\n')
    expect(guidesOnly).toMatch(/ONE key set/)
    expect(guidesOnly).toMatch(/Plots \(none\)/)

    // …and the honest document produces nothing, which is what stops all of the
    // above being a gate that refuses everything.
    expect(validateAstLane(mixedDoc())).toEqual([])
  })

  it('…and through the PUBLIC door the member meets defSchema instead, never this sentence', () => {
    const errors = validateUserDefinitions([dropTree(mixedDoc(), 'cap')]).errors.join('\n')
    expect(errors, 'defSchema no longer refuses first — this backstop just became the door')
      .toMatch(/has no tree in compute\.trees/)
    expect(errors).not.toMatch(/must be ONE key set/)
  })
})

describe('HB-3 — lintDefinition rows are PER TREE', () => {
  it('the signal row lints the signal tree (a longer lookback than the macd tree), not the scan alias', () => {
    const rows = lintDefinition(macdV2Doc()).plots
    const back = (k) => rows.find((r) => r.plotKey === k).back
    expect(back('signal')).toBeGreaterThan(back('macd'))
    expect(back('hist_up')).toBe(back('hist'))
    expect(rows.map((r) => r.mode)).toEqual(['non-repainting', 'non-repainting', 'non-repainting', 'non-repainting', 'non-repainting'])
  })

  it('a plot with no tree of its own lints the SCAN alias — which is what a v1 document is', () => {
    // The `zero` guide owns no tree (it returns no column), so it lints
    // `compute.ast`. That fallback IS the v1 path: a document with no `trees`
    // lints one alias for every plot, exactly as it did yesterday.
    const v2 = lintDefinition(macdV2Doc()).plots
    const scanRow = v2.find((r) => r.plotKey === 'hist_up')
    const guideRow = v2.find((r) => r.plotKey === 'zero')
    expect(guideRow.back).toBe(scanRow.back)
    expect(guideRow.forward).toBe(scanRow.forward)

    const base = macdV2Doc()
    const v1 = lintDefinition({ ...base, compute: { ...base.compute, trees: undefined } }).plots
    expect(new Set(v1.map((r) => r.back)).size, 'a tree-less document linted more than one tree').toBe(1)
    expect(v1.every((r) => r.back === scanRow.back)).toBe(true)
  })

  it('⭐ the per-tree row is the MEASUREMENT of that tree — a mixed document proves the rows differ', () => {
    const rows = lintDefinition(mixedDoc()).plots
    const mode = (k) => rows.find((r) => r.plotKey === k).mode
    for (const [k, src] of Object.entries(MIXED_SRC)) {
      expect(mode(k), k).toBe(lintRepaint(parseFormula(src).ast, MIXED_SCOPE).mode)
    }
    // …and the rows are not all one answer, which is what a lane reading the
    // scan alias for every plot would produce.
    expect(mode('lag'), 'every row carried the scan tree\'s verdict').not.toBe(mode('flag'))
  })
})

// app/src/components/chart/builder/compatHarness.level4Fixture.test.js
//
// ─── COMPATIBILITY HARNESS — LANE 2, LEVEL 4 (bands, fills, multiple guides) ───
//
// Design doc Section 5, Level 4: "fills / bands, multiple guide lines,
// state-driven styling."
//
// ⭐ THE REAL QUESTION LEVEL 4 EXISTS TO ANSWER: bands are confirmed REAL and
// RENDERED for NATIVE indicators (BB, Donchian — `defSchema.js` comment,
// Layer B investigation), but `BuilderSheet.jsx`'s own authoring UI has no
// control for `style:'band'`/`edges` at all. Does the SCHEMA restrict bands to
// natives specifically, or is this purely a UI-authoring-surface gap that a
// hand-composed user AST document can walk straight past? Answered directly
// below, not assumed.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'
import { validateUserDefinitions } from '../engine/nativeRegistry.js'
import { treesHash } from '../engine/ast/trees.js'

const ROOT = path.resolve(process.cwd(), '..')
const rel = (p) => path.join(ROOT, p)
const RESULTS_DIR = 'tests/fixtures/compat_harness/results/visual_fixture'
const DEF_ID = 'u_1e402100c010'

function buildThreePlotDoc() {
  const evUpper = evaluateFormula('sma(close, 10)', BUILDER_INPUT_SCOPE)
  const evLower = evaluateFormula('sma(close, 30)', BUILDER_INPUT_SCOPE)
  expect(evUpper.ok && evLower.ok).toBe(true)
  const row = (key, ev, source) => ({
    key, label: '', source, ast: ev.ast, mode: ev.verdict.mode,
    readback: ev.readback, style: 'line',
    color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
  })
  return buildDefinition({
    defId: DEF_ID, name: 'Band probe', source: 'sma(close, 10)',
    ast: evUpper.ast, mode: evUpper.verdict.mode, readback: evUpper.readback,
    plots: [row('upper', evUpper, 'sma(close, 10)'), row('lower', evLower, 'sma(close, 30)')],
    levels: [80, 70, 30, 20],
    placement: { target: 'price' },
  })
}

describe('compat harness Lane 2, Level 4 — bands, fill, multiple guide levels', () => {
  it('DISCOVERY #1: a "band" plot is STILL data-bearing and is REFUSED with no tree of its own', () => {
    // ⛔ A REAL, undocumented-until-now constraint: `validateTreesAgainstPlots`
    // exempts ONLY `style === 'hlines'` plots from needing their own
    // `compute.trees` entry (defSchema.js:1732 — the filter is `p.style !==
    // 'hlines'`, nothing else). A `band` plot's visible pixels come entirely
    // from its two `edges`, yet the schema still demands its OWN computed
    // series — there is no way to declare "a pure band with no independent
    // value," only a band that happens to carry a (possibly redundant) one.
    const doc = buildThreePlotDoc()
    doc.plots.push({
      key: 'range', label: 'Range', style: 'band',
      edges: { upper: 'upper', lower: 'lower' },
      color: '#c9a84c',
    })
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors.some((e) => e.includes('range') && e.includes('has no tree'))).toBe(true)
    expect(defs).toHaveLength(0)
  })

  it('DISCOVERY #2: giving the band its OWN (redundant) tree makes it install cleanly, on a USER ast-kind document', () => {
    const doc = buildThreePlotDoc()
    doc.plots.push({
      key: 'range', label: 'Range', style: 'band',
      edges: { upper: 'upper', lower: 'lower' },
      color: '#c9a84c',
    })
    // The redundant tree/source: reuse 'upper's own AST verbatim. Nothing
    // about band rendering reads this value -- it exists only to satisfy the
    // plots<->trees key-set invariant.
    doc.compute.trees.range = doc.compute.trees.upper
    doc.compute.sources.range = doc.compute.sources.upper
    doc.compute.treesHash = treesHash(doc.compute.trees)
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(defs).toHaveLength(1)
    // ⛔ NON-VACUITY: bands are NOT restricted to native-only registration —
    // this document has compute.kind:'ast', not a native compute kind.
    expect(defs[0].compute.kind).toBe('ast')
  })

  it('⛔⛔ MUTATION: a band whose edges reference itself is REFUSED (isolated from the missing-tree case)', () => {
    const doc = buildThreePlotDoc()
    doc.plots.push({
      key: 'range', label: 'Range', style: 'band',
      edges: { upper: 'range', lower: 'lower' }, // self-reference — invalid
      color: '#c9a84c',
    })
    // Give it its own tree so this test isolates the EDGES defect specifically,
    // not the separately-proven missing-tree defect from DISCOVERY #1 above.
    doc.compute.trees.range = doc.compute.trees.upper
    doc.compute.sources.range = doc.compute.sources.upper
    doc.compute.treesHash = treesHash(doc.compute.trees)
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors.some((e) => e.includes('own key') || e.includes('bound itself')),
      JSON.stringify(errors)).toBe(true)
    expect(defs).toHaveLength(0)
  })

  it('⛔⛔ MUTATION: a band whose edges reference an hlines guide plot is REFUSED (isolated from the missing-tree case)', () => {
    const doc = buildThreePlotDoc() // already carries a 'levels' hlines guide plot
    const guideKey = doc.plots.find((p) => p.style === 'hlines').key
    doc.plots.push({
      key: 'range', label: 'Range', style: 'band',
      edges: { upper: guideKey, lower: 'lower' }, // guides are static, not bounds
      color: '#c9a84c',
    })
    doc.compute.trees.range = doc.compute.trees.upper
    doc.compute.sources.range = doc.compute.sources.upper
    doc.compute.treesHash = treesHash(doc.compute.trees)
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors.some((e) => e.includes(guideKey) && e.includes('hlines')),
      JSON.stringify(errors)).toBe(true)
    expect(defs).toHaveLength(0)
  })

  it('DISCOVERY: plots[].fill:{with} is schema-VALID on a user document (installs), matching the known VALIDATED-BUT-INERT finding', () => {
    const doc = buildThreePlotDoc()
    doc.plots[0] = { ...doc.plots[0], fill: { with: 'lower' } }
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(defs).toHaveLength(1)
  })

  it('carries FOUR guide levels (multiple guide lines), one trailing hlines plot', () => {
    const doc = buildThreePlotDoc()
    const guides = doc.plots.filter((p) => p.style === 'hlines')
    expect(guides).toHaveLength(1)
    expect(guides[0].levels).toEqual([80, 70, 30, 20])
  })

  it('writes the Section-3 compat_harness result for Level 4', () => {
    fs.mkdirSync(rel(RESULTS_DIR), { recursive: true })
    const result = {
      id: 'visual_fixture/level4_bands_fill_multi_guides',
      lane: 'visual_fixture',
      source: {
        dialect: 'uct_native_formula',
        provenance_ref: 'app/src/components/chart/builder/compatHarness.level4Fixture.test.js',
        capture_method: 'self_authored_fixture',
      },
      steps: {
        parse: { status: 'SUPPORTED', guard: null },
        dialect_detect: { status: 'SUPPORTED', detected: 'uct_native_formula' },
        translate: { status: 'SUPPORTED', guard: null },
        canonical_ast: { status: 'SUPPORTED', ast_ref: 'sma(close,10) / sma(close,30)' },
        execution_requirements: { status: 'SUPPORTED', lookback: 30 },
        visual_requirements: {
          status: 'PARTIAL',
          plot_count: 3,
          needs: ['band', 'fill', 'multi_guide'],
          discovery: [
            'a style:"band" plot is STILL data-bearing under validateTreesAgainstPlots '
              + '(only style==="hlines" is exempt) and is REFUSED with no tree of its '
              + 'own, even though its visible pixels come entirely from its two edges -- '
              + 'there is no way to declare a band with no independent computed value, '
              + 'only one that carries a (possibly redundant) one',
            'once given its own (redundant) tree, a band plot with edges referencing '
              + 'two USER ast-kind plots (not natives) installs cleanly through '
              + 'validateUserDefinitions -- bands are NOT restricted to native-only '
              + 'registration at the schema/validation layer, only unreachable through '
              + 'the current BuilderSheet UI form',
            'edges self-reference and edges-against-an-hlines-guide are both '
              + 'correctly REFUSED (proven by mutation, isolated from the missing-tree case)',
            'plots[].fill:{with} is schema-valid on a user document, consistent '
              + 'with the known VALIDATED-BUT-INERT finding (accepted, not '
              + 'drawn) -- whether it draws requires a live render, not '
              + 'answered here',
            'four hlines guide levels ([80,70,30,20]) collapse into ONE '
              + 'trailing guide plot, not four separate plots',
          ],
        },
        chart_render: { status: 'ENVIRONMENT_BLOCKED', reason: 'RISK-027 still blocks a live pixel re-run in this session' },
        persistence_save: { status: 'PARTIAL', note: 'not exercised live' },
        persistence_reload: { status: 'PARTIAL', note: 'not exercised live' },
        screener_eligibility: { status: 'PARTIAL', eligible: false, reason: 'scanPlot yields num' },
        refusal_behavior: { status: 'SUPPORTED', guard: null },
        vendor_comparison: { status: 'SKIPPED_NOT_APPROPRIATE', ref: null },
      },
      failure_taxonomy: ['guide_fill_color_style_mismatch'],
      final_classification: 'PARTIAL',
      evidence_artifact_paths: ['app/src/components/chart/engine/defSchema.js#validateBandEdges'],
      harness_version: 'compat-harness-v1',
    }
    fs.writeFileSync(
      path.join(rel(RESULTS_DIR), 'level4_bands_fill_multi_guides.json'),
      JSON.stringify(result, null, 2) + '\n', 'utf8',
    )
    expect(result.id).toBe('visual_fixture/level4_bands_fill_multi_guides')
  })
})

// app/src/components/chart/builder/compatHarness.level3Fixture.test.js
//
// ─── COMPATIBILITY HARNESS — LANE 2, LEVEL 3 (colorMode + placement boundary) ───
//
// Design doc Section 5, Level 3: "overlay + own-pane combinations where
// supported, dynamic colors, conditional visibility."
//
// ⭐ TWO REAL BOUNDARIES DISCOVERED HERE, NOT ASSUMED FROM THE DESIGN DOC:
//
// 1. PLACEMENT IS DOCUMENT-LEVEL, NOT PER-PLOT. `buildDefinition`'s own JSDoc
//    types `placement` as a single `{target:'price'}|{target:'pane',...}`, not
//    an array — confirmed directly below by building a 2-plot document and
//    checking there is exactly ONE `placement` field governing both rows. A
//    single user-authored document CANNOT mix overlay and own-pane across its
//    own plots. This is a real, previously-undocumented-in-this-program
//    finding, not a limitation this harness invented to test around.
//
// 2. `colorMode` IS A PLOT-LEVEL FIELD `defSchema.js` already validates
//    (`validateColorModes`), but `buildDefinition`'s row API (per its own
//    JSDoc: `{key, label, source, ast, mode, readback, style, color, width,
//    hidden}`) has NO WAY TO SET IT through the builder's own composition
//    function. To exercise `colorMode:'sign'` at all, this fixture PATCHES it
//    onto a real `buildDefinition()`-produced plot afterward — a legitimate
//    raw-document capability (the schema accepts it; only the current
//    BuilderSheet UI form has no control for it, the exact same shape as the
//    already-known band-authoring gap) rather than a fabricated shape.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'
import { validateUserDefinitions } from '../engine/nativeRegistry.js'

const ROOT = path.resolve(process.cwd(), '..')
const rel = (p) => path.join(ROOT, p)
const RESULTS_DIR = 'tests/fixtures/compat_harness/results/visual_fixture'

describe('compat harness Lane 2, Level 3 — placement boundary + colorMode', () => {
  it('DISCOVERY: one document, two plots, exactly ONE placement governs both', () => {
    const ev = evaluateFormula('sma(close, 10)', BUILDER_INPUT_SCOPE)
    const row = (key) => ({
      key, label: '', source: 'sma(close, 10)', ast: ev.ast, mode: ev.verdict.mode,
      readback: ev.readback, style: 'line',
      color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
    })
    const doc = buildDefinition({
      defId: 'u_1e402100c003', name: 'Two rows one placement', source: 'sma(close, 10)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
      plots: [row('a'), row('b')],
      placement: { target: 'price' },
    })
    // ⛔ NON-VACUITY: `placement` is a single object, not an array or a
    // per-plot map — proven by shape, not merely by not finding a counter-example.
    expect(Array.isArray(doc.placement)).toBe(false)
    expect(doc.placement).toEqual({ target: 'price' })
    expect(doc.plots.every((p) => p.placement === undefined)).toBe(true)
  })

  it('colorMode:"sign" installs cleanly once patched onto a real document, WITH its required colorUp/colorDown', () => {
    const ev = evaluateFormula('change(close)', BUILDER_INPUT_SCOPE)
    expect(ev.ok, 'change(close) must evaluate').toBe(true)
    const doc = buildDefinition({
      defId: 'u_1e402100c004', name: 'Signed change', source: 'change(close)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
      placement: { target: 'pane' },
    })
    doc.plots[0] = {
      ...doc.plots[0],
      style: 'histogram',
      colorMode: 'sign',
      colorUp: '#1ae51a',
      colorDown: '#c41f2d',
    }
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(defs).toHaveLength(1)
  })

  it('⛔⛔ MUTATION: colorMode:"sign" WITHOUT colorUp/colorDown is REFUSED', () => {
    const ev = evaluateFormula('change(close)', BUILDER_INPUT_SCOPE)
    const doc = buildDefinition({
      defId: 'u_1e402100c005', name: 'Signed change no colors', source: 'change(close)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
      placement: { target: 'pane' },
    })
    doc.plots[0] = { ...doc.plots[0], style: 'histogram', colorMode: 'sign' }
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors.length, 'a sign-mode plot with no colorUp/colorDown must be refused').toBeGreaterThan(0)
    expect(defs).toHaveLength(0)
  })

  // ⚰️ THIS PROBE USED TO ASSERT `colorMode:"column:<key>"` INSTALLS WITH NO
  // COLOURS, recording it as the "VALIDATED-BUT-INERT" boundary. That was the
  // truth while nothing drew the mode.
  // ⭐ C1-A GAVE IT A RENDERER (`pool.columnColorsForPlot` + `binder.toPoints`),
  // and a mode that DRAWS must declare the two colours it alternates between —
  // exactly as `sign` above already must, and for the same reason: without them
  // it registers happily and paints one flat colour. The discovery is preserved
  // (it is schema-legal and installs); it now installs under the full contract.
  it('DISCOVERY: colorMode:"column:<key>" installs — and, since C1-A, is DRAWN rather than inert', () => {
    const ev = evaluateFormula('change(close)', BUILDER_INPUT_SCOPE)
    const doc = buildDefinition({
      defId: 'u_1e402100c006', name: 'Column color probe', source: 'change(close)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
      placement: { target: 'pane' },
    })
    doc.plots[0] = {
      ...doc.plots[0],
      colorMode: `column:${doc.plots[0].key}`,
      colorUp: '#1ae51a',
      colorDown: '#c41f2d',
    }
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(defs).toHaveLength(1)
  })

  it('⛔⛔ MUTATION: colorMode:"column:<key>" WITHOUT colorUp/colorDown is REFUSED', () => {
    // The other half of the change above, stated as its own case so the new
    // requirement cannot be deleted without a red test.
    const ev = evaluateFormula('change(close)', BUILDER_INPUT_SCOPE)
    const doc = buildDefinition({
      defId: 'u_1e402100c007', name: 'Column color no colours', source: 'change(close)',
      ast: ev.ast, mode: ev.verdict.mode, readback: ev.readback,
      placement: { target: 'pane' },
    })
    doc.plots[0] = { ...doc.plots[0], colorMode: `column:${doc.plots[0].key}` }
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors.length, 'a column-mode plot with no colours must be refused').toBeGreaterThan(0)
    expect(defs).toHaveLength(0)
  })

  it('writes the Section-3 compat_harness result for Level 3', () => {
    fs.mkdirSync(rel(RESULTS_DIR), { recursive: true })
    const result = {
      id: 'visual_fixture/level3_colormode_placement_boundary',
      lane: 'visual_fixture',
      source: {
        dialect: 'uct_native_formula',
        provenance_ref: 'app/src/components/chart/builder/compatHarness.level3Fixture.test.js',
        capture_method: 'self_authored_fixture',
      },
      steps: {
        parse: { status: 'SUPPORTED', guard: null },
        dialect_detect: { status: 'SUPPORTED', detected: 'uct_native_formula' },
        translate: { status: 'SUPPORTED', guard: null },
        canonical_ast: { status: 'SUPPORTED', ast_ref: 'change(close)' },
        execution_requirements: { status: 'SUPPORTED', lookback: 1 },
        visual_requirements: {
          status: 'PARTIAL',
          plot_count: 1,
          needs: ['sign_color'],
          discovery: [
            'placement is DOCUMENT-level, not per-plot -- a single document '
              + 'cannot mix overlay and own-pane across its own plots',
            'colorMode is plot-level and schema-validated (validateColorModes) '
              + 'but buildDefinition()\'s own row API has no field for it -- only '
              + 'reachable by patching the document directly, not through the '
              + 'current BuilderSheet UI form',
            'colorMode:"column:<key>" is schema-VALID (installs cleanly) AND, '
              + 'since C1-A, is DRAWN: pool.columnColorsForPlot resolves it and '
              + 'binder.toPoints colours each point by whether the named column '
              + 'is non-zero. It now REQUIRES colorUp/colorDown, exactly as '
              + '"sign" does. The earlier VALIDATED-BUT-INERT finding is '
              + 'SUPERSEDED, not merely re-stated',
          ],
        },
        chart_render: { status: 'ENVIRONMENT_BLOCKED', reason: 'RISK-027 still blocks a live pixel re-run in this session' },
        persistence_save: { status: 'PARTIAL', note: 'not exercised live' },
        persistence_reload: { status: 'PARTIAL', note: 'not exercised live' },
        screener_eligibility: { status: 'PARTIAL', eligible: false, reason: 'change(close) yields num' },
        refusal_behavior: { status: 'SUPPORTED', guard: null },
        vendor_comparison: { status: 'SKIPPED_NOT_APPROPRIATE', ref: null },
      },
      failure_taxonomy: ['chart_placement_mismatch'],
      final_classification: 'PARTIAL',
      evidence_artifact_paths: ['app/src/components/chart/engine/defSchema.js#validateColorModes'],
      harness_version: 'compat-harness-v1',
    }
    fs.writeFileSync(
      path.join(rel(RESULTS_DIR), 'level3_colormode_placement_boundary.json'),
      JSON.stringify(result, null, 2) + '\n', 'utf8',
    )
    expect(result.id).toBe('visual_fixture/level3_colormode_placement_boundary')
  })
})

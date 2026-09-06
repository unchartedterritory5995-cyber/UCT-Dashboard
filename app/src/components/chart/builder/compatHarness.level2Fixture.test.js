// app/src/components/chart/builder/compatHarness.level2Fixture.test.js
//
// ─── COMPATIBILITY HARNESS — LANE 2, LEVEL 2 FIXTURE (multi-plot + guides) ───
//
// Design doc: `docs/superpowers/specs/universal-indicator-ecosystem/
// PUBLIC_SCRIPT_VISUAL_COMPATIBILITY_HARNESS_READINESS_REPORT.md`, Section 5,
// Level 2: "multiple plots, multiple inputs, guide levels."
//
// ⭐ BUILT THROUGH THE REAL PRODUCT DOOR, NOT HAND-TYPED JSON. `buildDefinition`
// is the exact function `BuilderSheet.jsx`'s own Save button calls — the same
// one `ast_user_formula_sma20` (Lane 2's Level 1 fixture) went through before
// being frozen into `chart_parity_cases.json`. Two real ASTs
// (`evaluateFormula('rsi(close, 14)', ...)` / `rsi(close, 28)`) become two
// data-bearing plot rows; `levels: [70, 30]` becomes the trailing `hlines`
// guide plot the same way an RSI import's overbought/oversold lines would.
// Nothing here is a shape invented for the harness -- it is the multi-plot
// document format `buildDefinition`'s own docstring declares
// (`compute.trees`/`treesHash`/`scanPlot`/`sources`), exercised for the first
// time by an automated fixture rather than only by interactive builder tests.
//
// ⛔ NO LIVE PIXEL VERIFICATION YET. RISK-027 (this session) found a
// reproducible, undiagnosed `FontNotSettledError` blocking a live
// `chart_parity.py` re-run in this environment. Rather than skip Level 2
// entirely or fabricate a pixel count, this file verifies the ONE thing that
// needs no browser at all: the document is well-formed and INSTALLS cleanly
// through `validateUserDefinitions` -- the exact gate `installUserDefinitions`
// (the render route's own install door, per the Layer B investigation) runs
// before anything is ever drawn. A live pixel-diff case is added to
// `chart_parity_cases.json` WITHOUT an `expect` value, explicitly marked
// pending, so a future session with the font issue resolved can measure it.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildDefinition } from './BuilderSheet.jsx'
import { evaluateFormula } from './FormulaField.jsx'
import { BUILDER_INPUT_SCOPE, BUILDER_INPUTS } from './builderInputs.js'
import { validateUserDefinitions } from '../engine/nativeRegistry.js'

const ROOT = path.resolve(process.cwd(), '..')
const rel = (p) => path.join(ROOT, p)
const CASES_PATH = 'tools/chart_parity_cases.json'
const RESULTS_DIR = 'tests/fixtures/compat_harness/results/visual_fixture'

const DEF_ID = 'u_1e4e120002ab'

function buildLevel2Document() {
  const evFast = evaluateFormula('rsi(close, 14)', BUILDER_INPUT_SCOPE)
  const evSlow = evaluateFormula('rsi(close, 28)', BUILDER_INPUT_SCOPE)
  expect(evFast.ok, 'rsi(close,14) must evaluate').toBe(true)
  expect(evSlow.ok, 'rsi(close,28) must evaluate').toBe(true)

  const row = (key, ev, source) => ({
    key, label: '', source, ast: ev.ast, mode: ev.verdict.mode,
    readback: ev.readback, style: 'line',
    color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
  })

  return buildDefinition({
    defId: DEF_ID,
    name: 'RSI 14 vs RSI 28',
    source: 'rsi(close, 14)',
    ast: evFast.ast,
    mode: evFast.verdict.mode,
    readback: evFast.readback,
    plots: [
      row('fast', evFast, 'rsi(close, 14)'),
      row('slow', evSlow, 'rsi(close, 28)'),
    ],
    levels: [70, 30],
  })
}

describe('compat harness Lane 2, Level 2 fixture — multi-plot + guide levels', () => {
  const doc = buildLevel2Document()

  it('is a genuine schema-v2 multi-plot document (trees, not a single ast)', () => {
    expect(doc.compute.kind).toBe('ast')
    expect(Object.keys(doc.compute.trees).sort()).toEqual(['fast', 'slow'])
    expect(doc.compute.scanPlot).toBe('fast')
    expect(doc.compute.sources).toEqual({ fast: 'rsi(close, 14)', slow: 'rsi(close, 28)' })
  })

  it('carries two data-bearing plots plus one trailing hlines guide plot at [70, 30]', () => {
    const dataPlots = doc.plots.filter((p) => p.style !== 'hlines')
    const guidePlots = doc.plots.filter((p) => p.style === 'hlines')
    expect(dataPlots.map((p) => p.key)).toEqual(['fast', 'slow'])
    expect(guidePlots).toHaveLength(1)
    expect(guidePlots[0].levels).toEqual([70, 30])
  })

  it('carries multiple member-visible inputs (chrome per row: color/width x2)', () => {
    // ⛔ NON-VACUITY: "multiple inputs" is a real, member-editable count on the
    // saved document, not a description of the AST's own arguments (which are
    // literal `14`/`28`, not exposed as adjustable params in this fixture --
    // Track F parameter fidelity is a later level's concern, not this one's).
    expect(doc.inputs.length).toBeGreaterThanOrEqual(4)
    const keys = doc.inputs.map((i) => i.key)
    expect(new Set(keys).size).toBe(keys.length) // no duplicate input keys
  })

  it('⭐ installs cleanly through the REAL product validation door (no browser needed)', () => {
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors, `validation errors: ${JSON.stringify(errors)}`).toEqual([])
    expect(defs).toHaveLength(1)
    expect(defs[0].id).toBe(DEF_ID)
  })

  it('⛔⛔ MUTATION: a malformed document (duplicate plot key) is REFUSED, not silently accepted', () => {
    // Non-vacuity for the validation-door check itself: prove it can fail.
    const broken = JSON.parse(JSON.stringify(doc))
    broken.plots[1].key = broken.plots[0].key // duplicate a data-plot key
    broken.compute.trees[broken.plots[0].key] = broken.compute.trees.slow // keep trees consistent-ish
    const { defs, errors } = validateUserDefinitions([broken])
    expect(errors.length, 'a document with a duplicate plot key must be refused').toBeGreaterThan(0)
    expect(defs).toHaveLength(0)
  })

  it('writes the Section-3 compat_harness result AND registers a pending live-pixel case', () => {
    fs.mkdirSync(rel(RESULTS_DIR), { recursive: true })

    const validation = validateUserDefinitions([doc])
    const installsCleanly = validation.errors.length === 0

    const result = {
      id: 'visual_fixture/level2_multi_plot_guides',
      lane: 'visual_fixture',
      source: {
        dialect: 'uct_native_formula',
        provenance_ref: 'app/src/components/chart/builder/compatHarness.level2Fixture.test.js',
        capture_method: 'self_authored_fixture',
      },
      steps: {
        parse: { status: 'SUPPORTED', guard: null },
        dialect_detect: { status: 'SUPPORTED', detected: 'uct_native_formula' },
        translate: { status: 'SUPPORTED', guard: null },
        canonical_ast: { status: 'SUPPORTED', ast_ref: 'compute.trees.{fast,slow}' },
        execution_requirements: { status: 'SUPPORTED', lookback: null },
        visual_requirements: { status: 'SUPPORTED', plot_count: 2, needs: ['guide_levels'] },
        chart_render: {
          status: installsCleanly ? 'PARTIAL' : 'VISUAL_BLOCKED',
          note: installsCleanly
            ? 'document validates and installs cleanly through validateUserDefinitions '
              + '(no browser); a live pixel-diff case is registered in '
              + 'tools/chart_parity_cases.json as `ast_user_formula_multiplot_rsi` '
              + 'with NO expect value yet -- pending RISK-027 (FontNotSettledError, '
              + 'undiagnosed) being resolved in a future session. This is NOT the '
              + 'same claim as SUPPORTED: install-clean is verified, pixel-correct is not.'
            : 'document failed validateUserDefinitions -- see validation.errors',
          validation_errors: validation.errors,
        },
        persistence_save: { status: 'PARTIAL', note: 'not exercised live; document shape is the same the real save door produces' },
        persistence_reload: { status: 'PARTIAL', note: 'not exercised live; deferred to a save/reopen fixture at a later level' },
        screener_eligibility: { status: 'PARTIAL', eligible: false, reason: 'rsi yields num; scanPlot is "fast", not itself boolean' },
        refusal_behavior: { status: 'SUPPORTED', guard: null },
        vendor_comparison: { status: 'SKIPPED_NOT_APPROPRIATE', ref: null },
      },
      failure_taxonomy: installsCleanly ? [] : ['harness_defect'],
      final_classification: installsCleanly ? 'PARTIAL' : 'VISUAL_BLOCKED',
      evidence_artifact_paths: ['tools/chart_parity_cases.json#ast_user_formula_multiplot_rsi'],
      harness_version: 'compat-harness-v1',
    }
    fs.writeFileSync(
      path.join(rel(RESULTS_DIR), 'level2_multi_plot_guides.json'),
      JSON.stringify(result, null, 2) + '\n', 'utf8',
    )

    // Register (or refresh) the chart_parity.py case for a FUTURE live run --
    // deliberately WITHOUT `expect`/`regions`, since no live measurement has
    // succeeded in this session (RISK-027). `chart_parity.py` treats a case
    // with no `expect` as unmeasured rather than as a false pass/fail.
    const casesDoc = JSON.parse(fs.readFileSync(rel(CASES_PATH), 'utf8'))
    const cases = Array.isArray(casesDoc) ? casesDoc : casesDoc.cases
    const CASE_NAME = 'ast_user_formula_multiplot_rsi'
    const newCase = {
      name: CASE_NAME,
      // ⛔ `status: "placeholder"` IS LOAD-BEARING, NOT DECORATIVE.
      // `test_EVERY_live_case_declares_an_exact_expect_after_Flip_C`
      // (tests/test_chart_parity_harness.py) asserts every case WITHOUT this
      // flag carries an exact `expect` and a priced `expect` on every region.
      // This case deliberately has neither (no live pixel measurement has
      // succeeded this session -- RISK-027), so it MUST carry the flag or it
      // fails that rail outright. `load_cases` (chart_parity.py) skips a
      // placeholder unless `--include-placeholders` is passed, exactly the
      // existing convention `volume_profile_only`/`vwap_only` already use.
      status: 'placeholder',
      why: 'Compatibility Harness Lane 2, Level 2 fixture -- a genuine two-row '
        + 'AST multi-plot document (rsi(close,14) + rsi(close,28)) with a [70,30] '
        + 'hlines guide plot, built through the real buildDefinition() door (same '
        + 'function BuilderSheet.jsx Save calls) and confirmed to install cleanly '
        + 'through validateUserDefinitions with NO browser (see '
        + 'compatHarness.level2Fixture.test.js). PENDING LIVE PIXEL MEASUREMENT: '
        + 'RISK-027 (this session) found a reproducible FontNotSettledError '
        + 'blocking chart_parity.py --same-build against a local dev server, '
        + 'root cause undiagnosed. Deliberately carries no `expect`/`regions` so '
        + 'a future run does not silently compare against a guessed number -- '
        + 'run `chart_parity.py --base-a <url> --same-build --cases '
        + CASE_NAME + '` once the font issue is resolved or shown unrelated, '
        + 'then record the measured `expect`/`regions` here the same way '
        + 'ast_user_formula_sma20 recorded its own.',
      settings: {},
      instancesB: [{
        instanceId: `inst:${DEF_ID}:0`,
        defId: DEF_ID,
        defVersion: 1,
        inputs: {},
        placement: { target: 'pane' },
        hidden: false,
      }],
      userDefs: [doc],
      priceLine: false,
    }
    const idx = cases.findIndex((c) => c.name === CASE_NAME)
    if (idx >= 0) cases[idx] = newCase
    else cases.push(newCase)
    fs.writeFileSync(rel(CASES_PATH), JSON.stringify(casesDoc, null, 2) + '\n', 'utf8')

    expect(result.id).toBe('visual_fixture/level2_multi_plot_guides')
  })
})

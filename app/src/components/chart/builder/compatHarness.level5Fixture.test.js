// app/src/components/chart/builder/compatHarness.level5Fixture.test.js
//
// ─── COMPATIBILITY HARNESS — LANE 2, LEVEL 5 (nested calcs, mixed outputs) ───
//
// Design doc Section 5, Level 5: "nested calculations, multiple lookbacks,
// several interacting series, boolean + numeric outputs."
//
// ⭐ THE REAL QUESTION THIS LEVEL EXISTS TO ANSWER: can one function's output
// feed ANOTHER function's series-typed argument (`sma(rsi(close,14), 3)` --
// a smoothed RSI), or is `series` restricted to bare named series like
// `close`/`high`/`low`? This is not assumed from a table read -- it is
// answered by actually calling `evaluateFormula` on the nested text and
// reading whether it evaluates or refuses, and if it refuses, WITH WHICH
// GUARD (a real taxonomy label, not "nesting doesn't work").

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

let nestedOk = null
let nestedEv = null
let siblingRefGuard = null

describe('compat harness Lane 2, Level 5 — nested calculations + mixed outputs', () => {
  it('DISCOVERY: does one function\'s output feed into another\'s series argument?', () => {
    nestedEv = evaluateFormula('sma(rsi(close, 14), 3)', BUILDER_INPUT_SCOPE)
    nestedOk = !!nestedEv.ok
    // Whatever the answer is, RECORD it -- this test cannot fail either way,
    // because the point of Level 5 is to discover the boundary, not assert a
    // predetermined one. A later test in this file uses `nestedOk` to decide
    // which further probes make sense.
    expect(typeof nestedOk).toBe('boolean')
  })

  it('DISCOVERY: several plots referencing EACH OTHER is at minimum refused cleanly if unsupported', () => {
    // A second, distinct "interacting series" question: can plot B's formula
    // reference plot A's OWN series by key (e.g. "the SMA of the RSI plot"),
    // as opposed to nesting inside ONE formula string? BuilderSheet's row
    // model gives each plot an independent `source`/`ast` compiled the same
    // way `evaluateFormula` compiles any standalone formula -- there is no
    // documented cross-plot reference syntax (no `plots.fast` name in the
    // grammar), so the real prediction is REFUSAL, not a silent wrong answer
    // (the exact guard is read off the result below and recorded, not
    // asserted in advance).
    const ev = evaluateFormula('sma(fast, 5)', BUILDER_INPUT_SCOPE)
    expect(ev.ok, JSON.stringify(ev)).toBe(false)
    siblingRefGuard = (ev.refusal || {}).guard || null
  })

  it('installs a document mixing a NUMERIC plot and a BOOLEAN plot together', () => {
    const evNum = evaluateFormula('rsi(close, 14)', BUILDER_INPUT_SCOPE)
    const evBool = evaluateFormula('crossOver(close, sma(close, 20))', BUILDER_INPUT_SCOPE)
    expect(evNum.ok, 'rsi(close,14) must evaluate').toBe(true)
    expect(evBool.ok, 'crossOver(close, sma(close,20)) must evaluate').toBe(true)

    const row = (key, ev, source) => ({
      key, label: '', source, ast: ev.ast, mode: ev.verdict.mode,
      readback: ev.readback, style: 'line',
      color: BUILDER_INPUTS[0].default, width: BUILDER_INPUTS[1].default, hidden: false,
    })
    const doc = buildDefinition({
      defId: 'u_1e402100c020', name: 'Mixed num+bool', source: 'rsi(close, 14)',
      ast: evNum.ast, mode: evNum.verdict.mode, readback: evNum.readback,
      plots: [
        row('level', evNum, 'rsi(close, 14)'),
        row('signal', evBool, 'crossOver(close, sma(close, 20))'),
      ],
      scanPlot: 'signal', // the boolean row is the one the screener would read
    })
    const { defs, errors } = validateUserDefinitions([doc])
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(defs).toHaveLength(1)
    expect(doc.compute.scanPlot).toBe('signal')
  })

  it('writes the Section-3 compat_harness result for Level 5', () => {
    fs.mkdirSync(rel(RESULTS_DIR), { recursive: true })
    const discovery = [
      nestedOk
        ? 'sma(rsi(close,14), 3) EVALUATES -- one function\'s output can feed '
          + 'another\'s series-typed argument; "series" is NOT restricted to '
          + 'bare named series like close/high/low'
        : `sma(rsi(close,14), 3) is REFUSED (guard: ${JSON.stringify((nestedEv.refusal || {}).guard)}) `
          + '-- nested function composition is not supported through this path; '
          + 'a real, disclosed gap rather than a silent wrong answer',
      `a formula cannot reference a SIBLING plot's series by key `
        + `(sma(fast, 5) is refused, guard: ${JSON.stringify(siblingRefGuard)}) -- `
        + '"several interacting series" in one document means several '
        + 'INDEPENDENT computations, not cross-plot data flow',
      'a document mixing a NUMERIC plot and a BOOLEAN plot in the same '
        + 'multi-plot document installs cleanly, with scanPlot correctly '
        + 'naming the boolean row as the screener-relevant one',
    ]
    const result = {
      id: 'visual_fixture/level5_nested_calcs_mixed_outputs',
      lane: 'visual_fixture',
      source: {
        dialect: 'uct_native_formula',
        provenance_ref: 'app/src/components/chart/builder/compatHarness.level5Fixture.test.js',
        capture_method: 'self_authored_fixture',
      },
      steps: {
        parse: { status: 'SUPPORTED', guard: null },
        dialect_detect: { status: 'SUPPORTED', detected: 'uct_native_formula' },
        translate: { status: nestedOk ? 'SUPPORTED' : 'PARTIAL', guard: nestedOk ? null : (nestedEv.refusal || {}).guard },
        canonical_ast: { status: 'SUPPORTED', ast_ref: 'rsi(close,14) / crossOver(close, sma(close,20))' },
        execution_requirements: { status: 'SUPPORTED', lookback: 20 },
        visual_requirements: { status: 'SUPPORTED', plot_count: 2, needs: ['mixed_num_bool'], discovery },
        chart_render: { status: 'ENVIRONMENT_BLOCKED', reason: 'RISK-027 still blocks a live pixel re-run in this session' },
        persistence_save: { status: 'PARTIAL', note: 'not exercised live' },
        persistence_reload: { status: 'PARTIAL', note: 'not exercised live' },
        screener_eligibility: { status: 'SUPPORTED', eligible: true, reason: 'scanPlot "signal" yields bool directly' },
        refusal_behavior: { status: 'SUPPORTED', guard: siblingRefGuard },
        vendor_comparison: { status: 'SKIPPED_NOT_APPROPRIATE', ref: null },
      },
      failure_taxonomy: nestedOk ? [] : ['translator_semantic_gap'],
      final_classification: nestedOk ? 'SUPPORTED' : 'PARTIAL',
      evidence_artifact_paths: ['app/src/components/chart/engine/ast/interpret.js'],
      harness_version: 'compat-harness-v1',
    }
    fs.writeFileSync(
      path.join(rel(RESULTS_DIR), 'level5_nested_calcs_mixed_outputs.json'),
      JSON.stringify(result, null, 2) + '\n', 'utf8',
    )
    expect(result.id).toBe('visual_fixture/level5_nested_calcs_mixed_outputs')
  })
})

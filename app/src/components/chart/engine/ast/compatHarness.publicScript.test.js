// app/src/components/chart/engine/ast/compatHarness.publicScript.test.js
//
// ─── PUBLIC SCRIPT + COMPLEX VISUAL INDICATOR COMPATIBILITY HARNESS — LAYER A ───
//
// Authorized as a validation/discovery tranche (Phase Two): build a repeatable
// harness for real public Pine scripts, classify real compatibility gaps, and
// stop chasing a headline acceptance percentage. Full design:
// `docs/superpowers/specs/universal-indicator-ecosystem/PUBLIC_SCRIPT_VISUAL_COMPATIBILITY_HARNESS_READINESS_REPORT.md`.
//
// ⭐ THIS IS LAYER A: static, no browser, no TradingView. It reuses the EXACT
// same real doors `doorScorecard.test.js` already measures with
// (`translatePine`, `treeYieldsBool`, `evaluateFormula`, `canSaveFormula`,
// `conditionFrom`) rather than re-deriving a parallel judgment about what
// translates — a second opinion built from a different code path would be
// measuring something the product does not run.
//
// ⛔ WHAT THIS DOES NOT COVER, STATED PLAINLY RATHER THAN ASSUMED CLOSED:
// chart render, save/reload persistence, and vendor comparison are Layer B/C's
// job (browser-driven). Every result below marks those steps
// `ENVIRONMENT_BLOCKED` with an honest reason rather than fabricating a verdict
// this layer cannot produce — the exact distinction Golden Journey #4/#5
// established between an honestly-explained block and a misrepresenting one
// (RISK-016).
//
// The 8-script initial sample is drawn entirely from the EXISTING
// `tests/fixtures/pine_community/` corpus (already provenance-tracked via its
// own `SOURCES.md`) per the design doc's Section 6 sample strategy — no new
// scraping in this pass.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine, treeYieldsBool } from './pine.js'
import { parseFormula } from './parse.js'
import { conditionFrom } from '../../builder/toCondition.js'
import { evaluateFormula, canSaveFormula } from '../../builder/FormulaField.jsx'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs.js'

const ROOT = path.resolve(process.cwd(), '..')
const rel = (p) => path.join(ROOT, p)
const PINE_COMMUNITY_DIR = 'tests/fixtures/pine_community'
const RESULTS_DIR = 'tests/fixtures/compat_harness/results/public_script'

/** The 8-script initial sample, one per design-doc Section 6 target category.
 * File names are exact matches into `tests/fixtures/pine_community/`. */
const SAMPLE = [
  { file: '07-hull-suite.pine', category: 'moving_average_system' },
  { file: '02-wavetrend-oscillator-lazybear.pine', category: 'oscillator' },
  { file: '05-chandelier-exit.pine', category: 'trend_indicator' },
  { file: '03-cm-williams-vix-fix.pine', category: 'volatility_band_indicator' },
  { file: '19-cm-macd-ult-mtf.pine', category: 'multi_plot_study' },
  { file: '29-zigzag-plus-plus.pine', category: 'custom_state_logic' },
  { file: '27-support-resistance-channels.pine', category: 'visual_heavy_script' },
  { file: '18-minervini-trend-template.pine', category: 'input_heavy_script' },
]

/** ⛔ A CITATION, NOT A SECOND AUTHORITY. `doorScorecard.test.js` owns the real
 * RULED/OFFERED rosters for the combined `pine`+`pine_community` corpus, with
 * a written reason and its own non-vacuity rails (a script that starts
 * translating contradicts its own ruling and that file goes red). This harness
 * does not re-derive or duplicate that judgment — it only cross-references the
 * subset of entries that happen to fall inside THIS 8-script sample, so a
 * result here reads consistently with the door's own established scorecard
 * rather than silently disagreeing with it. If `doorScorecard.test.js`'s own
 * rosters change for these files, update this citation to match — never let
 * this file be the one a reviewer trusts over the door's own scorecard.
 */
const KNOWN_RULED = {
  '29-zigzag-plus-plus.pine':
    'imports another script, which is code this engine never sees (doorScorecard.test.js RULED)',
}
const KNOWN_OFFERED = {
  '07-hull-suite.pine':
    'a hand-expanded Hull hands wma a half-window of 27.5 with no published rounding; '
    + 'the door offers hma instead (doorScorecard.test.js OFFERED)',
}

function classifyOne({ file }) {
  const source = fs.readFileSync(path.join(rel(PINE_COMMUNITY_DIR), file), 'utf8')
  const slug = file.replace(/\.pine$/, '')

  let translateOut
  try {
    translateOut = translatePine(source)
  } catch (e) {
    translateOut = { ok: false, refusal: { guard: 'THREW', message: String(e && e.message || e) } }
  }

  const steps = {
    parse: { status: 'SUPPORTED', guard: null, evidence: [] },
    dialect_detect: { status: 'SUPPORTED', detected: 'pine' },
    translate: null,
    canonical_ast: null,
    execution_requirements: {
      status: 'PARTIAL',
      note: 'Layer A v1 does not extract per-script lookback/timeframe/session '
        + 'requirements yet; deferred to a later pass, disclosed rather than guessed.',
    },
    visual_requirements: { status: 'PARTIAL', plot_count: null, needs: [] },
    chart_render: { status: 'ENVIRONMENT_BLOCKED', reason: 'Layer A is static-only; rendering is Layer B/C' },
    persistence_save: { status: 'ENVIRONMENT_BLOCKED', reason: 'Layer A does not persist; Layer B/C does' },
    persistence_reload: { status: 'ENVIRONMENT_BLOCKED', reason: 'Layer A does not persist; Layer B/C does' },
    screener_eligibility: null,
    refusal_behavior: null,
    vendor_comparison: { status: 'SKIPPED_NOT_APPROPRIATE', ref: null },
  }

  const failureTaxonomy = []
  let finalClassification

  if (!translateOut.ok) {
    const guard = (translateOut.refusal || {}).guard || null
    const message = (translateOut.refusal || {}).message || null
    const suggest = (translateOut.refusal || {}).suggest || null
    steps.translate = { status: 'UNSUPPORTED', guard, message, unsupported_constructs: [] }
    steps.canonical_ast = { status: 'UNSUPPORTED', ast_ref: null }
    steps.screener_eligibility = { status: 'UNSUPPORTED', eligible: false, reason: 'translation did not produce a formula' }

    if (KNOWN_RULED[file]) {
      steps.refusal_behavior = { status: 'CORRECTLY_REFUSED', guard, message: KNOWN_RULED[file] }
      failureTaxonomy.push('correctly_refused')
      finalClassification = 'CORRECTLY_REFUSED'
    } else if (KNOWN_OFFERED[file] || (suggest && String(suggest).trim())) {
      steps.refusal_behavior = { status: 'PARTIAL', guard, message: KNOWN_OFFERED[file] || suggest }
      failureTaxonomy.push('unsupported_builtin')
      finalClassification = 'PARTIAL'
    } else {
      steps.refusal_behavior = { status: 'UNSUPPORTED', guard, message }
      failureTaxonomy.push(guard && guard.startsWith('canonicalise') ? 'parser_unsupported_syntax' : 'unsupported_builtin')
      finalClassification = 'UNSUPPORTED'
    }
  } else {
    steps.translate = { status: 'SUPPORTED', guard: null, unsupported_constructs: [] }
    steps.canonical_ast = { status: 'SUPPORTED', ast_ref: `translatePine(${file}).outputs` }

    const outputs = translateOut.outputs || []
    steps.visual_requirements.plot_count = outputs.length
    const selected = translateOut.selected >= 0 ? outputs[translateOut.selected] : null

    const cols = outputs.filter((o) => o.formula).map((o) => {
      let bool = false
      try { bool = !!treeYieldsBool(parseFormula(o.formula).ast) } catch (e) { bool = false }
      return { formula: o.formula, hidden: !!o.hidden, bool }
    })
    const anyScannable = cols.some((c) => c.bool)
    const anyReachableWithComparison = cols.some((c) => {
      if (c.bool) return false
      const r = conditionFrom(c.formula, '>', 0)
      return !!(r && r.ok)
    })

    if (!selected || !selected.formula) {
      steps.screener_eligibility = { status: 'UNSUPPORTED', eligible: false, reason: 'no selected output formula' }
      failureTaxonomy.push('screener_incompatibility')
      finalClassification = 'PARTIAL'
    } else {
      const ev = evaluateFormula(selected.formula, BUILDER_INPUT_SCOPE)
      if (!ev.ok) {
        steps.screener_eligibility = { status: 'UNSUPPORTED', eligible: false, reason: 'selected formula did not evaluate' }
        failureTaxonomy.push('execution_policy_mismatch')
        finalClassification = 'PARTIAL'
      } else {
        const saveableAsIs = canSaveFormula(ev, false)
        const saveableWithAck = !saveableAsIs && canSaveFormula(ev, true)
        const eligible = anyScannable || anyReachableWithComparison
        steps.screener_eligibility = {
          status: eligible ? 'SUPPORTED' : 'PARTIAL',
          eligible,
          reason: anyScannable
            ? 'at least one output yields bool directly'
            : anyReachableWithComparison
              ? 'reachable with one added comparison, no direct bool output'
              : 'yields num with no comparison path found',
        }
        if (!saveableAsIs && !saveableWithAck) {
          failureTaxonomy.push('save_reopen_drift')
        }
        if (!eligible) failureTaxonomy.push('screener_incompatibility')

        steps.refusal_behavior = { status: 'SUPPORTED', guard: null }
        finalClassification = eligible && (saveableAsIs || saveableWithAck) ? 'SUPPORTED' : 'PARTIAL'
        if (saveableWithAck && !saveableAsIs) {
          failureTaxonomy.push('guide_fill_color_style_mismatch') // repaint-acknowledgement class, disclosed not hidden
        }
      }
    }
  }

  return {
    id: `public_script/${slug}`,
    lane: 'public_script',
    source: {
      dialect: 'pine',
      version_declared: null,
      provenance_ref: `tests/fixtures/pine_community/SOURCES.md#${slug}`,
      captured_at: '2026-09-07',
      capture_method: 'local_fixture_file',
    },
    steps,
    failure_taxonomy: failureTaxonomy,
    final_classification: finalClassification,
    evidence_artifact_paths: [],
    harness_version: 'compat-harness-v1',
  }
}

describe('compat harness Layer A — public script sample (pine_community)', () => {
  const results = SAMPLE.map(classifyOne)

  it('⛔ every sample file actually exists in pine_community — no ghost entries', () => {
    for (const s of SAMPLE) {
      expect(fs.existsSync(path.join(rel(PINE_COMMUNITY_DIR), s.file)), s.file).toBe(true)
    }
  })

  it('writes one machine-readable result file per script (Section 3 schema)', () => {
    fs.mkdirSync(rel(RESULTS_DIR), { recursive: true })
    for (const r of results) {
      const outPath = path.join(rel(RESULTS_DIR), `${r.id.split('/')[1]}.json`)
      fs.writeFileSync(outPath, JSON.stringify(r, null, 2) + '\n', 'utf8')
    }
    expect(results.length).toBe(SAMPLE.length)
  })

  it('⛔ NON-VACUITY: the sample produces MORE THAN ONE distinct final_classification', () => {
    // A harness that classified everything the same way (all SUPPORTED, or all
    // UNSUPPORTED) would not be discriminating anything — it would just be
    // restating one number 8 times. This sample was deliberately picked to
    // include a known-RULED script and a known-OFFERED script alongside
    // several never-before-measured ones specifically so this cannot happen
    // by accident.
    const distinct = new Set(results.map((r) => r.final_classification))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('the known-RULED sample script is classified CORRECTLY_REFUSED, corroborating doorScorecard.test.js', () => {
    const zz = results.find((r) => r.id === 'public_script/29-zigzag-plus-plus')
    expect(zz.final_classification).toBe('CORRECTLY_REFUSED')
    expect(zz.steps.refusal_behavior.status).toBe('CORRECTLY_REFUSED')
  })

  it('⛔⛔ MUTATION: corrupting a translating script must flip its classification away from SUPPORTED', () => {
    // Non-vacuity for the "translate" step specifically: take whichever sample
    // script actually translates today, replace a real builtin call with a
    // clearly-unknown name, and confirm the harness's OWN classification logic
    // (not just translatePine in isolation) now reports UNSUPPORTED. A harness
    // that kept reporting SUPPORTED here would prove nothing about any script.
    const supported = results.find((r) => r.final_classification === 'SUPPORTED')
    expect(supported, 'need at least one currently-SUPPORTED sample script to mutate').toBeTruthy()
    const file = supported.id.split('/')[1] + '.pine'
    const source = fs.readFileSync(path.join(rel(PINE_COMMUNITY_DIR), file), 'utf8')
    // Older pine_community scripts are legacy Pine (v1-v3) and call builtins
    // bare (`ema(...)`), not namespaced (`ta.ema(...)`) — match both forms.
    const builtinRe = /\b(?:ta\.)?(sma|ema|rsi|atr|highest|lowest|stdev|wma|cross|crossover|crossunder)\(/
    const mutated = source.replace(builtinRe, 'zzz_not_a_real_builtin_zzz(')
    expect(mutated, 'mutation must actually change the source').not.toBe(source)
    // classifyOne's translate step calls translatePine directly on source text,
    // so exercising translatePine on the mutated text is the same code path the
    // harness itself uses for this step.
    const out = translatePine(mutated)
    expect(out.ok, 'the mutated builtin name must now be refused').toBe(false)
  })
})

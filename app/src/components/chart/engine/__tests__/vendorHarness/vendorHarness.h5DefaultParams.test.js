// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h5DefaultParams.test.js
//
// ─── H5 (step 84) — a user function's DEFAULT PARAMETERS on the HOST lane ──────
//
// `f(x, len = 14) =>` was `pine:function-def` on the host (columnar) lane: C47
// read such a header for the drawing lane only, and L2 for the runtime lane only.
// So every library export with defaults drew only through the runtime lane, and a
// member script with one drew nothing at all with the runtime pane off.
//
// ⭐ WHAT IS SERVED (`pine.js::functionParamDefaults` + `inlineUserFunction`): an
// omitted trailing argument is the default WRITTEN AT THE CALL, under ONE rule for
// both lanes (`paramDefaultShapeOk`: a literal, a dotted built-in constant, or one
// of Pine's bar series — refused by name where the script binds that name itself).
//
// ⭐ GRADED, not argued:
//   * `vw-default-param-spy-1d-2026-10-02` — TradingView's own answer for seven
//     omitted/written pairs (number, negative, bool, string, `na`, two defaults,
//     first given): D01–D15 MATCH on 1,800 bars, runtime pane OFF (the host lane).
//   * `vw-library-import-rddt-1d-2026-10-02` (Q-L1) with the L2 fixture library —
//     `ao()` with three defaults and `highestSince(cond)` with a bar-series one:
//     all seven plots MATCH on 636 bars on the host lane. That needed the H5
//     commit before this one (`periodAnchorMask` from the listing,
//     `vendorHarness.h5ListingAnchor`): without it the host lane would have taken
//     Q-L1 from the runtime lane and drawn 251 blank bars — a MATCH turned DIVERGE.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { sha256Hex, sealCapture } from '../../../../../../../tools/vendor_harness/schema.mjs'
import { registerPineLibrary, clearPineLibraries } from '../../ast/pineLibraryStore'

const load = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
afterEach(() => { vi.unstubAllEnvs(); clearPineLibraries() })

/** The host lane: objects pane on, runtime pane OFF — nothing else can draw it. */
function gradeHost(cap) {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  return gradeCapture(cap)
}
const item = (v, title) => v.plots.find((p) => p.title === title)

// ⭐ The capture's script with a few lines changed is still graded against the
// vendor's numbers only where the change is provably the same program: each
// rewrite below is pinned equal by the capture itself (`vendorHarness.capRound4`:
// L05 == L03 on every bar). The receipt is re-sealed over the changed text.
function rewritten(cap, text, history) {
  return sealCapture({ ...cap, source: { ...cap.source, text, sha256: sha256Hex(text) }, ...(history ? { history: { ...cap.history, ...history } } : {}) })
}

const DEFAULTS = load('vw-default-param-spy-1d-2026-10-02')
describe('⭐ H5 — vw-default-param on the HOST lane', () => {
  it('vendor: TradingView answers every omitted argument with its declared default (D15 is 0 on every bar)', () => {
    const plot = DEFAULTS.study.plots.find((p) => p.title === 'D15_pairs_that_differ_MUST_BE_0')
    const at = DEFAULTS.plotValues.fields.indexOf(plot.id)
    const col = DEFAULTS.plotValues.rows.map((r) => r[at])
    expect(col.length).toBe(1800)
    expect(col.every((x) => x === 0)).toBe(true)
  })

  it.each(['D01_number_omitted', 'D03_negative_omitted', 'D05_bool_omitted', 'D07_string_omitted',
    'D09_na_omitted', 'D11_two_defaults_none_given', 'D13_two_defaults_first_given', 'D15_pairs_that_differ_MUST_BE_0'])(
    '⭐ door: %s MATCH on all 1,800 bars, runtime pane off', (title) => {
      const g = gradeHost(DEFAULTS)
      const p = item(g.verdict, title)
      expect(p.verdict, p.reason).toBe('MATCH')
      expect(p.stats.compared).toBe(1800)
      // the host lane drew it: the door built a columnar document
      expect(g.ours.ok).toBe(true)
    })

  it('⛔ CONTROL: a default changed in the script (k = 7 → 8) DIVERGES on the omitted row only', () => {
    const text = DEFAULTS.source.text.replace('f_num(x, k = 7) => x * k', 'f_num(x, k = 8) => x * k')
    expect(text).not.toBe(DEFAULTS.source.text)
    const v = gradeHost(rewritten(DEFAULTS, text)).verdict
    expect(item(v, 'D01_number_omitted').verdict).toBe('DIVERGE')
    expect(item(v, 'D02_number_written').verdict).toBe('MATCH')
  })
})

// The L2 fixture library (our own spelling of the three exports Q-L1 calls; no
// third-party code), read from the rail that wrote it so the two cannot drift.
const CAP4 = fs.readFileSync(path.join(__dirname, 'vendorHarness.capRound4.test.js'), 'utf8')
const TA7 = CAP4.match(/const L2_TA7_FIXTURE = `([\s\S]*?)`/)[1]
const LIB = load('vw-library-import-rddt-1d-2026-10-02')
describe('⭐ H5 — Q-L1 on the HOST lane (fixture library at TradingView/ta/7)', () => {
  const withLib = (src = TA7) => registerPineLibrary({ path: 'TradingView/ta/7', source: src, licence: 'test-fixture', attribution: 'L2 rail fixture (no third-party code)' })

  it('⭐ door: all seven plots MATCH on all 636 bars with the runtime pane OFF', () => {
    withLib()
    const g = gradeHost(LIB)
    expect(g.verdict.verdict, g.verdict.reason).toBe('MATCH')
    expect(g.verdict.plots.length).toBe(7)
    for (const p of g.verdict.plots) expect(p.stats.compared, p.title).toBe(636)
  })

  it('⛔ CONTROL: the default source `low` instead of `high` DIVERGES on L05 only', () => {
    withLib(TA7.replace('series float source = high', 'series float source = low'))
    const v = gradeHost(LIB).verdict
    expect(item(v, 'L05 highestSince default source').verdict).toBe('DIVERGE')
    expect(item(v, 'L03 highestSince month').verdict).toBe('MATCH')
  })
})

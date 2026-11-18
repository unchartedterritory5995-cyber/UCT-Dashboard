// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.fcmpAcceptance.test.js
//
// ⭐⭐ engine 78 (#1858) — THE ACCEPTANCE OF PINE'S TOLERANT COMPARE, ON THE COMMITTED CAPTURES, BOTH LANES.
// Q-FCMP (packet 56330c15e071) and Q-FCMP2 (d0641f7651fb rows 1-8, 6f854939fa72 rows 9-16), every graded probe
// graded by the harness as a member sees it: the production lane (objects-only pane, runtime dark) and the
// runtime-on lane (both panes, as a permitted member).
//
// Every row agrees with TradingView on every bar. A row whose value is the same on every bar (two literals compared:
// the constant rows) is drawn by no series on our pane (`hidden (constant)`, the pre-existing pane rule for a column
// that reads no bar, as rt1-na-test's A05 and rt3-na-logic's B07), so its per-bar colour cannot be compared and it
// grades INCONCLUSIVE on colour with its values agreeing, never DIVERGE. Those rows are named here, by title.
//
// On BOTH lanes the member door draws these probes on the HOST lane (the runtime pane takes what the host cannot),
// so the runtime lane's own comparisons are measured by driving it over the same captures directly:
// runtime/__tests__/pineCompareRuntime.test.js (every row, every bar, all fourteen).
//
// The two built-in probes per symbol are refused by the member door by name (`pine:collection`: they read arrays);
// their TradingView numbers are railed directly by pineCompareBuiltins.test.js / test_pine_compare_builtins.py.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { runtimePaneEnabled } from '../../runtimePaneGate'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

afterEach(() => { vi.unstubAllEnvs() })
const load = (id) => loadCapture(path.join(HARNESS_DIR, `${id}.json`)).capture
const LANES = {
  production: { VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1', VITE_PINE_RUNTIME_PANE_ENABLED: '' },
  'runtime-on': { VITE_PINE_OBJECTS_ONLY_PANE_ENABLED: '1', VITE_PINE_RUNTIME_PANE_ENABLED: '1' },
}
const grade = (cap, lane) => {
  for (const [k, v] of Object.entries(LANES[lane])) vi.stubEnv(k, v)
  // the lane is PROVED, not assumed: the runtime pane's gate reads as the lane says
  expect(runtimePaneEnabled(), lane).toBe(lane === 'runtime-on')
  return gradeCapture(cap).verdict
}

const D = '1d-2026-11-18'
const FORM_HIDDEN = ['T49_const_center_3e-10', 'T50_const_straddle_1']
const CONST_HIDDEN = ['C01_literals', 'C02_named_consts', 'C03_literal_sum', 'C04_named_sum', 'C09_reassigned',
  'C10_function_result', 'C11_ternary_of_consts', 'C12_int_vs_float', 'C13_tie_literals', 'C14_tie_inline']
const QFCMP_HIDDEN = ['F01_sum_eq_point3', 'F02_sum_gt_point3', 'F03_y_gt_x_3e-14', 'F04_y_eq_x_3e-14',
  'F11_tie_literals_gt', 'F12_tie_literals_eq']
const GRADED = {
  [`vw-float-compare-tolerance-spy-${D}`]: QFCMP_HIDDEN,
  [`vw-float-compare-tolerance-rddt-${D}`]: QFCMP_HIDDEN,
  [`vw-fcmp-form-spy-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-rddt-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-v4-spy-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-v4-rddt-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-v5-spy-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-v3-spy-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-v2-spy-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-form-v1-spy-${D}`]: FORM_HIDDEN,
  [`vw-fcmp-magnitude-spy-${D}`]: [],
  [`vw-fcmp-magnitude-rddt-${D}`]: [],
  [`vw-fcmp-const-v4-spy-${D}`]: CONST_HIDDEN,
  [`vw-fcmp-const-v5-spy-${D}`]: CONST_HIDDEN,
}
const REFUSED = ['spy', 'rddt'].flatMap((s) => [`vw-fcmp-builtins-${s}-${D}`, `vw-fcmp-builtins-v2-${s}-${D}`])

for (const lane of Object.keys(LANES)) {
  describe(`Pine's tolerant compare, ${lane} lane: every committed Q-FCMP / Q-FCMP2 row agrees on every bar`, () => {
    for (const [id, hidden] of Object.entries(GRADED)) {
      it(id, () => {
        const v = grade(load(id), lane)
        expect(v.plots.length, v.reason).toBeGreaterThan(10)
        for (const p of v.plots) {
          expect(p.verdict, `${p.title}: ${p.reason}`).not.toBe('DIVERGE')
          if (p.stats && p.stats.steady) expect(p.stats.steady.divergent, p.title).toBe(0)
          if (hidden.includes(p.title)) {
            expect(p.verdict, p.title).toBe('INCONCLUSIVE')
            expect(p.reason, p.title).toMatch(/^values agree, .*hidden \(constant\)/)
          } else {
            expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
          }
        }
        // every named row exists (a renamed row cannot leave the list silently)
        for (const t of hidden) expect(v.plots.map((p) => p.title), t).toContain(t)
        expect(v.verdict).toBe(hidden.length ? 'INCONCLUSIVE' : 'MATCH')
      })
    }
    it('the door draws every graded probe on the host lane (with the runtime pane on too: the host can draw them)', () => {
      for (const [k, v] of Object.entries(LANES[lane])) vi.stubEnv(k, v)
      for (const id of Object.keys(GRADED)) {
        const d = memberPaneDefinition({ source: load(id).source.text, id: 'u_fcmp-lane', name: 'lane' })
        expect([d.ok, d.lane || 'host'], id).toEqual([true, 'host'])
      }
    })
    it.each(REFUSED)('%s is refused by name (arrays), and so graded by its rails instead', (id) => {
      const v = grade(load(id), lane)
      expect(v.verdict).toBe('INCONCLUSIVE')
      expect(v.reason).toMatch(/pine:collection/)
    })
  })
}

// ⭐ engine NUMBER PENDING (Q-FCMP3, packet b400024aa71d, run fcmp3b-2026-11-18): vw-fcmp-arrays on AMEX:SPY and
// NYSE:RDDT 1D from the listing. Arrays run on the runtime lane only: the production lane (runtime dark) refuses the
// script by name (`pine:collection`); the runtime-on lane draws it, and every row agrees with TradingView on every
// bar: array.lastindexof within the epsilon (A02-A04), the three binary searches exactly (A07-A14).
const ARRAYS = ['spy', 'rddt'].map((s) => `vw-fcmp-arrays-${s}-${D}`)
describe('Q-FCMP3 vw-fcmp-arrays: refused by name on the production lane, every row MATCH on the runtime-on lane', () => {
  it.each(ARRAYS)('%s, production: refused by name (pine:collection)', (id) => {
    const v = grade(load(id), 'production')
    expect(v.verdict).toBe('INCONCLUSIVE')
    expect(v.reason).toMatch(/pine:collection/)
  })
  it.each(ARRAYS)('%s, runtime-on: drawn by the runtime lane, all 17 rows MATCH', (id) => {
    for (const [k, val] of Object.entries(LANES['runtime-on'])) vi.stubEnv(k, val)
    const d = memberPaneDefinition({ source: load(id).source.text, id: 'u_fcmp-lane', name: 'lane' })
    expect([d.ok, d.lane], id).toEqual([true, 'runtime'])
    const v = grade(load(id), 'runtime-on')
    expect(v.plots.length).toBe(17)
    for (const p of v.plots) expect(p.verdict, `${p.title}: ${p.reason}`).toBe('MATCH')
    expect(v.verdict).toBe('MATCH')
  })
})

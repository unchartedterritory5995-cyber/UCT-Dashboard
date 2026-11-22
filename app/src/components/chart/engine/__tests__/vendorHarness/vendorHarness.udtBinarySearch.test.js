// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.udtBinarySearch.test.js
//
// ─── ⭐⭐ UDT UNIT (2026-11-16) — THE WITNESS FOR TWO ANSWERS NO REFERENCE SENTENCE STATES ──────────
//
// `bollinger-band-width-percentile-rddt-1d-2026-11-14` (NYSE:RDDT 1D from the listing, the committed corpus
// script's own capture) keeps a `var` array sorted by inserting each new value at
// `array.binary_search_rightmost(a, v)`, starting EMPTY:
//   · on its first computed bar it searches the empty array and inserts at the answer, and
//   · whenever a value is the largest yet, the answer is the last index plus one (the reference's words),
//     so the insert is AT `size`.
// The v6 reference states neither "rightmost of an empty array" nor "insert at `size`". TradingView ran the
// script through both on every such bar (the capture plots on), and with rightmost-of-empty = 0 and
// insert-at-size = append, every plotted value of this capture grades MATCH through the member door with the
// runtime pane on. That MATCH is the witness `collections.js` cites; the split probes `vw-w19r2a-insert-at-size`,
// `vw-w19r2a-insert-into-empty` and `vw-w19r2b-empty-rightmost` ask the two shapes directly.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'
import { __admitEveryRunHalfForTests, __resetRunHalfAdmissionForTests } from '../../runHalfRailSeam'

const ID = 'bollinger-band-width-percentile-rddt-1d-2026-11-14'

beforeAll(() => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  __admitEveryRunHalfForTests()
})
afterAll(() => {
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
  __resetRunHalfAdmissionForTests()
})

describe('⭐⭐ bollinger-band-width-percentile through the runtime lane: rightmost of an empty array, insert at `size`', () => {
  const cap = loadCapture(path.join(HARNESS_DIR, `${ID}.json`)).capture
  it('TradingView ran on past the first computed bar (the empty-array search and insert did not stop it)', () => {
    const plot = cap.study.plots.find((p) => p.title === 'BBWP')
    const at = cap.plotValues.fields.indexOf(plot.id)
    const drawn = cap.plotValues.rows.filter((r) => r[at] !== null).length
    // the first computed bar plots `na` (0 / 0 over an empty array); every later bar of the capture plots
    expect(drawn).toBeGreaterThan(600)
    expect(cap.plotValues.rows.length).toBe(666)
  })
  it('every plotted value grades MATCH on the runtime-on lane', () => {
    const { verdict, ours } = gradeCapture(cap)
    expect(ours && ours.ok, JSON.stringify((ours && ours.refusal) || null)).toBe(true)
    expect(verdict.verdict, verdict.reason).toBe('MATCH')
  }, 120000)
})

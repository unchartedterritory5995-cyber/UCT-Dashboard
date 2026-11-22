// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.tcTextColour.test.js
//
// ─── TC (text-colour unit, 2026-11-16) — volatility-trend-score, AGAINST ITS OWN CAPTURE ────────
//
// `committed:volatility-trend-score-backquant` was stopped on the runtime lane by ONE wall,
// `runtime:colour` at `bgcolor(bgCol ? coloring.transp(80) : na)`: its own
// `method transp(color x, int t) => color.new(x, t)` was not read as a colour (a parameter declared
// `color`, a method called in the dotted form). TC serves both, and the host object reader opens the
// same method in its two reference lines' colour (`chart.fg_color.transp(50)`).
//
// ⭐ THE WITNESS: the committed capture `volatility-trend-score-backquant-rddt-1d-2026-11-14`, graded
// on the RUNTIME-ON lane: every comparable plot MATCH, the two lines MATCH (count, and colour as a theme
// slot), and nothing DIVERGEs (the one plot titled "" cannot be paired: INCONCLUSIVE, as on master).
// ⚰️ Before TC the run drew the plots and NOT the lines, which graded DIVERGE (objects); a document that
// attached without its drawings would have been a new DIVERGE, so both halves land together.
import { describe, it, expect, vi } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'
import { __admitEveryRunHalfForTests, __resetRunHalfAdmissionForTests } from '../../runHalfRailSeam'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const VTS = 'volatility-trend-score-backquant-rddt-1d-2026-11-14.json'

describe('⭐⭐ volatility-trend-score on the runtime-on lane, graded against its capture', () => {
  it('drawn by the RUNTIME lane: plots MATCH, the two lines MATCH, nothing DIVERGEs', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    __admitEveryRunHalfForTests()
    try {
      const loaded = loadCapture(path.join(DIR, VTS))
      expect(loaded.capture, loaded.reason).toBeTruthy()
      // the member door draws it on the RUNTIME lane (the host lane refuses its user types)
      const d = memberPaneDefinition({ source: loaded.capture.source.text, id: 'u_tc-vts', name: 'tc vts' })
      expect(d.ok, d.reason || '').toBe(true)
      expect(d.lane).toBe('runtime')
      const { verdict } = gradeCapture(loaded.capture)
      expect(verdict.verdict, verdict.reason).not.toBe('DIVERGE')
      expect(verdict.objects && verdict.objects.verdict, JSON.stringify(verdict.objects)).toBe('MATCH')
      const byTitle = Object.fromEntries((verdict.plots || []).map((p) => [String(p.title), p.verdict]))
      expect(byTitle['ATR On Chart']).toBe('MATCH')
      expect(byTitle['Long Signal']).toBe('MATCH')
      expect(byTitle['Short Signal']).toBe('MATCH')
      expect((verdict.plots || []).filter((p) => p.verdict === 'DIVERGE')).toEqual([])
    } finally {
      vi.unstubAllEnvs()
      __resetRuntimePanePermission()
      __resetRuntimeAllowList()
      __resetRunHalfAdmissionForTests()
    }
  })
})

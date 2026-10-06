// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.h5RequestParam.test.js
//
// ─── H5 (step 84) — a request whose timeframe is a PARAMETER, on the plot lane ──
//
// `data_adr(string tf) => request.security(syminfo.tickerid, tf, …)` called as
// `data_adr(i_adr_1_tf)`: C33 read the parameter as its caller's argument on the
// OBJECT pass only (a newly served plot minted parameter ids ahead of saved ones;
// C46 retired that hazard — ids are the input call's place in the source). H5
// reads it on the plot lane too (`pine.js::timeframeLiteralOf`).
//
// ⭐ GRADED: `average-day-range-adr-pivots-rddt-1d-2026-09-28` with the objects-only
// pane OFF (the plot lane alone) went from refused ("declares nothing a chart can
// draw": every plot read the request) to MATCH, all seven plots on 632 bars and
// its objects too. With the pane on it was already MATCH and is unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { gradeCapture, loadCapture, HARNESS_DIR } from './harness'

afterEach(() => { vi.unstubAllEnvs() })
const ADR = loadCapture(path.join(HARNESS_DIR, 'average-day-range-adr-pivots-rddt-1d-2026-09-28.json')).capture

describe('⭐ H5 — average-day-range-adr-pivots with the objects-only pane OFF', () => {
  it('vendor: the script reads its two ADR timeframes through a function parameter', () => {
    expect(ADR.source.text).toContain('request.security(symbol = syminfo.tickerid, timeframe = tf,')
  })

  it('⭐ door: MATCH, every plot on all 632 bars, pane off', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    const v = gradeCapture(ADR).verdict
    expect(v.verdict, v.reason).toBe('MATCH')
    expect(v.plots.length).toBe(7)
    for (const p of v.plots) expect(p.stats.matching, p.title).toBe(632)
  })
})

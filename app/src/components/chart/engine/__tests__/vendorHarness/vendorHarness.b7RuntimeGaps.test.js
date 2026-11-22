// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.b7RuntimeGaps.test.js
//
// ─── LEGACY SEMANTICS (B7) — TWO RUNTIME-LANE GAPS THE s20 ADMISSION RUN FOUND ─────────────────
//
// 1. `vw-array-na-rddt-1d-2026-11-15` (our probe `tools/visual_conformance/probes/vw-array-na.pine`,
//    s20, NYSE:RDDT 1D from the listing): the runtime lane computed all thirteen columns, but the
//    member door dropped N01-N05 ("the member pane did not carry this output") because the HOST had
//    hidden them as `constant` (they read no bar). That is the host's screening judgement, not the
//    author's: TradingView draws each (1, 3, 6, 2, na). The door now carries a `constant` row.
// 2. signal-follow-through-ledger (AMEX:SPY 1D, s20): the run stopped at its last bar on
//    `array.median(btpArr)` over 161 whole bar counts (`provablyFloat`), where TradingView prints "15".
//    An odd count's median is one of the array's elements, so no fraction is turned into an int; it is
//    served (rail: `runtime/__tests__/w6ArrayMembers.test.js`). The capture is the corpus script's and
//    stays in the run store.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { runOurSide } from './ourSide'

beforeAll(() => { vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const DIR = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const ID = 'vw-array-na-rddt-1d-2026-11-15'

describe('⭐⭐ B7 — vw-array-na: every column the run computes is carried, and is TradingView\'s', () => {
  it('all thirteen plots, every bar, equal to the capture', () => {
    const cap = loadCapture(path.join(DIR, `${ID}.json`)).capture
    expect(cap.history.startsAtBar0).toBe(true)
    const ours = runOurSide(cap)
    expect(ours.ok, JSON.stringify(ours.refusal || null)).toBe(true)
    const titles = cap.study.plots.map((p) => p.title)
    expect(ours.plots.map((p) => p.title)).toEqual(titles)
    ours.plots.forEach((p, k) => {
      expect(p.missingReason || null, p.title).toBeNull()
      const col = Array.from(p.column)
      cap.plotValues.rows.forEach((r, i) => {
        const tv = r[k + 1]
        if (tv === null) expect(Number.isFinite(col[i]), `${p.title} bar ${i}`).toBe(false)
        else expect(col[i], `${p.title} bar ${i}`).toBe(tv)
      })
    })
  }, 120000)
})

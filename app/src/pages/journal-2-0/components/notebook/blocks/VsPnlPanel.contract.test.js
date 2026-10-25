// Ruling W9-R46, armed at the be->impl merge: the client's copies of routine_insights' sentences and its win-rate
// rounding are bound to the shared vectors file's `routine_vs_pnl` section, which tests/test_routine_vs_pnl_contract.py
// binds to the server owner (api/services/journal_two/routine_insights.py).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAVEAT, winRateLine } from './VsPnlPanel'
import { SUGGESTED } from './RoutineBlock'

// The shared vectors file, read from the repo (cwd is app/), never imported into a bundle.
const DOC = JSON.parse(readFileSync(join(process.cwd(), '..', 'tests', 'fixtures', 'widgetFormulaVectors.json'), 'utf8'))
const SECTION = DOC.routine_vs_pnl
const group = (avg, n = 22) => ({ avg, n, sample: 'normal', text: 'unused' })

describe('the routine vs P&L copy and rounding contract (W9-R46)', () => {
  it('the copied sentences are the shared ones', () => {
    expect(CAVEAT).toBe(SECTION.CAVEAT)
    expect(SUGGESTED).toBe(SECTION.SUGGEST_LINE)
  })

  it('every win-rate row renders the percent the server shows', () => {
    expect(SECTION.win_rate_rounding.length).toBeGreaterThanOrEqual(10)
    for (const [value, shown] of SECTION.win_rate_rounding) {
      const line = winRateLine({ done: group(value), other: group(0.25, 9) })
      expect(line, String(value)).toBe(`Win rate on days you finished it: ${shown} (22 days). Other days: 25% (9 days).`)
    }
  })

  it('CONTROL: a different rounding would fail the table', () => {
    const truncated = (v) => `${Math.trunc(v * 100)}%`
    expect(SECTION.win_rate_rounding.some(([v, shown]) => truncated(v) !== shown)).toBe(true)
  })
})

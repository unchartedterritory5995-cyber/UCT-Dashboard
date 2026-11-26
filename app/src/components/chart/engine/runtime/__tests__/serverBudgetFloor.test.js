// app/src/components/chart/engine/runtime/__tests__/serverBudgetFloor.test.js
//
// e99 server budget (coordinator ruling 2026-11-26) — THE SERVICE NOW PASSES `budgetScales` (services/pine_runtime/
// job.mjs), AND A RUN OF 5,000 BARS OR FEWER IS HELD EXACTLY AS BEFORE. `budgetScales` reaches a run in two places
// only: the budget it is held to (`runtimePaneBudgetFor`) and the limits it hands the VM (`runLimitsOf`, whose
// WALL_TIME follows a budget above DEFAULT_LIMITS.WALL_TIME). For every n <= 5,000 the first is the 1,000 ms the
// service passed before and the second hands the VM exactly what it was handed, with or without named limits.
import { describe, it, expect } from 'vitest'
import {
  runtimePaneBudgetFor, runLimitsOf, RUNTIME_PANE_TIME_BUDGET_MS, RUNTIME_PANE_BUDGET_FLOOR_BARS,
} from '../runtimeColumns.js'

describe('e99 server budget — at 5,000 bars or fewer `budgetScales` changes nothing', () => {
  it('FLOOR: every n from 1 to 5,000 is given the 1,000 ms the service passed before', () => {
    expect(RUNTIME_PANE_BUDGET_FLOOR_BARS).toBe(5000)
    const off = []
    for (let n = 1; n <= RUNTIME_PANE_BUDGET_FLOOR_BARS; n += 1) {
      if (runtimePaneBudgetFor(n) !== RUNTIME_PANE_TIME_BUDGET_MS) off.push(n)
    }
    expect(off, 'FLOOR: bar counts given another budget').toEqual([])
    expect(runtimePaneBudgetFor(RUNTIME_PANE_BUDGET_FLOOR_BARS + 1)).toBeGreaterThan(RUNTIME_PANE_TIME_BUDGET_MS)
  })

  it('FLOOR: the VM is handed exactly the limits it was handed before, for every n <= 5,000', () => {
    const named = { TOTAL_INSTRUCTIONS: 123 }
    for (const n of [1, 400, 4999, 5000]) {
      const budget = runtimePaneBudgetFor(n)
      expect(runLimitsOf({ budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true }, budget), `FLOOR: ${n}`)
        .toBe(runLimitsOf({ budgetMs: RUNTIME_PANE_TIME_BUDGET_MS }, budget))
      expect(runLimitsOf({ budgetMs: RUNTIME_PANE_TIME_BUDGET_MS, budgetScales: true, limits: named }, budget)).toBe(named)
    }
  })
})

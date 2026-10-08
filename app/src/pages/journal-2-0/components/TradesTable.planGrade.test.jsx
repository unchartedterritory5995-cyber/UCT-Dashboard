// Wave 13 lane 13A — the Unplanned chip in the Trade Journal. A trade with no prior plan is
// FLAGGED, never hidden: every row still renders, and the chip is the only difference.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SWRConfig } from 'swr'
import TradesTable, { buildTradesColumns } from './TradesTable'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contractBody, contractResponse } from '../__fixtures__/contract'

// CONTRACT: the statuses are the REAL server's answer to GET /api/j2/plan-grades/status
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py). The trade rows are
// the table's own props; their ids are the ids that answer was recorded for.
const STATUSES = contractBody('plan-grades.status').statuses

const trade = (id, symbol, extra = {}) => ({
  id, symbol, side: 'Long', shares: 10, entryPrice: 10, entryDate: '2026-09-10T00:00:00Z', exitPrice: 11,
  exitDate: '2026-09-11T00:00:00Z', originalStop: 9, setup: null, pnlDollar: 10, pnlPercent: 0.1,
  rMultiple: 1, holdDays: 1, result: 'Win', source: 'broker', ...extra,
})
const TRADES = [trade('pg-unplanned', 'AAA'), trade('pg-planned', 'BBB'), trade('pg-pick', 'CCC'),
  trade('o', 'OPT', { isOption: true })]
const cols = buildTradesColumns().filter((c) => !c.hiddenByDefault)

beforeEach(() => {
  global.fetch = vi.fn(async () => contractResponse('plan-grades.status'))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const renderTable = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <TradesTable trades={TRADES} visibleColumns={cols} />
  </SWRConfig>,
)

describe('TradesTable — the Unplanned chip', () => {
  it('fetches nothing and shows no chip while the gate is off', () => {
    renderTable()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('unplanned-chip')).toBeNull()
  })

  it('labels the unplanned trade, keeps every row, and never asks about an option', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    renderTable()
    const chip = await screen.findByTestId('unplanned-chip')
    expect(chip.textContent).toBe('Unplanned')
    expect([STATUSES['pg-unplanned'].status, STATUSES['pg-planned'].status, STATUSES['pg-pick'].status])
      .toEqual(['unplanned', 'planned', 'needs_pick'])
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)                     // nothing filtered
    expect(within(rows.find((r) => r.textContent.includes('AAA'))).getByTestId('unplanned-chip')).toBeTruthy()
    expect(within(rows.find((r) => r.textContent.includes('BBB'))).queryByTestId('unplanned-chip')).toBeNull()
    // a trade still waiting for the member to pick a plan is NOT called unplanned
    expect(within(rows.find((r) => r.textContent.includes('CCC'))).queryByTestId('unplanned-chip')).toBeNull()
    expect(screen.getAllByTestId('unplanned-chip')).toHaveLength(1)
    const url = String(global.fetch.mock.calls[0][0])
    expect(url).toBe('/api/j2/plan-grades/status?ids=pg-pick,pg-planned,pg-unplanned')   // the option row is not graded in v1
  })

  it('a failed status read shows no chip at all: it never marks every trade unplanned', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    global.fetch = vi.fn(async () => contractResponse('plan-grades.status.too-many'))
    renderTable()
    await new Promise((r) => setTimeout(r, 40))
    expect(global.fetch).toHaveBeenCalled()
    expect(screen.queryByTestId('unplanned-chip')).toBeNull()
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(4)
  })
})

/**
 * Phase 3 gate A5 — the Plan-trade sheet, through BOTH doors.
 *
 * The three cases the owner's 2026-09-09 ruling actually put in writing:
 *   1. the SCREENER door with a stream price   -> entry seeded, nothing else invented
 *   2. the SCREENER door with NO stream price  -> entry BLANK, "Save plan" DISABLED
 *   3. the JOURNAL door                        -> prefilled from the selected position
 *
 * ⭐ Case 2 is the load-bearing one. It is the test that stops a future "helpful" default from
 * inventing a level, which is the whole reason blank-means-blank was written down rather than
 * left as a preference.
 *
 * ⛔ AND THE POST BODY IS ASSERTED AGAINST THE PYDANTIC MODEL, KEY FOR KEY. `PlannedTradeCreate`
 * (`api/routers/hub_planned_trades.py`) declares `source_mode` in snake_case with no alias
 * generator, so a camelCase `sourceMode` is silently DROPPED and the request still returns 200 —
 * a plan stored with no idea which section it came from, and nothing anywhere says so.
 */
import { describe, it as vitestIt, expect, afterAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import PlanTradeSheet, { planOneR } from './PlanTradeSheet'
import { plannedTradeBody, planSideOf, createPlannedTrade, PLANNED_TRADES_URL } from './plannedTradesClient'

let definedCount = 0
let executedCount = 0
function it(name, fn) {
  definedCount += 1
  return vitestIt(name, (...args) => { executedCount += 1; return fn(...args) })
}
afterAll(() => {
  expect(executedCount).toBeGreaterThan(0)
  expect(executedCount).toBe(definedCount)
})

/** A member whose sizing rule and stop rule are both set — the "everything present" case. */
const SETTINGS = {
  accountSize: 100000,
  defaultSizePct: 10,
  defaultStop: { mode: 'fixed_percent_distance', percent: 5 },
}

const fakeClient = (impl) => ({ create: vi.fn(impl ?? (async (plan) => ({ id: 'pt1', ...plan }))) })

const openSheet = (props) => {
  const client = props.client ?? fakeClient()
  const view = render(
    <PlanTradeSheet onClose={() => {}} {...props} client={client} />,
  )
  return { client, view }
}

const save = () => screen.getByTestId('hub-plan-save')

describe('door 1 — the Screener, WITH a stream price', () => {
  it('seeds entry from the stream, derives stop and size from the member’s own rules', () => {
    openSheet({ symbol: 'NVDA', lastPrice: 120, settings: SETTINGS, sourceMode: 'scan' })
    expect(screen.getByTestId('hub-plan-entry')).toHaveValue(120)
    // prefillStop, 5% below a long entry.
    expect(screen.getByTestId('hub-plan-stop')).toHaveValue(114)
    // computeDefaultShares: 10% of 100,000 / 120 = 83 (floored).
    expect(screen.getByTestId('hub-plan-size')).toHaveValue(83)
    expect(save()).toBeEnabled()
  })

  it('R appears only when entry, stop and size are ALL present', () => {
    openSheet({ symbol: 'NVDA', lastPrice: 120, settings: SETTINGS, sourceMode: 'scan' })
    // |120 - 114| * 83 = 498.00, through calculations.tradePnlDollar — the same derivation
    // the server uses for r_value.
    expect(screen.getByTestId('hub-plan-r')).toHaveTextContent('Risk (1R) $498.00')

    fireEvent.change(screen.getByTestId('hub-plan-size'), { target: { value: '' } })
    expect(screen.getByTestId('hub-plan-r')).toHaveTextContent('Risk (1R) —')
    expect(save()).toBeDisabled()
  })
})

describe('⛔ door 1 again — the Screener with NO stream price. BLANK MEANS BLANK.', () => {
  it('entry is blank, renders an em dash, and Save plan is DISABLED', () => {
    // The Screener supplies symbol only when the stream has nothing. Nothing may be invented
    // from that: a fabricated level is indistinguishable from a real one once it is in the box.
    openSheet({ symbol: 'NVDA', lastPrice: null, settings: SETTINGS, sourceMode: 'scan' })
    expect(screen.getByTestId('hub-plan-entry')).toHaveValue(null)
    expect(screen.getByTestId('hub-plan-entry-shown')).toHaveTextContent('—')
    expect(save()).toBeDisabled()
  })

  it('with no entry there is no stop and no size either — the rules need one', () => {
    openSheet({ symbol: 'NVDA', lastPrice: null, settings: SETTINGS, sourceMode: 'scan' })
    expect(screen.getByTestId('hub-plan-stop-shown')).toHaveTextContent('—')
    expect(screen.getByTestId('hub-plan-size-shown')).toHaveTextContent('—')
    expect(screen.getByTestId('hub-plan-r')).toHaveTextContent('Risk (1R) —')
  })

  it('a member who types the three numbers themselves can save', () => {
    openSheet({ symbol: 'NVDA', lastPrice: null, settings: SETTINGS, sourceMode: 'scan' })
    fireEvent.change(screen.getByTestId('hub-plan-entry'), { target: { value: '120' } })
    expect(save()).toBeDisabled()
    fireEvent.change(screen.getByTestId('hub-plan-stop'), { target: { value: '114' } })
    expect(save()).toBeDisabled()
    fireEvent.change(screen.getByTestId('hub-plan-size'), { target: { value: '50' } })
    expect(save()).toBeEnabled()
  })

  it('with NO sizing rule at all, size stays blank even with a price', () => {
    openSheet({ symbol: 'NVDA', lastPrice: 120, settings: { defaultStop: { mode: 'custom' } } })
    expect(screen.getByTestId('hub-plan-size-shown')).toHaveTextContent('—')
    expect(screen.getByTestId('hub-plan-stop-shown')).toHaveTextContent('—')
    expect(save()).toBeDisabled()
  })
})

describe('door 2 — the Journal, prefilled from the selected position', () => {
  it('takes entry, stop and size from the position rather than from the rules', () => {
    openSheet({
      symbol: 'AAPL', side: 'Long', entry: 178.10, stop: 176.00, size: 100,
      settings: SETTINGS, sourceMode: 'journal',
    })
    expect(screen.getByTestId('hub-plan-entry')).toHaveValue(178.1)
    expect(screen.getByTestId('hub-plan-stop')).toHaveValue(176)
    expect(screen.getByTestId('hub-plan-size')).toHaveValue(100)
    expect(screen.getByTestId('hub-plan-side')).toHaveTextContent('Side Long')
    expect(save()).toBeEnabled()
  })

  it('a short position derives Short from entry-vs-stop, never from a passed-in side', () => {
    openSheet({
      symbol: 'AAPL', side: 'Long', entry: 178.10, stop: 181.00, size: 100,
      settings: SETTINGS, sourceMode: 'journal',
    })
    expect(screen.getByTestId('hub-plan-side')).toHaveTextContent('Side Short')
  })
})

describe('⛔ the POST body matches the Pydantic model', () => {
  it('sends symbol · entry · stop · size · source_mode and nothing else', async () => {
    const { client } = openSheet({
      symbol: 'nvda', lastPrice: 120, settings: SETTINGS, sourceMode: 'scan',
    })
    fireEvent.click(save())
    await waitFor(() => expect(client.create).toHaveBeenCalledTimes(1))
    // The sheet hands the client a plan; the CLIENT owns the wire shape. Assert the wire.
    expect(plannedTradeBody(client.create.mock.calls[0][0])).toEqual({
      symbol: 'NVDA', entry: 120, stop: 114, size: 83, source_mode: 'scan',
    })
  })

  it('the wire body is snake_case on source_mode and uppercases the symbol', () => {
    expect(Object.keys(plannedTradeBody({
      symbol: ' nvda ', entry: 1, stop: 2, size: 3, sourceMode: 'journal',
    })).sort()).toEqual(['entry', 'size', 'source_mode', 'stop', 'symbol'])
    expect(plannedTradeBody({ symbol: ' nvda ', entry: 1, stop: 2, size: 3 }).symbol).toBe('NVDA')
    expect(plannedTradeBody({ symbol: 'x', entry: 1, stop: 2, size: 3 }).source_mode).toBeNull()
  })

  it('the client POSTs to the Phase 2a endpoint and carries the server’s message on a 422', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 422,
      json: async () => ({ detail: 'stop must differ from entry (risk is undefined when they are equal)' }),
    }))
    await expect(createPlannedTrade(
      { symbol: 'X', entry: 10, stop: 10, size: 1 }, { fetchImpl },
    )).rejects.toThrow('stop must differ from entry')
    expect(fetchImpl.mock.calls[0][0]).toBe(PLANNED_TRADES_URL)
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST')
  })

  it('a failure toast carries the server’s own words, and Save stays available', async () => {
    const onToast = vi.fn()
    const client = fakeClient(async () => { throw new Error('planned trade not found') })
    render(<PlanTradeSheet
      symbol="NVDA"
      lastPrice={120}
      settings={SETTINGS}
      sourceMode="scan"
      client={client}
      onToast={onToast}
      onClose={() => {}}
    />)
    fireEvent.click(save())
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      "Couldn't save the plan: planned trade not found", 'error',
    ))
    await waitFor(() => expect(save()).toBeEnabled())
  })

  it('a success toast names the plan the member just made', async () => {
    const onToast = vi.fn()
    const onClose = vi.fn()
    const client = fakeClient()
    render(<PlanTradeSheet
      symbol="NVDA"
      lastPrice={120}
      settings={SETTINGS}
      sourceMode="scan"
      client={client}
      onToast={onToast}
      onClose={onClose}
    />)
    fireEvent.click(save())
    await waitFor(() => expect(onToast).toHaveBeenCalledWith(
      'Planned NVDA — 83 at 120.00, stop 114.00', 'success',
    ))
    expect(onClose).toHaveBeenCalled()
  })

  it('a stop AT the entry is refused before the round trip, in plain English', () => {
    const { client } = openSheet({
      symbol: 'NVDA', entry: 120, stop: 120, size: 10, settings: SETTINGS,
    })
    expect(screen.getByTestId('hub-plan-refusal')).toHaveTextContent(
      'A stop at the entry risks nothing',
    )
    expect(save()).toBeDisabled()
    fireEvent.click(save())
    expect(client.create).not.toHaveBeenCalled()
  })
})

describe('the derived halves, in isolation', () => {
  it('planSideOf mirrors the server: stop below entry is Long', () => {
    expect(planSideOf(100, 95)).toBe('Long')
    expect(planSideOf(100, 105)).toBe('Short')
  })

  it('planOneR is null unless all three are present, and null at stop === entry', () => {
    expect(planOneR({ entry: 100, stop: 95, size: 10 })).toBe(50)
    expect(planOneR({ entry: 100, stop: 95, size: null })).toBeNull()
    expect(planOneR({ entry: 100, stop: '', size: 10 })).toBeNull()
    expect(planOneR({ entry: 100, stop: 100, size: 10 })).toBeNull()
  })
})

// Wave 9 (Task 9.17): the builder picks a routine or tracker for the fields that name one, and the two tool sources
// drop what they cannot take (one account, a number of trades). Asserted by RENDERED TEXT and by the plan on the wire.
//
// The catalog is be's (Task 9.8) layered on impl's, from `__fixtures__/toolCatalog.js` (test-local until the 9.20
// merge regenerates serverCatalog.json).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import WidgetBuilderSheet, { PREVIEW_DEBOUNCE_MS } from './WidgetBuilderSheet'
import { normalizePlan } from './builderState'
import { __resetBuiltCaches, loadVocabulary } from '../../../lib/builtWidgets'
import { installFetch, answer, callsTo, bodyOf } from './__fixtures__/builderFixtures'
import {
  TOOL_CATALOG, ROUTINES, TRACKERS, R1, R2, T1, S_ONE_REF, S_UNKNOWN_RANGE,
} from './__fixtures__/toolCatalog'

const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

let fetchSpy
let routes
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  __resetBuiltCaches()
  window.localStorage.clear()
  ;({ spy: fetchSpy, routes } = installFetch([
    ['GET', (u) => u.endsWith('/vocabulary'), () => answer(TOOL_CATALOG)],
    ['GET', (u) => u.includes('/vocabulary?field=routine'), () => answer({ field: 'routine', values: ROUTINES })],
    ['GET', (u) => u.includes('/vocabulary?field=tracker'), () => answer({ field: 'tracker', values: TRACKERS })],
  ]))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const previews = () => callsTo(fetchSpy, 'POST', (u) => u.endsWith('/preview'))
const lastPlan = () => bodyOf(previews()[previews().length - 1]).plan
const vocabCalls = (field) => callsTo(fetchSpy, 'GET', (u) => u.endsWith(`/vocabulary?field=${field}`))

async function openBuilder() {
  render(<WidgetBuilderSheet uid="u1" onClose={vi.fn()} />)
  await flush()
  await flush(PREVIEW_DEBOUNCE_MS)
}

async function onTradingDays() {
  await openBuilder()
  fireEvent.click(screen.getByRole('radio', { name: 'Trading days' }))
  await flush(PREVIEW_DEBOUNCE_MS)
}

/** + Filter -> Routine done -> Which routine -> Morning prep -> Done -> Add filter. */
async function addRoutineDoneFilter() {
  fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
  fireEvent.click(screen.getByRole('button', { name: 'Routine done' }))
  await flush()
  fireEvent.click(screen.getByRole('button', { name: 'Morning prep' }))
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
  await flush(PREVIEW_DEBOUNCE_MS)
}

describe('routine and tracker choices (Task 9.17)', () => {
  it('ref_field_asks_which_routine_then_values', async () => {
    await onTradingDays()
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    // The field picker lists only fields a filter may use (be `filter: false` on routine history's Item).
    fireEvent.click(screen.getByRole('button', { name: 'Routine done' }))
    await flush()
    // First: which routine, from the member's own list.
    expect(screen.getByRole('heading', { name: 'Which routine' })).toBeInTheDocument()
    expect(vocabCalls('routine')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Post-market review' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Morning prep' }))
    // Then: its values, the server's codes with their labels.
    expect(screen.getByRole('heading', { name: 'Morning prep' })).toBeInTheDocument()
    for (const label of ['Done', 'Not done', 'Skipped', 'Off day', 'Not yet']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters).toEqual([
      { field: 'routine_done', op: 'in', values: ['done'], overridable: false, ref: R1 },
    ])
  })

  it('chip_sentence_names_the_routine', async () => {
    await onTradingDays()
    await addRoutineDoneFilter()
    // The chip reads the routine's own name, never the field's.
    expect(screen.getByRole('button', { name: 'Morning prep is Done' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter: Morning prep is Done' })).toBeInTheDocument()
    expect(screen.queryByText(/Routine done is/)).toBeNull()
    // A split on a tracker field asks which tracker, and its chip names it.
    fireEvent.click(screen.getByRole('button', { name: 'No split. Pick one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tracker value range' }))
    await flush()
    expect(screen.getByRole('heading', { name: 'Which tracker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check-in mood' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sleep' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.getByRole('button', { name: 'Split by Sleep. Change' })).toBeInTheDocument()
    expect(lastPlan().split).toEqual({ by: 'tracker_bucket', then: null, ref: T1 })
    // Removing the split drops its ref with it.
    fireEvent.click(screen.getByRole('button', { name: 'Remove split: Sleep' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().split).toBeNull()
  })

  it('second_routine_disabled_with_reason', async () => {
    await onTradingDays()
    await addRoutineDoneFilter()
    fireEvent.click(screen.getByRole('button', { name: 'No split. Pick one' }))
    fireEvent.click(screen.getByRole('button', { name: 'Routine done' }))
    await flush()
    const other = screen.getByRole('button', { name: 'Post-market review' })
    // aria-disabled, never `disabled`: it keeps focus, so the reason is readable from the keyboard.
    expect(other).toHaveAttribute('aria-disabled', 'true')
    expect(other).not.toBeDisabled()
    expect(other).toHaveAccessibleDescription(S_ONE_REF)
    fireEvent.click(other)
    expect(screen.getByRole('heading', { name: 'Which routine' })).toBeInTheDocument()   // nothing picked
    // The routine already in the widget stays pickable; a tracker is another kind and is not limited by it.
    const same = screen.getByRole('button', { name: 'Morning prep' })
    expect(same).not.toHaveAttribute('aria-disabled')
    fireEvent.click(same)
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().split).toEqual({ by: 'routine_done', then: null, ref: R1 })
    // Editing the one filter that names a routine may move it to another: it is not "a second one".
    fireEvent.click(screen.getByRole('button', { name: 'Remove split: Morning prep' }))
    fireEvent.click(screen.getByRole('button', { name: 'Morning prep is Done' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change routine' }))
    await flush()
    const moved = screen.getByRole('button', { name: 'Post-market review' })
    expect(moved).not.toHaveAttribute('aria-disabled')
    fireEvent.click(moved)
    fireEvent.click(screen.getByRole('button', { name: 'Update filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters[0].ref).toBe(R2)
    expect(screen.getByRole('button', { name: 'Post-market review is Done' })).toBeInTheDocument()
  })

  it('tool_source_hides_accounts_and_disables_last_n_trades', async () => {
    await openBuilder()
    // One account and a number of trades, both fine for closed trades...
    fireEvent.change(screen.getByLabelText('Accounts'), { target: { value: 'a1' } })
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Last 20 trades' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan()).toMatchObject({ accounts: { id: 'a1' }, range: { token: 'last_20_trades' } })
    // ...and neither carries into routine history, in the same undo step as the source.
    fireEvent.click(screen.getByRole('radio', { name: 'Routine history' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(screen.queryByLabelText('Accounts')).toBeNull()
    expect(lastPlan()).toMatchObject({ source: 'routine_history', accounts: 'all', range: { token: 'last_90d' } })
    fireEvent.click(screen.getByRole('button', { name: /Date range/ }))
    for (const name of ['Last 20 trades', 'Last 50 trades', 'Last 100 trades']) {
      const opt = screen.getByRole('button', { name })
      expect(opt).toHaveAttribute('aria-disabled', 'true')
      expect(opt).toHaveAccessibleDescription(S_UNKNOWN_RANGE)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Last 20 trades' }))
    expect(screen.getByRole('heading', { name: 'Date range' })).toBeInTheDocument()   // still choosing
    expect(screen.getByRole('button', { name: 'Last 30 days' })).not.toHaveAttribute('aria-disabled')
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().range).toEqual({ token: 'last_30d' })
    // Undo brings back the account and the range with closed trades.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan()).toMatchObject({ source: 'closed_trades', accounts: { id: 'a1' }, range: { token: 'last_20_trades' } })
    expect(screen.getByLabelText('Accounts')).toBeInTheDocument()
  })
})

describe('split-only fields (Task 9.17)', () => {
  it('routine history Item can split but is never offered as a filter (be filter: false)', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Routine history' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('button', { name: 'State' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Item' })).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'No split. Pick one' }))
    expect(screen.getByRole('button', { name: 'Item' })).toBeInTheDocument()
  })

  it('a Routine filter on routine history lists the member routines and its chip names them', async () => {
    await openBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'Routine history' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Routine' }))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Post-market review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    await flush(PREVIEW_DEBOUNCE_MS)
    expect(lastPlan().filters).toEqual([{ field: 'routine', op: 'in', values: [R2], overridable: false }])
    expect(screen.getByRole('button', { name: 'Routine is Post-market review' })).toBeInTheDocument()
  })
})

describe('the plan keeps its refs (Task 9.17)', () => {
  it('normalizePlan carries a filter ref and a split ref/ref2, and drops anything else', () => {
    const p = normalizePlan({
      source: 'trading_days',
      filters: [{ field: 'routine_done', op: 'in', values: ['done'], ref: R1 }, { field: 'mood', op: 'gt', values: [3], ref: 7 }],
      split: { by: 'routine_done', then: 'tracker_bucket', ref: R1, ref2: 'checkin:mood' },
      measures: [{ key: 'day_net_pnl' }],
    })
    expect(p.filters[0].ref).toBe(R1)
    expect(p.filters[1]).not.toHaveProperty('ref')
    expect(p.split).toEqual({ by: 'routine_done', then: 'tracker_bucket', ref: R1, ref2: 'checkin:mood' })
    expect(normalizePlan({ split: { by: 'weekday' } }).split).toEqual({ by: 'weekday', then: null })
  })

  it('the routine and tracker lists are read again on each open, so a routine made since is listed', async () => {
    const first = await loadVocabulary('routine')
    expect(first.map((r) => r.name)).toEqual(['Morning prep', 'Post-market review'])
    routes.unshift(['GET', (u) => u.includes('/vocabulary?field=routine'),
      () => answer({ field: 'routine', values: [...ROUTINES, { id: '44444444-4444-4444-8444-444444444444', name: 'Close review' }] })])
    const again = await loadVocabulary('routine', { fresh: true })
    expect(again).toHaveLength(3)
    expect(vocabCalls('routine')).toHaveLength(2)
    // Without `fresh`, the last answer is reused (the chip names read it, one request per tab).
    expect(await loadVocabulary('routine')).toHaveLength(3)
    expect(vocabCalls('routine')).toHaveLength(2)
  })
})

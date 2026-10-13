// app/src/components/chart/UnavailableIndicators.test.jsx — A1.4: the "can't be shown" notice
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'

// The member's formulas have LOADED (an empty store), so a missing `u_…` formula is reported.
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: () => ({ data: [], error: undefined, isLoading: false }), mutate: vi.fn() }
})
import { AuthContext } from '../../context/AuthContext'
import * as R from './engine/nativeRegistry'
import { mergeChartSettings } from './chartDefaults'
import { peekIndicatorHistory, _resetIndicatorHistoryForTests } from './indicatorHistoryStore'
import UnavailableIndicators from './UnavailableIndicators'

const broken = { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: -5 }, hidden: false, calcTimeframe: 'W' }
const gone = { instanceId: 'inst:u_deadbeef0001:1', defId: 'u_deadbeef0001', inputs: {}, hidden: false }
let store
beforeEach(() => {
  _resetIndicatorHistoryForTests()
  try { window.sessionStorage.clear() } catch { /* jsdom */ }
  store = { cs: { ...mergeChartSettings(null), indicatorInstances: [broken, gone] }, writes: [] }
  store.write = (next) => { store.writes.push(next); store.cs = next }
})
afterEach(cleanup)
const Group = () => (
  <AuthContext.Provider value={{ user: { id: 'm1' } }}>
    <UnavailableIndicators variant="group" cs={store.cs} registry={R} write={store.write} surfaceKey="chart:t" />
  </AuthContext.Provider>
)
const rowOf = (id) => document.querySelector(`[data-instance-id="${id}"]`)

describe('A1.4 — UnavailableIndicators', () => {
  it('lists each record with its reason and only the actions that reason allows', () => {
    render(<Group />)
    expect(screen.getByTestId('unavailable-group').textContent).toMatch(/2 indicators can't be shown/)
    expect(within(rowOf('inst:rsi:1')).getByText('Repair')).toBeTruthy()
    expect(within(rowOf('inst:u_deadbeef0001:1')).queryByText('Repair'), 'a missing formula cannot be repaired').toBeNull()
    expect(within(rowOf('inst:u_deadbeef0001:1')).getByText(/deleted or isn't installed/)).toBeTruthy()
  })

  it('Repair keeps the record\'s other settings, writes once, and is undoable', () => {
    render(<Group />)
    fireEvent.click(within(rowOf('inst:rsi:1')).getByText('Repair'))
    const fixed = store.writes.at(-1).indicatorInstances.find((i) => i.instanceId === 'inst:rsi:1')
    expect(fixed).toEqual({ ...broken, inputs: {} })
    expect(peekIndicatorHistory('chart:t').past).toHaveLength(1)
    expect(peekIndicatorHistory('chart:t').past[0].label).toMatch(/^Repaired /)
  })

  it('Remove tombstones the record (undoable); Keep hides the notice for this tab and writes nothing', () => {
    const view = render(<Group />)
    fireEvent.click(within(rowOf('inst:u_deadbeef0001:1')).getByText('Remove'))
    expect(store.writes.at(-1).indicatorInstances.find((i) => i.instanceId === 'inst:u_deadbeef0001:1')).toEqual({ instanceId: 'inst:u_deadbeef0001:1', deleted: true })
    expect(peekIndicatorHistory('chart:t').past.at(-1).label).toMatch(/^Removed /)
    view.rerender(<Group />)
    const n = store.writes.length
    fireEvent.click(within(rowOf('inst:rsi:1')).getByText('Keep'))
    expect(store.writes.length, 'Keep wrote to the chart').toBe(n)
    expect(screen.queryByTestId('unavailable-group'), 'the notice is still shown after Keep').toBeNull()
    expect(window.sessionStorage.getItem('uct.indicators.unavailable.dismissed.v1:chart:t')).toBe('["inst:rsi:1"]')
  })

  it('renders nothing for a chart with nothing unavailable', () => {
    render(<UnavailableIndicators variant="chip" cs={mergeChartSettings(null)} registry={R} write={() => {}} />)
    expect(screen.queryByTestId('unavailable-chip')).toBeNull()
  })
})

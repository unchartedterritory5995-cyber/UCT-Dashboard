import { render, screen, waitFor } from '@testing-library/react'
import { vi, expect, test, beforeEach } from 'vitest'
import { EmptyState } from '../FocusStates'
import { __resetCountCache } from '../useLazyCounts'
import { PRESENCE_MIN } from '../emptyReason'

const META = { filters: [
  { key: 'rvol_live', label: 'Rel Volume (by now)', type: 'range', live_only: true, presets: [] },
  { key: 'price', label: 'Price', type: 'range', unit: '$', presets: [] },
] }
const SURGE = { filters: [{ key: 'rvol_live', op: 'gte', min: 2 }, { key: 'price', op: 'gte', min: 5 }], view: 'technical' }

// The batch route answers each spec: a presence probe for rvol_live gets `liveHeld`.
function answer(liveHeld) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const { specs } = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ counts: specs.map(s => {
      const f = s.filters?.[0]
      return { count: f?.key === 'rvol_live' && f.min === PRESENCE_MIN ? liveHeld : 7 }
    }) }) }
  })
}
const show = props => render(<EmptyState filterCount={2} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} spec={SURGE} meta={META} {...props} />)
beforeEach(() => { __resetCountCache() })

test('outside the session a live-only screen says it is live during the session, not "no stocks match"', async () => {
  answer(0)
  show()
  await waitFor(() => expect(screen.getByText('Not available yet: this screen is live during the session')).toBeInTheDocument())
  expect(screen.getByText(/Rel Volume \(by now\) fills in from the live tape during the session, from 9:45 ET/)).toBeInTheDocument()
  expect(screen.queryByText('No stocks match all 2 filters')).toBeNull()
  // it asked only the live column: the coverage receipt already speaks for the rest
  const asked = globalThis.fetch.mock.calls.flatMap(([, init]) => JSON.parse(init.body).specs)
  expect(asked.some(s => s.filters?.[0]?.key === 'price' && s.filters[0].min === PRESENCE_MIN)).toBe(false)
})
test('in the session the same zero is the market answering', async () => {
  answer(2400)
  show()
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByText('No stocks match all 2 filters')).toBeInTheDocument())
  expect(screen.queryByText(/Not available yet/)).toBeNull()
})
test('a scan where no row could be checked says "not available yet" with the count', async () => {
  answer(2400)
  show({ spec: { filters: [{ key: 'price', op: 'gte', min: 5 }] }, coverage: { evaluated: 5787, answered: 0, not_computable: 5787, dropped: 0 } })
  expect(screen.getByText('Not available yet')).toBeInTheDocument()
  expect(screen.getByText(/None of the 5,787 stocks has a value for every filter on this screen yet/)).toBeInTheDocument()
})

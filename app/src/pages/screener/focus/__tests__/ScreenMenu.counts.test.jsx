// The screen menu's counts through the REAL count cache (useLazyCounts), network mocked at fetch.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
import ScreenMenu from '../ScreenMenu'
import { __resetCountCache } from '../useLazyCounts'

const starters = [
  { id: 'lead', name: 'Leaders', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 90 }] } },
  { id: 'uct50', name: 'UCT 50', spec: { filters: [], rank: { criteria: [{ key: 'uct_composite', weight: 1 }], top_n: 50 } } },
  { id: 'semis', name: 'Semis list', spec: { filters: [{ key: 'list', op: 'in', value: 'wl:3', label: 'Semis' }] } },
]
const props = { currentName: 'Leaders', currentId: 'lead', count: 10, isEdited: false, starters, saved: [], pinned: [],
  onTogglePin: vi.fn(), onApply: vi.fn(), onSaveAsNew: null, onNewScreen: vi.fn(), myScans: [], onUseScan: vi.fn() }
const UCT = [{ key: 'universe', op: 'eq', value: 'uct', label: 'UCT Universe' }]
let bodies
// The fake server answers each spec with a number that encodes what it was asked:
// 120 for the whole market, 21 inside the UCT universe, 312 eligible for the ranked screen, 7 for a list.
const answer = sp => {
  const inUct = (sp.filters || []).some(f => f.key === 'universe' && f.value === 'uct')
  const base = (sp.filters || []).some(f => f.key === 'list') ? 7 : sp.rank ? 312 : 120
  return inUct ? base - 99 : base
}
const serve = specs => ({ ok: true, json: async () => ({ counts: specs.map(sp => ({ count: answer(sp) })) }) })
beforeEach(() => {
  __resetCountCache()
  bodies = []
  globalThis.fetch = vi.fn(async (url, o) => {
    const b = JSON.parse(o.body)
    bodies.push(...b.specs)
    return serve(b.specs)
  })
})
const rowOf = name => screen.getByRole('button', { name: new RegExp(`^Open ${name}`) }).closest('div')

test('S3: screens are counted in the member universe; a screen with its own list keeps it', async () => {
  render(<ScreenMenu {...props} pool={UCT} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  await waitFor(() => expect(within(rowOf('Leaders')).getByText('21')).toBeInTheDocument())
  const keys = bodies.map(b => b.filters.map(f => f.key).join(','))
  expect(keys).toContain('rs_rank,universe')
  expect(keys).toContain('list')
  expect(within(rowOf('Semis list')).getByText('7')).toBeInTheDocument()
})
test('S3: changing the universe re-asks, and never shows the other universe count meanwhile', async () => {
  let release
  const { rerender } = render(<ScreenMenu {...props} pool={[]} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  await waitFor(() => expect(within(rowOf('Leaders')).getByText('120')).toBeInTheDocument())
  globalThis.fetch = vi.fn(() => new Promise(r => { release = r }))
  rerender(<ScreenMenu {...props} pool={UCT} />)
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(within(rowOf('Leaders')).queryByText('120')).toBeNull()
  release(serve(JSON.parse(fetch.mock.calls[0][1].body).specs))
  await waitFor(() => expect(within(rowOf('Leaders')).getByText('21')).toBeInTheDocument())
})
test('S2: a ranked screen is counted at its top_n in the menu', async () => {
  render(<ScreenMenu {...props} pool={[]} />)
  fireEvent.click(screen.getByRole('button', { name: /Leaders/ }))
  await waitFor(() => expect(within(rowOf('UCT 50')).getByText('50')).toBeInTheDocument())
  expect(within(rowOf('UCT 50')).queryByText('312')).toBeNull()
})

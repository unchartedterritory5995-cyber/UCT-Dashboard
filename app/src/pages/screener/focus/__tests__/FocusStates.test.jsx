import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, expect, test, beforeEach } from 'vitest'
import { EmptyState, ErrorState, ListSkeleton } from '../FocusStates'
import { MAX_DROP_PILLS } from '../drawerFilters'
import { __resetCountCache } from '../useLazyCounts'

const BATCH = '/api/screener/count/batch'
const META = { filters: [
  { key: 'rs_rank', label: 'RS Rank', type: 'range', presets: [] },
  { key: 'price', label: 'Price', type: 'range', unit: '$', presets: [] },
  { key: 'dollar_vol_30d', label: 'Dollar Volume (30d)', type: 'range', unit: '$', presets: [] },
] }
const specOf = filters => ({ filters, sort: { key: 'rs_rank', dir: 'desc' }, view: 'overview' })
const SPEC = specOf([
  { key: 'universe', op: 'eq', value: 'uct', label: 'UCT Universe' },
  { key: 'rs_rank', op: 'gte', min: 90 },
  { key: 'price', op: 'gte', min: 10 },
  { key: 'dollar_vol_30d', op: 'gte', min: 20000000 },
])
const emptyWith = props => render(<EmptyState filterCount={3} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} spec={SPEC} meta={META} {...props} />)
beforeEach(() => { __resetCountCache(); globalThis.fetch = vi.fn() })

test('empty names the emptying change and offers undo', () => {
  const onUndo = vi.fn()
  render(<EmptyState filterCount={5} lastChange={{ label: '8-wk gain ≥ 200%', from: 31 }} onUndo={onUndo} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match all 5 filters')).toBeInTheDocument()
  expect(screen.getByText(/took the list from 31 to 0/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo that change' }))
  expect(onUndo).toHaveBeenCalled()
})
test('empty without a known change has no undo', () => {
  render(<EmptyState filterCount={1} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match this filter')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Undo that change' })).toBeNull()
})
test('error has one action', () => {
  const onRetry = vi.fn()
  render(<ErrorState message="The server took too long to answer." onRetry={onRetry} />)
  expect(screen.getByRole('alert')).toHaveTextContent("The screen didn't load")
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalled()
})
test('skeleton is announced as loading', () => {
  render(<ListSkeleton />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading results')
})

test('empty with zero filters names the screen, and is a status region', () => {
  render(<EmptyState filterCount={0} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} />)
  expect(screen.getByText('No stocks match this screen')).toBeInTheDocument()
  expect(screen.getByRole('status')).toBeInTheDocument()
})
test('error message and kept-filters note are two sentences whatever the punctuation', () => {
  const { rerender } = render(<ErrorState message="Timed out." onRetry={vi.fn()} />)
  expect(screen.getByText('Timed out.')).toBeInTheDocument()
  expect(screen.getByText('Your filters are kept.')).toBeInTheDocument()
  rerender(<ErrorState message="Timed out" onRetry={vi.fn()} />)
  expect(screen.getByText('Timed out.')).toBeInTheDocument()
  expect(screen.getByText('Your filters are kept.')).toBeInTheDocument()
  rerender(<ErrorState message="" onRetry={vi.fn()} />)
  expect(screen.getByText('Your filters are kept.')).toBeInTheDocument()
})

// P13: the empty state lists each active filter as a pill saying what removing it gives back.
test('each filter is a pill with "remove → N matches", counted in ONE batch request without that filter', async () => {
  fetch.mockImplementation(async (url, init) => {
    expect(url).toBe(BATCH)
    const { specs } = JSON.parse(init.body)
    return { ok: true, json: async () => ({ counts: specs.map(s => ({ count: 100 * s.filters.length })) }) }
  })
  emptyWith({ onRemoveFilter: vi.fn() })
  await waitFor(() => expect(screen.getAllByText(/remove → 300 matches/)).toHaveLength(3))
  expect(fetch).toHaveBeenCalledTimes(1)
  const { specs } = JSON.parse(fetch.mock.calls[0][1].body)
  // Each spec keeps the universe and the screen's sort/view, and drops exactly one filter.
  expect(specs.map(s => s.filters.map(f => f.key))).toEqual([
    ['universe', 'price', 'dollar_vol_30d'], ['universe', 'rs_rank', 'dollar_vol_30d'], ['universe', 'rs_rank', 'price']])
  expect(specs.every(s => s.sort?.key === 'rs_rank' && s.view === 'overview')).toBe(true)
  // The universe is the pool being searched, not a filter: no pill for it.
  expect(screen.queryByRole('button', { name: /^Remove UCT Universe/ })).toBeNull()
  expect(screen.getByRole('button', { name: 'Remove Dollar Volume (30d): ≥ $20M, 300 matches' })).toBeInTheDocument()
})
test('clicking a pill removes that filter', async () => {
  fetch.mockResolvedValue({ ok: true, json: async () => ({ counts: [{ count: 4 }, { count: 5 }, { count: 6 }] }) })
  const onRemoveFilter = vi.fn()
  emptyWith({ onRemoveFilter })
  fireEvent.click(await screen.findByRole('button', { name: /^Remove Price: ≥ \$10/ }))
  expect(onRemoveFilter).toHaveBeenCalledWith('price')
})
test('a failed or pending count never reads as 0; a real 0 does', async () => {
  let release
  fetch.mockImplementation(() => new Promise(r => { release = () => r({ ok: true, json: async () => ({ counts: [{ count: 0 }, { error: 'boom' }, {}] }) }) }))
  emptyWith({ onRemoveFilter: vi.fn() })
  expect(screen.getAllByText('remove → counting…')).toHaveLength(3)
  release()
  await waitFor(() => expect(screen.getByText('remove → 0 matches')).toBeInTheDocument())
  expect(screen.getAllByText('remove → count unavailable')).toHaveLength(2)
})
test(`at most ${MAX_DROP_PILLS} pills, the rest named as a count`, async () => {
  fetch.mockImplementation(async (url, init) => ({ ok: true, json: async () => ({ counts: JSON.parse(init.body).specs.map(() => ({ count: 1 })) }) }))
  const many = specOf(Array.from({ length: 11 }, (_, i) => ({ key: `f${i}`, op: 'gte', min: i })))
  render(<EmptyState filterCount={11} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} spec={many} meta={{ filters: [] }} onRemoveFilter={vi.fn()} />)
  await waitFor(() => expect(screen.getAllByText('remove → 1 match')).toHaveLength(MAX_DROP_PILLS))
  expect(screen.getByText('+3 more in Filters')).toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(JSON.parse(fetch.mock.calls[0][1].body).specs).toHaveLength(MAX_DROP_PILLS)
})
test('custom criteria gets a pill only when it can be removed', async () => {
  fetch.mockImplementation(async (url, init) => ({ ok: true, json: async () => ({ counts: JSON.parse(init.body).specs.map(() => ({ count: 7 })) }) }))
  const onRemoveLogic = vi.fn()
  const withLogic = { ...specOf([{ key: 'rs_rank', op: 'gte', min: 90 }]), logic: { any: [] } }
  render(<EmptyState filterCount={2} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} spec={withLogic} meta={META}
    onRemoveFilter={vi.fn()} onRemoveLogic={onRemoveLogic} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Custom criteria, 7 matches' }))
  expect(onRemoveLogic).toHaveBeenCalled()
  const { specs } = JSON.parse(fetch.mock.calls[0][1].body)
  expect(specs[1].logic).toBeUndefined()
})
test('without a remover there are no pills and no request', () => {
  render(<EmptyState filterCount={3} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} spec={SPEC} meta={META} />)
  expect(screen.queryByText(/remove →/)).toBeNull()
  expect(fetch).not.toHaveBeenCalled()
})

test('only the verdict is a live region: the pills sit outside role=status', async () => {
  fetch.mockImplementation(async (url, init) => ({ ok: true, json: async () => ({ counts: JSON.parse(init.body).specs.map(() => ({ count: 9 })) }) }))
  emptyWith({ onRemoveFilter: vi.fn() })
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('No stocks match all 3 filters')
  await screen.findAllByText('remove → 9 matches')
  for (const pill of screen.getAllByRole('button', { name: /^Remove / })) expect(status.contains(pill)).toBe(false)
  expect(status).not.toHaveTextContent(/remove →/)
})
test('after the screen changes, the remaining pills read "counting…" until their own counts land', async () => {
  const pending = []
  fetch.mockImplementation((url, init) => new Promise(r => {
    const n = JSON.parse(init.body).specs.length
    pending.push(c => r({ ok: true, json: async () => ({ counts: Array.from({ length: n }, () => ({ count: c })) }) }))
  }))
  const props = { filterCount: 3, lastChange: null, onUndo: vi.fn(), onOpenFilters: vi.fn(), meta: META, onRemoveFilter: vi.fn() }
  const { rerender } = render(<EmptyState {...props} spec={SPEC} />)
  pending.shift()(300)
  await waitFor(() => expect(screen.getAllByText('remove → 300 matches')).toHaveLength(3))
  // The member tightens RS Rank. The Price and Dollar Volume pills now describe a different
  // screen, so their old number must go; the RS Rank pill's spec (RS Rank removed) is unchanged.
  const tighter = specOf(SPEC.filters.map(f => (f.key === 'rs_rank' ? { ...f, min: 95 } : f)))
  rerender(<EmptyState {...props} spec={tighter} />)
  const gain = name => screen.getByRole('button', { name: new RegExp(`^Remove ${name}`) }).lastChild.textContent
  expect(gain('RS Rank')).toBe('remove → 300 matches')
  expect(gain('Price')).toBe('remove → counting…')
  expect(gain('Dollar Volume')).toBe('remove → counting…')
  await waitFor(() => expect(pending).toHaveLength(1))
  pending.shift()(12)
  await waitFor(() => expect(gain('Price')).toBe('remove → 12 matches'))
  expect(gain('Dollar Volume')).toBe('remove → 12 matches')
})
test('a ranked screen caps each pill at its top_n', async () => {
  fetch.mockImplementation(async (url, init) => ({ ok: true, json: async () => ({ counts: JSON.parse(init.body).specs.map(() => ({ count: 1240, top_n: 50 })) }) }))
  const ranked = { ...SPEC, rank: { criteria: [{ key: 'uct_composite' }], top_n: 50 } }
  render(<EmptyState filterCount={3} lastChange={null} onUndo={vi.fn()} onOpenFilters={vi.fn()} spec={ranked} meta={META} onRemoveFilter={vi.fn()} />)
  await waitFor(() => expect(screen.getAllByText('remove → 50 matches')).toHaveLength(3))
  expect(screen.queryByText(/1,240/)).toBeNull()
})

test('5: an empty state that answers the previous screen reads as waiting', () => {
  const { rerender } = render(<EmptyState filterCount={1} lastChange={null} onUndo={() => {}} onOpenFilters={() => {}} pending />)
  const box = screen.getByTestId('focus-empty')
  expect(box.className).toMatch(/stateBusy/)
  expect(box).toHaveAttribute('aria-busy', 'true')
  rerender(<EmptyState filterCount={1} lastChange={null} onUndo={() => {}} onOpenFilters={() => {}} />)
  expect(screen.getByTestId('focus-empty').className).not.toMatch(/stateBusy/)
})

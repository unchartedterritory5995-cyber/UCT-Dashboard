import { render, screen, fireEvent, within } from '@testing-library/react'
import { vi, beforeEach, expect, test } from 'vitest'
// One answer map for every count the menu asks: screens by id, presence probes by column.
const lazy = vi.hoisted(() => ({ counts: {} }))
vi.mock('../useLazyCounts', () => ({ default: () => lazy.counts }))
import ScreenMenu from '../ScreenMenu'

const META = { filters: [
  { key: 'rvol_live', label: 'Rel Volume (by now)', type: 'range', live_only: true },
  { key: 'implied_move_pct', label: 'Implied Move', type: 'range' },
  { key: 'rs_rank', label: 'RS Rank', type: 'range' },
] }
const starters = [
  { id: 'starter_volume_surge_now', name: 'Volume surge right now', spec: { filters: [{ key: 'rvol_live', op: 'gte', min: 2 }] } },
  { id: 'starter_implied', name: 'Implied', spec: { filters: [{ key: 'implied_move_pct', op: 'gte', min: 0 }] } },
  { id: 'starter_quiet', name: 'Quiet', spec: { filters: [{ key: 'rs_rank', op: 'gte', min: 99 }] } },
]
const props = { currentName: 'Quiet', currentId: 'starter_quiet', count: 0, isEdited: false, starters, saved: [],
  pinned: [], onTogglePin: vi.fn(), onApply: vi.fn(), onNewScreen: vi.fn(), myScans: [], onUseScan: vi.fn(), meta: META }
const open = () => { render(<ScreenMenu {...props} />); fireEvent.click(screen.getByRole('button', { name: /Quiet/ })) }

beforeEach(() => { vi.clearAllMocks() })

test('a zero from a live-only column outside the session says "live during the session"', () => {
  lazy.counts = { starter_volume_surge_now: 0, starter_implied: 0, starter_quiet: 0, rvol_live: 0, implied_move_pct: 0, rs_rank: 3000 }
  open()
  const live = screen.getByRole('button', { name: 'Open Volume surge right now, live during the session' }).parentElement
  expect(within(live).getByText('live during the session')).toHaveAttribute('data-reason', 'live')
  const missing = screen.getByRole('button', { name: 'Open Implied, not available yet' }).parentElement
  expect(within(missing).getByText('not available yet')).toHaveAttribute('data-reason', 'missing')
  // a column every stock holds: the zero is the market's, and says so
  expect(screen.getByRole('button', { name: 'Open Quiet, none today' })).toBeInTheDocument()
})
test('in the session the same zero is "none today"', () => {
  lazy.counts = { starter_volume_surge_now: 0, starter_implied: 4, starter_quiet: 2, rvol_live: 2900 }
  open()
  expect(screen.getByRole('button', { name: 'Open Volume surge right now, none today' })).toBeInTheDocument()
})
test('while the probe is unanswered the row keeps its plain zero, never a guessed reason', () => {
  lazy.counts = { starter_volume_surge_now: 0, starter_implied: 4, starter_quiet: 2 }
  open()
  expect(screen.getByRole('button', { name: 'Open Volume surge right now, none today' })).toBeInTheDocument()
})
test('without meta nothing is probed and the old words stand', () => {
  lazy.counts = { starter_volume_surge_now: 0, starter_implied: 4, starter_quiet: 2, rvol_live: 0 }
  render(<ScreenMenu {...props} meta={null} />)
  fireEvent.click(screen.getByRole('button', { name: /Quiet/ }))
  expect(screen.getByRole('button', { name: 'Open Volume surge right now, none today' })).toBeInTheDocument()
})

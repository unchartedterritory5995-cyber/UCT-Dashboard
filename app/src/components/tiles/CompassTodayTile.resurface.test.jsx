import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

// Wave 13 lane 13D — a resurfacing insight on the "Compass noticed" feed carries a door to
// the note it brought back (`link`, attached server-side only while the flag is on). The tile
// follows ONLY the Notebook's own `?note=` door; anything else in that field renders nothing,
// and an insight without one (flag off) renders exactly as before.

const h = vi.hoisted(() => ({ data: undefined, mutate: () => {} }))

vi.mock('swr', () => ({
  default: (key) => {
    const k = String(key)
    if (k.includes('/api/voice/insights')) return { data: h.data, mutate: h.mutate }
    return { data: undefined, isLoading: false, mutate: () => {} }
  },
  useSWRConfig: () => ({ mutate: () => {} }),
}))
vi.mock('../../hooks/useRealtimeSession', () => ({
  default: () => ({ connect: vi.fn(), disconnect: vi.fn() }),
}))

import CompassTodayTile from './CompassTodayTile'

const NOW = new Date().toISOString()

function insight(over = {}) {
  return {
    id: 7, kind: 'note_level_touch', symbol: 'NVDA', importance: 7, dismissed_at: null, created_at: NOW,
    headline: 'NVDA reached 100.00, the stop you named',
    body: "In “NVDA swing plan” you named 100.00 as your stop on 2026-09-12. Here's what you thought then.",
    ...over,
  }
}

beforeEach(() => { h.data = undefined; h.mutate = vi.fn() })

test('a resurfacing insight is labelled Your Notes and opens the note at its version', () => {
  h.data = { insights: [insight({ link: '/journal/notebook?note=n1&resurfaceVersion=v1' })] }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.getByText('Your Notes')).toBeInTheDocument()
  const door = screen.getByRole('link', { name: 'Open what you wrote' })
  expect(door).toHaveAttribute('href', '/journal/notebook?note=n1&resurfaceVersion=v1')
})

test('no link (flag off) renders no door; the insight still reads', () => {
  h.data = { insights: [insight()] }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.getByText('NVDA reached 100.00, the stop you named')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Open what you wrote' })).toBeNull()
})

test('a link that is not the Notebook door is never followed', () => {
  h.data = { insights: [insight({ link: 'https://evil.example/journal/notebook?note=n1' })] }
  renderWithProviders(<CompassTodayTile />)
  expect(screen.queryByRole('link', { name: 'Open what you wrote' })).toBeNull()
})

// Desk "Discussion" links ride /api/community/desk-threads, which 503s while
// Community is off. The fetch is gated on /api/community/status `enabled` (the
// server's own `_enabled_for` reader), so Community-off sends NO request and
// the Desk renders without the links. Real SWR + a stubbed fetch: the assertion
// is on the wire, not on a mocked hook's key. The ON case is the control that
// proves this test can see the request at all.
import { render, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

vi.mock('../../components/mobile/Sheet', () => ({
  default: ({ children, title }) => <div data-testid="sheet">{title}{children}</div>,
}))
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'pro-user' } }),
}))
vi.mock('../../components/video/videoStore', () => ({ play: vi.fn(), minimize: vi.fn() }))
const mockProgress = {} // stable snapshot (useSyncExternalStore)
vi.mock('./videoProgress', () => ({
  subscribe: () => () => {},
  getSnapshot: () => mockProgress,
  hydrateFromServer: vi.fn(),
}))
vi.mock('../../components/video/VideoDockSlot', () => ({
  default: () => <div data-testid="dock-slot" />,
}))

import VideosSection from './VideosSection'

const videos = {
  total: 2,
  categories: [
    {
      name: 'Getting Started', kind: 'library', sort_order: 0, blurb: '',
      videos: [
        { id: 131, youtube_id: 'lib0000000a', title: 'Welcome to the Desk', description: '', category: 'Getting Started', tags: [] },
        { id: 156, youtube_id: 'lib0000000b', title: 'Breadth basics', description: '', category: 'Getting Started', tags: [] },
      ],
    },
  ],
}

let communityEnabled = false
let calls = []

const json = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    if (u === '/api/education/videos') return json(videos)
    if (u === '/api/community/status') return json({ enabled: communityEnabled })
    if (u.startsWith('/api/community/desk-threads')) {
      // What the server answers when Community is off — the request must not
      // be sent at all in that state.
      if (!communityEnabled) return json({ detail: 'Community is not enabled' }, 503)
      return json({ 131: { thread_id: 9, reply_count: 3 } })
    }
    if (u.startsWith('/api/education/paths')) return json({ paths: [] })
    return json(null, 404)
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const renderSection = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/']}>
        <VideosSection />
      </MemoryRouter>
    </SWRConfig>,
  )

const deskThreadCalls = () => calls.filter((u) => u.startsWith('/api/community/desk-threads'))

test('Community OFF: no desk-threads request is sent and the Desk still renders', async () => {
  communityEnabled = false
  renderSection()
  await screen.findAllByRole('button', { name: 'Play Welcome to the Desk' })
  // The status answer has landed (so the gate had its chance to open).
  await waitFor(() => expect(calls).toContain('/api/community/status'))
  await new Promise((r) => setTimeout(r, 50))
  expect(deskThreadCalls()).toEqual([])
  expect(screen.queryByText('3 replies')).toBeNull()
})

test('Community ON: the desk-threads request is sent and its links render (control)', async () => {
  communityEnabled = true
  renderSection()
  await waitFor(() => expect(deskThreadCalls()).toEqual(['/api/community/desk-threads?ids=131,156']))
  expect((await screen.findAllByText('3 replies')).length).toBeGreaterThan(0)
})

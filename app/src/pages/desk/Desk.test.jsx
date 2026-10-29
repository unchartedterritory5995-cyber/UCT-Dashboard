import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

// Stub the lazy section modules so they render synchronously in jsdom.
vi.mock('./VideosSection', () => ({ default: () => <div>VIDEOS_SECTION</div> }))
vi.mock('./ArticlesSection', () => ({ default: () => <div>ARTICLES_SECTION</div> }))
vi.mock('./PostsSection', () => ({ default: () => <div>POSTS_SECTION</div> }))
vi.mock('./TeamSection', () => ({ default: () => <div>TEAM_SECTION</div> }))
vi.mock('../traderArchive/TraderArchive', () => ({ default: () => <div>ARCHIVE_SECTION</div> }))

// The Archive tab is DARK with the archive: it reads `wisdomArchiveEnabled` off the auth payload.
const auth = { wisdomArchiveEnabled: false }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }))

// Search-params stub (no real router needed); a test may seed the URL and watch the writes.
const router = { params: new URLSearchParams(), setParams: vi.fn() }
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [router.params, router.setParams],
}))

import Desk from './Desk'

test('renders all four sub-tabs + brand tag', () => {
  render(<Desk />)
  expect(screen.getByText('The Desk')).toBeTruthy()
  for (const label of ['Videos', 'Articles', 'Posts', 'Team']) {
    expect(screen.getByRole('tab', { name: new RegExp(label) })).toBeTruthy()
  }
})

test('defaults to the Videos section', async () => {
  render(<Desk />)
  expect(await screen.findByText('VIDEOS_SECTION')).toBeTruthy()
})

test('switching tabs swaps the active section', async () => {
  render(<Desk />)
  fireEvent.click(screen.getByRole('tab', { name: /Team/ }))
  expect(await screen.findByText('TEAM_SECTION')).toBeTruthy()
  fireEvent.click(screen.getByRole('tab', { name: /Articles/ }))
  expect(await screen.findByText('ARTICLES_SECTION')).toBeTruthy()
})

// ── head start for the video library ────────────────────────────────────────
// Videos opens on a lazy chunk; without the head start the library request only
// leaves once that chunk has downloaded.
test('opening the Videos section starts the library request before the section loads', async () => {
  // A fresh swr: earlier tests in this file already started (and never consumed)
  // the same preload, and preload deliberately does not fetch a key twice.
  vi.resetModules()
  const { default: FreshDesk } = await import('./Desk')
  localStorage.removeItem('desk_section')   // the tab test above leaves 'articles' remembered
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = vi.fn((url) => { calls.push(String(url)); return new Promise(() => {}) })
  try {
    render(<FreshDesk />)
    expect(await screen.findByText('VIDEOS_SECTION')).toBeTruthy()   // control: really on Videos
    expect(calls).toContain('/api/education/videos')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('a section that never shows videos does not fetch the library', async () => {
  vi.resetModules()
  const { default: FreshDesk } = await import('./Desk')
  const calls = []
  const realFetch = globalThis.fetch
  globalThis.fetch = vi.fn((url) => { calls.push(String(url)); return new Promise(() => {}) })
  try {
    localStorage.setItem('desk_section', 'team')
    render(<FreshDesk />)
    expect(await screen.findByText('TEAM_SECTION')).toBeTruthy()
    expect(calls).not.toContain('/api/education/videos')
  } finally {
    localStorage.removeItem('desk_section')
    globalThis.fetch = realFetch
  }
})

// ── Archive: the TSDR trader archive, moved in from /trader-archive (2026-10-28) ──────────────
test('the Archive tab exists only while the archive is switched on', () => {
  auth.wisdomArchiveEnabled = false
  const { unmount } = render(<Desk />)
  expect(screen.getByRole('tab', { name: /Team/ })).toBeTruthy()        // control: the bar rendered
  expect(screen.queryByRole('tab', { name: /Archive/ })).toBeNull()
  unmount()
  auth.wisdomArchiveEnabled = true
  render(<Desk />)
  expect(screen.getByRole('tab', { name: /Archive/ })).toBeTruthy()
  auth.wisdomArchiveEnabled = false
})

test('a deep link opens the Archive and keeps its own params', async () => {
  auth.wisdomArchiveEnabled = true
  router.params = new URLSearchParams('section=archive&sym=ZZTA')
  router.setParams = vi.fn()
  try {
    render(<Desk />)
    expect(await screen.findByText('ARCHIVE_SECTION')).toBeTruthy()
    expect(router.setParams).not.toHaveBeenCalled()                     // already in sync: ?sym survives
  } finally {
    auth.wisdomArchiveEnabled = false
    router.params = new URLSearchParams()
  }
})

test('a deep link to the Archive while it is switched off lands on Videos', async () => {
  auth.wisdomArchiveEnabled = false
  router.params = new URLSearchParams('section=archive&sym=ZZTA')
  router.setParams = vi.fn()
  try {
    render(<Desk />)
    expect(await screen.findByText('VIDEOS_SECTION')).toBeTruthy()
    expect(screen.queryByText('ARCHIVE_SECTION')).toBeNull()
  } finally {
    router.params = new URLSearchParams()
  }
})

test('leaving a section drops its params: the Archive ?q never becomes the Articles search', () => {
  auth.wisdomArchiveEnabled = true
  router.params = new URLSearchParams('section=archive&view=search&q=flag')
  router.setParams = vi.fn()
  try {
    render(<Desk />)
    fireEvent.click(screen.getByRole('tab', { name: /Articles/ }))
    const next = router.setParams.mock.calls.at(-1)[0]
    expect(next.get('section')).toBe('articles')
    expect(next.get('q')).toBeNull()
    expect(next.get('view')).toBeNull()
  } finally {
    auth.wisdomArchiveEnabled = false
    router.params = new URLSearchParams()
  }
})

test('a first visit with no ?section keeps the params it came with (a /desk?v= video link)', () => {
  localStorage.removeItem('desk_section')
  router.params = new URLSearchParams('v=abc123')
  router.setParams = vi.fn()
  try {
    render(<Desk />)
    const next = router.setParams.mock.calls.at(-1)[0]
    expect(next.get('section')).toBe('videos')
    expect(next.get('v')).toBe('abc123')
  } finally {
    router.params = new URLSearchParams()
  }
})

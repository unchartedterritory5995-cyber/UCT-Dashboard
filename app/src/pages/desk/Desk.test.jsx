import { render, screen, fireEvent } from '@testing-library/react'
import { vi, test, expect } from 'vitest'

// Stub the lazy section modules so they render synchronously in jsdom.
vi.mock('./VideosSection', () => ({ default: () => <div>VIDEOS_SECTION</div> }))
vi.mock('./ArticlesSection', () => ({ default: () => <div>ARTICLES_SECTION</div> }))
vi.mock('./PostsSection', () => ({ default: () => <div>POSTS_SECTION</div> }))
vi.mock('./TeamSection', () => ({ default: () => <div>TEAM_SECTION</div> }))

// Stable search-params stub (no real router needed).
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
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

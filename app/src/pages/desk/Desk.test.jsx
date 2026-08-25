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

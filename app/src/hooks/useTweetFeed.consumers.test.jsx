// Quality pass 2026-10-05: useTweetFeed is shared by four surfaces. Each must tell a FAILED read
// apart from an empty feed, and each must still say "nothing yet" for a genuinely empty one.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen } from '../test-utils'

let feed
vi.mock('./useTweetFeed', () => ({ default: () => feed }))

import TapeFeed from '../components/tiles/TapeFeed'
import MoversSidebar from '../components/MoversSidebar'
import PostsSection from '../pages/desk/PostsSection'
import { OnTheTape } from '../pages/MorningWire'

const FAILED = "The tape couldn't be read right now. That is not the same as no tweets."
const MOVERS = { ripping: [{ sym: 'RNG', pct: '+3.40%' }], drilling: [] }

beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }))
})

describe('every tweet-feed surface tells a failed read from an empty feed', () => {
  it('TapeFeed (Dashboard)', () => {
    feed = { data: undefined, error: new Error('tweet feed 502') }
    const a = renderWithProviders(<TapeFeed />)
    expect(screen.getByText(FAILED)).toBeInTheDocument()
    a.unmount()
    feed = { data: [], error: undefined }
    renderWithProviders(<TapeFeed />)
    expect(screen.getByText('Nothing on the tape yet')).toBeInTheDocument()
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument()
  })

  it('MoversSidebar (the rail)', () => {
    feed = { data: undefined, error: new Error('tweet feed 502') }
    const a = renderWithProviders(<MoversSidebar data={MOVERS} />)
    expect(screen.getByText(FAILED)).toBeInTheDocument()
    expect(screen.queryByText('Nothing on the tape yet')).not.toBeInTheDocument()
    a.unmount()
    feed = { data: [], error: undefined }
    renderWithProviders(<MoversSidebar data={MOVERS} />)
    expect(screen.getByText('Nothing on the tape yet')).toBeInTheDocument()
  })

  it('Morning Wire "On the tape"', () => {
    feed = { data: undefined, error: new Error('tweet feed 502') }
    const a = renderWithProviders(<OnTheTape />)
    expect(screen.getByText(FAILED)).toBeInTheDocument()
    expect(screen.queryByText('No tweets on the tape yet')).not.toBeInTheDocument()
    a.unmount()
    feed = { data: [], error: undefined }
    renderWithProviders(<OnTheTape />)
    expect(screen.getByText('No tweets on the tape yet')).toBeInTheDocument()
  })

  it('The Desk "Posts"', () => {
    feed = { data: undefined, isLoading: false, error: new Error('tweet feed 502') }
    const a = renderWithProviders(<PostsSection />)
    expect(screen.getByText("Posts couldn't be loaded")).toBeInTheDocument()
    expect(screen.queryByText('No posts yet')).not.toBeInTheDocument()
    a.unmount()
    feed = { data: [], isLoading: false, error: undefined }
    renderWithProviders(<PostsSection />)
    expect(screen.getByText('No posts yet')).toBeInTheDocument()
    expect(screen.queryByText("Posts couldn't be loaded")).not.toBeInTheDocument()
  })

  it('a failed refresh over a populated feed keeps showing the tweets', () => {
    feed = { data: [{ id: '1', text: 'held over', url: 'x', created_at: new Date().toISOString() }], error: new Error('502') }
    renderWithProviders(<TapeFeed />)
    expect(screen.getByText('held over')).toBeInTheDocument()
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument()
  })
})

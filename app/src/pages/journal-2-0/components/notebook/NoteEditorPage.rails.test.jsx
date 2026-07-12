import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// A video note whose YouTube id resolves to a Desk library session — the
// editor should wrap the note column with the Desk theater's watch rails.
const NOTE = {
  id: 'n1', title: 'Workshop — Notes', subtitle: '', folderId: null,
  ticker: null, tags: [],
  heroImageUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  bodyJson: { type: 'doc', content: [] },
}

vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))
vi.mock('../../../../hooks/useDeskVideoByYoutube', () => ({
  useDeskVideoByYoutube: () => ({
    loading: false,
    video: { id: 7, title: 'Workshop with ChartMaster', youtube_id: 'abcdefghijk' },
  }),
}))
vi.mock('../../../../hooks/useVideoInsights', () => ({
  useVideoInsights: () => ({
    loading: false,
    chapters: [{ t: 0, title: 'Opening context' }],
    tickerMoments: [{ t: 61, ticker: 'GH' }],
    hasTranscript: true,
    headline: 'Sector rotation is the play',
    summary: ['Buy pullbacks into support'],
    setups: [{ setup: 'Bull Flag' }],
    posterUrl: '/api/education/videos/7/poster',
  }),
}))
vi.mock('../../../../components/TickerPopup', () => ({
  default: ({ children }) => <button type="button">{children}</button>,
}))
vi.mock('../../../../components/RsBadge', () => ({ default: () => null }))

beforeEach(() => {
  window.YT = { Player: class { constructor() { this.seekTo = vi.fn(); this.playVideo = vi.fn(); this.destroy = vi.fn() } } }
})
afterEach(() => { delete window.YT; vi.clearAllMocks() })

describe('NoteEditorPage watch rails', () => {
  it('wraps a Desk-session video note with chapters/recap/takeaways rails + transcript', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    // Left rail
    expect(screen.getByText('Chapters')).toBeInTheDocument()
    expect(screen.getByText('Opening context')).toBeInTheDocument()
    expect(screen.getByText('Setups covered')).toBeInTheDocument()
    expect(screen.getByText('Session recap')).toBeInTheDocument()
    // Right rail
    expect(screen.getByText('Key takeaways')).toBeInTheDocument()
    expect(screen.getByText('Tickers covered')).toBeInTheDocument()
    // Transcript search pill under the hero
    expect(screen.getByText('Search transcript')).toBeInTheDocument()
  })
})

import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Chart-parity round: the page must WIRE the one-authority settings stamp
// (widgetEmbedCore.stampChartSettings) — a helper that exists but is never
// called is the built-tested-green-and-unreachable class. Partial mock: every
// other core export stays real (the editor's extensions ride this module).
const stampSpy = vi.hoisted(() => vi.fn())
vi.mock('../../lib/widgetEmbedCore', async (orig) => {
  const mod = await orig()
  return {
    ...mod,
    stampChartSettings: (...args) => { stampSpy(...args); return mod.stampChartSettings(...args) },
  }
})

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
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
// NoteEditorPage reads useAuth (admin-only Share button) — these tests
// render it outside the app shell, so stub the provider read.
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
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

// Owner ask (chart-parity round): "a box or a row up at the top with the
// font, the print, and PNG stuff." The formatting cluster and the exports
// existed but were split across one crowded header line — this pins the
// dedicated toolbar ROW that groups them, discoverable as one surface.
describe('NoteEditorPage editor toolbar row', () => {
  it('groups the formatting cluster AND the PNG/Print exports in one labeled toolbar row', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    const row = await screen.findByRole('toolbar', { name: 'Editor toolbar' })
    const q = within(row)
    expect(q.getByLabelText('Font family')).toBeInTheDocument()
    expect(q.getByLabelText('Text size')).toBeInTheDocument()
    expect(q.getByText('B')).toBeInTheDocument()
    expect(q.getByText('H1')).toBeInTheDocument()
    expect(q.getByTitle('Download this note as a PNG image')).toBeInTheDocument()
    expect(q.getByTitle('Print — or Save as PDF from the print dialog')).toBeInTheDocument()
  })

  /**
   * ⛔⛔ EVERY TOOL BUTTON NEEDS AN ACCESSIBLE NAME — `ToolButton` sets
   * `aria-label={title}`, so a button with no `title` has NO accessible name
   * at all when its visible content is an `aria-hidden` UIcon (Link) or a
   * bare decorative dash (Horizontal rule) with no real text meaning. The
   * Image/Attach buttons right beside them already do this correctly.
   * Competitive audit finding UX #7, 2026-09-22.
   */
  it('the Link and Horizontal-rule buttons have accessible names, matching their Image/Attach neighbors', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    const row = await screen.findByRole('toolbar', { name: 'Editor toolbar' })
    const q = within(row)
    expect(q.getByLabelText('Insert link')).toBeInTheDocument()
    expect(q.getByLabelText('Horizontal rule')).toBeInTheDocument()
    // Controls — the two that already worked, so this is a real gap check, not a broken query
    expect(q.getByLabelText('Insert image')).toBeInTheDocument()
    expect(q.getByLabelText('Attach a file')).toBeInTheDocument()
  })

  /**
   * ⛔⛔ FIND HAD NO VISIBLE ENTRY POINT — Cmd/Ctrl+F was the only door.
   * History, right beside where this button now lives, has always had one.
   * Competitive audit finding UX #5, 2026-09-22.
   */
  it('a visible Find button opens NoteFindBar, the same as Ctrl+F', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    expect(screen.queryByRole('search', { name: 'Find in note' })).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: 'Find in note' }))
    expect(screen.getByRole('search', { name: 'Find in note' })).toBeInTheDocument()
  })
})

describe('NoteEditorPage widget palette', () => {
  it('the toolbar row opens the insert palette; closing it works', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    const { fireEvent } = await import('@testing-library/react')
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    const row = await screen.findByRole('toolbar', { name: 'Editor toolbar' })
    expect(screen.queryByRole('dialog', { name: 'Insert widget' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Insert widget' }))
    const panel = screen.getByRole('dialog', { name: 'Insert widget' })
    expect(within(panel).getByText('Chart')).toBeInTheDocument()
    fireEvent.click(within(panel).getByLabelText('Close insert panel'))
    expect(screen.queryByRole('dialog', { name: 'Insert widget' })).toBeNull()
  })
})

describe('NoteEditorPage chart-settings stamp', () => {
  it('wires stampChartSettings with the live editor once it exists', async () => {
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(<MemoryRouter><NoteEditorPage noteId="n1" onBack={() => {}} /></MemoryRouter>)
    await waitFor(() => {
      const withEditor = stampSpy.mock.calls.find(([ed]) => ed && typeof ed === 'object' && 'storage' in ed)
      expect(withEditor).toBeTruthy()
    })
  })
})

import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NoteRailLeft, NoteRailRight } from './NoteVideoRails'

vi.mock('../../../../components/TickerPopup', () => ({
  default: ({ children }) => <button type="button">{children}</button>,
}))
vi.mock('../../../../components/RsBadge', () => ({ default: () => null }))

const INSIGHTS = {
  loading: false,
  chapters: [{ t: 0, title: 'Opening context' }, { t: 553, title: 'Chart analysis' }],
  tickerMoments: [{ t: 61, ticker: 'GH', note: 'rotation' }, { t: 728, ticker: 'QQQ' }],
  hasTranscript: true,
  headline: 'Sector rotation is the play',
  summary: ['Buy pullbacks into support', 'Respect the stop'],
  setups: [{ setup: 'Bull Flag', note: '' }],
  posterUrl: '/api/education/videos/7/poster',
}

let seeks
const onSeek = (e) => seeks.push(e.detail?.seconds)
beforeEach(() => { seeks = []; window.addEventListener('uct:video-seek', onSeek) })
afterEach(() => { window.removeEventListener('uct:video-seek', onSeek) })

const leftRail = (insights = INSIGHTS) =>
  render(<MemoryRouter><NoteRailLeft insights={insights} /></MemoryRouter>)

describe('NoteRailLeft', () => {
  it('renders chapters and seeks the hero video on click', () => {
    leftRail()
    expect(screen.getByText('Chapters')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Chart analysis'))
    expect(seeks).toEqual([553])
  })

  it('renders setup chips deep-linking into the Setup Library', () => {
    leftRail()
    const chip = screen.getByText('Bull Flag')
    expect(chip.getAttribute('href')).toBe('/model-book?view=setups&setup=Bull%20Flag')
  })

  it('renders the session recap poster', () => {
    leftRail()
    const img = screen.getByAltText('Session recap poster')
    expect(img.getAttribute('src')).toBe('/api/education/videos/7/poster')
  })

  it('shows a chapters skeleton while insights load', () => {
    const { container } = leftRail({ ...INSIGHTS, loading: true, chapters: [], setups: [], posterUrl: null })
    expect(screen.getByText('Chapters')).toBeInTheDocument()
    expect(container.querySelectorAll('[class*="skelRow"]').length).toBeGreaterThan(0)
  })
})

describe('NoteRailRight', () => {
  it('renders key takeaways and the ticker cloud with seekable times', () => {
    render(<MemoryRouter><NoteRailRight insights={INSIGHTS} /></MemoryRouter>)
    expect(screen.getByText('Key takeaways')).toBeInTheDocument()
    expect(screen.getByText('Buy pullbacks into support')).toBeInTheDocument()
    expect(screen.getByText('Tickers covered')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument() // count badge
    fireEvent.click(screen.getByTitle('Jump to 1:01 in the video'))
    expect(seeks).toEqual([61])
  })

  it('collapses the ticker cloud from the header toggle', () => {
    render(<MemoryRouter><NoteRailRight insights={INSIGHTS} /></MemoryRouter>)
    expect(screen.getByText('GH')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /tickers covered/i }))
    expect(screen.queryByText('GH')).not.toBeInTheDocument()
  })
})

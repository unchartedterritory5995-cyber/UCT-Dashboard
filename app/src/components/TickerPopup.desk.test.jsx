// TickerPopup "Desk" tab (Phase 2B) — a view tab beside Chart/Fundamentals/
// Analyst/Ownership listing every Desk session that discussed this ticker
// (useTickerMentions), newest-first (server order). Row click deep-links back
// into the Desk player at that exact moment and closes the popup.
//
// Providers + mock idiom: copied from TickerPopup.anchor.test.jsx
// (renderWithProviders wraps AuthProvider/VoiceProvider/MemoryRouter; ChartPane
// mocked so the default Chart view never boots the real chart chunk).
// useTickerMentions is mocked directly (its own contract is covered by
// useTickerMentions.test.jsx) so this file stays focused on TickerPopup's
// wiring: the tab, the enabled-gating, and the row → navigate + close.
// react-router-dom is partially mocked (importOriginal) so MemoryRouter still
// works while useNavigate is spy-able — same idiom as PaywallTeaser.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { renderWithProviders, screen } from '../test-utils'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(),
  prefetchBars: vi.fn(),
  prefetchBar: vi.fn(),
  default: vi.fn(),
}))

vi.mock('./chart/pane/ChartPane', () => ({
  default: () => <div data-testid="pane-stub" />,
}))

const navigateSpy = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy }
})

const mentionsCalls = []
let mentionsReturn = { mentions: [], loading: false }
vi.mock('../hooks/useTickerMentions', () => ({
  useTickerMentions: (sym, opts) => {
    mentionsCalls.push([sym, opts])
    return mentionsReturn
  },
}))

import TickerPopup from './TickerPopup'

const MENTIONS = [
  {
    video_id: 501, youtube_id: 'nvdasession01', title: 'NVDA session — breadth day',
    anchor_date: '2026-02-11', t: 30, note: 'breaking out of the base',
  },
  {
    video_id: 480, youtube_id: 'nvdasession02', title: 'Evening Update — Jan 9',
    anchor_date: '2026-01-09', t: 725, note: null, // no note → falls back to title
  },
]

const openPopup = () => {
  renderWithProviders(<TickerPopup sym="NVDA">NVDA</TickerPopup>)
  fireEvent.click(screen.getByText('NVDA'))
}

const openDeskTab = () => {
  openPopup()
  fireEvent.click(screen.getByRole('tab', { name: 'Desk' }))
}

beforeEach(() => {
  navigateSpy.mockClear()
  mentionsCalls.length = 0
  mentionsReturn = { mentions: [], loading: false }
})

describe('TickerPopup Desk tab', () => {
  it('renders a Desk tab beside Chart/Fundamentals/Analyst/Ownership', () => {
    openPopup()
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Chart', 'Fundamentals', 'Analyst', 'Ownership', 'Desk'])
  })

  it('does not fetch mentions while the Chart tab is active', () => {
    openPopup()
    expect(mentionsCalls).toEqual([])
  })

  it('fetches (enabled) only once the Desk tab is selected', () => {
    mentionsReturn = { mentions: MENTIONS, loading: false }
    openDeskTab()
    expect(mentionsCalls.length).toBe(1)
    const [sym, opts] = mentionsCalls[0]
    expect(sym).toBe('NVDA')
    expect(opts.enabled).toBe(true)
  })

  it('shows a loading skeleton while mentions are in flight', () => {
    mentionsReturn = { mentions: [], loading: true }
    openDeskTab()
    expect(screen.getByText(/Loading Desk sessions/i)).toBeInTheDocument()
  })

  it('empty state reads "No Desk sessions have covered {SYM} yet."', () => {
    mentionsReturn = { mentions: [], loading: false }
    openDeskTab()
    expect(screen.getByText('No Desk sessions have covered NVDA yet.')).toBeInTheDocument()
  })

  it('renders rows newest-first in server order: anchor_date · note (fallback title)', () => {
    mentionsReturn = { mentions: MENTIONS, loading: false }
    openDeskTab()
    expect(screen.getByText('2026-02-11')).toBeInTheDocument()
    expect(screen.getByText('breaking out of the base')).toBeInTheDocument()
    expect(screen.getByText('2026-01-09')).toBeInTheDocument()
    // second mention has no note → falls back to its title
    expect(screen.getByText('Evening Update — Jan 9')).toBeInTheDocument()
    // server order preserved, no client re-sort
    const rows = screen.getByTestId('desk-mentions-list').querySelectorAll('button')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('2026-02-11')
    expect(rows[1].textContent).toContain('2026-01-09')
  })

  it('row click navigates to the exact deep-link URL and closes the popup', () => {
    mentionsReturn = { mentions: MENTIONS, loading: false }
    openDeskTab()
    fireEvent.click(screen.getByText('breaking out of the base').closest('button'))
    expect(navigateSpy).toHaveBeenCalledWith('/desk?section=videos&v=nvdasession01&t=30')
    expect(screen.queryByTestId('chart-modal')).not.toBeInTheDocument()
  })

  it('a title-fallback row also navigates with its own youtube_id/t', () => {
    mentionsReturn = { mentions: MENTIONS, loading: false }
    openDeskTab()
    fireEvent.click(screen.getByText('Evening Update — Jan 9').closest('button'))
    expect(navigateSpy).toHaveBeenCalledWith('/desk?section=videos&v=nvdasession02&t=725')
  })
})

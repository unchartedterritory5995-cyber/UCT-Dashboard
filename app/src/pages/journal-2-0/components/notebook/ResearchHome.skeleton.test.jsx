// VIS-5 (audit 2026-11-05): while Home's read is in flight it shows a HOME skeleton -- the header row (search
// box, New note) and two sections of rows -- so the page does not grow by a screen when the read lands. It was a
// title and two text lines (Home's measured CLS: 0.169 desktop, 0.220 phone).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

let loading = true
vi.mock('../../hooks/useNotebookHome', () => ({
  default: () => ({ home: loading ? null : { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }, isLoading: loading, error: null, refresh: vi.fn() }),
}))
vi.mock('./AskPanel', () => ({ default: () => null }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'

const renderHome = () => render(
  <SWRConfig value={{ provider: () => new Map() }}>
    <AuthContext.Provider value={{ isPaid: true }}>
      <MemoryRouter><ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} /></MemoryRouter>
    </AuthContext.Provider>
  </SWRConfig>,
)

describe('the Home skeleton', () => {
  it('has Home\'s shape: a header row, then two sections of three rows', () => {
    loading = true
    renderHome()
    const sk = screen.getByRole('status', { name: 'Loading…' })
    expect(sk).toHaveAttribute('data-home-skeleton')
    const [header, ...sections] = sk.children
    expect(header.children).toHaveLength(2)          // the search box and New note
    expect(sections).toHaveLength(2)
    for (const s of sections) expect(s.children).toHaveLength(4)   // a heading and three rows
  })

  it('CONTROL: once the read lands, the skeleton is gone', () => {
    loading = false
    renderHome()
    expect(document.querySelector('[data-home-skeleton]')).toBeNull()
  })
})

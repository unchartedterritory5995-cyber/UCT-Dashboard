// Finish program (fin-walk 8.3): "Research Home shows no Ask button for a member who has three
// notes and has not opened one yet (0 buttons before, 1 after opening them). The quiet state of
// the page leaves it out." Ask reads the whole Notebook, not the home's sections, so the door
// belongs in every state that has notes to ask about -- quiet, quiet-with-a-failed-read, and
// the full home -- and NOT in the first-run state, where there is nothing to ask.
//
// The door is ONE element at ONE tree position in all three states (ResearchHome.jsx), so a
// home that flips from quiet to full while an answer is open keeps the panel mounted. The
// AskPanel is replaced by a stateful stand-in here so the mount is observable: text typed into
// it survives the flip only if React kept the instance.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
let hookResult
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => hookResult }))
vi.mock('./AskPanel', () => ({
  default: function AskDoor({ scope }) {
    const [text, setText] = useState('')
    return (
      <div data-testid="ask-door" data-scope={scope}>
        <input aria-label="ask stand-in" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    )
  },
}))

import ResearchHome from './ResearchHome'

const tree = (props = {}) => (
  <MemoryRouter>
    <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} {...props} />
  </MemoryRouter>
)

beforeEach(() => {
  hookResult = { home: EMPTY, isLoading: false, error: null, refresh: vi.fn() }
})

describe('Research Home offers Ask in every state that has notes', () => {
  it('quiet state (notes exist, nothing qualifies for a section): the Ask door is there, scoped to the whole Notebook', () => {
    render(tree())
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
    expect(screen.getByTestId('ask-door')).toHaveAttribute('data-scope', 'notebook')
  })

  it('quiet state after a failed read: Ask is still offered (it does not depend on the home read)', () => {
    hookResult = { home: EMPTY, isLoading: false, error: new Error('boom'), refresh: vi.fn() }
    render(tree())
    expect(screen.getByTestId('ask-door')).toBeInTheDocument()
  })

  it('full home (a section has content): the door is there once, not twice', () => {
    hookResult = {
      home: { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    render(tree())
    expect(screen.getAllByTestId('ask-door')).toHaveLength(1)
  })

  it('first run (no notes at all): no Ask door -- there is nothing to ask about', () => {
    render(tree({ hasAnyNotes: false }))
    expect(screen.getByText('Welcome to your Notebook')).toBeInTheDocument()
    expect(screen.queryByTestId('ask-door')).toBeNull()
  })

  it('loading: no Ask door while the skeleton shows', () => {
    hookResult = { home: EMPTY, isLoading: true, error: null, refresh: vi.fn() }
    render(tree())
    expect(screen.queryByTestId('ask-door')).toBeNull()
  })

  it('quiet -> full keeps the same Ask instance mounted (what the member typed survives the flip)', () => {
    const { rerender } = render(tree())
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'ask stand-in' }), { target: { value: 'what did I write about NVDA?' } })
    hookResult = {
      home: { ...EMPTY, continueWorking: [{ id: 'n1', title: 'NVDA thesis', updatedAt: new Date().toISOString() }] },
      isLoading: false, error: null, refresh: vi.fn(),
    }
    rerender(tree())
    expect(screen.getByText('Continue working')).toBeInTheDocument()   // the layout DID flip
    expect(screen.getByRole('textbox', { name: 'ask stand-in' })).toHaveValue('what did I write about NVDA?')
  })
})

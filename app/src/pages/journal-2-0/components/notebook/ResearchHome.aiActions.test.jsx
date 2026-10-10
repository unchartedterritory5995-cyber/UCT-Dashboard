// Wave 11 lane 11C — "Ask Notebook to do something" keeps its state when Research Home flips
// between its quiet and full layouts. Found by the lane's real-browser walk: applying a change
// set refreshes the home, the home went from quiet to full, and a box mounted in each branch was
// remounted -- the applied list and its Undo button vanished mid-task.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
let home = EMPTY
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => ({ home, isLoading: false }) }))
vi.mock('./AskPanel', () => ({ default: () => <div>ask</div> }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

const tree = () => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ isPaid: true }}>
      <MemoryRouter>
        <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} />
      </MemoryRouter>
    </AuthContext.Provider>
  </SWRConfig>
)

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_ai_actions_enabled: true })
  home = EMPTY
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => __resetNotebookFlags())

describe('the AI actions box survives the home changing layout', () => {
  it('quiet -> full keeps what the member typed (and so a plan or an applied list)', async () => {
    const { rerender } = render(tree())
    expect(screen.getByText('Nothing needs your attention right now.')).toBeInTheDocument()
    // The box is a lazy chunk while its flag is on (landing 12-15 byte gate): wait for it once.
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Notebook to do something' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'What should Notebook do?' }), { target: { value: 'tag my NVDA notes' } })
    home = { ...EMPTY, favorites: [{ id: 'n1', title: 'NVDA thesis', updatedAt: new Date().toISOString() }] }
    rerender(tree())
    expect(screen.getByText('Favorites')).toBeInTheDocument()            // the layout DID flip
    expect(screen.getByRole('textbox', { name: 'What should Notebook do?' })).toHaveValue('tag my NVDA notes')
  })

  it('is absent from both layouts while the flag is off', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_ai_actions_enabled: false })
    // The box is a lazy chunk, so "absent right after render" alone could be a load not yet
    // finished. Let any chunk settle before each absence is read.
    const settle = () => act(() => new Promise((r) => setTimeout(r, 100)))
    const { rerender } = render(tree())
    await settle()
    expect(screen.queryByRole('button', { name: 'Ask Notebook to do something' })).toBeNull()
    home = { ...EMPTY, favorites: [{ id: 'n1', title: 'NVDA thesis', updatedAt: new Date().toISOString() }] }
    rerender(tree())
    await settle()
    expect(screen.queryByRole('button', { name: 'Ask Notebook to do something' })).toBeNull()
  })
})

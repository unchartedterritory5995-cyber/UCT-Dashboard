// P0.7 (owner decision, 2026-10-11): Research Home had TWO Ask doors -- "Ask Notebook to do
// something" under the Notices box and a lower Ask box -- and a member could not tell which to
// use. They are ONE labelled section now: the question box, then "Or tell Notebook what to
// change" for the member who wants an edit rather than an answer. ONE element at ONE tree
// position in the quiet, quiet-with-error and full home (ResearchHome.quietAsk.test.jsx proves
// the panel stays mounted across the flip).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
let hookResult
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => hookResult }))
vi.mock('./AskPanel', () => ({ default: () => <div data-testid="ask-panel-stub">ask</div> }))

import ResearchHome from './ResearchHome'
import { AuthContext } from '../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

function renderHome(props = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter>
          <ResearchHome hasAnyNotes onOpenNote={vi.fn()} onCreateNote={vi.fn()} onCreateThesis={vi.fn()} onImport={vi.fn()} {...props} />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}

const FULL = { ...EMPTY, favorites: [{ id: 'n1', title: 'Fav note', updatedAt: '2026-09-01T00:00:00Z' }] }

beforeEach(() => {
  __resetNotebookFlags()
  hookResult = { home: EMPTY, isLoading: false, error: null, refresh: vi.fn() }
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => __resetNotebookFlags())

describe('Research Home has one Ask section', () => {
  it('holds the question box and the change-it disclosure, and the old label is gone', async () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: true })
    renderHome()
    const sections = screen.getAllByRole('region', { name: 'Ask your Notebook' })
    expect(sections).toHaveLength(1)
    expect(within(sections[0]).getByTestId('ask-panel-stub')).toBeTruthy()
    // The disclosure is a lazy chunk while its flag is on: wait for it once.
    expect(await within(sections[0]).findByRole('button', { name: 'Or tell Notebook what to change' })).toBeTruthy()
    expect(screen.queryByText('Ask Notebook to do something')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ask Notebook to do something' })).toBeNull()
  })

  it('is the same single section in the full home, and in the quiet home after a failed read', async () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: true })
    hookResult = { home: FULL, isLoading: false, error: null, refresh: vi.fn() }
    const full = renderHome()
    expect(screen.getAllByRole('region', { name: 'Ask your Notebook' })).toHaveLength(1)
    expect(screen.getAllByTestId('ask-panel-stub')).toHaveLength(1)
    full.unmount()
    hookResult = { home: EMPTY, isLoading: false, error: new Error('boom'), refresh: vi.fn() }
    renderHome()
    expect(screen.getAllByRole('region', { name: 'Ask your Notebook' })).toHaveLength(1)
    expect(screen.getAllByTestId('ask-panel-stub')).toHaveLength(1)
  })

  it('sits ABOVE the quiet-state text and the Favorites section, right under the boxes at the top', () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: false })
    const quiet = renderHome()
    const quietSection = screen.getByRole('region', { name: 'Ask your Notebook' })
    const quietText = screen.getByText('Nothing needs your attention right now.')
    expect(quietSection.compareDocumentPosition(quietText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    quiet.unmount()
    hookResult = { home: FULL, isLoading: false, error: null, refresh: vi.fn() }
    renderHome()
    const fullSection = screen.getByRole('region', { name: 'Ask your Notebook' })
    const favorites = screen.getByText('Favorites')
    expect(fullSection.compareDocumentPosition(favorites) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('with the change-it flag off the section is just the question box (no disclosure, nothing empty)', async () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: false })
    renderHome()
    const section = screen.getByRole('region', { name: 'Ask your Notebook' })
    expect(within(section).getByTestId('ask-panel-stub')).toBeTruthy()
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Or tell Notebook what to change' })).toBeNull()
  })

  it('first run (no notes at all) has no Ask section -- there is nothing to ask about', () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: true })
    renderHome({ hasAnyNotes: false })
    expect(screen.queryByRole('region', { name: 'Ask your Notebook' })).toBeNull()
    expect(screen.queryByTestId('ask-panel-stub')).toBeNull()
  })
})

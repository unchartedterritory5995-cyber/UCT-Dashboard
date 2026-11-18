// The base tour's Replay (Help's Walkthroughs, the Support article's link: `state.startTour`).
//
// ⚰️ Wave 14, lane W14-C2 made this door wait, bounded (8 s), for step 1's anchor on an EMPTY notebook: that step was
// `first-run`, on Research Home's first-run screen, which painted after the notes loaded. Go-live wave 1 removed the
// step with Research Home, and the wait with it (brief C4: "so the tour opens at once"). This file is the evidence that
// the door now opens on its first step after the one paint moment (AUTO_START_DELAY_MS), empty notebook or not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour, { AUTO_START_DELAY_MS } from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY } from './tourCopy'
import { __resetTourControl } from './tourControl'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/auth/preferences' && (init.method || 'GET') === 'GET') {
      // a member who finished the tour long ago: only the Replay door can open it
      return { ok: true, status: 200, json: async () => ({ notebook_tour: JSON.stringify({ v: 1, state: 'done', step: null }) }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  installTourLayout()
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks(); vi.useRealTimers() })

/** A Notebook whose anchors are painted at once; the note count is known (`notesKnown`) or still loading. */
function Notebook({ hasNotes, notesKnown }) {
  return (
    <div>
      {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
      <NotebookTour hasAnyNotes={hasNotes} notesKnown={notesKnown} />
    </div>
  )
}

function Page(props) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={[{ pathname: '/journal/notebook', state: { startTour: true } }]}>
          <Routes><Route path="*" element={<Notebook {...props} />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

describe('Replay opens at once on step one (no wait for a first-run screen)', () => {
  it.each([
    ['an empty notebook', { hasNotes: false, notesKnown: true }],
    ['a notebook whose count is still loading', { hasNotes: false, notesKnown: false }],
    ['a member with notes', { hasNotes: true, notesKnown: true }],
  ])('%s: the card is up on step one right after the paint moment', async (_name, props) => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<Page {...props} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_START_DELAY_MS + 50) })
    const d = screen.getByRole('dialog')
    expect(d).toHaveAccessibleName(TOUR_STEP_COPY[TOUR_STEPS[0].id].title)
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument()
  })

  it('step one is the folders panel now (the first-run step left with Research Home)', () => {
    expect(TOUR_STEPS[0].id).toBe('sidebar')
    expect(TOUR_STEPS.some((s) => s.id === 'first-run')).toBe(false)
  })
})

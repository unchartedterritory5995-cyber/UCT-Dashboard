// Wave 14, lane W14-C2: the base tour's Replay on a COLD load opened at step 2.
//
// Cause (reproduced here before the fix): Help's Replay -- and the Support article's "Take
// the tour" link -- arrive with `state.startTour`, and NotebookTour opened the tour after a
// fixed AUTO_START_DELAY_MS on whatever anchors were on screen THEN. On a cold load the
// Notebook is still loading its notes at that moment: the sidebar is painted, the first-run
// screen (which carries step 1's `first-run` anchor) is not, so the tour began at step 2,
// "Folders and tags" (W14-0's walk.json, both widths).
//
// Fix: that door now waits, bounded, for step 1's anchor while it can still arrive -- the
// note count is unknown, or known to be zero. A member WITH notes never sees the first-run
// screen, so for them it opens exactly as before. The existing base-tour rails are
// unchanged; this file is the new evidence.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect, useState } from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour, { AUTO_START_DELAY_MS, REPLAY_FIRST_STEP_WAIT_MS } from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY } from './tourCopy'
import { __resetTourControl } from './tourControl'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

const FIRST = TOUR_STEPS[0]
const REST = TOUR_STEPS.slice(1).map((s) => s.anchor)

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
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

/** A cold Notebook: the sidebar's anchors are painted at once; the note count and the
 *  first-run screen arrive `lateMs` later. */
function ColdNotebook({ lateMs, hasNotes = false }) {
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), lateMs)
    return () => clearTimeout(t)
  }, [lateMs])
  return (
    <div>
      {REST.map((a) => <div key={a} data-tour={a}>anchor {a}</div>)}
      {loaded && !hasNotes && <div data-tour={FIRST.anchor}>Welcome to your Notebook</div>}
      <NotebookTour hasAnyNotes={loaded && hasNotes} notesKnown={loaded} />
    </div>
  )
}

function Page(props) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={[{ pathname: '/journal/notebook', state: { startTour: true } }]}>
          <Routes><Route path="*" element={<ColdNotebook {...props} />} /></Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

const dialog = () => screen.findByRole('dialog', {}, { timeout: 4000 })

describe('Replay on a cold load', () => {
  it('opens at STEP ONE when the first-run screen arrives after the door\'s first look', async () => {
    render(<Page lateMs={AUTO_START_DELAY_MS + 700} />)
    const d = await dialog()
    expect(d).toHaveAccessibleName(TOUR_STEP_COPY[FIRST.id].title)
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument()
  })

  it('a member WITH notes (no first-run screen) is not kept waiting: it opens on the first visible step', async () => {
    const started = Date.now()
    render(<Page lateMs={AUTO_START_DELAY_MS + 200} hasNotes />)
    const d = await dialog()
    expect(d).toHaveAccessibleName(TOUR_STEP_COPY[TOUR_STEPS[1].id].title)
    expect(Date.now() - started).toBeLessThan(REPLAY_FIRST_STEP_WAIT_MS)
  })

  it('the wait is bounded: a first-run screen that never comes still opens on what IS there', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<Page lateMs={10 * REPLAY_FIRST_STEP_WAIT_MS} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_START_DELAY_MS + REPLAY_FIRST_STEP_WAIT_MS + 500) })
      const d = screen.getByRole('dialog')
      expect(d).toHaveAccessibleName(TOUR_STEP_COPY[TOUR_STEPS[1].id].title)
    } finally {
      vi.useRealTimers()
    }
  })
})

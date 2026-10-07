// Finish program, lane FE round 2: does the wave-8 basics tour have the same history trap the
// registered tours had (finding I1)?
//
// It does not, and this file is the evidence. The base tour never navigates, and it removes
// `state.startTour` from the history entry (a replace) the moment it reads it
// (NotebookTour.jsx). So Back leaves it, Forward does not bring it back, and a reload does not
// replay it. Run over real history entries, with the real tour.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { __resetTourControl } from './tourControl'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

let here = null
let go = null
function Probe() { here = useLocation(); go = useNavigate(); return null }

function Notebook() {
  return (
    <div>
      {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
      <NotebookTour hasAnyNotes notesKnown />
    </div>
  )
}

function App({ entries, index }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={entries} initialIndex={index ?? entries.length - 1}>
          <Probe />
          <Routes>
            <Route path="/support" element={<h1>Help</h1>} />
            <Route path="/journal/notebook" element={<Notebook />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/auth/preferences' && (init.method || 'GET') === 'GET') {
      // finished long ago: only the Replay request can open it
      return { ok: true, status: 200, json: async () => ({ notebook_tour: JSON.stringify({ v: 1, state: 'done', step: null }) }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  installTourLayout()
  here = null
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const pause = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const REPLAY = { pathname: '/journal/notebook', state: { startTour: true, keep: 'me' } }

describe('the basics tour never traps navigation', () => {
  it('Help, Take the tour: the request is spent when read; Back leaves; Forward does not reopen', async () => {
    render(<App entries={['/support', REPLAY]} />)
    expect(await screen.findByRole('dialog', {}, { timeout: 4000 })).toBeInTheDocument()
    expect(here.pathname).toBe('/journal/notebook')
    expect(here.state).toEqual({ keep: 'me' })
    act(() => { go(-1) })
    await pause(300)
    expect(here.pathname).toBe('/support')          // one Back is enough: nothing was pushed
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { go(1) })
    await pause(1500)
    expect(here.pathname).toBe('/journal/notebook')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a reload of the page the tour opened on does not replay it', async () => {
    const first = render(<App entries={[REPLAY]} />)
    expect(await screen.findByRole('dialog', {}, { timeout: 4000 })).toBeInTheDocument()
    const restored = { pathname: here.pathname, search: here.search, state: here.state }
    first.unmount()
    __resetTourControl()
    render(<App entries={[restored]} />)
    await pause(1500)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

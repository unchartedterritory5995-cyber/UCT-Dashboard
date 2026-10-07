// Wave 14, lane W14-keys: where focus goes when the AUTO-started base tour closes.
//
// An auto-started tour has nothing focused to hand back to (focus was on <body>), so the
// wave-8 return left a keyboard member at the top of the document. With the wave-14 switch
// on, focus lands on the first-run heading instead, so the next Tab is "Start a note"
// (docs/notebook/wave14-keys.md). Off, the wave-8 behaviour is unchanged. And a tour that a
// member opened from a control still hands focus back to that control.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { openNotebookTour, __resetTourControl } from './tourControl'
import { FIRST_RUN_HEADING_ATTR } from './keyboardDoors'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

let server
beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  server = { prefs: {} }
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return { ok: true, status: 200, json: async () => server.prefs }
    if (url === '/api/auth/preferences' && method === 'POST') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
  installTourLayout()
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={['/journal/notebook']}>
          <Routes>
            <Route path="*" element={(
              <div>
                <h2 tabIndex={-1} {...{ [FIRST_RUN_HEADING_ATTR]: '' }}>Welcome to your Notebook</h2>
                <button type="button">Start a note</button>
                {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
                <NotebookTour hasAnyNotes={false} notesKnown />
              </div>
            )} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

const dialog = () => screen.findByRole('dialog', {}, { timeout: 2000 })
const heading = () => screen.getByRole('heading', { level: 2, name: 'Welcome to your Notebook' })

describe('closing the auto-started base tour (W14-keys)', () => {
  it('switch ON: Escape lands focus on the first-run heading, and the next Tab is "Start a note"', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    render(<Page />)
    await dialog()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(heading())
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Start a note' }))
  })

  it('switch ON: "Skip tour" lands focus on the heading too', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    render(<Page />)
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(heading())
  })

  it('switch OFF (onboarding only): the wave-8 behaviour -- focus is not moved to the heading', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    render(<Page />)
    await dialog()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).not.toBe(heading())
    expect(document.activeElement).toBe(document.body)
  })

  it('a tour a member opened from a control still hands focus back to THAT control', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    server.prefs = { notebook_tour: JSON.stringify({ v: 1, state: 'dismissed', step: null }) } // no auto-start
    render(<Page />)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    const opener = screen.getByRole('button', { name: 'Start a note' })
    opener.focus()
    act(() => { openNotebookTour() })
    await dialog()
    const user = userEvent.setup()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })

  it('never moves focus on mount (no tour was open)', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
    server.prefs = { notebook_tour: JSON.stringify({ v: 1, state: 'dismissed', step: null }) }
    render(<Page />)
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(document.activeElement).toBe(document.body)
  })
})

// Wave 8 final review, fix I-2: the tour's chunk can neither take the Notebook down nor
// reload the page, and it is fetched only when the tour is about to show.
//
// ⛔ The failing loader is handed in (`makeTourGate(load, 0)`), so each rail counts the
// fetches the gate actually made -- a loader that is never called and a loader that failed
// are different facts. Location mocking follows lib/lazyChunk.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { makeTourGate } from './NotebookTourGate'
import { openNotebookTour, __resetTourControl } from './tourControl'
import { TOUR_PREF } from './tourPref'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { RELOAD_FLAG } from '../../../../../utils/lazyWithRetry'
import { chunkRetry } from '../../../lib/lazyChunk'

const realLocation = window.location
const realImportUrl = chunkRetry.importUrl
const chunkError = () => new TypeError('Failed to fetch dynamically imported module: /assets/NotebookTour-abc123.js')
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

let prefs
function installFetch() {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/auth/preferences') return { ok: true, status: 200, json: async () => prefs }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const prefsRead = () => global.fetch.mock.calls.some(([u]) => u === '/api/auth/preferences')

const tourLoader = () => vi.fn(async () => ({ default: () => <p>the tour is open</p> }))

function Page({ Gate, hasAnyNotes = false, notesKnown = true, paid = true, route = '/journal/notebook' }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <MemoryRouter initialEntries={[route]}>
          <main>
            <h1>Your Notebook</h1>
            <button type="button">Start a note</button>
          </main>
          <Gate hasAnyNotes={hasAnyNotes} notesKnown={notesKnown} />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

let errorSpy
beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  prefs = {}
  installFetch()
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, reload: vi.fn(), href: String(realLocation.href) },
  })
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  try { sessionStorage.removeItem(RELOAD_FLAG) } catch { /* private mode */ }
  errorSpy.mockRestore()
  chunkRetry.importUrl = realImportUrl
  __resetNotebookFlags()
  __resetTourControl()
})

describe('a tour chunk that cannot load costs the tour, and nothing else', () => {
  it('a rejecting chunk import leaves the Notebook rendered and makes no reload', async () => {
    const load = vi.fn().mockRejectedValue(chunkError())
    // the error names the chunk, so the one retry imports it under a new specifier (wave-8
    // walk W7); here that retry fails too
    chunkRetry.importUrl = vi.fn().mockRejectedValue(chunkError())
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} />)
    // one in-place retry of the failed fetch, then the boundary -- never a reload
    await waitFor(() => expect(chunkRetry.importUrl).toHaveBeenCalledTimes(1))
    expect(load).toHaveBeenCalledTimes(1)
    await settle(60)
    expect(window.location.reload).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Your Notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start a note' })).toBeInTheDocument()
    expect(screen.queryByText('the tour is open')).toBeNull()
    // and it was the tour's own boundary that took the failure
    await waitFor(() => expect(errorSpy.mock.calls.some(([m]) => String(m).includes('[NotebookTourGate]'))).toBe(true))
    let flag = null
    try { flag = sessionStorage.getItem(RELOAD_FLAG) } catch { /* private mode */ }
    expect(flag).toBeNull() // the one-reload-per-session budget is untouched, too
    // still there once the failure has fully played out
    expect(screen.getByRole('heading', { level: 1, name: 'Your Notebook' })).toBeInTheDocument()
  })

  it('a module that throws while it evaluates: not retried, the same quiet outcome', async () => {
    const load = vi.fn().mockRejectedValue(new ReferenceError("Can't find variable: Iterator"))
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} />)
    await waitFor(() => expect(errorSpy.mock.calls.some(([m]) => String(m).includes('[NotebookTourGate]'))).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Your Notebook' })).toBeInTheDocument()
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('CONTROL: a chunk that loads renders the tour (the failing rails are not passing on silence)', async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} />)
    expect(await screen.findByText('the tour is open')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('the chunk is fetched only when the tour is about to show', () => {
  it('a member WITH notes, and no request, never fetches it', async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} hasAnyNotes />)
    await waitFor(() => expect(prefsRead()).toBe(true))
    await settle()
    expect(load).not.toHaveBeenCalled()
  })

  it('while the note count is still loading, nothing is fetched', async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} notesKnown={false} />)
    await waitFor(() => expect(prefsRead()).toBe(true))
    await settle()
    expect(load).not.toHaveBeenCalled()
  })

  it('a tour the member finished or dismissed is not fetched again on its own', async () => {
    for (const state of ['done', 'dismissed']) {
      prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state, step: null }) }
      installFetch()
      const load = tourLoader()
      const Gate = makeTourGate(load, 0)
      const { unmount } = render(<Page Gate={Gate} />)
      await waitFor(() => expect(prefsRead()).toBe(true))
      await settle()
      expect(load, state).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('an unpaid member (the tour is not for them) does not fetch it', async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} paid={false} />)
    await waitFor(() => expect(prefsRead()).toBe(true))
    await settle()
    expect(load).not.toHaveBeenCalled()
  })

  it('with the onboarding gate off, never', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: false })
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} />)
    await settle()
    act(() => { openNotebookTour() })
    await settle()
    expect(load).not.toHaveBeenCalled()
  })

  it('a new member the tour is for: fetched, and shown', async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} />)
    expect(await screen.findByText('the tour is open')).toBeInTheDocument()
  })

  it('"Take the tour" while the Notebook is open fetches it (a member with notes)', async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} hasAnyNotes />)
    await waitFor(() => expect(prefsRead()).toBe(true))
    await settle()
    expect(load).not.toHaveBeenCalled()
    act(() => { openNotebookTour() })
    expect(await screen.findByText('the tour is open')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a request made BEFORE the gate mounted is honoured', async () => {
    openNotebookTour()
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} hasAnyNotes />)
    expect(await screen.findByText('the tour is open')).toBeInTheDocument()
  })

  it("the help article's link (state.startTour) fetches it", async () => {
    const load = tourLoader()
    const Gate = makeTourGate(load, 0)
    render(<Page Gate={Gate} hasAnyNotes route={{ pathname: '/journal/notebook', state: { startTour: true } }} />)
    expect(await screen.findByText('the tour is open')).toBeInTheDocument()
  })
})

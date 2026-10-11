// The generic gate (wave 14, lane W14-0) -- mirrors NotebookTourGate.test.jsx's own
// coverage of `makeTourGate`, generalized to a REGISTRY of tours instead of one.
// This is the "one tiny test-only tour ... to prove multi-tour works" rail: a fake
// second tour, run through the SAME factory the production file exports, proving
// the mechanism generalizes beyond the single tour that ships today.
//
// The fake tour's `flag` borrows an EXISTING, unrelated dark-flag key already in
// `FLAG_FALLBACKS` (`notebookFlags.js`) purely as an available vehicle --
// `latchNotebookFlags` only latches keys it already knows, so a brand-new made-up
// key could never read as armed. This is a test fixture decision, not a claim
// about that capability.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { makeRegistryToursGate, TOUR_FAILED_NOTICE } from './RegistryToursGate'
import {
  REGISTRY_TOUR_CLOSED_EVENT, getRegistryTourWanted, hasPendingRegistryTourOpen, openRegistryTour, __resetRegistryTourControl,
} from './tourRegistryControl'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

const BORROWED_FLAG = 'notebook_template_gallery_enabled'
const TOUR_A = { id: 'w14-0-tour-a', flag: BORROWED_FLAG, title: 'Tour A', replayable: true }
const TOUR_B = { id: 'w14-0-tour-b', flag: BORROWED_FLAG, title: 'Tour B', replayable: true }

function installFetch() {
  global.fetch = vi.fn(async (url) => {
    if (url === '/api/auth/preferences') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

const engineLoader = () => vi.fn(async () => ({
  default: ({ entry, onClose }) => (
    <div role="dialog">
      {entry.title} is open
      <button type="button" onClick={onClose}>Close</button>
    </div>
  ),
}))

function Page({ Gate, tours, route = '/journal/notebook' }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[route]}>
        <main><h1>Your Notebook</h1></main>
        <Gate tours={tours} />
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [BORROWED_FLAG]: true })
  installFetch()
})
afterEach(() => {
  __resetNotebookFlags()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

describe('the failure notice points at Learn, where the walkthroughs start', () => {
  it('says Learn, not Help', () => {
    expect(TOUR_FAILED_NOTICE).toMatch(/start it again from Learn\.$/)
    expect(TOUR_FAILED_NOTICE).not.toMatch(/Help/)
  })
})

describe('multi-tour: the SAME generic gate opens either of two different registered tours by id', () => {
  it('opening tour A by id shows tour A, not tour B', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A, TOUR_B]} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { openRegistryTour('w14-0-tour-a') })
    expect(await screen.findByText('Tour A is open')).toBeInTheDocument()
    expect(screen.queryByText('Tour B is open')).toBeNull()
  })

  it('opening tour B by id shows tour B', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A, TOUR_B]} />)
    act(() => { openRegistryTour('w14-0-tour-b') })
    expect(await screen.findByText('Tour B is open')).toBeInTheDocument()
  })

  it('an id the gate was not handed is ignored (not in `tours`)', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('not-registered-here') })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the base tour\'s own id is never special-cased here -- it behaves like any other entry', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    const baseLikeEntry = { id: 'notebook-basics', flag: BORROWED_FLAG, title: 'Not the real base tour', replayable: true }
    render(<Page Gate={Gate} tours={[baseLikeEntry]} />)
    act(() => { openRegistryTour('notebook-basics') })
    expect(await screen.findByText('Not the real base tour is open')).toBeInTheDocument()
  })

  it('an empty tours list renders null and never subscribes to anything surprising', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(load).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a flag that is off: the tour is never fetched, even when asked for by id', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [BORROWED_FLAG]: false })
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(load).not.toHaveBeenCalled()
  })

  it('a request made BEFORE the gate mounted is honoured', async () => {
    openRegistryTour('w14-0-tour-a')
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    expect(await screen.findByText('Tour A is open')).toBeInTheDocument()
  })

  it('startRegistryTourId in navigation state opens that tour', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} route={{ pathname: '/journal/notebook', state: { startRegistryTourId: 'w14-0-tour-a' } }} />)
    expect(await screen.findByText('Tour A is open')).toBeInTheDocument()
  })

  it('closing (onClose) unmounts the dialog, and a second open still works', async () => {
    const load = engineLoader()
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await screen.findByText('Tour A is open')
    act(() => { screen.getByRole('button', { name: 'Close' }).click() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    act(() => { openRegistryTour('w14-0-tour-a') })
    expect(await screen.findByText('Tour A is open')).toBeInTheDocument()
  })
})

describe('a chunk that cannot load costs the tour, and nothing else (same contract as the base gate)', () => {
  it('a module that throws while it evaluates: not retried, the page stays rendered', async () => {
    // NOT a chunk-fetch error (NotebookTourGate.test.jsx's own second variant) -- this path
    // never reaches `chunkRetry.importUrl`, so nothing here needs to mock it.
    const load = vi.fn().mockRejectedValue(new ReferenceError("Can't find variable: Iterator"))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Gate = makeRegistryToursGate(load, 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await waitFor(() => expect(errorSpy.mock.calls.some(([m]) => String(m).includes('[RegistryToursGate]'))).toBe(true))
    expect(load).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Your Notebook' })).toBeInTheDocument()
    errorSpy.mockRestore()
  })
})

describe('W14-C1: a request for a tour whose capability is off is dropped, never held', () => {
  it('the one-tour slot is free again: a later request for an allowed tour opens', async () => {
    const OFF = { id: 'w14-c1-off', flag: 'notebook_formulas_enabled', title: 'Off tour', replayable: true }
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [BORROWED_FLAG]: true, notebook_formulas_enabled: false })
    const Gate = makeRegistryToursGate(engineLoader(), 0)
    render(<Page Gate={Gate} tours={[OFF, TOUR_A]} />)
    act(() => { openRegistryTour('w14-c1-off') })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { openRegistryTour('w14-0-tour-a') })
    expect(await screen.findByRole('dialog')).toHaveTextContent('Tour A is open')
  })
})

// Notebook UX pass: Research Home folds an empty box and a folded box's content is unmounted,
// so the gate publishes the tour it is running and Home unfolds its boxes while one is wanted.
describe('the gate publishes the tour it is running (Research Home unfolds for it)', () => {
  it('a tour that may run is published while it runs, and withdrawn when it closes', async () => {
    const Gate = makeRegistryToursGate(engineLoader(), 0)
    render(<Page Gate={Gate} tours={[TOUR_A, TOUR_B]} />)
    expect(getRegistryTourWanted()).toBeNull()
    act(() => { openRegistryTour('w14-0-tour-a') })
    expect(await screen.findByText('Tour A is open')).toBeInTheDocument()
    expect(getRegistryTourWanted()).toBe('w14-0-tour-a')
    act(() => { screen.getByRole('button', { name: 'Close' }).click() })
    await waitFor(() => expect(getRegistryTourWanted()).toBeNull())
  })

  it('a tour whose capability is off is never published', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, [BORROWED_FLAG]: false })
    const Gate = makeRegistryToursGate(engineLoader(), 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(getRegistryTourWanted()).toBeNull()
  })

  it('unmounting the gate withdraws it', async () => {
    const Gate = makeRegistryToursGate(engineLoader(), 0)
    const { unmount } = render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    expect(await screen.findByText('Tour A is open')).toBeInTheDocument()
    unmount()
    expect(getRegistryTourWanted()).toBeNull()
  })
})

// P0.3: a chart tour's card adds the sample notebook and then wants the SAME tour run again, now
// that a chart note exists. A bare "open this tour" request cannot do that while the engine is
// still the wanted one (close then re-open lands on the same id: React sees no change and the
// old engine, finished, stays mounted showing nothing). The engine says `restart` and the gate
// remounts a fresh one.
describe('a tour that restarts itself (the chart card, after it adds the sample notebook)', () => {
  /** An engine that counts its mounts and can ask for a restart or end plainly. */
  const restartingEngine = (mounts) => vi.fn(async () => ({
    default: function FakeEngine({ entry, onClose }) {
      useEffect(() => { mounts.push(entry.id) }, [entry.id])
      return (
        <div role="dialog">
          {entry.title} is open
          <button type="button" onClick={() => onClose({ opened: false, restart: true })}>Restart</button>
          <button type="button" onClick={() => onClose({ opened: true })}>End</button>
        </div>
      )
    },
  }))

  it('mounts a FRESH engine for the same tour, which stays the wanted one', async () => {
    const mounts = []
    const Gate = makeRegistryToursGate(restartingEngine(mounts), 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await screen.findByText('Tour A is open')
    expect(mounts).toEqual(['w14-0-tour-a'])
    act(() => { screen.getByRole('button', { name: 'Restart' }).click() })
    await waitFor(() => expect(mounts).toEqual(['w14-0-tour-a', 'w14-0-tour-a']))
    expect(screen.getByRole('dialog')).toHaveTextContent('Tour A is open')
    expect(getRegistryTourWanted()).toBe('w14-0-tour-a')
  })

  it('a restart is not an end: nothing announces the tour closed, and no request is left pending', async () => {
    const mounts = []
    const closed = vi.fn()
    window.addEventListener(REGISTRY_TOUR_CLOSED_EVENT, closed)
    const Gate = makeRegistryToursGate(restartingEngine(mounts), 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await screen.findByText('Tour A is open')
    act(() => { screen.getByRole('button', { name: 'Restart' }).click() })
    await waitFor(() => expect(mounts).toHaveLength(2))
    expect(closed).not.toHaveBeenCalled()
    expect(hasPendingRegistryTourOpen()).toBeFalsy()
    // the restarted tour then ends like any other
    act(() => { screen.getByRole('button', { name: 'End' }).click() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(closed).toHaveBeenCalledTimes(1)
    expect(closed.mock.calls[0][0].detail).toEqual({ tourId: 'w14-0-tour-a', opened: true })
    window.removeEventListener(REGISTRY_TOUR_CLOSED_EVENT, closed)
  })

  it('CONTROL: an ordinary close still ends the tour (the restart branch is not the default)', async () => {
    const mounts = []
    const Gate = makeRegistryToursGate(restartingEngine(mounts), 0)
    render(<Page Gate={Gate} tours={[TOUR_A]} />)
    act(() => { openRegistryTour('w14-0-tour-a') })
    await screen.findByText('Tour A is open')
    act(() => { screen.getByRole('button', { name: 'End' }).click() })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mounts).toHaveLength(1)
    expect(getRegistryTourWanted()).toBeNull()
  })
})

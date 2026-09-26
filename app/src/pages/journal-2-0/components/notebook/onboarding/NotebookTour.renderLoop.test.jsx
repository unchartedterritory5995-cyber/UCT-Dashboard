// H14 for the first-run tour (wave 8, lane 8C, C2; dispatch plan R8): mounted on a fixture
// page holding every anchor, run for 2 s of fake time with the tour OPEN, and its render
// count stays bounded. The precedent is CatalystTable.renderLoop.test.jsx: a render loop
// that never throws starves navigation, and only a count can see it.
//
// ⛔ The tour measures nothing; the anchor is outlined with an attribute once per step. The
// mutation proof for this rail puts a setState in a requestAnimationFrame loop into the tour
// and watches the count climb past the bound (the lane report quotes the red line).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour, { AUTO_START_DELAY_MS } from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { __resetTourControl } from './tourControl'
import { installTourLayout } from './__fixtures__/tourLayout'

/** Commits of the tour's subtree allowed across the whole run. Measured: 3 (all of them
 *  while it opens); a setState per animation frame adds one per 100 ms step (20). */
const BOUND = 10

let commits = 0
function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter>
          {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
          <Profiler id="tour" onRender={() => { commits += 1 }}>
            <NotebookTour hasAnyNotes={false} notesKnown />
          </Profiler>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date'] })
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  installTourLayout() // jsdom lays nothing out; the tour asks whether an anchor can be seen (M-7)
  commits = 0
})
afterEach(() => {
  vi.useRealTimers()
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('H14: the open tour does not render in a loop', () => {
  it(`stays under ${BOUND} commits across 2 s of fake time, open the whole while`, async () => {
    render(<Page />)
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_START_DELAY_MS + 50) })
    expect(screen.getByRole('dialog')).toBeInTheDocument()          // non-vacuity: it IS open
    const atOpen = commits
    for (let i = 0; i < 20; i += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    }
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(commits, `the tour committed ${commits} times (${atOpen} by the time it opened)`).toBeLessThan(BOUND)
    // and once open it is QUIET: nothing re-renders it while the member reads
    expect(commits - atOpen, `${commits - atOpen} commits while open and untouched`).toBeLessThanOrEqual(2)
  })
})

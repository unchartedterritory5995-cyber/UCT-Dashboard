// The first-run tour through 8A's axe harness (wave 8, lane 8C, C2) -- the rail file
// a11y/notebookSurfaces.js names for this surface (OTHER_LANES_OUTSIDE_POPULATION). The card
// portals to document.body, so the run is over the body (component level): the first step,
// and the last step with its help link.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { __resetTourControl } from './tourControl'
import { expectNoAxeViolations } from '../../../a11y/axeHarness'
import { installTourLayout } from './__fixtures__/tourLayout'

let restoreLayout = () => {}

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter>
          <main>
            {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
            <NotebookTour hasAnyNotes={false} notesKnown />
          </main>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  // The tour asks whether each anchor can be SEEN (fix M-7) and jsdom lays nothing out, so the
  // anchors get a box while the tour walks -- and lose it again before axe runs, so axe sees the
  // page exactly as it did before (every element one shared box would read as overlapping targets).
  restoreLayout = installTourLayout()
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('NotebookTour -- axe', () => {
  it('the first step: zero violations', async () => {
    render(<Page />)
    expect(await screen.findByRole('dialog', {}, { timeout: 2000 })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('the last step, with its help link: zero violations', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    for (let i = 1; i < TOUR_STEPS.length; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('link', { name: 'Read the Notebook help' })).toBeInTheDocument()
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })
})

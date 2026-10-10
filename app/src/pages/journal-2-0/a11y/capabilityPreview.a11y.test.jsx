// app/src/pages/journal-2-0/a11y/capabilityPreview.a11y.test.jsx
//
// Wave 14, lane W14-A: the first-run welcome's capability preview through 8A's axe harness --
// its own rail, never inherited from Research Home's (plan 5.4, risk R9). Each recipe proves
// the state it is about rendered before axe runs, so an empty screen can never pass as a clean
// one:
//   * capability-preview  -- every line armed, with the sample promotion, on its own;
//   * first-run-welcome   -- inside the real first-run screen, with "See what it can do"
//                            opened (the preview is folded and a lazy chunk there), the sample
//                            button described by the promotion, and the Learn menu open.
// OUTSIDE_POPULATION_SURFACES (notebookSurfaces.js) names this file for CapabilityPreview.jsx.
import { describe, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import CapabilityPreview from '../components/notebook/onboarding/CapabilityPreview'
import ResearchHome from '../components/notebook/ResearchHome'
import { CAPABILITY_PREVIEW, PREVIEW_COPY } from '../components/notebook/onboarding/capabilityList'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../hooks/useNotebookHome', () => ({
  default: () => ({ home: { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }, isLoading: false }),
}))

const ALL_ON = Object.fromEntries(CAPABILITY_PREVIEW.map((c) => [c.flag, true]))

beforeEach(() => {
  __resetNotebookFlags()
  // integration ruling: the preview rides the checklist's gate (onboarding AND getting-started)
  latchNotebookFlags({ ...ALL_ON, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('capability preview -- axe', () => {
  axeSurface('capability-preview', async () => {
    const { container } = render(<main><CapabilityPreview canAddSample promoId="w14a-promo" /></main>)
    expect(screen.getAllByRole('listitem')).toHaveLength(CAPABILITY_PREVIEW.length)
    expect(document.getElementById('w14a-promo')).toHaveTextContent(PREVIEW_COPY.sampleTail)
    return { root: container }
  })

  axeSurface('first-run-welcome', async () => {
    const { container } = render(
      <Providers>
        <main>
          <ResearchHome hasAnyNotes={false} onOpenNote={vi.fn()} onCreateNote={vi.fn()}
            onCreateThesis={vi.fn()} onImport={vi.fn()} onOpenToday={vi.fn()} />
        </main>
      </Providers>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'See what it can do' }))
    expect(await screen.findByRole('list', { name: PREVIEW_COPY.heading })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add a sample notebook' }))
      .toHaveAccessibleDescription(new RegExp(PREVIEW_COPY.sampleLead.replace('?', '\\?')))
    // the Learn menu, open, is part of the same screen
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    expect(screen.getByRole('menu', { name: 'Learn: walkthroughs' })).toBeInTheDocument()
    return { root: container }
  })
})

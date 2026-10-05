// app/src/pages/journal-2-0/a11y/tourOffer.a11y.test.jsx
//
// Wave 14, lane W14-C2: the "new in your Notebook" offer card through 8A's axe harness --
// its own rail, never inherited (plan 5.4, risk R9). Each recipe proves the card rendered
// before axe runs, so an empty screen cannot pass as a clean one:
//   * tour-offer-prompt     -- the card on its own, inside <main>;
//   * tour-offer-in-slot    -- the REAL gate, offering a fake registered tour into a
//                              Layout-shaped first-run slot.
// OUTSIDE_POPULATION_SURFACES (notebookSurfaces.js) names this file for TourOfferPrompt.jsx
// and TourOfferGate.jsx (both under components/notebook/onboarding/, outside the derived
// population, like CapabilityPreview.jsx).
import { describe, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { axeSurface } from './surface'
import { AuthContext } from '../../../context/AuthContext'
import { registerFirstRunSlot } from '../../../components/firstRun/firstRunStage'
import TourOfferPrompt from '../components/notebook/onboarding/TourOfferPrompt'
import TourOfferGate from '../components/notebook/onboarding/TourOfferGate'
import { OFFER_COPY } from '../components/notebook/onboarding/tourOfferCopy'
import { __resetOfferSession } from '../components/notebook/onboarding/tourEligibility'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const FLAG = 'notebook_template_gallery_enabled'
const ENTRY = { id: 'c2-a11y', flag: FLAG, title: 'Template gallery', replayable: true, load: async () => ({}) }

beforeEach(() => {
  __resetNotebookFlags()
  __resetOfferSession()
  latchNotebookFlags({ notebook_onboarding_enabled: true, [FLAG]: true })
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
})
afterEach(() => { __resetNotebookFlags(); __resetOfferSession(); registerFirstRunSlot(null); vi.restoreAllMocks() })

describe('tour offer -- axe', () => {
  axeSurface('tour-offer-prompt', async () => {
    const { container } = render(<main><TourOfferPrompt entry={ENTRY} onAccept={vi.fn()} onLater={vi.fn()} /></main>)
    expect(screen.getByRole('region', { name: OFFER_COPY.title('Template gallery') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: OFFER_COPY.accept })).toBeInTheDocument()
    return { root: container }
  })

  axeSurface('tour-offer-in-slot', async () => {
    const { container } = render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <AuthContext.Provider value={{ isPaid: true }}>
          <main>
            <h1>Your Notebook</h1>
            <div ref={registerFirstRunSlot} />
            <TourOfferGate tours={[ENTRY]} hasAnyNotes notesKnown />
          </main>
        </AuthContext.Provider>
      </SWRConfig>,
    )
    expect(await screen.findByRole('region', { name: OFFER_COPY.title('Template gallery') }, { timeout: 3000 })).toBeInTheDocument()
    return { root: container }
  })
})

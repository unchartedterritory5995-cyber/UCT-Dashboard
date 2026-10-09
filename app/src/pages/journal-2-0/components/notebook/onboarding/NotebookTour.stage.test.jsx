// Wave 10 follow-up F5: the first-run tour holds the first-run STAGE for exactly as
// long as its card is open, so the voice orb's "Meet Compass" card waits behind it.
//
// proof walk 10E-1 6b: on a new member's first visit the tour card covered "Meet
// Compass"'s "Got it" at 390, 820 and 1200 -- two first-run moments seated in the same
// corner at the same time. The rule is SEQUENCE: the tour first, the card after it.
// FloatingOrb.coachmark.test.jsx rails the card's side; this file rails the tour's.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { __resetTourControl } from './tourControl'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'
import { isFirstRunStageHeld } from '../../../../../components/firstRun/firstRunStage'
import { whenWritesSettle } from '../../../../../hooks/usePreferences'
import { TOUR_PREF } from './tourPref'

let prefs
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return { ok: true, status: 200, json: async () => prefs }
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      prefs = { ...prefs, [key]: value }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

function Page() {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: true }}>
        <MemoryRouter initialEntries={['/journal/notebook']}>
          {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
          <NotebookTour hasAnyNotes={false} notesKnown />
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  prefs = {}
  installFetch()
  installTourLayout()
})
// ⚰️ 2026-10-09 (verify-1009): since 2c902624e4 every preference save runs through a per-key
// queue (usePreferences `queueWrite`), so the tour's "done"/"dismissed" POST from one test can
// leave AFTER the next test's beforeEach has reset `prefs` and installed its fetch. That late
// POST then wrote "done" into the NEXT test's fake server, and its tour never auto-started
// (red on master; green at the 10/07 gate). Wait for this file's own writes before the next
// test begins: the leak is the test's, and the product's queue is correct.
afterEach(async () => {
  await whenWritesSettle([TOUR_PREF])
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

const dialog = () => screen.findByRole('dialog', {}, { timeout: 2000 })

describe('NotebookTour holds the first-run stage while it is open', () => {
  it('holds it from the moment the card opens, and lets go on Skip', async () => {
    render(<Page />)
    expect(isFirstRunStageHeld(), 'nothing open yet').toBe(false)
    await dialog()
    expect(isFirstRunStageHeld(), 'the tour is on screen').toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(isFirstRunStageHeld(), 'the card may show now').toBe(false)
  })

  it('keeps holding it while the member steps through, and lets go on Done', async () => {
    render(<Page />)
    await dialog()
    for (let i = 1; i < TOUR_STEPS.length; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      expect(isFirstRunStageHeld(), `still held at step ${i + 1}`).toBe(true)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(isFirstRunStageHeld()).toBe(false)
  })

  it('lets go if the page unmounts with the tour open (a member navigates away)', async () => {
    const { unmount } = render(<Page />)
    await dialog()
    expect(isFirstRunStageHeld()).toBe(true)
    unmount()
    expect(isFirstRunStageHeld()).toBe(false)
  })

  it('control: a tour that never opens never holds the stage', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: false })
    render(<Page />)
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(isFirstRunStageHeld()).toBe(false)
  })
})

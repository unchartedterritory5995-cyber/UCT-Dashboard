// Finish program, lane FE2, finding P3 — when does the resurfacing explainer show?
//
// A browser walk never saw it, on a member who had hidden "Get started" and answered one tour
// offer with "Not now". The question was whether either of those suppresses it. Neither does.
// The rule (docs/notebook/wave14-w14-c1.md, section f) is ONE thing: the explainer is shown once
// per member, and "shown" is recorded the moment it appears (a `started` row), not when "Got it"
// is pressed. The walk opened the sheet, counted before the explainer had loaded, closed the
// sheet, and from then on the same member had already been shown it.
//
// This file makes that rule explicit, with the REAL gate, the REAL engine and the REAL registry
// entry (`note-resurfaces`), so each half can be seen to hold:
//   * hiding Get started does not suppress it; a declined offer for ANOTHER tour does not either;
//   * it is shown once: the row is written when it appears, and any row means never again;
//   * with the wave-14 onboarding switch off it does not show at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { makeRegistryToursGate } from './RegistryToursGate'
import GenericTourEngine from './GenericTourEngine'
import { OTHER_TOURS, getTourEntry } from './tourRegistry'
import { openRegistryTour, __resetRegistryTourControl } from './tourRegistryControl'
import { TOURS_PREF } from './tourSeenState'
import { CHECKLIST_PREF } from './gettingStartedPref'
import { writeOfferSession, __resetOfferSession } from './tourEligibility'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

const ID = 'note-resurfaces'
let prefs
let writes
let rowPuts
function installFetch() {
  writes = []
  rowPuts = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return { ok: true, status: 200, json: async () => prefs }
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      prefs = { ...prefs, [key]: value }
      writes.push({ key, value: JSON.parse(value) })
      return { ok: true, status: 200, json: async () => ({}) }
    }
    // the seen-state row has its own door: one PUT per tour (tourSeenState.js)
    if (method === 'PUT') rowPuts.push({ url: String(url), body: JSON.parse(init.body) })
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

const Gate = makeRegistryToursGate(async () => ({
  default: (props) => <GenericTourEngine {...props} startWaitMs={400} stepWaitMs={200} />,
}), 0)

/** The "What you wrote then" sheet, as far as the explainer cares: its two anchors, and the
 *  one call the real sheet makes when the version has rendered. */
function SheetStandIn() {
  return (
    <div role="dialog" aria-modal="true" aria-label="What you wrote then">
      <p data-tour="resurface-then">Saved then.</p>
      <button type="button" data-tour="resurface-back">Back to the note as it is now</button>
    </div>
  )
}
function App({ sheet = true }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={['/journal/notebook?note=n1&resurfaceVersion=v1']}>
        {sheet && <SheetStandIn />}
        <Gate tours={OTHER_TOURS} />
      </MemoryRouter>
    </SWRConfig>
  )
}
const ON = { notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, awareness_note_resurface_enabled: true }
const explainer = () => document.querySelector('[data-tour-explainer]')
const pause = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const openSheet = async () => { render(<App />); act(() => { openRegistryTour(ID) }) }

let restore
beforeEach(() => {
  __resetNotebookFlags(); __resetRegistryTourControl(); __resetOfferSession()
  prefs = {}
  installFetch()
  restore = installTourLayout()
})
afterEach(() => { restore(); __resetNotebookFlags(); __resetRegistryTourControl(); __resetOfferSession(); vi.restoreAllMocks() })

describe('P3 — the resurfacing explainer', () => {
  it('the registry entry is the passive one: two steps, not replayable, its own flag', async () => {
    const entry = getTourEntry(ID, OTHER_TOURS)
    expect(entry).toMatchObject({ replayable: false, flag: 'awareness_note_resurface_enabled' })
    expect((await entry.load()).steps.map((s) => s.anchor)).toEqual(['resurface-then', 'resurface-back'])
  })

  it('a member who HID Get started and said "Not now" to another tour’s offer still gets it', async () => {
    latchNotebookFlags(ON)
    prefs = {
      [CHECKLIST_PREF]: JSON.stringify({ v: 1, state: 'dismissed', at: '2026-10-01T00:00:00Z', done: [] }),
      [TOURS_PREF]: JSON.stringify({ 'writing-help': { v: 1, state: 'dismissed', step: null } }),
    }
    writeOfferSession({ id: 'writing-help', answered: true })
    await openSheet()
    await waitFor(() => expect(explainer()).not.toBeNull(), { timeout: 4000 })
    expect(explainer().textContent).toContain('What you wrote then')
    expect(explainer().textContent).toContain('Close this to go back to the note as it is now.')
    expect(screen.getByRole('button', { name: 'Got it' })).toBeInTheDocument()
  })

  it('ONCE PER MEMBER, counted from the moment it appears: the row is written before "Got it"', async () => {
    latchNotebookFlags(ON)
    await openSheet()
    await waitFor(() => expect(explainer()).not.toBeNull(), { timeout: 4000 })
    await waitFor(() => expect(rowPuts.length).toBeGreaterThan(0))
    expect(rowPuts[0].url).toContain(ID)
    expect(rowPuts[0].body).toMatchObject({ state: 'started' })
    expect(explainer()).not.toBeNull()               // still on screen: nobody pressed Got it
  })

  it('so a member with ANY row for it is never shown it again (closing the sheet early counts as shown)', async () => {
    latchNotebookFlags(ON)
    prefs = { [TOURS_PREF]: writesShape('started') }
    await openSheet()
    await pause(1200)
    expect(explainer()).toBeNull()
  })

  it('CONTROL — that member’s twin with no row is shown it (the rail is not passing by never showing)', async () => {
    latchNotebookFlags(ON)
    prefs = { [TOURS_PREF]: JSON.stringify({}) }
    await openSheet()
    await waitFor(() => expect(explainer()).not.toBeNull(), { timeout: 4000 })
  })

  it('with the wave-14 onboarding switch off it does not show, whatever the capability’s own flag says', async () => {
    latchNotebookFlags({ ...ON, notebook_getting_started_enabled: false })
    await openSheet()
    await pause(1200)
    expect(explainer()).toBeNull()
  })
})

/** A stored `notebook_tours` value carrying one row for the explainer: a flat map of tour id
 *  to its row, the shape `readToursPref` reads and the test above sees the engine write. */
function writesShape(state) {
  return JSON.stringify({ [ID]: { v: 1, state, step: 'then' } })
}

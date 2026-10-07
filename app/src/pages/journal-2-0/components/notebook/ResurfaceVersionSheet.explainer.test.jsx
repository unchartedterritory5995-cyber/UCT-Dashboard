// W14-C1 item (f): the resurfacing notice asks for its passive explainer the first time it
// shows what the member wrote, and the explainer renders as a light, non-modal note INSIDE
// the sheet -- through the real gate and the real engine, with the real registered copy.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { installFetch, Providers } from '../../a11y/fixtures'
import { expectNoAxeViolations } from '../../a11y/axeHarness'
import ResurfaceVersionSheet, { RESURFACE_EXPLAINER_ID } from './ResurfaceVersionSheet'
import RegistryToursGate from './onboarding/RegistryToursGate'
import { OTHER_TOURS, getTourEntry } from './onboarding/tourRegistry'
import {
  REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl,
} from './onboarding/tourRegistryControl'
import { TOURS_PREF } from './onboarding/tourSeenState'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { installTourLayout } from './onboarding/__fixtures__/tourLayout'

const VERSION = {
  id: 'v1', noteId: 'n1', title: 'NVDA swing plan', subtitle: null, createdAt: '2026-09-12T15:00:00Z',
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stop: 100' }] }] },
}
const VERSION_ROUTE = /^\/api\/j2\/notes\/n1\/versions\/v1$/

let opens = []
const onOpen = (e) => opens.push(e.detail.tourId)
let restoreLayout = () => {}
beforeEach(() => {
  opens = []
  __resetNotebookFlags()
  __resetRegistryTourControl()
  window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
  restoreLayout = installTourLayout()
})
afterEach(() => {
  window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
  __resetNotebookFlags()
  __resetRegistryTourControl()
  vi.restoreAllMocks()
})

describe('(f) the trigger', () => {
  it('the explainer is the registry\'s one replayable:false entry', () => {
    const e = getTourEntry(RESURFACE_EXPLAINER_ID)
    expect(e.replayable).toBe(false)
    expect(OTHER_TOURS.filter((t) => !t.replayable).map((t) => t.id)).toEqual([RESURFACE_EXPLAINER_ID])
  })

  it('asks for it ONCE, when what the member wrote first renders', async () => {
    installFetch([[VERSION_ROUTE, { version: VERSION }]])
    const { rerender } = render(<Providers><ResurfaceVersionSheet noteId="n1" versionId="v1" onClose={() => {}} /></Providers>)
    await screen.findByText('Stop: 100')
    expect(opens).toEqual([RESURFACE_EXPLAINER_ID])
    rerender(<Providers><ResurfaceVersionSheet noteId="n1" versionId="v1" onClose={() => {}} /></Providers>)
    expect(opens).toEqual([RESURFACE_EXPLAINER_ID])
  })

  it('does not ask while loading, or when the version could not be opened', async () => {
    installFetch([[/^\/api\/j2\/notes\/n1\/versions\/gone$/, [404, { detail: 'Version not found' }]]])
    render(<Providers><ResurfaceVersionSheet noteId="n1" versionId="gone" onClose={() => {}} /></Providers>)
    await screen.findByRole('alert')
    expect(opens).toEqual([])
  })
})

function Screen() {
  return (
    <Providers>
      <ResurfaceVersionSheet noteId="n1" versionId="v1" onClose={() => {}} />
      <RegistryToursGate tours={OTHER_TOURS} />
    </Providers>
  )
}

describe('(f) through the real gate and engine', () => {
  it('a light note inside the sheet: not a dialog, no stepper, focus left where it was; axe clean', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, awareness_note_resurface_enabled: true })
    installFetch([[VERSION_ROUTE, { version: VERSION }]])
    render(<Screen />)
    const { steps, copy } = await getTourEntry(RESURFACE_EXPLAINER_ID).load()
    const note = await screen.findByRole('complementary', { name: copy[steps[0].id].title }, { timeout: 5000 })
    expect(note.closest('[data-sheet-panel]')).not.toBeNull()
    expect(screen.queryByText(/Step \d of/)).toBeNull()
    for (const s of steps) expect(note).toHaveTextContent(copy[s.id].body)
    expect(note.contains(document.activeElement)).toBe(false)
    restoreLayout()
    await expectNoAxeViolations(document.body)
  })

  it('flag off: nothing shows (the sheet itself only renders with that flag on, and the gate checks it too)', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, awareness_note_resurface_enabled: false })
    installFetch([[VERSION_ROUTE, { version: VERSION }]])
    render(<Screen />)
    await screen.findByText('Stop: 100')
    await new Promise((r) => setTimeout(r, 300))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('seen before: nothing shows', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, awareness_note_resurface_enabled: true })
    installFetch([
      [VERSION_ROUTE, { version: VERSION }],
      [/^\/api\/auth\/preferences$/, { [TOURS_PREF]: JSON.stringify({ [RESURFACE_EXPLAINER_ID]: { v: 1, state: 'done', step: 'back' } }) }],
    ])
    render(<Screen />)
    await screen.findByText('Stop: 100')
    await new Promise((r) => setTimeout(r, 1200))   // the positive case shows within ~0.5 s
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('"Got it" closes it', async () => {
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, awareness_note_resurface_enabled: true })
    installFetch([[VERSION_ROUTE, { version: VERSION }]])
    render(<Screen />)
    await screen.findByRole('complementary', {}, { timeout: 5000 })
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
  })
})

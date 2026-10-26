// Notebook P5 final fix, item 9 (the Task 10 report left it unverified): the Community library tour's step 1
// ("Select Templates", waiting for the gallery door) must advance on an EMPTY notebook.
//
// On an empty notebook the inline template picker is on screen, gallery door and all, when step 1 is shown.
// Pressing Templates opens the New note sheet and NotebookTab unmounts the inline picker while the sheet is
// open (one picker per page, NotebookTab.starterOffer.test.jsx), so the door is REPLACED by the sheet's own in
// one commit: the anchor is never absent. The engine used to move on only after it had SEEN the anchor
// absent, so this step could never advance by the press it asks for. It now moves on when the waited-for
// anchor is a different element from the one on screen when the step was shown.
//
// The fixture is the empty notebook's shape, driven by the REAL tour entry (b4Styles.js, its real steps and
// copy) through the REAL generic engine: a Templates button, the inline picker's door until the sheet opens,
// then the sheet's door. Controls: the same tour on a notebook with notes (no inline door), and Back onto
// step 1 with the sheet still open stays on step 1 (W14-Q2 round 2 still holds).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense, lazy, useState } from 'react'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from '../GenericTourEngine'
import { installTourLayout } from '../__fixtures__/tourLayout'
import { TOURS } from './b4Styles'
import { STYLE_LIBRARY_COPY } from './b4Styles.steps'
import TemplatePickerSkeleton from '../../TemplatePickerSkeleton'

// Task 7.4: a picker module that never arrives, so the sheet holds the skeleton for the whole test.
const NeverPicker = lazy(() => new Promise(() => {}))

const ENTRY = TOURS.find((t) => t.id === 'style-library')
const STEP1 = STYLE_LIBRARY_COPY.templates.title
const STEP2 = STYLE_LIBRARY_COPY.door.title

function Page({ empty, lazySheet = false }) {
  const [sheet, setSheet] = useState(false)
  return (
    <>
      <button type="button" data-tour="templates" onClick={() => setSheet(true)}>Templates</button>
      {/* the empty notebook's inline picker: gone while the sheet is open (NotebookTab `!pickerOpen`) */}
      {empty && !sheet && <div><button type="button" data-tour="template-gallery-door">Browse the community gallery</button></div>}
      {sheet && (
        <div role="dialog" aria-label="New note">
          {lazySheet
            ? <Suspense fallback={<TemplatePickerSkeleton />}><NeverPicker /></Suspense>
            : <button type="button" data-tour="template-gallery-door">Browse the community gallery</button>}
        </div>
      )}
    </>
  )
}

let restore
beforeEach(() => {
  restore = installTourLayout()
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { restore?.(); vi.restoreAllMocks() })

const mount = (empty, { lazySheet = false } = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter initialEntries={['/journal/notebook?view=all']}>
      <Page empty={empty} lazySheet={lazySheet} />
      <GenericTourEngine entry={ENTRY} onClose={vi.fn()} startWaitMs={50} stepWaitMs={2000} />
    </MemoryRouter>
  </SWRConfig>,
)
const wait = (ms) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

describe('the Community library tour on an EMPTY notebook (item 9)', () => {
  it('non-vacuity: the inline door is on screen when step 1 is shown', async () => {
    mount(true)
    await screen.findByRole('dialog', { name: STEP1 })
    expect(document.querySelectorAll('[data-tour="template-gallery-door"]')).toHaveLength(1)
  })

  it('pressing Templates moves step 1 on to the door step, which points at the SHEET door', async () => {
    mount(true)
    await screen.findByRole('dialog', { name: STEP1 })
    act(() => { screen.getByRole('button', { name: 'Templates' }).click() })
    await screen.findByRole('dialog', { name: STEP2 }, { timeout: 3000 })
    const active = document.querySelector('[data-tour-active="true"]')
    expect(active?.closest('[role="dialog"][aria-label="New note"]')).toBeTruthy()
  })

  it('control: on a notebook with notes (no inline door) the same press moves on too', async () => {
    mount(false)
    await screen.findByRole('dialog', { name: STEP1 })
    act(() => { screen.getByRole('button', { name: 'Templates' }).click() })
    await screen.findByRole('dialog', { name: STEP2 }, { timeout: 3000 })
  })

  // Wave 7 Task 7.4: the picker is a lazy chunk now. While it is on its way (here: a module that NEVER
  // arrives) the sheet holds the real skeleton, and the tour must still move on to its door step, pointing
  // at the skeleton's anchor inside the sheet.
  it('the picker module still loading: the tour reaches its gallery step on the skeleton\'s anchor', async () => {
    mount(true, { lazySheet: true })
    await screen.findByRole('dialog', { name: STEP1 })
    act(() => { screen.getByRole('button', { name: 'Templates' }).click() })
    await screen.findByRole('dialog', { name: STEP2 }, { timeout: 3000 })
    const active = document.querySelector('[data-tour-active="true"]')
    expect(active?.closest('[role="dialog"][aria-label="New note"]')).toBeTruthy()
    expect(active?.closest('[data-template-picker-skeleton]'), 'the anchor is not the skeleton\'s').toBeTruthy()
  })

  it('control: Back onto step 1 with the sheet still open stays on step 1 (the door is the same element)', async () => {
    mount(true)
    await screen.findByRole('dialog', { name: STEP1 })
    act(() => { screen.getByRole('button', { name: 'Templates' }).click() })
    await screen.findByRole('dialog', { name: STEP2 }, { timeout: 3000 })
    act(() => { screen.getByRole('button', { name: 'Back' }).click() })
    await screen.findByRole('dialog', { name: STEP1 })
    await wait(600)
    expect(screen.getByRole('dialog', { name: STEP1 })).toBeTruthy()
  })
})

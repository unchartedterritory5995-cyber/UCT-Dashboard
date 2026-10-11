// app/src/pages/journal-2-0/a11y/learnMenu.a11y.test.jsx
//
// Notebook P0.12 / P0.15: Research Home's Learn menu through 8A's axe harness, in the two shapes
// it now has. Each recipe proves the menu rendered, with something in it, before axe runs, so an
// empty screen cannot pass as a clean one:
//   * learn-menu-grouped -- the desktop popover, open, over the REAL registry with every
//                           capability armed (all four groups drawn), the paid member's "Add the
//                           sample notebook" row, and its refusal line showing;
//   * learn-menu-sheet   -- the same menu as the phone's bottom Sheet;
//   * learn-catalog-sheet -- Task 14b: "What your Notebook can do", the capability preview opened
//                           from the menu in a Sheet, with every capability armed (the Terminal
//                           and Compass lines among them), the sample offer for a member with no
//                           notes, and its refusal line showing.
// OUTSIDE_POPULATION_SURFACES (notebookSurfaces.js) names this file for LearnMenu.jsx (under
// components/notebook/onboarding/, outside the derived population, like CapabilityPreview.jsx).
import { describe, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axeSurface } from './surface'
import { AuthContext } from '../../../context/AuthContext'
import LearnMenu from '../components/notebook/onboarding/LearnMenu'
import { LEARN_GROUPS, learnMenuTours } from '../components/notebook/onboarding/learnTours'
import { SAMPLE_COPY } from '../components/notebook/onboarding/sampleNotebook'
import { CAPABILITY_PREVIEW, PREVIEW_COPY } from '../components/notebook/onboarding/capabilityList'
import { TOUR_REGISTRY } from '../components/notebook/onboarding/tourRegistry'
import { notebookFlag, latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const { phone } = vi.hoisted(() => ({ phone: { on: false } }))
vi.mock('../../../hooks/useBreakpoint', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsPhone: () => phone.on,
  useIsTouch: () => phone.on,
}))

/** Every flag a registered tour is gated on (its own and its `requires`), plus the wave-14 switch. */
const ALL_ON = Object.fromEntries([
  ['notebook_onboarding_enabled', true],
  ['notebook_getting_started_enabled', true],
  ...TOUR_REGISTRY.flatMap((t) => [t.flag, ...(t.requires || [])]).map((f) => [f, true]),
  ...CAPABILITY_PREVIEW.map((c) => [c.flag, true]),
])

beforeEach(() => {
  __resetNotebookFlags()
  phone.on = false
  latchNotebookFlags(ALL_ON)
  // the sample route answers 409: the member already has notes, so the refusal line shows
  global.fetch = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({}) }))
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

function renderMenu() {
  return render(
    <AuthContext.Provider value={{ isPaid: true }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <main><LearnMenu hasAnyNotes={false} /></main>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

async function openAndRefuse(scope) {
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  fireEvent.click(within(scope()).getByRole('menuitem', { name: 'Add the sample notebook' }))
  expect(await within(scope()).findByText(SAMPLE_COPY.refused)).toBeInTheDocument()
}

describe('Learn menu -- axe', () => {
  axeSurface('learn-menu-grouped', async () => {
    const { container } = renderMenu()
    // NON-VACUITY: the real registry offers tours in more than one group
    expect(learnMenuTours({ flag: notebookFlag }).length).toBeGreaterThan(10)
    // the refusal line sits beside the menu, inside the popover that holds both
    await openAndRefuse(() => screen.getByRole('menu', { name: 'Learn: walkthroughs' }).closest('[data-learn-popover]'))
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label'))
    expect(groups).toEqual(LEARN_GROUPS)
    return { root: container }
  })

  axeSurface('learn-menu-sheet', async () => {
    phone.on = true
    renderMenu()
    await openAndRefuse(() => screen.getByRole('dialog', { name: 'Learn: walkthroughs' }))
    expect(within(screen.getByRole('dialog')).getAllByRole('group').length).toBeGreaterThan(1)
    // the sheet is portaled to <body>, so axe reads the whole document
  })

  axeSurface('learn-catalog-sheet', async () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: PREVIEW_COPY.heading }))
    const dlg = await screen.findByRole('dialog', { name: PREVIEW_COPY.heading })
    // NON-VACUITY: every armed capability is drawn, the two Task 14b lines among them, and the
    // sample offer for this member (no notes) is on screen with its button.
    const list = await within(dlg).findByRole('list', { name: PREVIEW_COPY.heading })
    expect(within(list).getAllByRole('listitem')).toHaveLength(CAPABILITY_PREVIEW.length)
    for (const id of ['terminal-links', 'compass-notes']) {
      expect(list).toHaveTextContent(CAPABILITY_PREVIEW.find((c) => c.id === id).label)
    }
    expect(within(dlg).getByRole('button', { name: SAMPLE_COPY.add })).toBeInTheDocument()
    // and its refusal line shows (the sample route answers 409 here)
    fireEvent.click(within(dlg).getByRole('button', { name: SAMPLE_COPY.add }))
    expect(await within(dlg).findByText(SAMPLE_COPY.refused)).toBeInTheDocument()
    // the sheet is portaled to <body>, so axe reads the whole document
  })
})

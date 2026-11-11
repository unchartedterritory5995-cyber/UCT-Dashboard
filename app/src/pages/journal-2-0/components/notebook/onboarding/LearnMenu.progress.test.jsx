// S14 (audit 2026-11-05, detail #65): each Learn item is the tour's NAME (no "tour" suffix) and says what the member
// has done with it -- a ✓ ("Done") for finished, "New" for never taken, nothing for one walked part way -- read off
// the tour-seen state that already exists (tourProgress.js). The mark is the item's description, never its name.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const prefsBox = vi.hoisted(() => ({ prefs: {} }))
vi.mock('../../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: prefsBox.prefs, loading: false, setPref: vi.fn(), setPrefMerged: vi.fn() }),
}))
vi.mock('./tourRegistry', async (importOriginal) => {
  const real = await importOriginal()
  const TOUR_REGISTRY = Object.freeze([
    ...real.TOUR_REGISTRY.filter((t) => t.id === real.BASE_TOUR_ID),
    Object.freeze({ id: 'chart-plan-basics', flag: 'notebook_chart_plan_enabled', title: 'Chart plan basics', replayable: true, load: async () => ({}) }),
    Object.freeze({ id: 'writing-help', flag: 'notebook_chart_plan_enabled', title: 'Writing help', replayable: true, load: async () => ({}) }),
  ])
  return { ...real, TOUR_REGISTRY, replayableTours: (registry = TOUR_REGISTRY) => real.replayableTours(registry) }
})

import LearnMenu from './LearnMenu'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_chart_plan_enabled: true })
})
afterEach(() => { __resetNotebookFlags(); prefsBox.prefs = {} })

async function openMenu() {
  render(
    <AuthContext.Provider value={{ isPaid: true }}>
      <MemoryRouter initialEntries={['/journal/notebook']}><LearnMenu hasAnyNotes /></MemoryRouter>
    </AuthContext.Provider>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Learn' }))
  return screen.findByRole('menu', { name: 'Learn: walkthroughs' })
}

describe('Learn: the done ticks and the New marks (S14)', () => {
  it('done -> ✓ described "Done"; walked part way -> no mark; never taken -> "New"; the NAME is the tour name alone', async () => {
    prefsBox.prefs = {
      notebook_tour: JSON.stringify({ v: 1, state: 'done', step: 'end' }),
      notebook_tours: JSON.stringify({ 'chart-plan-basics': { v: 1, state: 'started', step: 'levels' } }),
    }
    const menu = await openMenu()
    const basics = within(menu).getByRole('menuitem', { name: 'Notebook basics' })
    expect(basics).toHaveAccessibleDescription('Done')
    expect(basics.querySelector('[data-learn-progress="done"]').textContent).toBe('✓')
    const plan = within(menu).getByRole('menuitem', { name: 'Chart plan basics' })
    expect(plan.querySelector('[data-learn-progress]')).toBeNull()
    expect(plan).not.toHaveAttribute('aria-describedby')
    const writing = within(menu).getByRole('menuitem', { name: 'Writing help' })
    expect(writing).toHaveAccessibleDescription('New')
    expect(writing.querySelector('[data-learn-progress="new"]').textContent).toBe('New')
    // no item name ends in " tour" any more
    for (const item of within(menu).getAllByRole('menuitem')) expect(item.firstChild.textContent).not.toMatch(/ tour$/)
  })

  it('a tour declined from the one-time offer before a step is still "New" (the What\'s new rule)', async () => {
    prefsBox.prefs = { notebook_tours: JSON.stringify({ 'writing-help': { v: 1, state: 'dismissed', step: null } }) }
    const menu = await openMenu()
    expect(within(menu).getByRole('menuitem', { name: 'Writing help' })).toHaveAccessibleDescription('New')
    // CONTROL: no record for the base tour either -> New
    expect(within(menu).getByRole('menuitem', { name: 'Notebook basics' })).toHaveAccessibleDescription('New')
  })
})

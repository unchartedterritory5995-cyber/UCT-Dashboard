// Lane FIN-A11Y round 2 (review R4, I-8, applied to the wave-8 BASE tour). The base tour had
// the same gap the generic engine had: "Step N of M" was in neither the dialog's name nor its
// description, and focus goes to the heading, so a screen reader member never heard where
// they were. The dialog is now described by the count and then the body, and the heading that
// takes focus on every step is described by the count, so it is read on each step change.
// The steps, their order, their copy and the preference key are untouched
// (baseTour.zeroDrift.test.jsx still pins those).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import NotebookTour from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY } from './tourCopy'
import { __resetTourControl } from './tourControl'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

const Page = () => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <AuthContext.Provider value={{ isPaid: true }}>
      <MemoryRouter initialEntries={['/journal/notebook']}>
        <div>
          {TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}
          <NotebookTour hasAnyNotes={false} notesKnown />
        </div>
      </MemoryRouter>
    </AuthContext.Provider>
  </SWRConfig>
)

const textOf = (el, attr) => (el.getAttribute(attr) || '')
  .split(/\s+/).filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent || '')
  .join(' ')

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/auth/preferences' && (init.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  installTourLayout()
})
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

const first = TOUR_STEP_COPY[TOUR_STEPS[0].id]
const second = TOUR_STEP_COPY[TOUR_STEPS[1].id]
const N = TOUR_STEPS.length

describe('the base tour says where the member is', () => {
  it('the dialog keeps its name and is described by the step count, then the body', async () => {
    render(<Page />)
    const dialog = await screen.findByRole('dialog', {}, { timeout: 2000 })
    expect(dialog).toHaveAccessibleName(first.title)
    expect(textOf(dialog, 'aria-describedby')).toBe('Step 1 of ' + N + ' ' + first.body)
  })

  it('the heading that takes focus is described by the count', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    const heading = screen.getByRole('heading', { level: 2 })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(textOf(heading, 'aria-describedby')).toBe('Step 1 of ' + N)
  })

  it('on Next the new heading has focus and its description is the new count', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const heading = await screen.findByRole('heading', { level: 2, name: second.title })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(textOf(heading, 'aria-describedby')).toBe('Step 2 of ' + N)
    expect(textOf(screen.getByRole('dialog'), 'aria-describedby')).toBe('Step 2 of ' + N + ' ' + second.body)
  })

  it('the count is still the same visible text', async () => {
    render(<Page />)
    await screen.findByRole('dialog', {}, { timeout: 2000 })
    expect(screen.getByText('Step 1 of ' + N)).toBeVisible()
  })
})

describe('on touch a target is never left under the bottom card (both tours share this stylesheet)', () => {
  const css = readFileSync(
    join(process.cwd(), 'src/pages/journal-2-0/components/notebook/onboarding/NotebookTour.module.css'), 'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  it('the active anchor carries a scroll margin at 1024px and under', () => {
    const at = css.indexOf('@media (max-width: 1024px)')
    expect(at).toBeGreaterThanOrEqual(0)
    const rule = /:global\(\[data-tour-active='true'\]\)\s*\{([^}]*)\}/.exec(css.slice(at))
    expect(rule, 'a [data-tour-active] rule inside the touch block').not.toBeNull()
    expect(rule[1]).toMatch(/scroll-margin-top:\s*\d+px/)
    expect(Number(/scroll-margin-bottom:\s*calc\(\s*(\d+)px\s*\+\s*env\(safe-area-inset-bottom\)/.exec(rule[1])[1]))
      .toBeGreaterThanOrEqual(240)
  })
})

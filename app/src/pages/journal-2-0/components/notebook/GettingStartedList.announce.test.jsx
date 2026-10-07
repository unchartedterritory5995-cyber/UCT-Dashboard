// Lane FIN-A11Y (review R4, M-1). The "get started" list ticked steps silently: the
// "2 of 5 done" count was a plain span, a finished step swapped its button for text (so
// focus on that button fell to <body>), and when the last step was done the card vanished
// with no message. Now the count is a polite live region, focus moves to the card heading
// when the step it was on is ticked, and "every step is done" is said when the card closes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GettingStartedList from './GettingStartedList'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { WALKTHROUGH_TITLE } from '../../lib/templateBlocks'

const state = vi.hoisted(() => ({ prefs: {}, home: null, writes: [] }))
vi.mock('../../../../hooks/usePreferences', async (orig) => ({
  ...(await orig()),
  default: () => ({
    prefs: state.prefs,
    loading: false,
    setPrefMerged: (key, fn) => { state.writes.push(key); state.prefs = { ...state.prefs, [key]: fn(state.prefs[key]) } },
  }),
}))
vi.mock('../../hooks/useNotebookHome', () => ({ default: () => ({ home: state.home }) }))

const EMPTY_HOME = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }
const WROTE = { ...EMPTY_HOME, continueWorking: [{ id: 'n1', title: 'Mine', bodyPlain: 'my words' }] }
const TOUR_DONE = { notebook_tour: JSON.stringify({ v: 1, state: 'done', step: 'export' }) }

const ui = (props = {}) => (
  <MemoryRouter>
    <main>
      <h1 data-first-run-heading="" tabIndex={-1}>Welcome to your Notebook</h1>
      <GettingStartedList hasAnyNotes={false} onCreateNote={() => {}} onAddSample={null} {...props} />
    </main>
  </MemoryRouter>
)

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({
    notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true,
  })
  state.prefs = {}
  state.home = EMPTY_HOME
  state.writes = []
})
afterEach(() => __resetNotebookFlags())

describe('M-1 -- ticks are announced', () => {
  it('the progress count is a polite live region', () => {
    render(ui())
    const progress = screen.getByText(/^0 of \d done$/)
    expect(progress).toHaveAttribute('aria-live', 'polite')
  })

  it('the same element carries the new count after a tick', () => {
    const { rerender } = render(ui())
    const progress = screen.getByText(/^0 of \d done$/)
    state.home = WROTE
    rerender(ui({ hasAnyNotes: true }))
    expect(progress).toHaveTextContent(/^1 of \d done$/)
  })
})

describe('M-1 -- a tick does not drop focus', () => {
  it('when the step that had focus is ticked, focus moves to the card heading', () => {
    const { rerender } = render(ui())
    const step = screen.getByRole('button', { name: 'Write your first note' })
    step.focus()
    expect(step).toHaveFocus()
    state.home = WROTE
    rerender(ui({ hasAnyNotes: true }))
    expect(screen.queryByRole('button', { name: 'Write your first note' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Get started' })).toHaveFocus()
  })

  it('a tick on a step the member was NOT on leaves their focus alone', () => {
    const { rerender } = render(ui())
    const hide = screen.getByRole('button', { name: 'Hide the get started list' })
    hide.focus()
    state.home = WROTE
    rerender(ui({ hasAnyNotes: true }))
    expect(hide).toHaveFocus()
  })
})

describe('M-1 -- finishing the list says so', () => {
  it('when the last step is done the card closes and a status says every step is done', async () => {
    state.prefs = { ...TOUR_DONE }
    const { rerender } = render(ui())
    // one step left that this page can finish by evidence: the first note
    screen.getByRole('link', { name: 'Start a note from a template' })
    const step = screen.getByRole('button', { name: 'Write your first note' })
    step.focus()
    state.home = {
      ...EMPTY_HOME,
      continueWorking: [
        { id: 'n1', title: 'Mine', bodyPlain: 'my words' },
        { id: 'n2', title: 'From a template', bodyPlain: 'intro ' + WALKTHROUGH_TITLE + ' body' },
      ],
    }
    rerender(ui({ hasAnyNotes: true }))
    rerender(ui({ hasAnyNotes: true }))
    expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull()
    const status = await screen.findByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Get started: every step is done.'))
    // focus was inside the card that closed: it goes to the page heading, not to <body>
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome to your Notebook' })).toHaveFocus())
  })
})

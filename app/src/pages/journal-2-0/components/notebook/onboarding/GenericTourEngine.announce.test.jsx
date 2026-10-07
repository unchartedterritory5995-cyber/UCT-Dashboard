// Lane FIN-A11Y (review R4: I-8 and M-3). What a screen reader member is told by a tour.
//   * "Step N of M" was in neither the dialog's name nor its description, and focus goes to
//     the heading, so a member never heard where they were.
//   * "Do this to continue" mounted with its step, so it was not announced as a change, and
//     it was not in the description either.
//   * The passive explainer appeared at the end of <body>, never focused, with no live role.
//   * On touch the card is fixed to the bottom edge and a target scrolled with
//     block: 'nearest' could sit under it.
// The focused heading is DESCRIBED by the step count and the hint, so both are read on
// every step change (focus moves to the heading each time), and the dialog's own
// description carries them too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine from './GenericTourEngine'
import { installTourLayout } from './__fixtures__/tourLayout'

const tour = (id, steps, extra = {}) => ({
  id,
  title: id,
  replayable: true,
  load: async () => ({
    steps,
    copy: Object.fromEntries(steps.map((s) => [s.id, { title: 'Title of ' + s.id, body: 'Body of ' + s.id + '.' }])),
  }),
  ...extra,
})

const wrap = (children) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter initialEntries={['/journal/notebook']}><main>{children}</main></MemoryRouter>
  </SWRConfig>
)

/** The text an id list (aria-describedby / aria-labelledby) resolves to. */
const textOf = (el, attr) => (el.getAttribute(attr) || '')
  .split(/\s+/).filter(Boolean)
  .map((id) => document.getElementById(id)?.textContent || '')
  .join(' ')

beforeEach(() => {
  global.fetch = vi.fn(async (url, init = {}) => {
    if (url === '/api/auth/preferences' && (init.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => ({ preferences: {} }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  installTourLayout()
})
afterEach(() => { vi.restoreAllMocks() })

describe('I-8 -- the step count is part of what the dialog says', () => {
  const T = tour('fin-steps', [
    { id: 'a', anchor: 'fin-a', file: 'x' },
    { id: 'b', anchor: 'fin-b', file: 'x' },
    { id: 'c', anchor: 'fin-c', file: 'x' },
  ])
  const page = () => render(wrap(<>
    <div data-tour="fin-a">a</div>
    <div data-tour="fin-b">b</div>
    <div data-tour="fin-c">c</div>
    <GenericTourEngine entry={T} onClose={() => {}} />
  </>))

  it('the dialog is described by "Step 1 of 3" and then the body', async () => {
    page()
    const dialog = await screen.findByRole('dialog', { name: 'Title of a' }, { timeout: 2000 })
    expect(textOf(dialog, 'aria-describedby')).toBe('Step 1 of 3 Body of a.')
  })

  it('the heading that takes focus is described by the step count, so it is read on arrival', async () => {
    page()
    await screen.findByRole('dialog', { name: 'Title of a' }, { timeout: 2000 })
    const heading = screen.getByRole('heading', { name: 'Title of a' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(textOf(heading, 'aria-describedby')).toBe('Step 1 of 3')
  })

  it('on Next, focus is on the new heading and its description says the new count', async () => {
    page()
    await screen.findByRole('dialog', { name: 'Title of a' }, { timeout: 2000 })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const heading = await screen.findByRole('heading', { name: 'Title of b' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(textOf(heading, 'aria-describedby')).toBe('Step 2 of 3')
    expect(textOf(screen.getByRole('dialog'), 'aria-describedby')).toBe('Step 2 of 3 Body of b.')
  })

  it('the step count is still visible text', async () => {
    page()
    await screen.findByRole('dialog', { name: 'Title of a' }, { timeout: 2000 })
    expect(screen.getByText('Step 1 of 3')).toBeVisible()
  })
})

describe('I-8 -- "do this to continue" is said, not only shown', () => {
  const W = tour('fin-wait', [
    { id: 'door', anchor: 'fin-door', file: 'x', waitFor: 'fin-panel' },
    { id: 'panel', anchor: 'fin-panel', file: 'x' },
  ])
  const page = () => render(wrap(<>
    <button type="button" data-tour="fin-door">Plan</button>
    <GenericTourEngine entry={W} onClose={() => {}} />
  </>))

  it('the dialog description and the focused heading both carry the hint', async () => {
    page()
    const dialog = await screen.findByRole('dialog', { name: 'Title of door' }, { timeout: 2000 })
    expect(textOf(dialog, 'aria-describedby'))
      .toBe('Step 1 of 2 Body of door. Do this to continue, or choose Next to skip it.')
    const heading = screen.getByRole('heading', { name: 'Title of door' })
    expect(textOf(heading, 'aria-describedby'))
      .toBe('Step 1 of 2 Do this to continue, or choose Next to skip it.')
  })

  it('a step that waits for nothing does not mention it', async () => {
    const T = tour('fin-plain', [{ id: 'a', anchor: 'fin-door', file: 'x' }])
    render(wrap(<>
      <button type="button" data-tour="fin-door">Plan</button>
      <GenericTourEngine entry={T} onClose={() => {}} />
    </>))
    const dialog = await screen.findByRole('dialog', { name: 'Title of a' }, { timeout: 2000 })
    expect(textOf(dialog, 'aria-describedby')).toBe('Step 1 of 1 Body of a.')
  })
})

describe('M-3 -- the passive explainer is announced politely', () => {
  const P = tour('fin-explain', [
    { id: 'then', anchor: 'fin-then', file: 'x' },
    { id: 'back', anchor: 'fin-back', file: 'x' },
  ], { replayable: false })

  it('a polite status says its title and every sentence, without taking focus', async () => {
    render(wrap(<>
      <button type="button">where focus was</button>
      <div data-tour="fin-then">then</div>
      <div data-tour="fin-back">back</div>
      <GenericTourEngine entry={P} onClose={() => {}} />
    </>))
    screen.getByRole('button', { name: 'where focus was' }).focus()
    const note = await screen.findByRole('complementary', { name: 'Title of then' }, { timeout: 3000 })
    const status = note.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    // the region is mounted empty and filled a moment later: a status that mounts WITH its
    // text is often not announced
    await waitFor(() => expect(status).toHaveTextContent('Title of then. Body of then. Body of back. Got it closes this note.'))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'where focus was' }))
    // and it does not double the visible text for a member reading the card itself
    expect(status.className).toMatch(/sr-only/)
  })

  // Round 2: the note was portaled to the END of <body>, so "Got it" was the last Tab stop on
  // the page. It is now in a slot at the START of <body>: the first Tab from the top of the
  // page reaches it, and it still never takes focus by itself.
  it('"Got it" is the first Tab stop on the page, not the last', async () => {
    const user = userEvent.setup()
    render(wrap(<>
      <button type="button">first page control</button>
      <div data-tour="fin-then">then</div>
      <div data-tour="fin-back">back</div>
      <button type="button">last page control</button>
      <GenericTourEngine entry={P} onClose={() => {}} />
    </>))
    const note = await screen.findByRole('complementary', { name: 'Title of then' }, { timeout: 3000 })
    expect(document.body).toHaveFocus()
    const firstControl = screen.getByRole('button', { name: 'first page control' })
    // DOM order: the note comes before the page's own content
    expect(note.compareDocumentPosition(firstControl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Got it' })).toHaveFocus()
    await user.tab()
    expect(firstControl).toHaveFocus()
  })

  it('the announcement says how to close it', async () => {
    render(wrap(<>
      <div data-tour="fin-then">then</div>
      <div data-tour="fin-back">back</div>
      <GenericTourEngine entry={P} onClose={() => {}} />
    </>))
    const note = await screen.findByRole('complementary', { name: 'Title of then' }, { timeout: 3000 })
    await waitFor(() => expect(note.querySelector('[role="status"]')).toHaveTextContent(/Got it closes this note\.$/))
  })

  it('"Got it" closes it and leaves no note behind in the slot', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(wrap(<>
      <div data-tour="fin-then">then</div>
      <div data-tour="fin-back">back</div>
      <GenericTourEngine entry={P} onClose={onClose} />
    </>))
    await screen.findByRole('complementary', { name: 'Title of then' }, { timeout: 3000 })
    await user.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// The touch scroll margin lives in NotebookTour.module.css (both tours share that
// stylesheet); it is railed in NotebookTour.announce.test.jsx.

// Wave 8 lane 8C (C2): the first-run tour, on a fixture page holding every anchor.
//
// ⛔ Every state change is asserted TWO ways: the rendered text changes (the member's side)
// and the preference call carries the state (spied on the wire, read from fetch.mock.calls
// outside the mock). ⛔ Every step's words are a copy contract.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import NotebookTour, { TOUR_PREF, AUTO_START_DELAY_MS } from './NotebookTour'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_STEP_COPY, TOUR_UI } from './tourCopy'
import { openNotebookTour, __resetTourControl } from './tourControl'
import { AuthContext } from '../../../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { installTourLayout } from './__fixtures__/tourLayout'

let server
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === '/api/auth/preferences' && method === 'GET') return { ok: true, status: 200, json: async () => server.prefs }
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      server.prefs = { ...server.prefs, [key]: value }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
/** Every tour preference write, parsed, in order. */
const tourWrites = () => global.fetch.mock.calls
  .filter(([u, init = {}]) => u === '/api/auth/preferences' && init.method === 'POST')
  .map(([, init]) => JSON.parse(init.body))
  .filter((b) => b.key === TOUR_PREF)
  .map((b) => JSON.parse(b.value))

function Support() {
  const loc = useLocation()
  return <p>support page from {loc.state?.from}</p>
}

// `boxes` (fix M-7): an anchor's layout -- 'none' (no box) or 'l,t,r,b' -- and `slot`, the anchors
// placed inside a 0-width clipping slot the way the collapsed sidebar holds its own: the slot sits
// at x=200, the panel is translated left of it, so the panel's box is ON screen and only the
// slot's clip hides it.
function Page({ anchors = TOUR_STEPS.map((s) => s.anchor), paid = true, tour = {}, initial = '/journal/notebook', boxes = {}, slot = [] }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ isPaid: paid }}>
        <MemoryRouter initialEntries={[typeof initial === 'string' ? { pathname: initial } : initial]}>
          <Routes>
            <Route path="/support" element={<Support />} />
            <Route path="*" element={(
              <div>
                <button type="button">before the tour</button>
                {anchors.filter((a) => !slot.includes(a)).map((a) => <div key={a} data-tour={a} data-test-box={boxes[a]}>anchor {a}</div>)}
                {slot.length > 0 && (
                  <div style={{ overflow: 'hidden' }} data-test-box="200,0,200,600">
                    {anchors.filter((a) => slot.includes(a)).map((a) => <div key={a} data-tour={a} data-test-box="-60,20,200,60">anchor {a}</div>)}
                  </div>
                )}
                <NotebookTour hasAnyNotes={false} notesKnown {...tour} />
              </div>
            )} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}

beforeEach(() => {
  __resetNotebookFlags()
  __resetTourControl()
  latchNotebookFlags({ notebook_onboarding_enabled: true })
  server = { prefs: {} }
  installFetch()
  // jsdom lays nothing out; the tour asks whether an anchor can be SEEN (fix M-7)
  installTourLayout()
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

const dialog = (opts) => screen.findByRole('dialog', {}, { timeout: 2000, ...opts })
const title = () => screen.getByRole('heading', { level: 2 })

describe('when it starts', () => {
  it('auto-starts for a new paid member, on the first step, and records "started"', async () => {
    render(<Page />)
    const d = await dialog()
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveAccessibleName('Welcome to your Notebook')
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument()
    await waitFor(() => expect(tourWrites()).toEqual([{ v: 1, state: 'started', step: 'first-run' }]))
  })

  it.each([
    ['the gate is off', () => { __resetNotebookFlags(); latchNotebookFlags({ notebook_onboarding_enabled: false }) }, {}],
    ['no flag has latched', () => { __resetNotebookFlags() }, {}],
    ['the member has notes', () => {}, { tour: { hasAnyNotes: true } }],
    ['the note count is still loading', () => {}, { tour: { notesKnown: false } }],
    ['the member is unpaid', () => {}, { paid: false }],
    ['the tour was finished', () => { server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'done', step: 'import' }) } }, {}],
    ['the tour was dismissed', () => { server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'dismissed', step: null }) } }, {}],
  ])('never auto-starts when %s', async (_why, arrange, props) => {
    arrange()
    render(<Page {...props} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tourWrites()).toEqual([])
  })

  it('shows once: after Done it does not come back on the same page', async () => {
    const { rerender } = render(<Page />)
    await dialog()
    for (let i = 1; i < TOUR_STEPS.length; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<Page />)
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a tour left half-way resumes at its step', async () => {
    server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'started', step: 'import' }) }
    render(<Page />)
    await dialog()
    expect(title()).toHaveTextContent('Import')
  })

  it('"Take the tour" opens it whatever the preference says', async () => {
    server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'dismissed', step: null }) }
    render(<Page />)
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => { openNotebookTour() })
    await dialog()
    expect(title()).toHaveTextContent('Welcome to your Notebook')
  })

  it('a link from the help article (state startTour) opens it', async () => {
    server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'done', step: null }) }
    render(<Page initial={{ pathname: '/journal/notebook', state: { startTour: true } }} />)
    await dialog()
  })

  // ⛔ Fix M-7: leaving inside the help link's wait used to open the tour anyway -- on a page
  // the member had left -- and record `started`.
  // The anchors live in a tree of their own that STAYS, so a stray timer would find something to
  // open -- otherwise the unmount would take the anchors with it and the rail could not tell.
  const standaloneAnchors = () => render(<div>{TOUR_STEPS.map((s) => <div key={s.anchor} data-tour={s.anchor}>anchor {s.anchor}</div>)}</div>)
  it("M-7: leaving before the help link's wait ends opens nothing and records nothing", async () => {
    server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'done', step: null }) }
    standaloneAnchors()
    const { unmount } = render(<Page anchors={[]} initial={{ pathname: '/journal/notebook', state: { startTour: true } }} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    unmount()
    await act(async () => { await new Promise((r) => setTimeout(r, AUTO_START_DELAY_MS + 200)) })
    expect(tourWrites()).toEqual([])
  })

  it('M-7 CONTROL: the same arrangement, not left, does open (so the rail above can fail)', async () => {
    server.prefs = { [TOUR_PREF]: JSON.stringify({ v: 1, state: 'done', step: null }) }
    standaloneAnchors()
    render(<Page anchors={[]} initial={{ pathname: '/journal/notebook', state: { startTour: true } }} />)
    await dialog()
    await waitFor(() => expect(tourWrites().at(-1)).toEqual({ v: 1, state: 'started', step: 'first-run' }))
  })

  it('with no anchor on the page there is no tour, and nothing is recorded', async () => {
    render(<Page anchors={[]} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tourWrites()).toEqual([])
  })
})

describe('how it walks', () => {
  it('Next, Back and Done change the words, outline the anchor, and record each step', async () => {
    render(<Page />)
    await dialog()
    expect(document.querySelector('[data-tour="first-run"]')).toHaveAttribute('data-tour-active', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toHaveTextContent('Folders and tags')
    expect(screen.getByText(`Step 2 of ${TOUR_STEPS.length}`)).toBeInTheDocument()
    expect(document.querySelector('[data-tour="first-run"]')).not.toHaveAttribute('data-tour-active')
    expect(document.querySelector('[data-tour="sidebar"]')).toHaveAttribute('data-tour-active', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(title()).toHaveTextContent('Welcome to your Notebook')
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled()
    await waitFor(() => expect(tourWrites().map((w) => w.step)).toEqual(['first-run', 'sidebar', 'first-run']))
  })

  it('Done records "done", closes, and hands focus back', async () => {
    render(<Page />)
    screen.getByRole('button', { name: 'before the tour' }).focus()
    await dialog()
    for (let i = 1; i < TOUR_STEPS.length; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toHaveTextContent('Export')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(tourWrites().at(-1)).toEqual({ v: 1, state: 'done', step: 'export' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'before the tour' }))
    expect(document.querySelector('[data-tour-active]')).toBeNull()
  })

  it('Escape records "dismissed", closes, and hands focus back', async () => {
    render(<Page />)
    screen.getByRole('button', { name: 'before the tour' }).focus()
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(tourWrites().at(-1)).toEqual({ v: 1, state: 'dismissed', step: 'sidebar' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'before the tour' }))
  })

  it('"Skip tour" records "dismissed"', async () => {
    render(<Page />)
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(tourWrites().at(-1).state).toBe('dismissed'))
  })

  it('a missing anchor skips its step', async () => {
    render(<Page anchors={TOUR_STEPS.map((s) => s.anchor).filter((a) => a !== 'search' && a !== 'ask-row')} />)
    await dialog()
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length - 2}`)).toBeInTheDocument()
    const seen = [title().textContent]
    for (let i = 1; i < TOUR_STEPS.length - 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      seen.push(title().textContent)
    }
    expect(seen).not.toContain('Search')
    expect(seen).not.toContain('Ask your notebook')
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  // ⛔ Wave 8 final review, fix M-7: PRESENT IS NOT VISIBLE. With the sidebar collapsed its
  // anchors stay in the DOM, translated out of a 0-width slot that clips them; the tour used
  // to outline those, pointing at nothing the member could see.
  it('M-7: anchors in a collapsed sidebar (clipped to nothing) are skipped', async () => {
    render(<Page slot={['sidebar', 'search']} />)
    await dialog()
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length - 2}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toHaveTextContent('New note')
    expect(document.querySelector('[data-tour="sidebar"]')).not.toHaveAttribute('data-tour-active')
  })

  it('M-7: an anchor with no box (display: none) or off the side of the window is skipped', async () => {
    render(<Page boxes={{ search: 'none', import: '-400,100,-200,140' }} />)
    await dialog()
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length - 2}`)).toBeInTheDocument()
    const seen = [title().textContent]
    for (let i = 1; i < TOUR_STEPS.length - 2; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }))
      seen.push(title().textContent)
    }
    expect(seen).not.toContain('Search')
    expect(seen).not.toContain('Import')
  })

  it('M-7 CONTROL: an anchor below the fold still counts (the step scrolls it into view)', async () => {
    render(<Page boxes={{ sidebar: '100,5000,300,5040' }} />)
    await dialog()
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument()
  })

  it('an anchor that leaves the page mid-tour is skipped on the way past it', async () => {
    render(<Page />)
    await dialog()
    document.querySelector('[data-tour="sidebar"]').remove()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toHaveTextContent('Search')
  })

  it('Tab stays inside the card', async () => {
    render(<Page />)
    const d = await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    const next = screen.getByRole('button', { name: 'Next' })
    next.focus()
    fireEvent.keyDown(next, { key: 'Tab' })
    expect(d.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skip tour' }))
  })

  it('the last step links to the Notebook help, which opens with the Notebook articles first', async () => {
    render(<Page />)
    await dialog()
    for (let i = 1; i < TOUR_STEPS.length; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('link', { name: 'Read the Notebook help' }))
    expect(await screen.findByText('support page from /journal/notebook')).toBeInTheDocument()
    await waitFor(() => expect(tourWrites().at(-1).state).toBe('done'))
  })
})

describe('the copy contract', () => {
  it('every step has its words, and they are these', () => {
    expect(Object.keys(TOUR_STEP_COPY).sort()).toEqual(TOUR_STEPS.map((s) => s.id).sort())
    expect(TOUR_STEP_COPY).toEqual({
      'first-run': { title: 'Welcome to your Notebook', body: 'Start here: write a note, create a thesis or bring in the notes you already have.' },
      sidebar: { title: 'Folders and tags', body: 'Your folders, tags and saved views live here. Choose one to see just those notes.' },
      search: { title: 'Search', body: 'Find any word in any note. Press ? at any time to see every keyboard shortcut.' },
      'new-note': { title: 'New note', body: 'Start a blank note, or pick a template such as the daily note.' },
      'view-switcher': { title: 'Views', body: 'See your notes as a list, a table, a board, a calendar, a graph of their links, a timeline or a list of tasks.' },
      import: { title: 'Import', body: 'Bring in notes from Notion, Obsidian, Evernote, Markdown files or Word documents.' },
      ask: { title: 'Ask your notebook', body: 'Ask a question and get an answer drawn from your own notes, with the notes it came from.' },
      export: { title: 'Export', body: 'Download this note as Markdown, a web page, JSON or Word, or print it to a PDF.' },
    })
    expect([TOUR_UI.back, TOUR_UI.next, TOUR_UI.done, TOUR_UI.skip, TOUR_UI.help, TOUR_UI.progress(2, 7)])
      .toEqual(['Back', 'Next', 'Done', 'Skip tour', 'Read the Notebook help', 'Step 2 of 7'])
  })

  it('every step is rendered with exactly its words', async () => {
    render(<Page />)
    await dialog()
    for (let i = 0; i < TOUR_STEPS.length; i += 1) {
      const copy = TOUR_STEP_COPY[TOUR_STEPS[i].id]
      expect(title()).toHaveTextContent(copy.title)
      expect(screen.getByText(copy.body)).toBeInTheDocument()
      if (i < TOUR_STEPS.length - 1) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
  })

  it('no step spells out a shortcut chord (it says "press ?")', () => {
    const all = Object.values(TOUR_STEP_COPY).map((c) => `${c.title} ${c.body}`).join(' ')
    expect(all).not.toMatch(/⌘|Ctrl|Cmd|Alt\+|Shift\+/)
    expect(all).toContain('Press ?')
  })
})

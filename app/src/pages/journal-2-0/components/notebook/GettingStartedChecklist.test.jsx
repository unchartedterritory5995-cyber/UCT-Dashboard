// Wave 14 lane W14-D: the "get started" checklist, rendered against a real
// usePreferences / useNotebookHome over a fetch stub.
//
// ⛔ Every sentence is asserted as RENDERED TEXT (copy contract). ⛔ Every write is read
// from `fetch.mock.calls`. ⛔ An item ticks from the member's real action or seen-state
// -- each "click does not tick" case below proves a click alone records nothing.
//
// The registry is extended here with one extra tour (gated on a dark flag), so the
// "one item per armed registered tour" and D4 ("a newly armed capability never reopens
// a closed list") rails have a second tour to arm. The real registry holds only the
// base tour today; gettingStarted.test.js rails the derivation against it too.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

vi.mock('./onboarding/tourRegistry', async (importOriginal) => {
  const real = await importOriginal()
  const TOUR_REGISTRY = Object.freeze([
    ...real.TOUR_REGISTRY,
    Object.freeze({ id: 'w14d-formulas', flag: 'notebook_formulas_enabled', title: 'Formulas', replayable: true, load: async () => ({}) }),
  ])
  return {
    ...real,
    TOUR_REGISTRY,
    replayableTours: (registry = TOUR_REGISTRY) => real.replayableTours(registry),
  }
})

import GettingStartedChecklist, { makeChecklistGate } from './GettingStartedChecklist'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { TOUR_OPEN_EVENT, __resetTourControl } from './onboarding/tourControl'
import { REGISTRY_TOUR_OPEN_EVENT, __resetRegistryTourControl } from './onboarding/tourRegistryControl'
import { claimFirstRunStage, isFirstRunStageHeld } from '../../../../components/firstRun/firstRunStage'
import { WALKTHROUGH_TITLE } from '../../lib/templateBlocks'

const PREFS = '/api/auth/preferences'
const HOME = '/api/j2/notebook/home'
const EMPTY_HOME = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

let server
function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}
function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    if (url === PREFS && method === 'GET') {
      if (server.prefsGate) await server.prefsGate
      return json(200, server.prefs)
    }
    if (url === PREFS && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      server.prefs = { ...server.prefs, [key]: value }
      return json(200, { ok: true })
    }
    if (url === HOME && method === 'GET') return json(200, server.home)
    return json(404, { detail: 'Not Found' })
  })
}
const prefWrites = (key) => global.fetch.mock.calls
  .filter(([u, init = {}]) => u === PREFS && (init.method || 'GET').toUpperCase() === 'POST')
  .map(([, init]) => JSON.parse(init.body))
  .filter((b) => !key || b.key === key)

const settle = (ms = 20) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

function renderList(props = {}) {
  const onCreateNote = props.onCreateNote ?? vi.fn()
  const onAddSample = 'onAddSample' in props ? props.onAddSample : vi.fn(async () => {})
  const utils = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <GettingStartedChecklist hasAnyNotes={props.hasAnyNotes ?? false}
          onCreateNote={onCreateNote} onAddSample={onAddSample} />
      </MemoryRouter>
    </SWRConfig>,
  )
  return { ...utils, onCreateNote, onAddSample }
}

beforeEach(() => {
  server = { prefs: {}, home: EMPTY_HOME, prefsGate: null }
  installFetch()
  __resetNotebookFlags()
  // W14-C1: task reminders reads ON when a payload omits it (a kill switch), which adds
  // its tour step; pinned OFF so these cases keep their fixed step lists.
  latchNotebookFlags({ notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true })
  __resetTourControl()
  __resetRegistryTourControl()
})
afterEach(() => {
  __resetNotebookFlags()
  vi.restoreAllMocks()
})

describe('when it shows', () => {
  it('first run: the title, the progress line and one action per step', async () => {
    renderList()
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    expect(screen.getByText('0 of 4 done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Write your first note' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start a note from a template' })).toHaveAttribute('href', '/journal/notebook?view=all')
    expect(screen.getByRole('button', { name: 'Open the sample notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take the Notebook basics tour' })).toBeInTheDocument()
    // The dark capability's tour is not offered.
    expect(screen.queryByText(/Formulas/)).toBeNull()
  })

  it('renders nothing while the onboarding flag is off, and writes nothing', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: false, notebook_getting_started_enabled: true })
    const { container } = renderList()
    await settle()
    expect(container).toBeEmptyDOMElement()
    expect(prefWrites()).toEqual([])
  })

  it('renders nothing while its OWN flag is off (onboarding on), and writes nothing', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    const { container } = renderList()
    await settle()
    expect(container).toBeEmptyDOMElement()
    expect(prefWrites()).toEqual([])
  })

  it('renders nothing until the preferences have loaded (a dismissed list never flashes)', async () => {
    let open
    server.prefsGate = new Promise((r) => { open = r })
    server.prefs = { notebook_getting_started: JSON.stringify({ v: 1, state: 'dismissed', at: 'x' }) }
    const { container } = renderList()
    await settle()
    expect(container).toBeEmptyDOMElement()
    open()
    await settle()
    expect(container).toBeEmptyDOMElement()
  })

  it('the sample step is not offered without a door to add it', async () => {
    renderList({ onAddSample: null })
    await screen.findByRole('heading', { name: 'Get started' })
    expect(screen.queryByText('Open the sample notebook')).toBeNull()
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument()
  })

  it('one item per armed registered tour: arming a capability adds its tour', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_formulas_enabled: true })
    renderList()
    const btn = await screen.findByRole('button', { name: 'Take the Formulas tour' })
    const opened = vi.fn()
    window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, opened)
    fireEvent.click(btn)
    window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, opened)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(opened.mock.calls[0][0].detail).toEqual({ tourId: 'w14d-formulas' })
  })
})

describe('a click opens the door; only the real action ticks the step', () => {
  it('"Write your first note" calls the Notebook\'s own create, and ticks nothing', async () => {
    const { onCreateNote } = renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'Write your first note' }))
    expect(onCreateNote).toHaveBeenCalledTimes(1)
    await settle()
    expect(screen.getByText('0 of 4 done')).toBeInTheDocument()
    expect(prefWrites()).toEqual([])
  })

  it('"Open the sample notebook" runs Research Home\'s own add, and shows it is busy', async () => {
    let finish
    const onAddSample = vi.fn(() => new Promise((r) => { finish = r }))
    renderList({ onAddSample })
    fireEvent.click(await screen.findByRole('button', { name: 'Open the sample notebook' }))
    expect(onAddSample).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('button', { name: 'Adding the sample…' })).toBeDisabled()
    await act(async () => { finish() })
    expect(await screen.findByRole('button', { name: 'Open the sample notebook' })).toBeEnabled()
    expect(prefWrites()).toEqual([])
  })

  it('"Take the Notebook basics tour" opens the base tour through its own door', async () => {
    renderList()
    const opened = vi.fn()
    window.addEventListener(TOUR_OPEN_EVENT, opened)
    fireEvent.click(await screen.findByRole('button', { name: 'Take the Notebook basics tour' }))
    window.removeEventListener(TOUR_OPEN_EVENT, opened)
    expect(opened).toHaveBeenCalledTimes(1)
    expect(prefWrites()).toEqual([])
  })

  it('a finished base tour (its own seen-state) ticks the step', async () => {
    server.prefs = { notebook_tour: JSON.stringify({ v: 1, state: 'done', step: 'export' }) }
    renderList()
    expect(await screen.findByText('1 of 4 done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take the Notebook basics tour' })).toBeNull()
    const done = screen.getByText('Take the Notebook basics tour')
    expect(done.closest('li')).toHaveTextContent('Done')
  })

  it('a note of the member\'s own built from a template ticks both note steps', async () => {
    server.home = { ...EMPTY_HOME, continueWorking: [{ id: 'n1', title: 'Thesis', bodyPlain: `NVDA ${WALKTHROUGH_TITLE} 1. Read it` }] }
    renderList({ hasAnyNotes: true, onAddSample: null })
    expect(await screen.findByText('2 of 3 done')).toBeInTheDocument()
  })
})

describe('a step never unticks', () => {
  it('the first time a step ticks, its id is recorded in the one key (no close)', async () => {
    server.home = { ...EMPTY_HOME, continueWorking: [{ id: 'n1', title: 'T', bodyPlain: WALKTHROUGH_TITLE }] }
    renderList({ hasAnyNotes: true, onAddSample: null })
    await waitFor(() => expect(prefWrites('notebook_getting_started').length).toBeGreaterThan(0))
    const stored = JSON.parse(server.prefs.notebook_getting_started)
    expect([...stored.done].sort()).toEqual(['note', 'template'])
    expect(stored.state).toBeUndefined()
    expect(screen.getByText('2 of 3 done')).toBeInTheDocument()
  })

  it('a recorded step stays ticked after its evidence leaves the home read', async () => {
    // A sample exists and none of the member's own notes is in Research Home's capped
    // read any more: on the evidence alone "note" and "template" would read undone.
    server.prefs = {
      notebook_sample: JSON.stringify({ v: 1, ids: ['s1'] }),
      notebook_getting_started: JSON.stringify({ v: 1, done: ['note', 'template'] }),
    }
    server.home = { ...EMPTY_HOME, continueWorking: [{ id: 's1', title: 'Sample', bodyPlain: '' }] }
    renderList({ hasAnyNotes: true, onAddSample: null })
    expect(await screen.findByText('3 of 4 done')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Write your first note' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Start a note from a template' })).toBeNull()
  })

  it('a refused write is not retried on every render (bounded, per id)', async () => {
    server.home = { ...EMPTY_HOME, continueWorking: [{ id: 'n1', title: 'T', bodyPlain: 'mine' }] }
    const real = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === PREFS && (init.method || 'GET').toUpperCase() === 'POST') return json(400, { detail: 'nope' })
      return real(url, init)
    })
    renderList({ hasAnyNotes: true, onAddSample: null })
    await settle(150)
    const posts = global.fetch.mock.calls.filter(([u, i = {}]) => u === PREFS && (i.method || '').toUpperCase() === 'POST')
    expect(posts).toHaveLength(1)
  })
})

describe('closing it -- ONE preference key, and D4', () => {
  it('Hide writes notebook_getting_started once, as dismissed, and the list goes', async () => {
    renderList()
    fireEvent.click(await screen.findByRole('button', { name: 'Hide the get started list' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Get started' })).toBeNull())
    const writes = prefWrites()
    expect(writes).toHaveLength(1)
    expect(writes[0].key).toBe('notebook_getting_started')
    expect(JSON.parse(writes[0].value)).toMatchObject({ v: 1, state: 'dismissed' })
  })

  it('D4: a dismissed list stays closed when a new capability arms later', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_formulas_enabled: true })
    server.prefs = { notebook_getting_started: JSON.stringify({ v: 1, state: 'dismissed', at: 'x' }) }
    const { container } = renderList()
    await settle(40)
    expect(container).toBeEmptyDOMElement()
    expect(prefWrites()).toEqual([])
  })

  it('every step done: the list closes as `done`, keeping its done-set, with a bounded number of writes', async () => {
    server.prefs = { notebook_tour: JSON.stringify({ v: 1, state: 'done', step: 'export' }) }
    server.home = { ...EMPTY_HOME, continueWorking: [{ id: 'n1', title: 'T', bodyPlain: WALKTHROUGH_TITLE }] }
    const { container, rerender } = renderList({ hasAnyNotes: true, onAddSample: null })
    await waitFor(() => expect(JSON.parse(server.prefs.notebook_getting_started || '{}').state).toBe('done'))
    const stored = JSON.parse(server.prefs.notebook_getting_started)
    expect(stored).toMatchObject({ v: 1, state: 'done' })
    expect([...stored.done].sort()).toEqual(['note', 'template', 'tour:notebook-basics'])
    expect(container).toBeEmptyDOMElement()
    // At most one write per step as it ticks, plus the close: three steps here.
    const n = prefWrites('notebook_getting_started').length
    expect(n).toBeLessThanOrEqual(4)
    rerender(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <GettingStartedChecklist hasAnyNotes onCreateNote={vi.fn()} onAddSample={null} />
        </MemoryRouter>
      </SWRConfig>,
    )
    await settle(40)
    expect(prefWrites('notebook_getting_started')).toHaveLength(n)
  })

  it('D4: a list closed as done stays closed when a new capability arms later', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_task_reminders_enabled: false, notebook_onboarding_enabled: true, notebook_getting_started_enabled: true, notebook_formulas_enabled: true })
    server.prefs = { notebook_getting_started: JSON.stringify({ v: 1, state: 'done', at: 'x' }) }
    const { container } = renderList()
    await settle(40)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('the first-run stage: no surface stacks on another', () => {
  it('the list never claims the stage (it would hold the Compass card back for good)', async () => {
    renderList()
    await screen.findByRole('heading', { name: 'Get started' })
    expect(isFirstRunStageHeld()).toBe(false)
  })

  it('it is page content: shown the same while a tour holds the stage', async () => {
    const release = claimFirstRunStage()
    try {
      renderList()
      expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    } finally {
      release()
    }
  })

  it('its stylesheet never floats it (no fixed, absolute or sticky positioning)', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/GettingStartedList.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toContain('.card')
    expect(css).not.toMatch(/position\s*:\s*(fixed|absolute|sticky)/)
  })
})

describe('keyboard reach', () => {
  it('Tab reaches every step and Hide, in reading order; Enter runs the focused step', async () => {
    const user = userEvent.setup()
    const { onCreateNote } = renderList()
    await screen.findByRole('heading', { name: 'Get started' })
    const order = []
    for (let i = 0; i < 5; i += 1) {
      await user.tab()
      order.push(document.activeElement.textContent)
    }
    expect(order).toEqual([
      'Hide',
      'Write your first note',
      'Start a note from a template',
      'Open the sample notebook',
      'Take the Notebook basics tour',
    ])
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    await user.tab({ shift: true })
    expect(document.activeElement).toHaveTextContent('Write your first note')
    await user.keyboard('{Enter}')
    expect(onCreateNote).toHaveBeenCalledTimes(1)
  })
})

describe('the eager gate: the list chunk is fetched only for a member it is for', () => {
  function renderGate(Gate) {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter><Gate hasAnyNotes={false} onCreateNote={vi.fn()} onAddSample={null} /></MemoryRouter>
      </SWRConfig>,
    )
  }

  it('a dismissed member never downloads the list', async () => {
    server.prefs = { notebook_getting_started: JSON.stringify({ v: 1, state: 'dismissed', at: 'x' }) }
    const load = vi.fn(() => import('./GettingStartedList'))
    const { container } = renderGate(makeChecklistGate(load, 0))
    await settle(40)
    expect(load).not.toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('its own flag off: never downloads the list', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: true, notebook_getting_started_enabled: false })
    const load = vi.fn(() => import('./GettingStartedList'))
    renderGate(makeChecklistGate(load, 0))
    await settle(40)
    expect(load).not.toHaveBeenCalled()
  })

  it('flag off: never downloads the list', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_onboarding_enabled: false, notebook_getting_started_enabled: true })
    const load = vi.fn(() => import('./GettingStartedList'))
    renderGate(makeChecklistGate(load, 0))
    await settle(40)
    expect(load).not.toHaveBeenCalled()
  })

  it('a member it is for: fetched once, and shown', async () => {
    const load = vi.fn(() => import('./GettingStartedList'))
    renderGate(makeChecklistGate(load, 0))
    expect(await screen.findByRole('heading', { name: 'Get started' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('a chunk that cannot load renders NOTHING (never the route error), and is reported', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn(() => Promise.reject(new Error('boom')))
    const { container } = renderGate(makeChecklistGate(load, 0))
    await settle(80)
    expect(container).toBeEmptyDOMElement()
    expect(err).toHaveBeenCalled()
  })
})

// The generic engine (wave 14, lane W14-0) -- mirrors NotebookTour.test.jsx's own
// coverage of the base tour's engine, run against TWO different fake tours (never
// the real registry) to prove the mechanism is actually generic: the same
// component code walks either one correctly, records under the SHARED
// `notebook_tours` key, and never touches the base tour's own `notebook_tour` key.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect, useState } from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import GenericTourEngine, { START_WAIT_MS, atStart } from './GenericTourEngine'
import { TOURS_PREF } from './tourSeenState'
import { SAMPLE_COPY } from './sampleNotebook'
import { UNREACHABLE_COPY } from './tourStart'
import { installTourLayout } from './__fixtures__/tourLayout'

// P0.3: the chart card's "Add the sample notebook" button adds the sample through the ONE
// authority (sampleNotebook.js addSampleNotebook); every other export stays real.
const { sampleMock } = vi.hoisted(() => ({ sampleMock: vi.fn() }))
vi.mock('./sampleNotebook', async (importOriginal) => ({
  ...(await importOriginal()),
  addSampleNotebook: (...a) => sampleMock(...a),
}))

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
/** Every `notebook_tours` write, parsed, in order. */
const toursWrites = () => global.fetch.mock.calls
  .filter(([u, init = {}]) => u === '/api/auth/preferences' && init.method === 'POST')
  .map(([, init]) => JSON.parse(init.body))
  .filter((b) => b.key === TOURS_PREF)
  .map((b) => JSON.parse(b.value))
/** Every `notebook_tour` (the BASE tour's own, singular, key) write -- must stay empty. */
const baseTourWrites = () => global.fetch.mock.calls
  .filter(([u, init = {}]) => u === '/api/auth/preferences' && init.method === 'POST')
  .map(([, init]) => JSON.parse(init.body))
  .filter((b) => b.key === 'notebook_tour')

const TOUR_A = {
  id: 'w14-0-tour-a',
  load: async () => ({
    steps: [
      { id: 's1', anchor: 'anchor-a1', file: 'x' },
      { id: 's2', anchor: 'anchor-a2', file: 'x' },
    ],
    copy: { s1: { title: 'A step one', body: 'A body one' }, s2: { title: 'A step two', body: 'A body two' } },
  }),
}
const TOUR_B = {
  id: 'w14-0-tour-b',
  load: async () => ({
    steps: [{ id: 'only', anchor: 'anchor-b1', file: 'y' }],
    copy: { only: { title: 'B step one', body: 'B body one' } },
  }),
}

function Page({ entry, anchors, onCloseSpy = () => {}, startWaitMs, stepWaitMs }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <div>
          <button type="button">before the tour</button>
          {anchors.map((a) => <div key={a} data-tour={a}>anchor {a}</div>)}
          <GenericTourEngine entry={entry} onClose={onCloseSpy} {...(startWaitMs != null ? { startWaitMs } : {})}
            {...(stepWaitMs != null ? { stepWaitMs } : {})} />
        </div>
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(() => {
  server = { prefs: {} }
  installFetch()
  installTourLayout()
})
afterEach(() => { vi.restoreAllMocks() })

const dialog = (opts) => screen.findByRole('dialog', {}, { timeout: 2000, ...opts })
const title = () => screen.getByRole('heading', { level: 2 })

describe('multi-tour: the SAME engine walks two different tours correctly', () => {
  it('tour A: opens at step one, walks to step two, and records under the shared key', async () => {
    render(<Page entry={TOUR_A} anchors={['anchor-a1', 'anchor-a2']} />)
    const d = await dialog()
    expect(d).toHaveAccessibleName('A step one')
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(title()).toHaveTextContent('A step two')
    await waitFor(() => expect(toursWrites().map((w) => w['w14-0-tour-a'])).toEqual([
      { v: 1, state: 'started', step: 's1' },
      { v: 1, state: 'started', step: 's2' },
    ]))
    expect(baseTourWrites()).toEqual([])
  })

  it('tour B: a single-step tour, opens and finishes on Done', async () => {
    render(<Page entry={TOUR_B} anchors={['anchor-b1']} />)
    const d = await dialog()
    expect(d).toHaveAccessibleName('B step one')
    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(toursWrites().at(-1)['w14-0-tour-b']).toEqual({ v: 1, state: 'done', step: 'only' }))
  })

  it('⛔⛔ RISK R8: finishing tour B does not clobber tour A\'s already-recorded row', async () => {
    server.prefs = { [TOURS_PREF]: JSON.stringify({ 'w14-0-tour-a': { v: 1, state: 'done', step: 's2' } }) }
    render(<Page entry={TOUR_B} anchors={['anchor-b1']} />)
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      const last = toursWrites().at(-1)
      expect(last['w14-0-tour-a']).toEqual({ v: 1, state: 'done', step: 's2' })   // untouched
      expect(last['w14-0-tour-b']).toEqual({ v: 1, state: 'done', step: 'only' })
    })
  })
})

describe('with no anchor on the page', () => {
  // (W14-D finding: the engine now WAITS, bounded, for the starting anchor
  // before deciding there is no tour -- so this case shortens that wait.)
  it('there is no tour, nothing is recorded, and onClose fires once the bounded wait runs out', async () => {
    const onCloseSpy = vi.fn()
    render(<Page entry={TOUR_A} anchors={[]} onCloseSpy={onCloseSpy} startWaitMs={200} />)
    await waitFor(() => expect(onCloseSpy).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toursWrites()).toEqual([])
  })
})

describe('how it walks (same contract as the base engine)', () => {
  it('Escape records dismissed, closes, and hands focus back', async () => {
    render(<Page entry={TOUR_A} anchors={['anchor-a1', 'anchor-a2']} />)
    screen.getByRole('button', { name: 'before the tour' }).focus()
    await dialog()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(toursWrites().at(-1)['w14-0-tour-a']).toEqual({ v: 1, state: 'dismissed', step: 's1' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'before the tour' }))
  })

  it('"Skip tour" records dismissed', async () => {
    render(<Page entry={TOUR_A} anchors={['anchor-a1', 'anchor-a2']} />)
    await dialog()
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    await waitFor(() => expect(toursWrites().at(-1)['w14-0-tour-a'].state).toBe('dismissed'))
  })

  // W14-C1 (c): the step list is no longer frozen at open. A step whose anchor is missing
  // is WAITED for on Next (bounded), and skipped only after the wait; with nothing later on
  // screen the tour finishes as done -- never a card pointing at nothing.
  it('a missing anchor skips its step, after the bounded wait', async () => {
    render(<Page entry={TOUR_A} anchors={['anchor-a1']} stepWaitMs={150} />)
    await dialog()
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Looking for the next step…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(toursWrites().at(-1)['w14-0-tour-a']).toEqual({ v: 1, state: 'done', step: 's1' }))
  })

  it('opening moves focus into itself, and Tab stays inside the card', async () => {
    const user = userEvent.setup()
    render(<Page entry={TOUR_A} anchors={['anchor-a1', 'anchor-a2']} />)
    const d = await dialog()
    expect(document.activeElement).toBe(title())
    await user.tab()
    expect(d.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skip tour' }))
  })

  it('the outline attribute follows the active step', async () => {
    render(<Page entry={TOUR_A} anchors={['anchor-a1', 'anchor-a2']} />)
    await dialog()
    expect(document.querySelector('[data-tour="anchor-a1"]')).toHaveAttribute('data-tour-active', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(document.querySelector('[data-tour="anchor-a1"]')).not.toHaveAttribute('data-tour-active')
    expect(document.querySelector('[data-tour="anchor-a2"]')).toHaveAttribute('data-tour-active', 'true')
  })
})

// ── the starting screen (W14-D finding; plan 4.2: a tour starts at its
// capability's screen) ─────────────────────────────────────────────────────

/** Renders its anchors only after `delayMs` -- a page still loading its data. */
function LateAnchors({ anchors, delayMs }) {
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), delayMs); return () => clearTimeout(t) }, [delayMs])
  return on ? anchors.map((a) => <div key={a} data-tour={a}>anchor {a}</div>) : null
}

let seenPath = null
function PathProbe() { const l = useLocation(); seenPath = l.pathname + l.search; return null }

/** A two-screen notebook: the tour's anchors live only on `?view=all`. */
function TwoScreens({ entry, initial = '/journal/notebook', onCloseSpy = () => {}, startWaitMs }) {
  const Screen = () => {
    const l = useLocation()
    const onAll = new URLSearchParams(l.search).get('view') === 'all'
    return (
      <div>
        {onAll && <LateAnchors anchors={['anchor-a1', 'anchor-a2']} delayMs={300} />}
        <PathProbe />
        <GenericTourEngine entry={entry} onClose={onCloseSpy} {...(startWaitMs != null ? { startWaitMs } : {})} />
      </div>
    )
  }
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes><Route path="/journal/notebook" element={<Screen />} /></Routes>
      </MemoryRouter>
    </SWRConfig>
  )
}

describe('the starting anchor arrives after the content (opened from Help, page still loading)', () => {
  it('the tour WAITS for it and opens at step one, instead of closing', async () => {
    const onCloseSpy = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <LateAnchors anchors={['anchor-a1', 'anchor-a2']} delayMs={400} />
          <GenericTourEngine entry={TOUR_A} onClose={onCloseSpy} />
        </MemoryRouter>
      </SWRConfig>,
    )
    const d = await dialog({ timeout: 3000 })
    expect(d).toHaveAccessibleName('A step one')
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    expect(onCloseSpy).not.toHaveBeenCalled()
  })

  it('the wait is bounded: START_WAIT_MS is a few seconds, not forever', () => {
    expect(START_WAIT_MS).toBeGreaterThanOrEqual(2000)
    expect(START_WAIT_MS).toBeLessThanOrEqual(15000)
  })
})

describe('an entry with a `start` location', () => {
  const TOUR_S = { ...TOUR_A, id: 'w14-0-tour-s', start: '/journal/notebook?view=all' }

  it('opened on another notebook screen, it navigates to its start and opens at step one there', async () => {
    seenPath = null
    const onCloseSpy = vi.fn()
    render(<TwoScreens entry={TOUR_S} onCloseSpy={onCloseSpy} />)
    const d = await dialog({ timeout: 3000 })
    expect(seenPath).toBe('/journal/notebook?view=all')
    expect(d).toHaveAccessibleName('A step one')
    expect(onCloseSpy).not.toHaveBeenCalled()
  })

  it('already at its start, it does not navigate', async () => {
    seenPath = null
    render(<TwoScreens entry={TOUR_S} initial="/journal/notebook?view=all&folder=f1" />)
    await dialog({ timeout: 3000 })
    expect(seenPath).toBe('/journal/notebook?view=all&folder=f1')
  })

  it('CONTROL: the same tour WITHOUT a start never reaches its screen and closes after the wait', async () => {
    seenPath = null
    const onCloseSpy = vi.fn()
    render(<TwoScreens entry={TOUR_A} onCloseSpy={onCloseSpy} startWaitMs={500} />)
    await waitFor(() => expect(onCloseSpy).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(seenPath).toBe('/journal/notebook')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toursWrites()).toEqual([])
  })
})

describe('atStart', () => {
  const loc = (pathname, search = '') => ({ pathname, search })
  it('matches the path and every query parameter the start names', () => {
    expect(atStart('/journal/notebook?view=all', loc('/journal/notebook', '?view=all&folder=f1'))).toBe(true)
    expect(atStart('/journal/notebook?view=all', loc('/journal/notebook', '?view=board'))).toBe(false)
    expect(atStart('/journal/notebook?view=all', loc('/journal/notebook'))).toBe(false)
    expect(atStart('/journal/notebook', loc('/journal/notebook', '?anything=1'))).toBe(true)
    expect(atStart('/journal/notebook/x', loc('/journal/notebook'))).toBe(false)
    expect(atStart(undefined, loc('/anywhere'))).toBe(true)
  })
})

// ── P0.3: a chart tour with notes but no chart says so, and offers the sample ───────────────
describe('the unreachable card: a chart tour with no chart in any note', () => {
  const CHART_TOUR = {
    id: 'w14-0-tour-chart',
    title: 'Chart plan',
    start: { note: 'sample:plan', embed: 'chart' },
    load: async () => ({
      steps: [{ id: 'chart', anchor: 'chart-anchor', file: 'x' }],
      copy: { chart: { title: 'The chart', body: 'The chart body' } },
    }),
  }
  const ok = (body) => ({ ok: true, status: 200, json: async () => body })

  /** The start lookup finds no example note and no note holding a chart. `hasNotes` is whether the
   *  member has any note at all (the unfiltered read): the sample button is for a member with none. */
  function installNoChartFetch({ hasNotes = false } = {}) {
    const base = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => {
      if (url === '/api/j2/notes/import/check') return ok({ existing: {} })
      if (String(url).startsWith('/api/j2/notes?')) {
        return ok({ notes: hasNotes && !String(url).includes('embed_widget') ? [{ id: 'n1' }] : [] })
      }
      return base(url, init)
    })
  }

  beforeEach(() => {
    sampleMock.mockReset()
    sampleMock.mockResolvedValue({ ok: true, folderId: 'f1', welcomeNoteId: 'w1' })
    installNoChartFetch()
  })

  async function openCard(onCloseSpy = vi.fn()) {
    render(<Page entry={CHART_TOUR} anchors={[]} onCloseSpy={onCloseSpy} />)
    const d = await dialog({ timeout: 3000 })
    expect(d).toHaveAccessibleName(UNREACHABLE_COPY.chart.title)
    return onCloseSpy
  }

  it('(no notes at all) says exactly what is missing, and offers the sample and a way to the notes', async () => {
    await openCard()
    expect(screen.getByText(UNREACHABLE_COPY.chartNoNotes.body)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add the sample notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go to my notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  // R15 (D-C6): the server refuses the sample to a member with ANY note, so a member who has notes
  // gets the /chart card with no add button; only a member with none is offered the sample.
  it('a member WITH notes: the /chart card, no add button, a way to their notes', async () => {
    installNoChartFetch({ hasNotes: true })
    render(<Page entry={CHART_TOUR} anchors={[]} onCloseSpy={vi.fn()} />)
    expect(await dialog({ timeout: 3000 })).toHaveAccessibleName(UNREACHABLE_COPY.chart.title)
    expect(screen.getByText(UNREACHABLE_COPY.chart.body)).toBeInTheDocument()
    expect(screen.getByText(/Type \/chart in any note to add one/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add the sample notebook' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Go to my notes' })).toBeInTheDocument()
    // exactly one primary button is left: the way out
    expect(screen.getByRole('button', { name: 'Go to my notes' })).toHaveClass('btn-primary')
    expect(sampleMock).not.toHaveBeenCalled()
  })

  it('a member with NO notes: the card offers the sample', async () => {
    installNoChartFetch({ hasNotes: false })
    render(<Page entry={CHART_TOUR} anchors={[]} onCloseSpy={vi.fn()} />)
    expect(await dialog({ timeout: 3000 })).toHaveAccessibleName(UNREACHABLE_COPY.chartNoNotes.title)
    expect(screen.getByText(UNREACHABLE_COPY.chartNoNotes.body)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add the sample notebook' })).toBeInTheDocument()
  })

  it('"Add the sample notebook" adds it through addSampleNotebook, then restarts THIS tour', async () => {
    const onCloseSpy = await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Add the sample notebook' }))
    await waitFor(() => expect(onCloseSpy).toHaveBeenCalledTimes(1))
    expect(sampleMock).toHaveBeenCalledTimes(1)
    // the engine closes itself and asks to be run again; the gate does the re-run (it cannot be
    // done by a bare start request while this engine is still the wanted one: RegistryToursGate.test.jsx)
    expect(onCloseSpy).toHaveBeenCalledWith({ opened: false, restart: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sample409: when the sample cannot be added the refusal shows in the card and the tour is NOT restarted', async () => {
    sampleMock.mockResolvedValueOnce({ ok: false, message: SAMPLE_COPY.refused })
    const onCloseSpy = await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Add the sample notebook' }))
    const said = await screen.findByText(SAMPLE_COPY.refused)
    expect(said.closest('[role="status"]')).not.toBeNull()
    expect(onCloseSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // and the member can try again, or leave
    expect(screen.getByRole('button', { name: 'Add the sample notebook' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('a second press while the first is still adding does not add a second sample', async () => {
    let finish
    sampleMock.mockReturnValueOnce(new Promise((r) => { finish = r }))
    const onCloseSpy = await openCard()
    const add = screen.getByRole('button', { name: 'Add the sample notebook' })
    fireEvent.click(add)
    fireEvent.click(add)
    expect(sampleMock).toHaveBeenCalledTimes(1)
    expect(add).toHaveAttribute('aria-disabled', 'true')
    finish({ ok: true, folderId: 'f1', welcomeNoteId: 'w1' })
    await waitFor(() => expect(onCloseSpy).toHaveBeenCalledTimes(1))
  })

  // D (polish round): the voice tour's first anchor (the New note arrow) exists only once the member
  // has a note. Started from Help or What's new by a member with none, it used to wait for that
  // anchor and fail with "start it again"; now it shows ONE card and a way to the Notebook.
  describe('a tour that needs a note, started by a member with none', () => {
    const VOICE = {
      id: 'voice-notes',
      title: 'Voice notes',
      start: '/journal/notebook',
      load: async () => ({
        steps: [{ id: 'open', anchor: 'new-note-home', file: 'x', waitFor: 'new-note-voice' }],
        copy: { open: { title: 'Start a voice note', body: 'Open the arrow.' } },
      }),
    }

    function Where() {
      const l = useLocation()
      return <p data-testid="where">{l.pathname}</p>
    }

    it('shows the "make a note first" card, and its one button goes to the Notebook', async () => {
      installNoChartFetch({ hasNotes: false })
      const onCloseSpy = vi.fn()
      render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <MemoryRouter initialEntries={['/support']}>
            <GenericTourEngine entry={VOICE} onClose={onCloseSpy} />
            <Routes><Route path="*" element={<Where />} /></Routes>
          </MemoryRouter>
        </SWRConfig>,
      )
      const d = await dialog({ timeout: 3000 })
      expect(d).toHaveAccessibleName(UNREACHABLE_COPY.firstNote.title)
      expect(screen.getByText('Make your first note, then come back to this tour.')).toBeInTheDocument()
      expect(screen.queryByText(/start it again/)).toBeNull()
      expect(screen.queryByRole('button', { name: 'Add the sample notebook' })).toBeNull()
      const go = screen.getByRole('button', { name: 'Go to the Notebook' })
      expect(go).toHaveClass('btn-primary')
      fireEvent.click(go)
      expect(screen.getByTestId('where')).toHaveTextContent('/journal/notebook')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(onCloseSpy).toHaveBeenCalledWith({ opened: false })
    })

    it('CONTROL: a member WITH notes never sees that card (the tour goes on to its start as before)', async () => {
      installNoChartFetch({ hasNotes: true })
      const onCloseSpy = vi.fn()
      render(<Page entry={VOICE} anchors={[]} onCloseSpy={onCloseSpy} startWaitMs={50} />)
      await waitFor(() => expect(onCloseSpy).toHaveBeenCalled())
      expect(onCloseSpy).toHaveBeenCalledWith({ opened: false, failed: true })
      expect(screen.queryByRole('dialog', { name: UNREACHABLE_COPY.firstNote.title })).toBeNull()
    })
  })

  it('CONTROL: the other cards (a note tour with no note) carry no sample button', async () => {
    const NOTE_TOUR = { ...CHART_TOUR, id: 'w14-0-tour-note', start: { note: 'sample:plan' } }
    render(<Page entry={NOTE_TOUR} anchors={[]} />)
    expect(await dialog({ timeout: 3000 })).toHaveAccessibleName(UNREACHABLE_COPY.note.title)
    expect(screen.queryByRole('button', { name: 'Add the sample notebook' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Go to the Notebook' })).toBeInTheDocument()
  })
})

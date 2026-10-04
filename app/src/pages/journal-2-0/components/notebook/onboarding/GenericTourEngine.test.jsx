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

function Page({ entry, anchors, onCloseSpy = () => {}, startWaitMs }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter>
        <div>
          <button type="button">before the tour</button>
          {anchors.map((a) => <div key={a} data-tour={a}>anchor {a}</div>)}
          <GenericTourEngine entry={entry} onClose={onCloseSpy} {...(startWaitMs != null ? { startWaitMs } : {})} />
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

  it('a missing anchor skips its step', async () => {
    render(<Page entry={TOUR_A} anchors={['anchor-a1']} />)
    await dialog()
    expect(screen.getByText('Step 1 of 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
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

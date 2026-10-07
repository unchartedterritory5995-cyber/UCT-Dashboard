// W14-C1: the engine's reach. Fake tours (never the real registry) prove each mechanism:
//   (b) a note / trade start is resolved and navigated to; nothing to open => a card with
//       a way out, nothing recorded, nothing created;
//   (c) steps are re-evaluated on every Next: a step behind a click shows once its anchor
//       appears; a `waitFor` step moves on when the member does the thing;
//   (d) a Home tour opened on an open note navigates Home;
//   (e) a step inside a Sheet renders non-modal INSIDE the sheet; Escape closes only the
//       topmost layer; Tab is the sheet's ring, which includes the card;
//   (f) a `replayable: false` entry is a light, non-modal explainer, shown once.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SWRConfig } from 'swr'
import Sheet from '../../../../../components/mobile/Sheet'
import GenericTourEngine from './GenericTourEngine'
import { TOURS_PREF } from './tourSeenState'
import { SAMPLE_IMPORT_PREFIX } from './tourStart'
import { installTourLayout } from './__fixtures__/tourLayout'

let server
function installFetch(extra = () => null) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    const special = extra(url, init)
    if (special) return special
    if (url === '/api/auth/preferences' && method === 'GET') return ok(server.prefs)
    if (url === '/api/auth/preferences' && method === 'POST') {
      const { key, value } = JSON.parse(init.body)
      server.prefs = { ...server.prefs, [key]: value }
      return ok({})
    }
    return { ok: false, status: 404, json: async () => ({}) }
  })
}
const toursWrites = (id) => global.fetch.mock.calls
  .filter(([u, init = {}]) => u === '/api/auth/preferences' && init.method === 'POST')
  .map(([, init]) => JSON.parse(init.body))
  .filter((b) => b.key === TOURS_PREF)
  .map((b) => JSON.parse(b.value)[id])
  .filter(Boolean)

const tour = (id, steps, extra = {}) => ({
  id,
  title: id,
  replayable: true,
  load: async () => ({
    steps,
    copy: Object.fromEntries(steps.map((s) => [s.id, { title: `${id} ${s.id}`, body: `Body of ${s.id}.` }])),
  }),
  ...extra,
})

let seen = null
function Probe() { const l = useLocation(); seen = l.pathname + l.search; return null }

function Shell({ children, initial = '/journal/notebook' }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[initial]}>
        <Probe />
        {children}
      </MemoryRouter>
    </SWRConfig>
  )
}

beforeEach(() => {
  server = { prefs: {} }
  seen = null
  installFetch()
  installTourLayout()
})
afterEach(() => { vi.restoreAllMocks() })

const card = (name) => screen.findByRole('dialog', { name }, { timeout: 3000 })

// ── (c) dynamic steps ───────────────────────────────────────────────────────────────────────
describe('(c) the step list is re-evaluated on every Next', () => {
  const T = tour('c-behind', [
    { id: 'door', anchor: 'c-door', file: 'x' },
    { id: 'panel', anchor: 'c-panel', file: 'x' },
  ])

  function Page({ panelAt = null }) {
    const [open, setOpen] = useState(false)
    return (
      <Shell>
        <button type="button" data-tour="c-door" onClick={() => setOpen(true)}>Open the panel</button>
        {open && <section data-tour="c-panel">panel</section>}
        <button type="button" data-testid="open-panel-now" onClick={() => setOpen(true)} data-test-box={panelAt ?? undefined}>external</button>
        <GenericTourEngine entry={T} onClose={() => {}} stepWaitMs={1500} />
      </Shell>
    )
  }

  it('a step whose anchor appears AFTER the tour opened is shown, not dropped', async () => {
    render(<Page />)
    await card('c-behind door')
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // the panel opens while Next is waiting (a click outside the modal card's layer, as the
    // page's own code would do it)
    act(() => { screen.getByTestId('open-panel-now').click() })
    expect(await card('c-behind panel')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
    await waitFor(() => expect(toursWrites('c-behind').map((w) => w.step)).toEqual(['door', 'panel']))
  })

  it('Back re-checks too: it goes to the nearest earlier step that is on screen', async () => {
    const T3 = tour('c-back', [
      { id: 'a', anchor: 'b-a', file: 'x' },
      { id: 'gone', anchor: 'b-gone', file: 'x' },
      { id: 'c', anchor: 'b-c', file: 'x' },
    ])
    render(
      <Shell>
        <div data-tour="b-a">a</div>
        <div data-tour="b-c">c</div>
        <GenericTourEngine entry={T3} onClose={() => {}} stepWaitMs={100} />
      </Shell>,
    )
    await card('c-back a')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await card('c-back c')).toBeInTheDocument()
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await card('c-back a')).toBeInTheDocument()
  })
})

describe('(c) a `waitFor` step: "do this to continue"', () => {
  const T = tour('c-wait', [
    { id: 'door', anchor: 'w-door', file: 'x', waitFor: 'w-panel' },
    { id: 'panel', anchor: 'w-panel', file: 'x' },
    { id: 'after', anchor: 'w-after', file: 'x' },
  ])

  function Page() {
    const [open, setOpen] = useState(false)
    return (
      <Shell>
        <button type="button" data-tour="w-door" onClick={() => setOpen(true)}>Plan</button>
        {open && <section data-tour="w-panel">the plan panel</section>}
        <div data-tour="w-after">after</div>
        <GenericTourEngine entry={T} onClose={() => {}} />
      </Shell>
    )
  }

  it('is non-modal, asks the member to act, and moves on when they do', async () => {
    const user = userEvent.setup()
    render(<Page />)
    const d = await card('c-wait door')
    expect(d).not.toHaveAttribute('aria-modal')
    expect(d).toHaveAttribute('data-tour-card', 'non-modal')
    expect(screen.getByRole('status')).toHaveTextContent('Do this to continue')
    // the member really clicks the page's own control: nothing holds the page still
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    const next = await card('c-wait panel')
    expect(next).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(toursWrites('c-wait').map((w) => w.step)).toEqual(['door', 'panel']))
  })

  it('Next still skips the action for a member who does not want to do it', async () => {
    render(<Page />)
    await card('c-wait door')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    // the panel never opens: after the bounded wait the tour goes on to the next step on screen
    expect(await card('c-wait after')).toBeInTheDocument()
  })
})

// ── (e) sheets and focus ───────────────────────────────────────────────────────────────────
describe('(e) a step inside a Sheet', () => {
  const T = tour('e-sheet', [
    { id: 'in', anchor: 'e-in', file: 'x' },
    { id: 'in2', anchor: 'e-in2', file: 'x' },
  ])

  function Page({ onSheetClose }) {
    return (
      <Shell>
        <button type="button">page button</button>
        <Sheet open onClose={onSheetClose} title="The sheet" labelledByTitle variant="modal">
          <input aria-label="sheet field" />
          <p data-tour="e-in">inside the sheet</p>
          <p data-tour="e-in2">also inside</p>
        </Sheet>
        <GenericTourEngine entry={T} onClose={() => {}} />
      </Shell>
    )
  }

  it('the card is non-modal and placed INSIDE the sheet, so the sheet stays the one modal', async () => {
    render(<Page onSheetClose={() => {}} />)
    const d = await card('e-sheet in')
    expect(d).not.toHaveAttribute('aria-modal')
    expect(d.closest('[data-sheet-panel]')).not.toBeNull()
  })

  it('one Escape closes the TOUR only; the next Escape closes the sheet', async () => {
    const onSheetClose = vi.fn()
    render(<Page onSheetClose={onSheetClose} />)
    await card('e-sheet in')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'e-sheet in' })).toBeNull()
    expect(onSheetClose).not.toHaveBeenCalled()
    await waitFor(() => expect(toursWrites('e-sheet').at(-1)).toEqual({ v: 1, state: 'dismissed', step: 'in' }))
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    expect(onSheetClose).toHaveBeenCalledTimes(1)
  })

  it('Tab is not trapped by the card: it walks the sheet\'s ring, which includes the card', async () => {
    const user = userEvent.setup()
    render(<Page onSheetClose={() => {}} />)
    const d = await card('e-sheet in')
    const panel = d.closest('[data-sheet-panel]')
    const reached = new Set()
    for (let i = 0; i < 12; i += 1) {
      await user.tab()
      expect(panel.contains(document.activeElement), `Tab ${i} left the sheet`).toBe(true)
      reached.add(d.contains(document.activeElement) ? 'card' : 'sheet')
    }
    expect([...reached].sort()).toEqual(['card', 'sheet'])
  })
})

describe('(e) Escape belongs to the TOPMOST layer', () => {
  const T = tour('e-top', [
    { id: 'p', anchor: 'e-page', file: 'x' },
    { id: 'q', anchor: 'e-page2', file: 'x' },
  ])

  function Page({ sheetOpen, onSheetClose }) {
    return (
      <Shell>
        <div data-tour="e-page">on the page</div>
        <div data-tour="e-page2">also on the page</div>
        <GenericTourEngine entry={T} onClose={() => {}} />
        <Sheet open={sheetOpen} onClose={onSheetClose} title="Opened later" labelledByTitle variant="modal">
          <input aria-label="later field" />
        </Sheet>
      </Shell>
    )
  }

  it('a modal tour over the page: Escape closes the tour (control)', async () => {
    render(<Page sheetOpen={false} onSheetClose={() => {}} />)
    const d = await card('e-top p')
    expect(d).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'e-top p' })).toBeNull()
  })

  it('a sheet opened ABOVE the tour: Escape closes the sheet, and the tour stays', async () => {
    const onSheetClose = vi.fn()
    const { rerender } = render(<Page sheetOpen={false} onSheetClose={onSheetClose} />)
    await card('e-top p')
    rerender(<Page sheetOpen onSheetClose={onSheetClose} />)
    await screen.findByRole('dialog', { name: 'Opened later' })
    fireEvent.keyDown(screen.getByLabelText('later field'), { key: 'Escape' })
    expect(onSheetClose).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'e-top p' })).toBeInTheDocument()
  })
})

// ── (b) starts that open a note or a trade ─────────────────────────────────────────────────
describe('(b) an in-note start opens a suitable note, never creates one', () => {
  const T = tour('b-note', [
    { id: 'chart', anchor: 'b-chart', file: 'x' },
    { id: 'more', anchor: 'b-more', file: 'x' },
  ], { start: { note: 'sample:plan', embed: 'chart' } })

  function NoteScreen() {
    const l = useLocation()
    const id = new URLSearchParams(l.search).get('note')
    return id === 's-plan' ? <div data-tour="b-chart">the example chart</div> : null
  }

  it('opens the W14-E example note and the tour starts there', async () => {
    installFetch((url) => (url === '/api/j2/notes/import/check'
      ? { ok: true, status: 200, json: async () => ({ existing: { [`${SAMPLE_IMPORT_PREFIX}plan`]: { id: 's-plan' } } }) }
      : null))
    render(
      <Shell initial="/support">
        <Routes><Route path="*" element={<NoteScreen />} /></Routes>
        <GenericTourEngine entry={T} onClose={() => {}} />
      </Shell>,
    )
    expect(await card('b-note chart')).toBeInTheDocument()
    expect(seen).toBe('/journal/notebook?note=s-plan')
    const posts = global.fetch.mock.calls.filter(([u, i = {}]) => i.method === 'POST' && u !== '/api/auth/preferences')
    expect(posts.map(([u]) => u)).toEqual(['/api/j2/notes/import/check'])    // the one read, nothing written
  })

  it('with no note to open: a card that says so, a way out, nothing recorded', async () => {
    installFetch((url) => {
      if (url === '/api/j2/notes/import/check') return { ok: true, status: 200, json: async () => ({ existing: {} }) }
      if (url.startsWith('/api/j2/notes?')) return { ok: true, status: 200, json: async () => ({ notes: [] }) }
      return null
    })
    const onClose = vi.fn()
    render(
      <Shell initial="/support">
        <GenericTourEngine entry={T} onClose={onClose} />
      </Shell>,
    )
    const d = await card('This walkthrough runs inside a note')
    expect(d).toHaveTextContent('You do not have a note it can open yet')
    fireEvent.click(screen.getByRole('button', { name: 'Go to the Notebook' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(seen).toBe('/journal/notebook')
    expect(toursWrites('b-note')).toEqual([])
  })

  it('a trade start opens the most recent trade page', async () => {
    installFetch((url) => (url.startsWith('/api/j2/trades?')
      ? { ok: true, status: 200, json: async () => ({ trades: [{ id: 77 }] }) }
      : null))
    const TT = tour('b-trade', [{ id: 'g', anchor: 'b-grade', file: 'x' }, { id: 'h', anchor: 'b-x', file: 'x' }], { start: { trade: 'recent' } })
    function TradeScreen() { const l = useLocation(); return l.pathname === '/journal-2-0/trade/77' ? <div data-tour="b-grade">grade</div> : null }
    render(
      <Shell initial="/journal">
        <Routes><Route path="*" element={<TradeScreen />} /></Routes>
        <GenericTourEngine entry={TT} onClose={() => {}} />
      </Shell>,
    )
    expect(await card('b-trade g')).toBeInTheDocument()
    expect(seen).toBe('/journal-2-0/trade/77')
  })
})

// ── (d) start detection, through the engine ────────────────────────────────────────────────
describe('(d) a Home tour opened on an open note goes Home', () => {
  const T = tour('d-home', [
    { id: 'list', anchor: 'd-home-list', file: 'x' },
    { id: 'x', anchor: 'd-home-x', file: 'x' },
  ], { start: '/journal/notebook' })

  function Notebook() {
    const l = useLocation()
    const home = !new URLSearchParams(l.search).get('note')
    return home ? <div data-tour="d-home-list">Reporting soon</div> : <div>an open note</div>
  }

  it('navigates from ?note= to Home and opens there', async () => {
    render(
      <Shell initial="/journal/notebook?note=n1">
        <Routes><Route path="/journal/notebook" element={<Notebook />} /></Routes>
        <GenericTourEngine entry={T} onClose={() => {}} />
      </Shell>,
    )
    expect(await card('d-home list')).toBeInTheDocument()
    expect(seen).toBe('/journal/notebook')
  })
})

// ── (f) the passive explainer ──────────────────────────────────────────────────────────────
describe('(f) a replayable:false entry is a light explainer, not a stepper', () => {
  const P = tour('f-explain', [
    { id: 'then', anchor: 'f-then', file: 'x' },
    { id: 'back', anchor: 'f-back', file: 'x' },
  ], { replayable: false })

  function Page({ onClose = () => {} }) {
    return (
      <Shell>
        <button type="button">where focus was</button>
        <div data-tour="f-then">what you wrote then</div>
        <div data-tour="f-back">back</div>
        <GenericTourEngine entry={P} onClose={onClose} />
      </Shell>
    )
  }

  it('a non-modal note: no dialog, no stepper, no focus taken, every sentence on one card', async () => {
    render(<Page />)
    screen.getByRole('button', { name: 'where focus was' }).focus()
    const note = await screen.findByRole('complementary', { name: 'f-explain then' }, { timeout: 3000 })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/Step \d of/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
    expect(note).toHaveTextContent('Body of then.')
    expect(note).toHaveTextContent('Body of back.')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'where focus was' }))
  })

  it('"Got it" records it done', async () => {
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    await screen.findByRole('complementary', {}, { timeout: 3000 })
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(toursWrites('f-explain').at(-1)).toEqual({ v: 1, state: 'done', step: 'back' }))
  })

  it('shown ONCE per member: a member with any row for it sees nothing', async () => {
    server.prefs = { [TOURS_PREF]: JSON.stringify({ 'f-explain': { v: 1, state: 'started', step: 'then' } }) }
    const onClose = vi.fn()
    render(<Page onClose={onClose} />)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('complementary')).toBeNull()
  })
})

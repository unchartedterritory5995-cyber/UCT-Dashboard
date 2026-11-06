// Audit 2026-11-05, S16 (M2): the 60-second first run -- when it shows, what it asks (M2's words), what Build writes
// through the existing doors (once, however often it is pressed), the build list, Skip and Undo.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { __resetMyNamesQueue } from '../../lib/myNames'
import { FIRST_RUN_MARKS, FIRST_RUN_STATE, firstRunIsDue, setFirstRunShowing, useFirstRunShowing } from '../../lib/firstRun'
import FirstRunGate, { FirstRunInlineSlot } from './FirstRunGate'
import { FIRST_RUN_COPY, FIRST_RUN_PACKS, ROW_STAGGER_MS } from './FirstRunSheet'

const P = vi.hoisted(() => ({ prefs: {}, writes: [] }))
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    prefs: P.prefs, loading: false, readFailed: false,
    setPrefMerged: (key, updater) => {
      const next = updater(P.prefs[key])
      if (next !== undefined) { P.prefs = { ...P.prefs, [key]: next }; P.writes.push([key, next]) }
      return Promise.resolve({ ok: true })
    },
  }),
}))

const S = { lists: [], calls: [], dailyOk: true }
const json = (status, body) => Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) })

beforeEach(() => {
  __resetMyNamesQueue()
  P.prefs = {}
  P.writes = []
  S.lists = []
  S.calls = []
  S.dailyOk = true
  latchNotebookFlags({ notebook_starter_packs_enabled: true })
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const u = String(url)
    const method = opts.method || 'GET'
    const body = opts.body ? JSON.parse(opts.body) : null
    S.calls.push({ method, url: u, body })
    if (u.startsWith('/api/j2/template-gallery?')) {
      return json(200, { templates: ['Daily prep', 'Trade plan', 'Weekly review'].map((title) => ({ kind: 'firm', title })) })
    }
    if (u.startsWith('/api/ticker-search?')) return json(200, { results: [{ ticker: 'CRWD', name: 'CrowdStrike' }, { ticker: 'CRM', name: 'Salesforce' }] })
    if (u.startsWith('/api/watchlists?')) return json(200, S.lists.map((l) => ({ ...l, items: [...l.items] })))
    if (u === '/api/watchlists' && method === 'POST') {
      const l = { id: `wl${S.lists.length + 1}`, name: body.name, items: [] }
      S.lists.push(l)
      return json(200, l)
    }
    const m = /^\/api\/watchlists\/([^/]+)\/items\/bulk$/.exec(u)
    if (m) {
      const l = S.lists.find((x) => x.id === m[1])
      for (const sym of body.symbols) if (!l.items.some((i) => i.sym === sym)) l.items.push({ sym })
      return json(200, { added: body.symbols.length })
    }
    if (u === '/api/j2/journal-styles/starter-packs/swing') {
      return json(200, { installed: [{ styleId: 's1', title: 'Daily prep' }, { styleId: 's2', title: 'Trade plan' }, { styleId: 's3', title: 'Weekly review' }], alreadyHad: [], skipped: [] })
    }
    if (u === '/api/j2/notes/daily') return S.dailyOk ? json(200, { note: { id: 'd1', title: '2026-11-05 · Thursday' }, created: true }) : json(500, {})
    if (u.startsWith('/api/j2/journal-styles/') && method === 'DELETE') return json(200, { ok: true })
    if (u === '/api/j2/telemetry') return json(200, { ok: true })
    return json(404, { detail: 'Not found' })
  }))
  window.matchMedia = vi.fn((q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); __resetNotebookFlags() })

let lastLocation = null
function Spy() { lastLocation = useLocation(); return null }
function mount(props = {}, entry = '/journal/notebook') {
  const onOpenNote = vi.fn()
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes><Route path="*" element={<><Spy /><FirstRunGate hasAnyNotes={false} notesKnown onOpenNote={onOpenNote} {...props} /></>} /></Routes>
    </MemoryRouter>,
  )
  return { onOpenNote }
}
const seen = () => new Set(P.prefs.notebook_tips?.seen || [])
const telemetry = () => S.calls.filter((c) => c.url === '/api/j2/telemetry').map((c) => c.body)

describe('when it shows', () => {
  it('opens by itself on a first visit (no notes), and records that it showed', async () => {
    mount()
    expect(await screen.findByRole('dialog', { name: 'Make the Notebook yours' })).toBeInTheDocument()
    await waitFor(() => expect(seen().has(FIRST_RUN_MARKS.shown)).toBe(true))
  })

  it('CONTROL: not for a member with notes, not once seen, not while the counts load, not with the packs off', () => {
    expect(firstRunIsDue({ enabled: true, prefsReady: true, tipsRaw: null, notesKnown: true, hasAnyNotes: false })).toBe(true)
    expect(firstRunIsDue({ enabled: true, prefsReady: true, tipsRaw: null, notesKnown: true, hasAnyNotes: true })).toBe(false)
    expect(firstRunIsDue({ enabled: true, prefsReady: true, tipsRaw: { v: 1, seen: ['first-run'] }, notesKnown: true, hasAnyNotes: false })).toBe(false)
    expect(firstRunIsDue({ enabled: true, prefsReady: true, tipsRaw: null, notesKnown: false, hasAnyNotes: false })).toBe(false)
    expect(firstRunIsDue({ enabled: true, prefsReady: false, tipsRaw: null, notesKnown: true, hasAnyNotes: false })).toBe(false)
    expect(firstRunIsDue({ enabled: false, prefsReady: true, tipsRaw: null, notesKnown: true, hasAnyNotes: false })).toBe(false)
    mount({ hasAnyNotes: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Settings opens it again for anyone, once (the request is dropped from the history entry)', async () => {
    P.prefs = { notebook_tips: { v: 1, seen: ['first-run', 'first-run-built'] } }
    const onOpenNote = vi.fn()
    render(
      <MemoryRouter initialEntries={[{ pathname: '/journal/notebook', state: { [FIRST_RUN_STATE]: true } }]}>
        <Routes><Route path="*" element={<><Spy /><FirstRunGate hasAnyNotes notesKnown onOpenNote={onOpenNote} /></>} /></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('dialog', { name: 'Make the Notebook yours' })).toBeInTheDocument()
    await waitFor(() => expect(lastLocation.state?.[FIRST_RUN_STATE]).toBeUndefined())
  })

  it('while it is up the tour waits (one first-run moment at a time)', () => {
    let read = null
    function Probe() { read = useFirstRunShowing(); return null }
    render(<Probe />)
    expect(read).toBe(false)
    act(() => setFirstRunShowing(true))
    expect(read).toBe(true)
    act(() => setFirstRunShowing(false))
  })
})

describe('step 1 says M2, word for word', () => {
  it('the two questions, the five answers, the promise and the two buttons', async () => {
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    expect(d).toHaveTextContent('Step 1 of 2')
    expect(d).toHaveTextContent('about 60 seconds')
    expect(within(d).getByRole('group', { name: 'How do you trade?' })).toBeInTheDocument()
    expect(FIRST_RUN_PACKS.map((p) => p.label)).toEqual(['Swing', 'Day', 'Options', 'Earnings', 'Prop / funded'])
    for (const p of FIRST_RUN_PACKS) expect(within(d).getByRole('button', { name: p.label })).toHaveAttribute('aria-pressed', 'false')
    expect(d).toHaveTextContent("Three tickers you're watching right now")
    expect(d).toHaveTextContent('We use these to fill your daily plan, earnings, and setups. You can change them anytime. Your notes are always yours to export.')
    expect(within(d).getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
    expect(within(d).getByRole('button', { name: 'Build my Notebook →' })).toBeInTheDocument()
  })

  it('a chosen pack previews what it adds, from the Template library', async () => {
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    fireEvent.click(within(d).getByRole('button', { name: 'Swing' }))
    expect(await within(d).findByText('Adds Swing templates: Daily prep · Trade plan · Weekly review. You can undo it.')).toBeInTheDocument()
    expect(S.calls.some((c) => c.url === '/api/j2/template-gallery?type=style&trading_style=swing')).toBe(true)
    expect(S.calls.some((c) => c.method === 'POST')).toBe(false)              // choosing writes nothing
  })

  it('tickers come from /api/ticker-search, at most three', async () => {
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    const input = within(d).getByRole('combobox', { name: 'Add a ticker' })
    fireEvent.change(input, { target: { value: 'cr' } })
    const opt = await within(d).findByRole('option', { name: /CRWD/ })
    fireEvent.mouseDown(opt)
    expect(within(d).getByRole('list', { name: 'Your tickers' })).toHaveTextContent('CRWD')
    for (const t of ['NVDA', 'AMD']) {
      fireEvent.change(within(d).getByRole('combobox'), { target: { value: t } })
      fireEvent.keyDown(within(d).getByRole('combobox'), { key: 'Enter' })
    }
    expect(within(d).queryByRole('combobox')).toBeNull()                      // three is the most
    expect(within(d).getAllByRole('button', { name: /^Remove / })).toHaveLength(3)
  })
})

async function fillAndBuild(d, { press = 1 } = {}) {
  fireEvent.click(within(d).getByRole('button', { name: 'Swing' }))
  for (const t of ['NVDA', 'AMD']) {
    fireEvent.change(within(d).getByRole('combobox'), { target: { value: t } })
    fireEvent.keyDown(within(d).getByRole('combobox'), { key: 'Enter' })
  }
  const build = within(d).getByRole('button', { name: 'Build my Notebook →' })
  // Both presses inside ONE act: React has not re-rendered in between, so the button is not disabled yet -- only the
  // press latch can stop the second one (the double click a slow device delivers).
  act(() => { for (let i = 0; i < press; i += 1) build.click() })
}

describe('Build my Notebook', () => {
  it('writes the names, the pack and today\'s plan through the existing doors, ONCE on a double press', async () => {
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d, { press: 2 })
    await within(d).findByText(/Watchlist "My names" created with NVDA, AMD/)
    const posts = S.calls.filter((c) => c.method === 'POST' && c.url !== '/api/j2/telemetry').map((c) => c.url)
    expect(posts).toEqual([
      '/api/watchlists', '/api/watchlists/wl1/items/bulk',
      '/api/j2/journal-styles/starter-packs/swing',
      '/api/j2/notes/daily',
    ])
    expect(S.lists).toHaveLength(1)
    expect(P.prefs.notebook_starter_pack).toMatchObject({ v: 1, state: 'installed', pack: 'swing' })
    expect(seen().has(FIRST_RUN_MARKS.built)).toBe(true)
    const done = telemetry().filter((t) => t.event === 'first_run_completed')
    expect(done).toHaveLength(1)
    expect(done[0].props).toMatchObject({ names: 2, pack: 'swing', plan: true })
    expect(Object.keys(done[0].props).sort()).toEqual(['ms', 'names', 'pack', 'plan'])  // never a ticker
  })

  it('an existing "My names" is added to, never made again', async () => {
    S.lists = [{ id: 'mine', name: 'My names', items: [{ sym: 'TSLA' }] }]
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    await within(d).findByText(/Watchlist "My names" now has NVDA, AMD/)
    expect(S.calls.some((c) => c.method === 'POST' && c.url === '/api/watchlists')).toBe(false)
    expect(S.lists[0].items.map((i) => i.sym)).toEqual(['TSLA', 'NVDA', 'AMD'])
  })

  it('step 2 is M2\'s build list, row by row within 1.5 s, ending on the "Try it" row', async () => {
    expect(ROW_STAGGER_MS * 3 + 300).toBeLessThanOrEqual(1500)
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    const list = await within(d).findByRole('list', { name: 'What was built' })
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(4), { timeout: 2000 })
    const rows = within(list).getAllByRole('listitem').map((li) => li.textContent)
    expect(rows[0]).toBe('Watchlist "My names" created with NVDA, AMD')
    expect(rows[1]).toBe('Swing templates added: Daily prep · Trade plan · Weekly review (preview · undo)')
    expect(rows[2]).toContain("Today's plan written")
    expect(within(list).getByRole('link', { name: 'Try it: draw entry, stop and target on NVDA, and watch the setups board track it →' }))
      .toHaveAttribute('href', '/journal/notebook/research/NVDA')
    expect(d).toHaveTextContent('Step 2 of 2')
  })

  it('under prefers-reduced-motion every row is there at once', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    const list = await within(d).findByRole('list', { name: 'What was built' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(4)
  })

  it('Undo takes the added templates back (their own soft delete) and records the answer as dismissed', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    fireEvent.click(await within(d).findByRole('button', { name: 'undo' }))
    await within(d).findByText('Templates removed. They are in Recently deleted if you want them back.')
    expect(S.calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([
      '/api/j2/journal-styles/s1', '/api/j2/journal-styles/s2', '/api/j2/journal-styles/s3'])
    expect(P.prefs.notebook_starter_pack).toMatchObject({ state: 'dismissed' })
  })

  it('Done closes on today\'s plan', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    const { onOpenNote } = mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    fireEvent.click(await within(d).findByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }))
  })

  // Audit 2026-11-05, S15: once the Notebook has a Today home, Done closes onto it; "Open it" still opens the plan.
  it('with a Today home, Done closes onto Today', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    const onOpenToday = vi.fn()
    const { onOpenNote } = mount({ onOpenToday })
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    fireEvent.click(await within(d).findByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onOpenToday).toHaveBeenCalledTimes(1)
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('with a Today home, "Open it" opens the plan note, not Today', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    const onOpenToday = vi.fn()
    const { onOpenNote } = mount({ onOpenToday })
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    fireEvent.click(await within(d).findByRole('button', { name: 'Open it' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'd1' }))
    expect(onOpenToday).not.toHaveBeenCalled()
  })
})

describe('Skip', () => {
  it('closes, records the skip, and Home then asks the same two things inline', async () => {
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    fireEvent.click(within(d).getByRole('button', { name: 'Skip for now' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(seen().has(FIRST_RUN_MARKS.skipped)).toBe(true)
    expect(telemetry().filter((t) => t.event === 'first_run_skipped')).toEqual([{ event: 'first_run_skipped', props: { step: 1 } }])
    expect(S.calls.some((c) => c.method === 'POST' && c.url !== '/api/j2/telemetry')).toBe(false)   // nothing built
    cleanup()
    render(<MemoryRouter><FirstRunInlineSlot onOpenNote={vi.fn()} /></MemoryRouter>)
    const inline = await screen.findByRole('region', { name: FIRST_RUN_COPY.title })
    expect(within(inline).getByRole('group', { name: 'How do you trade?' })).toBeInTheDocument()
    expect(within(inline).getByRole('button', { name: 'Build my Notebook →' })).toBeInTheDocument()
  })

  it('CONTROL: no inline ask before a skip, or after a build', () => {
    render(<MemoryRouter><FirstRunInlineSlot /></MemoryRouter>)
    expect(screen.queryByRole('region')).toBeNull()
    cleanup()
    P.prefs = { notebook_tips: { v: 1, seen: ['first-run', 'first-run-skipped', 'first-run-built'] } }
    render(<MemoryRouter><FirstRunInlineSlot /></MemoryRouter>)
    expect(screen.queryByRole('region')).toBeNull()
  })
})

describe('one "How do you trade?" at a time', () => {
  it('the inline starter-pack card does not ask while the first run is on screen, and may once it closes', async () => {
    const { useStarterPackOffer, __resetStarterPackOfferForTests } = await import('./styles/StarterPackOffer')
    __resetStarterPackOfferForTests()
    let offer = null
    function Probe() { offer = useStarterPackOffer({ styles: [] }); return null }
    act(() => setFirstRunShowing(true))
    const { unmount } = render(<Probe />)
    expect(offer.show).toBe(false)
    unmount()
    act(() => setFirstRunShowing(false))
    render(<Probe />)
    await waitFor(() => expect(offer.show).toBe(true))                  // CONTROL: the card itself still works
  })
})

describe('Tier 3a fix round 1', () => {
  it('minor 7: Escape while Build runs neither closes the sheet nor records a Skip', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const real = global.fetch
    global.fetch = vi.fn((url, opts) => (String(url) === '/api/j2/notes/daily' ? gate.then(() => real(url, opts)) : real(url, opts)))
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    await waitFor(() => expect(within(d).getByRole('button', { name: FIRST_RUN_COPY.building })).toBeDisabled())
    fireEvent.keyDown(document.activeElement || d, { key: 'Escape' })
    fireEvent.keyDown(d, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: FIRST_RUN_COPY.title })).toBeInTheDocument()
    release()
    await within(d).findByRole('list', { name: 'What was built' })
    expect(seen().has(FIRST_RUN_MARKS.skipped)).toBe(false)
    expect(telemetry().some((t) => t.event === 'first_run_skipped')).toBe(false)
  })

  it('minor 8: a double press on Undo removes each template once', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    await fillAndBuild(d)
    const undo = await within(d).findByRole('button', { name: 'undo' })
    act(() => { undo.click(); undo.click() })
    await within(d).findByText('Templates removed. They are in Recently deleted if you want them back.')
    expect(S.calls.filter((c) => c.method === 'DELETE')).toHaveLength(3)
  })

  it('minor 12: the tickers question names its group, and step 2 takes focus on its heading with a live list', async () => {
    window.matchMedia = vi.fn((q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    mount()
    const d = await screen.findByRole('dialog', { name: FIRST_RUN_COPY.title })
    expect(within(d).getByRole('group', { name: "Three tickers you're watching right now" })).toBeInTheDocument()
    await fillAndBuild(d)
    const head = await within(d).findByRole('heading', { name: 'Step 2 of 2' })
    await waitFor(() => expect(document.activeElement).toBe(head))
    expect(within(d).getByRole('list', { name: 'What was built' })).toHaveAttribute('aria-live', 'polite')
  })

  it('minor 6: when a race made a second "My names", names go to the OLDEST', async () => {
    const { addMyNames } = await import('../../lib/myNames')
    // Another device made one in the same moment: this tab's read saw none, its create is the second.
    let reads = 0
    const real = global.fetch
    global.fetch = vi.fn((url, opts = {}) => {
      const u = String(url)
      if (u.startsWith('/api/watchlists?')) {
        reads += 1
        const lists = reads === 1 ? [] : [{ id: 'twin', name: 'My names', created_at: '2026-11-05T10:00:01Z', items: [] },
          { id: 'first', name: 'My names', created_at: '2026-11-05T10:00:00Z', items: [] }]
        return json(200, lists)
      }
      if (u === '/api/watchlists' && opts.method === 'POST') return json(200, { id: 'twin', name: 'My names' })
      return real(url, opts)
    })
    S.lists = [{ id: 'first', name: 'My names', items: [] }]
    const out = await addMyNames(['NVDA'])
    expect(out.listId).toBe('first')
    expect(S.calls.some((c) => c.url === '/api/watchlists/first/items/bulk')).toBe(true)
  })
})

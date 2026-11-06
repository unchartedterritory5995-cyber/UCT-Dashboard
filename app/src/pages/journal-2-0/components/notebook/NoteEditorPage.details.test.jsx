/**
 * Notebook UX pass (2026-10-10) -- BODY FIRST, and ONE ticker.
 *
 * Owner's words: "oh wow this is easy and simple to use but has tons of cool stuff". Before this
 * pass a real note stacked subtitle, tags, "+ Add evidence", four property rows, the thesis review
 * line and a changelog between the title and the body, and the header carried a SECOND ticker box
 * beside the read-only Ticker property row.
 *
 * What this file holds, through the REAL editor, the REAL PropertiesSection and ThesisSection:
 *   1. the details are folded behind ONE line under the title, collapsed by default;
 *   2. that line names only what has a value (`#thesis · NVDA · Technology · 3 properties ·
 *      Not reviewed`), and a bare note shows only a quiet "Add details";
 *   3. the toggle is a real button (aria-expanded, aria-controls) and reveals the EXISTING
 *      controls in place -- hidden, never unmounted, so a half-typed value survives a collapse;
 *   4. the choice is remembered per browser, and a browser that refuses storage still renders;
 *   5. exactly ONE editable ticker control, and its check still says what it refused;
 *   6. keyboard order: title, then the details toggle, then the body.
 */
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NOTE_DETAILS_PREF_KEY } from './NoteDetailsLine'
import { publishRegistryTourWanted, __resetRegistryTourControl } from './onboarding/tourRegistryControl'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body words' }] }] }
const bareNote = () => ({
  id: 'n1', title: 'A plain note', subtitle: '', folderId: null, ticker: null, tags: [],
  heroImageUrl: null, updatedAt: 'T1', isFavorite: false, bodyJson: BODY,
})
const thesisNote = () => ({ ...bareNote(), title: 'NVDA thesis', ticker: 'NVDA', tags: ['thesis'] })

let NOTE = bareNote()
let PROPERTIES = []
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({
    note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn(), patchTags: vi.fn(),
  }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
// S6: the editor tells the note views when a title has landed (and when a note moved).
const invalidateSpy = vi.hoisted(() => vi.fn())
vi.mock('../../lib/offline/invalidateNoteViews', async (importOriginal) => ({
  ...(await importOriginal()),
  invalidateNoteViews: (...args) => invalidateSpy(...args),
}))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [{ id: 'f9', name: 'Swing ideas', parentId: null }] }) }))

const derived = (id, name, value) => ({ id, name, type: 'text', source: 'financial_derived', value })
const NVDA_PROPERTIES = [
  derived('builtin:ticker', 'Ticker', 'NVDA'),
  derived('builtin:sector', 'Sector', 'Technology'),
  derived('builtin:industry', 'Industry', 'Semiconductors'),
  derived('builtin:theme', 'Theme', 'AI Compute'),
  { id: 'p-conv', name: 'Conviction', type: 'text', source: 'user_set', value: null },
]

beforeEach(() => {
  localStorage.clear()
  NOTE = bareNote()
  PROPERTIES = []
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: 'T2' }))
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u === '/api/j2/notes/n1/properties') return { ok: true, json: async () => ({ properties: PROPERTIES }) }
    if (u === '/api/j2/notes/n1/thesis-summary') return { ok: true, json: async () => ({ evidence: [], changelog: [] }) }
    if (u === '/api/j2/notes/n1/reviews') return { ok: true, json: async () => ({ reviews: [], attention: null }) }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  // A fresh SWR cache per render, so one test's properties never answer the next one's.
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>
    </SWRConfig>,
  )
  await screen.findByPlaceholderText('Title')
  await waitFor(() => { if (!view.container.querySelector('.ProseMirror')) throw new Error('no body yet') })
  return view
}
const toggle = () => screen.getByRole('button', { name: /^(add )?details$/i })
const region = () => {
  const ids = toggle().getAttribute('aria-controls').split(' ')
  return document.getElementById(ids[ids.length - 1])
}
const summary = (container) => container.querySelector('[data-note-details-summary]')

describe('body first: the details fold behind one line under the title', () => {
  it('is collapsed by default: the toggle says so and the controls are hidden, not gone', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    await renderEditor()
    expect(toggle().tagName).toBe('BUTTON')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(region().hidden).toBe(true)
    // Hidden from the member and from assistive tech...
    expect(screen.queryByRole('textbox', { name: 'Ticker' })).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'Add a tag to this note' })).toBeNull()
    // ...but MOUNTED (a collapse must never throw away local state).
    expect(within(region()).getByLabelText('Ticker')).toBeTruthy()
    // The body is right there.
    expect(screen.getByText('Body words')).toBeTruthy()
  })

  it('a bare note shows only a quiet "Add details", with no summary', async () => {
    const { container } = await renderEditor()
    expect(toggle().textContent).toBe('Add details')
    expect(summary(container)).toBeNull()
  })

  it('the line names only what has a value: tags, ticker, sector, how many properties, review state', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    const { container } = await renderEditor()
    await waitFor(() => expect(summary(container)?.textContent).toContain('Not reviewed'))
    const parts = [...summary(container).querySelectorAll('[class*="item"]')].map((el) => el.textContent)
    // Sector, Industry, Theme are filled; the empty Conviction is not; the ticker is its own field.
    expect(parts).toEqual(['#thesis', 'NVDA', 'Technology', '3 properties', 'Not reviewed'])
    expect(toggle().textContent).toBe('Details')
  })

  it('a note that is not a thesis never claims a review state', async () => {
    NOTE = { ...bareNote(), ticker: 'AMD', tags: ['earnings'] }
    PROPERTIES = [derived('builtin:ticker', 'Ticker', 'AMD')]
    const { container } = await renderEditor()
    await waitFor(() => expect(summary(container)?.textContent).toContain('AMD'))
    expect(summary(container).textContent).not.toMatch(/review/i)
    expect(global.fetch.mock.calls.map(([u]) => String(u))).not.toContain('/api/j2/notes/n1/reviews')
  })

  it('the toggle reveals the EXISTING controls in place: subtitle, tags, ticker, properties, evidence, review, changelog', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    await renderEditor()
    expect(screen.queryByRole('textbox', { name: 'Subtitle' })).toBeNull()
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(region().hidden).toBe(false)
    expect(screen.getByRole('textbox', { name: 'Subtitle' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Add a tag to this note' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Ticker' })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Add property/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Add evidence/ })).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Review thesis/ })).toBeTruthy()
    expect(screen.getByText('This thesis has not been reviewed yet.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Changelog/ })).toBeTruthy()
    // aria-controls names both things it shows: the subtitle and the region.
    const controls = toggle().getAttribute('aria-controls').split(' ')
    expect(controls).toHaveLength(2)
    expect(document.getElementById(controls[0])).toBe(screen.getByRole('textbox', { name: 'Subtitle' }))
  })

  it('a subtitle with words is CONTENT: it stays on screen while the details are collapsed', async () => {
    NOTE = { ...bareNote(), subtitle: 'Why the datacenter cycle has legs' }
    await renderEditor()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('textbox', { name: 'Subtitle' }).value).toBe('Why the datacenter cycle has legs')
  })

  it('hidden, never unmounted: a half-typed property name survives a collapse', async () => {
    PROPERTIES = NVDA_PROPERTIES
    await renderEditor()
    fireEvent.click(toggle())
    fireEvent.click(await screen.findByRole('button', { name: /Add property/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ New property…' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Property name' }), { target: { value: 'Half typ' } })
    fireEvent.click(toggle())
    expect(region().hidden).toBe(true)
    fireEvent.click(toggle())
    expect(screen.getByRole('textbox', { name: 'Property name' }).value).toBe('Half typ')
  })
})

describe('the choice is remembered per browser', () => {
  it('opening writes the preference; the next editor opens expanded; closing writes it back', async () => {
    const first = await renderEditor()
    fireEvent.click(toggle())
    expect(localStorage.getItem(NOTE_DETAILS_PREF_KEY)).toBe('1')
    first.unmount()

    await renderEditor()
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(region().hidden).toBe(false)
    fireEvent.click(toggle())
    expect(localStorage.getItem(NOTE_DETAILS_PREF_KEY)).toBe('0')
    expect(region().hidden).toBe(true)
  })

  it('a browser that refuses storage still renders, collapsed, and the toggle still works', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    await renderEditor()
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(region().hidden).toBe(false)
  })
})

describe('ONE ticker control', () => {
  it('exactly one editable Ticker field, and the read-only property mirror is gone', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    const { container } = await renderEditor()
    fireEvent.click(toggle())
    expect(screen.getAllByRole('textbox', { name: 'Ticker' })).toHaveLength(1)
    expect(screen.getAllByLabelText('Ticker')).toHaveLength(1)
    expect(screen.getByRole('textbox', { name: 'Ticker' }).value).toBe('NVDA')
    // It lives in the details, not in the header row.
    expect(region().contains(screen.getByRole('textbox', { name: 'Ticker' }))).toBe(true)
    // CONTROL: the properties DID render (Sector is a row), so the missing Ticker row is the omit.
    await waitFor(() => expect(container.querySelector('[data-prop-row="builtin:sector"]')).not.toBeNull())
    expect(container.querySelector('[data-prop-row="builtin:ticker"]')).toBeNull()
  })

  it('its check still says what it refused -- and the sentence outlives a collapse', async () => {
    NOTE = thesisNote()
    await renderEditor()
    fireEvent.click(toggle())
    const field = screen.getByRole('textbox', { name: 'Ticker' })
    fireEvent.change(field, { target: { value: 'crawl test 42' } })
    fireEvent.blur(field)
    await screen.findByText(/isn't a ticker symbol/)
    expect(updateMock).not.toHaveBeenCalled()
    expect(field.value).toBe('NVDA')
    fireEvent.click(toggle())
    expect(region().hidden).toBe(true)
    expect(screen.getByText(/isn't a ticker symbol/)).toBeTruthy()
  })

  it('CONTROL: a real symbol is normalised and saved through the same door', async () => {
    await renderEditor()
    fireEvent.click(toggle())
    const field = screen.getByRole('textbox', { name: 'Ticker' })
    fireEvent.change(field, { target: { value: ' $amd ' } })
    fireEvent.blur(field)
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ ticker: 'AMD' })))
  })
})

describe('keyboard order: title, then the details toggle, then the body', () => {
  const TABBABLE = 'input, button, select, textarea, [contenteditable="true"], a[href], [tabindex]'
  const reachable = (el) => !el.closest('[hidden]') && !el.disabled && el.getAttribute('tabindex') !== '-1'
  // S10 (audit 2026-11-05, M4): the folder moved from the header to the start of this line ("Semis · #swing · Add
  // details"), so it is the one other stop: title, folder, the toggle, the body.
  it('collapsed, the only stops between the title and the body are the folder and the toggle', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    const { container } = await renderEditor()
    const stops = [...container.querySelectorAll(TABBABLE)].filter(reachable)
    const title = screen.getByRole('textbox', { name: 'Note title' })
    const body = container.querySelector('.ProseMirror')
    const between = stops.slice(stops.indexOf(title) + 1, stops.indexOf(body))
    expect(stops.indexOf(title)).toBeGreaterThanOrEqual(0)
    expect(stops.indexOf(body)).toBeGreaterThan(stops.indexOf(title))
    expect(between).toEqual([screen.getByRole('combobox', { name: 'Folder' }), toggle()])
  })
})

// Integrator: a registered tour may point at a control inside the details (e.g. "Add property");
// a tour step whose anchor is hidden closes the tour. Every start path goes through the gate,
// which publishes what it runs -- the editor opens the details for as long as one runs.
describe('a running tour opens the details (any start path)', () => {
  afterEach(() => { __resetRegistryTourControl() })

  it('opens while a tour runs and stays open for this visit, without touching the preference', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    await renderEditor()
    expect(region().hidden).toBe(true)
    publishRegistryTourWanted('formulas')
    await waitFor(() => expect(region().hidden).toBe(false))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    publishRegistryTourWanted(null)
    await new Promise((r) => setTimeout(r, 20))
    expect(region().hidden).toBe(false)          // like a review link: revealed for this visit
    expect(localStorage.getItem(NOTE_DETAILS_PREF_KEY)).toBeNull()
  })
})

// ⛔ Audit 2026-11-05, spec S2: a ticker on a plain note grew the thesis controls, because a Compass
// verdict for that ticker sat in the note's computed changelog. Only a real thesis shows them, and a
// member asks for them from the note menu.
describe('S2: thesis controls only on request', () => {
  const VERDICT = { type: 'compass_verdict', at: '2026-11-04T00:00:00Z', verdictId: 'v1', label: 'GO', symbol: 'NVDA' }
  const withSummary = (changelog) => {
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => (String(url) === '/api/j2/notes/n1/thesis-summary'
      ? { ok: true, json: async () => ({ evidence: [], changelog }) }
      : base(url, init)))
  }

  it('a plain note with a ticker and a verdict on file shows no thesis controls', async () => {
    NOTE = { ...bareNote(), ticker: 'NVDA' }
    PROPERTIES = [derived('builtin:ticker', 'Ticker', 'NVDA')]
    withSummary([VERDICT])
    const { container } = await renderEditor()
    await waitFor(() => expect(summary(container)?.textContent).toContain('NVDA'))
    expect(summary(container).textContent).not.toMatch(/review/i)
    expect(screen.queryByText('Add evidence')).toBeNull()
  })

  it('"Make this a thesis" in the note menu writes kind Thesis through the property door', async () => {
    NOTE = { ...bareNote(), ticker: 'NVDA' }
    withSummary([VERDICT])
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    const item = await screen.findByRole('button', { name: /Make this a thesis/ })
    fireEvent.click(item)
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ properties: { 'builtin:note_kind': 'thesis' } }))
  })

  it('a thesis is never offered "Make this a thesis"', async () => {
    NOTE = thesisNote()
    await renderEditor()
    await waitFor(() => expect(global.fetch.mock.calls.map(([u]) => String(u))).toContain('/api/j2/notes/n1/thesis-summary'))
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    await screen.findByRole('button', { name: 'Duplicate note' })
    expect(screen.queryByRole('button', { name: /Make this a thesis/ })).toBeNull()
  })
})

// ⛔ Audit 2026-11-05, S6 (found on production after #816): a title typed into a new note stayed
// "Untitled" in Recents and the list cards. Once the title save LANDS, the editor revalidates the
// views that show a title -- and only then, and never for a body-only save.
describe('S6: a landed title reaches every view', () => {
  it('a title save that lands asks the title views again (titleOnly)', async () => {
    invalidateSpy.mockClear()
    NOTE = { ...bareNote(), title: '' }
    await renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'NVDA swing plan' } })
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'NVDA swing plan' }), expect.anything()), { timeout: 5000 })
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ titleOnly: true }))
  })

  it('a save that changes no title asks no view', async () => {
    invalidateSpy.mockClear()
    NOTE = bareNote()
    await renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Subtitle (optional)'), { target: { value: 'deck line' } })
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ subtitle: 'deck line' }), expect.anything()), { timeout: 5000 })
    await new Promise((r) => setTimeout(r, 50))
    expect(invalidateSpy).not.toHaveBeenCalledWith({ titleOnly: true })
  })
})

// ⛔ Audit 2026-11-05, S5 (B11): the tab read "Journal" on every open note.
describe('S5: the browser tab names the open note', () => {
  it('the main pane names it "{title} · Notebook · UCT Intelligence", and follows typing', async () => {
    NOTE = { ...bareNote(), title: 'NVDA swing plan' }
    const NoteEditorPage = (await import('./NoteEditorPage')).default
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} ownsDocumentTitle /></MemoryRouter>
      </SWRConfig>,
    )
    await waitFor(() => expect(document.title).toBe('NVDA swing plan · Notebook · UCT Intelligence'))
    fireEvent.change(screen.getByPlaceholderText('Title'), { target: { value: 'NVDA plan v2' } })
    await waitFor(() => expect(document.title).toBe('NVDA plan v2 · Notebook · UCT Intelligence'))
  })

  it('a pane that does not own the tab (the split view side) leaves it alone', async () => {
    document.title = 'unchanged'
    NOTE = { ...bareNote(), title: 'Side note' }
    await renderEditor()
    await new Promise((r) => setTimeout(r, 20))
    expect(document.title).toBe('unchanged')
  })
})

// ⛔ Audit 2026-11-05, S5 (B4): a widget's archived snapshot is an image document; OCR read the
// chart, and the note said "Image — Text read from a scanned page" once per widget.
describe('S5 (B4): the editor speaks of an image only when its body holds it', () => {
  const docs = (list) => {
    const base = global.fetch
    global.fetch = vi.fn(async (url, init) => (String(url) === '/api/j2/notes/n1/documents'
      ? { ok: true, json: async () => ({ documents: list }) }
      : base(url, init)))
  }
  const snap = (file, extra = {}) => ({
    id: file, name: 'Image', attachmentUrl: `/api/j2/notes/attachments/u1/n1/inline/${file}`, status: 'no_text',
    pagesTotal: 1, pagesWithText: 0, pagesFromOcr: 0, pagesAwaitingOcr: 0, textComplete: false, ...extra,
  })

  it('snapshot images the body does not hold: no line at all', async () => {
    docs([snap('a.png'), snap('b.png', { status: 'ready', pagesWithText: 1, pagesFromOcr: 1, textComplete: true })])
    await renderEditor()
    await waitFor(() => expect(global.fetch.mock.calls.map(([u]) => String(u))).toContain('/api/j2/notes/n1/documents'))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.queryByRole('status', { name: 'Attachment text status' })).toBeNull()
  })

  it('an image the body holds, with no text: one line, and it is not called a scan', async () => {
    NOTE = { ...bareNote(), bodyJson: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Body words' }] },
      { type: 'image', attrs: { src: '/api/j2/notes/attachments/u1/n1/inline/a.png' } }] } }
    docs([snap('a.png')])
    await renderEditor()
    const region = await screen.findByRole('status', { name: 'Attachment text status' })
    expect(region).toHaveTextContent('Image has no readable text, so Search and Ask cannot use it.')
  })
})

// Fix round 1 (review minor 13): the folder select (B2's door) reaches the note-views helper.
describe('S6: a move from the editor revalidates the note views', () => {
  it('changing the folder calls invalidateNoteViews once the move is settled', async () => {
    invalidateSpy.mockClear()
    await renderEditor()
    fireEvent.change(screen.getAllByRole('combobox', { name: 'Folder' })[0], { target: { value: 'f9' } })
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ folderId: 'f9' }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith())
  })
})

// Fix round 2 (re-review N1): Duplicate kept its own `/api/j2/notes*` predicate -- a second authority
// that revalidated the open note under its editor and missed the folder tree. It uses the helper.
describe('S6: Duplicate revalidates through the one helper', () => {
  it('a duplicate calls invalidateNoteViews({ tags: true })', async () => {
    invalidateSpy.mockClear()
    const base = global.fetch
    global.fetch = vi.fn(async (url, init = {}) => (String(url) === '/api/j2/notes' && init.method === 'POST'
      ? { ok: true, status: 200, json: async () => ({ note: { id: 'n2', title: 'Copy of A plain note' } }) }
      : base(url, init)))
    await renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'More note actions' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate note' }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ tags: true }))
  })
})

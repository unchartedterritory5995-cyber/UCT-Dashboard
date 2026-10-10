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
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

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
  it('collapsed, the only stop between the title and the body is the toggle', async () => {
    NOTE = thesisNote()
    PROPERTIES = NVDA_PROPERTIES
    const { container } = await renderEditor()
    const stops = [...container.querySelectorAll(TABBABLE)].filter(reachable)
    const title = screen.getByRole('textbox', { name: 'Note title' })
    const body = container.querySelector('.ProseMirror')
    const between = stops.slice(stops.indexOf(title) + 1, stops.indexOf(body))
    expect(stops.indexOf(title)).toBeGreaterThanOrEqual(0)
    expect(stops.indexOf(body)).toBeGreaterThan(stops.indexOf(title))
    expect(between).toEqual([toggle()])
  })
})

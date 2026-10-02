/**
 * Wave 11 lane 11D — a trade-plan canvas note in the REAL editor page.
 *
 * ⛔⛔ THE BOARD OPENS NO DOOR OF ITS OWN. A canvas note renders the board in place
 * of the text editor, and every board change is one transaction on the editor's
 * canvas node, so it reaches the server through the note's own autosave (`update`,
 * which owns the compare-and-set, the offline outbox and the schema declaration).
 * These rails drive the page as a member would and read what the autosave SENT.
 *
 * Also: the gate (off ⇒ the board is read-only with a sentence, nothing hidden; the
 * /canvas slash item is not offered), a locked canvas takes no edits, the text
 * editor's toolbar is not shown on a canvas, a capture is never aimed at a canvas,
 * and the link-from-a-thesis offer writes nothing until the member presses Add.
 */
import { render, screen, act, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { buildCanvasDoc, emptyBoard, addItems, makeTextCard } from '../../lib/tradeCanvas'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1200 } })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 700 } })

vi.mock('./ChartEmbed', () => ({ default: () => <div data-testid="fake-chart" /> }))

const T1 = '2026-10-01T14:00:00.000000+00:00'
let NOTE
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

function canvasNote(extra = {}) {
  return {
    id: 'n1', title: 'NVDA trade plan', subtitle: '', folderId: null, ticker: 'NVDA', tags: ['trade-plan'],
    heroImageUrl: null, updatedAt: T1, isFavorite: false, locked: false,
    bodyJson: buildCanvasDoc(addItems(emptyBoard(), [makeTextCard({ x: 0, y: 0, text: 'first' })]).board),
    ...extra,
  }
}

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  NOTE = canvasNote()
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-10-01T14:09:00.000000+00:00' }))
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  __resetNotebookFlags()
  localStorage.clear()
})

async function renderEditor(route = '/journal/notebook?note=n1') {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter initialEntries={[route]}><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
const bodyPuts = () => updateMock.mock.calls.map(([p]) => p).filter((p) => p && 'bodyJson' in p)
const flagOn = () => latchNotebookFlags({ notebook_trade_canvas_enabled: true })

describe('a canvas note opens on its board, not the text editor', () => {
  it('renders the board; the formatting toolbar and Find are not offered', async () => {
    flagOn()
    await renderEditor()
    expect(await screen.findByRole('application', { name: /Trade-plan canvas, 1 card/ })).toBeTruthy()
    expect(screen.queryByRole('toolbar', { name: 'Editor toolbar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Find in note' })).toBeNull()
    // the editor stays MOUNTED (it is the board's store) but hidden
    expect(document.querySelector('.ProseMirror').closest('[hidden]')).toBeTruthy()
  })
  it('CONTROL — an ordinary note opens the text editor and its toolbar', async () => {
    flagOn()
    NOTE = { ...canvasNote(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] } }
    await renderEditor()
    expect(screen.queryByRole('application', { name: /Trade-plan canvas/ })).toBeNull()
    expect(screen.getByRole('toolbar', { name: 'Editor toolbar' })).toBeTruthy()
  })
})

describe('⛔ a board change reaches the server through the note’s own autosave', () => {
  it('add a card → ONE body save carrying the board and its search line', async () => {
    flagOn()
    await renderEditor()
    await screen.findByRole('application', { name: /Trade-plan canvas/ })
    fireEvent.click(await screen.findByRole('button', { name: /^Sticky/ }))
    const box = screen.getByRole('textbox', { name: 'Sticky note text' })
    fireEvent.change(box, { target: { value: 'Earnings 10/28' } })
    act(() => { fireEvent.keyDown(box, { key: 'Escape' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await waitFor(() => expect(bodyPuts().length).toBeGreaterThan(0))
    const sent = bodyPuts().at(-1).bodyJson
    expect(sent.content[0].type).toBe('tradeCanvas')
    expect(sent.content[0].attrs.board.items.map((i) => i.kind)).toEqual(['text', 'sticky'])
    expect(sent.content[0].attrs.searchText).toContain('Earnings 10/28')
  })
})

describe('the gate and the lock', () => {
  it('⛔ gate OFF: the canvas still opens, READ-ONLY, with a sentence — nothing hidden, nothing writable', async () => {
    await renderEditor()
    expect(await screen.findByText(/Trade-plan canvases are switched off right now, so this plan is read-only/)).toBeTruthy()
    expect(screen.getByRole('application', { name: /Trade-plan canvas, 1 card/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Text/ })).toBeNull()
    const vp = screen.getByRole('application')
    act(() => { fireEvent.keyDown(vp, { key: 't' }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(bodyPuts()).toEqual([])
  })
  it('a LOCKED canvas takes no edits', async () => {
    flagOn()
    NOTE = canvasNote({ locked: true })
    await renderEditor()
    await screen.findByRole('application', { name: /Trade-plan canvas/ })
    expect(screen.queryByRole('button', { name: /^Text/ })).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(bodyPuts()).toEqual([])
  })
  it('a canvas is never made the capture target (Send to Journal aims at the last TEXT note)', async () => {
    flagOn()
    await renderEditor()
    await screen.findByRole('application', { name: /Trade-plan canvas/ })
    expect(localStorage.getItem('uct.jw.lastNote')).toBeNull()
  })
})

describe('/canvas in an ordinary note', () => {
  it('is offered only while the gate is on, and never inside a canvas', async () => {
    NOTE = { ...canvasNote(), bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] } }
    const ed = await renderEditor()
    expect(ed.storage.uctJournalWidgets.canTradeCanvas()).toBe(false)
    __resetNotebookFlags(); flagOn()
    expect(ed.storage.uctJournalWidgets.canTradeCanvas()).toBe(true)
  })
  it('creates the canvas through the create door, then links it at the caret (an editor transaction)', async () => {
    flagOn()
    NOTE = { ...canvasNote(), title: 'NVDA thesis', bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] } }
    const created = { id: 'c9', title: 'NVDA thesis — trade plan', updatedAt: T1 }
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (String(url) === '/api/j2/notes' && opts.method === 'POST') {
        const body = JSON.parse(opts.body)
        expect(body.bodyJson.content[0].type).toBe('tradeCanvas')
        expect(body.tags).toEqual(['trade-plan'])
        expect(body.title).toBe('NVDA thesis — trade plan')
        expect(body.ticker).toBe('NVDA')
        return { ok: true, status: 200, json: async () => ({ note: created }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    })
    const ed = await renderEditor()
    await act(async () => { ed.view.dom.dispatchEvent(new CustomEvent('uct:notebook-trade-canvas', { bubbles: true })) })
    await waitFor(() => {
      const links = []
      ed.state.doc.descendants((n) => { if (n.type.name === 'noteLink') links.push(n.attrs.noteId) })
      expect(links).toEqual(['c9'])
    })
    expect(await screen.findByText(/Trade plan created and linked/)).toBeTruthy()
  })
})

describe('link from a thesis — the offer writes nothing until Add', () => {
  it('Not now writes nothing; Add puts a link to the canvas at the end of the note', async () => {
    flagOn()
    NOTE = { ...canvasNote(), id: 'n1', title: 'NVDA thesis', bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'thesis' }] }] } }
    const ed = await renderEditor('/journal/notebook?note=n1&linkCanvas=c9')
    const offer = await screen.findByRole('region', { name: 'Link a trade plan' })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(bodyPuts()).toEqual([])
    fireEvent.click(within(offer).getByRole('button', { name: 'Add link' }))
    const links = []
    ed.state.doc.descendants((n) => { if (n.type.name === 'noteLink') links.push(n.attrs.noteId) })
    expect(links).toEqual(['c9'])
    expect(screen.queryByRole('region', { name: 'Link a trade plan' })).toBeNull()
  })
})

describe('link from a thesis — refusals say the true thing', () => {
  it('a LOCKED thesis: Add link is refused with the locked sentence and nothing is linked', async () => {
    flagOn()
    NOTE = { ...canvasNote(), title: 'NVDA thesis', locked: true,
      bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'thesis' }] }] } }
    const ed = await renderEditor('/journal/notebook?note=n1&linkCanvas=c9')
    const offer = await screen.findByRole('region', { name: 'Link a trade plan' })
    await act(async () => { fireEvent.click(within(offer).getByRole('button', { name: 'Add link' })) })
    expect(await screen.findByText(/This note is locked/)).toBeTruthy()
    const links = []
    ed.state.doc.descendants((n) => { if (n.type.name === 'noteLink') links.push(n.attrs.noteId) })
    expect(links).toEqual([])
  })
})


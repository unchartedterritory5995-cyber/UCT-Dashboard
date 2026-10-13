/**
 * P2a Task 12, R-T12-2 — a failed "Market context" read says so, in the REAL editor page's own toast.
 * ⛔ Asserted by the RENDERED sentence (the copy contract), never by a spy on `notify`: the typed
 * "/market context" is already gone when the read is awaited (R-RC-4), so a silent failure reads as the
 * command having done nothing at all. Driven the way a member drives it: type the command, the menu
 * shows, Enter.
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const T1 = '2026-10-01T14:00:00.000000+00:00'
const MC = '/api/j2/trader-blocks/market-context'
// The member's sentence, the /vs wording ("could not be ... just now, so nothing was added. Try ... again.").
const SENTENCE = 'Market context could not be read just now, so nothing was added. Try /market context again.'
let NOTE
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, error: null, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const note = () => ({
  id: 'n1', title: 'AMD plan', subtitle: '', folderId: null, ticker: 'AMD', tags: [],
  heroImageUrl: null, updatedAt: T1, isFavorite: false, locked: false,
  bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }] },
})

/** Every other read answers an empty 200; the market-context read answers `mc`. */
function routeFetch(mc) {
  global.fetch = vi.fn(async (url) => (String(url) === MC ? mc() : { ok: true, status: 200, json: async () => ({}) }))
}

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch }))
  NOTE = note()
})
afterEach(() => {
  vi.clearAllMocks()
  __resetNotebookFlags()
  localStorage.clear()
})

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(<MemoryRouter initialEntries={['/journal/notebook?note=n1']}><NoteEditorPage noteId="n1" onBack={vi.fn()} /></MemoryRouter>)
  await screen.findByPlaceholderText('Title')
  return waitFor(() => {
    const el = document.querySelector('.ProseMirror')
    if (!el?.editor) throw new Error('editor not mounted')
    return el.editor
  })
}
const mcCalls = () => global.fetch.mock.calls.filter(([u]) => String(u) === MC)
const stamps = (ed) => ed.getJSON().content.filter((n) => n.type === 'widgetEmbed' && n.attrs.widgetId === 'marketcontext')

/** Type "/market context" at the end of the line, wait for the menu, press Enter on its top row. */
async function runMarketContext(ed) {
  ed.commands.focus('end', { scrollIntoView: false })
  await act(async () => { ed.commands.insertContent('/market context') })
  const top = await waitFor(() => {
    const opt = document.querySelector('#uct-slash-menu [role="option"]')
    if (!opt) throw new Error('slash menu not shown')
    return opt.firstElementChild.textContent
  })
  expect(top).toBe('Market context')                     // non-vacuity: Enter runs THIS item
  await act(async () => { ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' }))) })
  await waitFor(() => expect(mcCalls()).toHaveLength(1))
}

describe('Market context: a failed read is said, in the note\'s own toast', () => {
  it('a 503 shows the sentence and inserts nothing', async () => {
    routeFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    const ed = await renderEditor()
    await runMarketContext(ed)
    expect(await screen.findByText(SENTENCE)).toBeTruthy()
    expect(stamps(ed)).toEqual([])
    expect(ed.state.doc.textContent).not.toContain('/market')
  })

  it('a read that throws (offline) shows the sentence and inserts nothing', async () => {
    routeFetch(async () => { throw new TypeError('Failed to fetch') })
    const ed = await renderEditor()
    await runMarketContext(ed)
    expect(await screen.findByText(SENTENCE)).toBeTruthy()
    expect(stamps(ed)).toEqual([])
  })

  it('CONTROL: a good read stamps the note and shows no sentence', async () => {
    routeFetch(async () => ({ ok: true, status: 200, json: async () => ({ readings: {}, wireDate: '2026-10-12', updated: '10:30 AM ET' }) }))
    const ed = await renderEditor()
    await runMarketContext(ed)
    await waitFor(() => expect(stamps(ed)).toHaveLength(1))
    expect(screen.queryByText(SENTENCE)).toBeNull()
  })
})

// R-T12-C fix round, I-1: the WIRE, end to end in the real editor page. A stamp the create could not
// read in time ({uncaptured: true, reason: "budget"}, the backend's shape) offers "Capture now", and the
// click lands the readings IN THE NOTE (the node's params) through the embed's setParams: nothing on
// the path is mocked but the read itself.
const BUDGET = 'The market could not be read in time when this note was made.'
const budgetStamp = () => ({ type: 'widgetEmbed', attrs: {
  v: 1, widgetId: 'marketcontext', embedId: 'mc-budget', mode: 'snapshot',
  params: { uncaptured: true, reason: 'budget', fields: 'all' },
  capturedAt: null, annotations: [], caption: null, layout: { width: 'full', height: null }, fallback: null,
} })

describe('Market context: the budget stamp\'s Capture now writes into the note', () => {
  // The setup's IntersectionObserver never reports, so an embed would stay below the fold forever; this
  // one says every observed block is in view, which is what mounts the embed's real renderer.
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb) { this.cb = cb }
      observe(target) { this.cb([{ isIntersecting: true, target }], this) }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('the click lands the readings in the node, the stamp keeps its preset, and the sentence goes', async () => {
    const READ = { readings: { marketPhase: 'Uptrend', exposureScore: 72.5, powerTrend: null }, wireDate: '2026-10-12', updated: '10:30 AM ET' }
    routeFetch(async () => ({ ok: true, status: 200, json: async () => READ }))
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }, budgetStamp()] } }
    const ed = await renderEditor()
    expect(await screen.findByText(BUDGET)).toBeTruthy()
    expect(mcCalls()).toHaveLength(0)                       // never on mount
    const button = await screen.findByRole('button', { name: 'Capture now' })
    await act(async () => { button.click() })
    await waitFor(() => expect(stamps(ed)[0].attrs.params.readings).toEqual(READ.readings))
    const params = stamps(ed)[0].attrs.params
    expect(params.fields).toBe('all')
    expect(params.wireDate).toBe('2026-10-12')
    expect(params.uncaptured).toBeUndefined()
    expect(params.reason).toBeUndefined()
    expect(mcCalls()).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText(BUDGET)).toBeNull())
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
  })

  it('CONTROL: the "Update layout" stamp (no reason) shows its old sentence and no Capture now', async () => {
    routeFetch(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    const stamp = budgetStamp()
    delete stamp.attrs.params.reason
    NOTE = { ...note(), bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plan ' }] }, stamp] } }
    await renderEditor()
    expect(await screen.findByText('Market context is captured when a note is created. This note was written before it had one.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Capture now' })).toBeNull()
  })
})

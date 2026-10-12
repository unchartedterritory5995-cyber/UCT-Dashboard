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

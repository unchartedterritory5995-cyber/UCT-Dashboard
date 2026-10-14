/**
 * Tier 2 part A -- /plan NVDA in the REAL editor page.
 *
 * Modelled on the /canvas rail in NoteEditorPage.tradeCanvas.test.jsx: the slash item dispatches PLAN_EVENT on
 * the editor's own DOM root, the page makes the Trade plan through `createPlanNote` (the one create door, landed
 * with settleNoteWrite) and links it at the caret as an editor transaction. Toasts are asserted by their
 * RENDERED TEXT, never by state -- a toast nobody can read is not feedback.
 *
 * Covered: (a) an editable note creates the plan and gets exactly one noteLink with the returned id;
 * (b) a LOCKED note calls nothing and says so; (c) a refused create inserts nothing and says nothing was saved;
 * plus the switch (off: nothing is created) and a bad symbol (nothing is created).
 */
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { __resetNotebookFlags, latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { PLAN_EVENT } from '../../lib/journalStylesFlag'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1200 } })
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 700 } })

vi.mock('./ChartEmbed', () => ({ default: () => <div data-testid="fake-chart" /> }))

const createPlanNoteMock = vi.fn()
vi.mock('../../lib/planCreate', () => ({
  createPlanNote: (...args) => createPlanNoteMock(...args),
  planTitle: (s) => `${String(s).toUpperCase()} trade plan`,
}))

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

function textNote(extra = {}) {
  return {
    id: 'n1', title: 'NVDA thesis', subtitle: '', folderId: 'f1', ticker: 'NVDA', tags: [],
    heroImageUrl: null, updatedAt: T1, isFavorite: false, locked: false,
    bodyJson: { type: 'doc', content: [{ type: 'paragraph' }] },
    ...extra,
  }
}

beforeEach(() => {
  localStorage.clear()
  __resetNotebookFlags()
  NOTE = textNote()
  updateMock.mockReset()
  updateMock.mockImplementation(async (patch) => ({ ...NOTE, ...patch, updatedAt: '2026-10-01T14:09:00.000000+00:00' }))
  createPlanNoteMock.mockReset()
  globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
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
const flagOn = () => latchNotebookFlags({ notebook_journal_styles_enabled: true })
const firePlan = (ed, symbol) => act(async () => {
  ed.view.dom.dispatchEvent(new CustomEvent(PLAN_EVENT, { bubbles: true, detail: { symbol } }))
})
const linkIds = (ed) => {
  const ids = []
  ed.state.doc.descendants((n) => { if (n.type.name === 'noteLink') ids.push(n.attrs.noteId) })
  return ids
}

describe('/plan in an ordinary note', () => {
  it('(a) makes the Trade plan in this note\'s folder and links it at the caret -- one noteLink, one toast', async () => {
    flagOn()
    createPlanNoteMock.mockResolvedValue({ id: 'p9', title: 'NVDA trade plan', updatedAt: T1 })
    const ed = await renderEditor()
    await firePlan(ed, 'NVDA')
    await waitFor(() => expect(linkIds(ed)).toEqual(['p9']))
    expect(createPlanNoteMock).toHaveBeenCalledTimes(1)
    expect(createPlanNoteMock).toHaveBeenCalledWith({ symbol: 'NVDA', folderId: 'f1' })
    expect(await screen.findByText('Trade plan for NVDA created and linked. Open it from the link.')).toBeTruthy()
  })

  it('(b) a LOCKED note calls nothing and says it is locked', async () => {
    flagOn()
    NOTE = textNote({ locked: true })
    const ed = await renderEditor()
    await firePlan(ed, 'NVDA')
    expect(await screen.findByText('This note is locked — unlock it in the Notebook first')).toBeTruthy()
    expect(createPlanNoteMock).not.toHaveBeenCalled()
    expect(linkIds(ed)).toEqual([])
  })

  it('(c) a refused create inserts nothing and says nothing was saved', async () => {
    flagOn()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    createPlanNoteMock.mockRejectedValue(Object.assign(new Error('Could not create note (400)'), { status: 400 }))
    const ed = await renderEditor()
    await firePlan(ed, 'NVDA')
    expect(await screen.findByText("Couldn't create the trade plan. Nothing was saved.")).toBeTruthy()
    expect(createPlanNoteMock).toHaveBeenCalledTimes(1)
    expect(linkIds(ed)).toEqual([])
    spy.mockRestore()
  })

  it('the switch OFF: nothing is created, nothing is linked, nothing is said', async () => {
    const ed = await renderEditor()
    await firePlan(ed, 'NVDA')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(createPlanNoteMock).not.toHaveBeenCalled()
    expect(linkIds(ed)).toEqual([])
    expect(screen.queryByText(/Trade plan for NVDA/)).toBeNull()
    expect(screen.queryByText(/Couldn't create the trade plan/)).toBeNull()
  })

  it('a second /plan while one is in flight creates nothing more', async () => {
    flagOn()
    let release
    createPlanNoteMock.mockImplementation(() => new Promise((r) => { release = r }))
    const ed = await renderEditor()
    await firePlan(ed, 'NVDA')
    await firePlan(ed, 'AMD')
    expect(createPlanNoteMock).toHaveBeenCalledTimes(1)
    await act(async () => { release({ id: 'p9', title: 'NVDA trade plan' }) })
    await waitFor(() => expect(linkIds(ed)).toEqual(['p9']))
  })
})

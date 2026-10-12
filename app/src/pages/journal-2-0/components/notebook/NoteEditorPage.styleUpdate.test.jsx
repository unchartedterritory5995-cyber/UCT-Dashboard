import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Notebook P1 (Task 14), through a REAL NoteEditorPage: the previewed "Update layout" offer, the sheet that
// waits for the editor to save first, and /style. The network is mocked at lane B's client module boundary
// (journalStyles.js): its wire and settle are pinned in lib/journalStyles.test.js and doorFamilies.settle.
// The Review Focus tests are named for the plan: styleUpdate.staleBase, styleUpdate.waitsForSave,
// styleUpdate.deletedStyleNoBanner.

const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const H = (t) => ({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: t }] })

let NOTE
const baseNote = () => ({
  id: 'n1', title: 'NVDA weekend', subtitle: '', folderId: null, ticker: 'NVDA', tags: [], heroImageUrl: null,
  updatedAt: '2026-01-01T00:00:00Z', isFavorite: false, locked: false,
  styleId: 's1', styleVersion: 1, kindId: 'weekend_prep',
  bodyJson: { type: 'doc', content: [H('Plan'), P('Intro line.')] },
})
const updateMock = vi.fn()
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: NOTE, isLoading: false, update: updateMock, refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

const calls = []
const fetchJournalStyles = vi.fn()
const planStyleUpdate = vi.fn()
const applyStyleUpdate = vi.fn()
vi.mock('../../lib/journalStyles', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchJournalStyles: (...a) => fetchJournalStyles(...a),
  planStyleUpdate: (...a) => planStyleUpdate(...a),
  applyStyleUpdate: (...a) => applyStyleUpdate(...a),
}))

import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { STYLE_EVENT } from '../../lib/journalStylesFlag'

const KINDS = [{ id: 'weekend_prep', name: 'Weekend prep', builtin: true }, { id: 'trade_plan', name: 'Trade plan', builtin: true }]
const style = (over = {}) => ({
  id: 's1', name: 'Weekend prep', kindId: 'weekend_prep', builtin: false, isDefault: true, version: 3, blocks: [], properties: {}, ...over,
})
const LIST = { kinds: KINDS, styles: [style(), style({ id: 's2', name: 'Plan B', kindId: 'trade_plan', isDefault: false, version: 1 })], blockKinds: [] }
const PLAN = {
  styleId: 's1', styleName: 'Weekend prep', fromVersion: 1, toVersion: 3, switching: false, insertsOutline: false,
  add: [{ block: 'chart', label: null }], skipped: [], versionCurrent: false, missingBlocks: true, upToDate: false, locked: false,
}
const APPLIED = {
  id: 'n1', title: 'NVDA weekend', subtitle: '', updatedAt: '2026-01-05T00:00:00Z', styleId: 's1', styleVersion: 3,
  bodyJson: { type: 'doc', content: [H('Plan'), P('Added by the update.'), P('Intro line.')] },
}

beforeEach(() => {
  NOTE = baseNote()
  calls.length = 0
  vi.clearAllMocks()
  updateMock.mockImplementation(async (patch) => { calls.push('put'); return { ...NOTE, ...patch, updatedAt: '2026-01-03T00:00:00Z' } })
  fetchJournalStyles.mockResolvedValue(LIST)
  planStyleUpdate.mockResolvedValue({ plan: PLAN })
  applyStyleUpdate.mockImplementation(async () => { calls.push('apply'); return { note: APPLIED, plan: PLAN } })
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
  latchNotebookFlags({ notebook_journal_styles_enabled: true })
})
afterEach(() => { vi.clearAllMocks(); __resetNotebookFlags() })

async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><NoteEditorPage noteId="n1" onBack={vi.fn()} showBack /></MemoryRouter>
    </SWRConfig>,
  )
  await screen.findByPlaceholderText('Title')
  await waitFor(() => {
    if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
  })
}
const editorOf = () => document.querySelector('.ProseMirror').editor
const BANNER = 'This note uses Weekend prep v1. Update layout to v3?'
const openSheet = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Review update' }))
  return screen.findByRole('dialog', { name: 'Update layout' })
}

describe('styleUpdate.banner', () => {
  it('offers the update with both versions', async () => {
    await renderEditor()
    expect(await screen.findByText(BANNER)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review update' })).toBeTruthy()
  })

  // The offer needs the preview to say there is something to add: `!locked && !versionCurrent && missingBlocks`
  // (NOT `!upToDate`), so each leg is a case.
  it.each([
    ['a newer version that adds nothing', { missingBlocks: false }],
    ['a locked note (never written)', { locked: true }],
    ['a note already on the current version', { versionCurrent: true }],
  ])('no offer for %s', async (_name, over) => {
    planStyleUpdate.mockResolvedValue({ plan: { ...PLAN, ...over } })
    await renderEditor()
    await waitFor(() => expect(planStyleUpdate).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(BANNER)).toBeNull()
  })

  it('a 404 from the plan (style deleted or purged) is no banner, and the note is unchanged', async () => {
    planStyleUpdate.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }))
    await renderEditor()
    await waitFor(() => expect(planStyleUpdate).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(BANNER)).toBeNull()
    expect(editorOf().getJSON()).toEqual(NOTE.bodyJson)
  })
})

describe('styleUpdate.deletedStyleNoBanner', () => {
  it('a note whose style is gone from the list shows no banner and asks for no plan', async () => {
    fetchJournalStyles.mockResolvedValue({ ...LIST, styles: LIST.styles.filter((s) => s.id !== 's1') })
    await renderEditor()
    await waitFor(() => expect(fetchJournalStyles).toHaveBeenCalled())
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/Update layout/)).toBeNull()
    expect(planStyleUpdate).not.toHaveBeenCalled()
    expect(editorOf().getJSON()).toEqual(NOTE.bodyJson)
  })
})

describe('styleUpdate.waitsForSave', () => {
  it('Apply waits for the editor to send pending words, reads the base AFTER, then lands and adopts', async () => {
    await renderEditor()
    const dialog = await openSheet()
    expect(await within(dialog).findByText('Will be added')).toBeTruthy()
    // a word typed inside the autosave window: nothing has been sent yet
    const editor = editorOf()
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Typed just now.')
    expect(updateMock).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(applyStyleUpdate).toHaveBeenCalled())
    // the pending body was PUT before the apply, in that order
    expect(calls).toEqual(['put', 'apply'])
    expect(JSON.stringify(updateMock.mock.calls[0][0].bodyJson)).toContain('Typed just now.')
    // and the base sent is the revision that save landed, not the one the sheet opened on
    expect(applyStyleUpdate).toHaveBeenCalledWith('n1', { baseUpdatedAt: '2026-01-03T00:00:00Z' })
    // the editor adopts the server's copy
    await waitFor(() => expect(JSON.stringify(editor.getJSON())).toContain('Added by the update.'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Update layout' })).toBeNull())
  })

  it('if words are still unsent after the wait, nothing is applied and it says so', async () => {
    await renderEditor()
    const dialog = await openSheet()
    await within(dialog).findByText('Will be added')
    updateMock.mockRejectedValue(new Error('offline'))
    const editor = editorOf()
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Unsent words.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(await within(dialog).findByText('Some words are still saving. Try again in a moment.', {}, { timeout: 4000 })).toBeTruthy()
    expect(applyStyleUpdate).not.toHaveBeenCalled()
  })
})

describe('styleUpdate.staleBase', () => {
  it('a 409 writes nothing, says so, and Check again re-asks for the plan', async () => {
    applyStyleUpdate.mockRejectedValue(Object.assign(new Error('This note changed since you opened it. Nothing was added.'), { status: 409 }))
    await renderEditor()
    const dialog = await openSheet()
    await within(dialog).findByText('Will be added')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(await within(dialog).findByText('This note changed since you opened it. Nothing was added.')).toBeTruthy()
    expect(editorOf().getJSON()).toEqual(NOTE.bodyJson)
    const before = planStyleUpdate.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(planStyleUpdate.mock.calls.length).toBe(before + 1))
  })

  it('a locked note (423) gets a plain locked sentence', async () => {
    applyStyleUpdate.mockRejectedValue(Object.assign(new Error('locked'), { status: 423 }))
    await renderEditor()
    const dialog = await openSheet()
    await within(dialog).findByText('Will be added')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }))
    expect(await within(dialog).findByText('This note is locked. Unlock it to change its layout.')).toBeTruthy()
  })
})

describe('the sheet', () => {
  it('lists what is added and what is left out, in words, and promises nothing is removed', async () => {
    planStyleUpdate.mockResolvedValue({ plan: { ...PLAN, skipped: [{ block: 'chart', reason: 'needs-ticker' }] } })
    await renderEditor()
    const dialog = await openSheet()
    expect(await within(dialog).findByLabelText('Will be added')).toBeTruthy()
    expect(within(dialog).getByLabelText('Left out').textContent).toContain('this note has no ticker yet')
    expect(within(dialog).getByText('Nothing in your note is removed or moved.')).toBeTruthy()
  })

  it('an up-to-date plan says so and offers Close only', async () => {
    planStyleUpdate.mockResolvedValue({ plan: { ...PLAN, upToDate: true, versionCurrent: true, missingBlocks: false, add: [] } })
    NOTE = { ...baseNote(), styleVersion: 3 }
    await renderEditor()
    // no banner for a current note; open the sheet through /style's switch to the same style instead
    act(() => { editorOf().view.dom.dispatchEvent(new CustomEvent(STYLE_EVENT, { bubbles: true })) })
    fireEvent.click(await screen.findByRole('button', { name: /^Weekend prep/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('This note already has the latest layout.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Cancel' })).toBeNull()   // the footer offers Close alone
    expect(within(dialog).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0)
  })
})

describe('/style', () => {
  it('opens a chooser of the member\'s styles by kind; picking one previews the switch and applies it', async () => {
    planStyleUpdate.mockResolvedValue({ plan: { ...PLAN, styleId: 's2', styleName: 'Plan B', switching: true, fromVersion: null, toVersion: 1 } })
    await renderEditor()
    act(() => { editorOf().view.dom.dispatchEvent(new CustomEvent(STYLE_EVENT, { bubbles: true })) })
    const chooser = await screen.findByRole('dialog', { name: 'Choose a journal style' })
    expect(within(chooser).getByRole('group', { name: 'Trade plan' })).toBeTruthy()
    fireEvent.click(within(chooser).getByRole('button', { name: /^Plan B/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Switch to Plan B' })
    expect(planStyleUpdate).toHaveBeenCalledWith('n1', { styleId: 's2' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(applyStyleUpdate).toHaveBeenCalledWith('n1', { styleId: 's2', baseUpdatedAt: expect.any(String) }))
  })
})

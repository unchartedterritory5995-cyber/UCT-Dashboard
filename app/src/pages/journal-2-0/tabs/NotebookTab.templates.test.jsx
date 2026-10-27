import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 3) — creating from a MEMBER template goes through the
 * same path as a built-in (`createNote` -> `createNoteViaApi`): the template is
 * read in full, the note is POSTed with its title and body, its property values
 * follow in the properties PUT (which lands its revision), and the new note
 * opens. Real TemplatePicker + MemberTemplates; network, sidebar, editor stubbed.
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 0, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
// The editor stand-in takes focus as the real one does for a fresh note (a passive effect on `openFocus`), so a rail
// can see where focus ENDS (W11-R80 m-1).
vi.mock('../components/notebook/NoteEditorPage', async () => {
  const { useEffect, useRef } = await import('react')
  return {
    default: function NoteEditorStub({ noteId, openFocus }) {
      const title = useRef(null)
      useEffect(() => { if (openFocus === 'title') title.current?.focus() }, [openFocus])
      return (
        <div data-testid="note-editor" data-note-id={noteId} data-open-focus={openFocus || ''}>
          <input ref={title} aria-label="Title" />
        </div>
      )
    },
  }
})
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
vi.mock('../lib/offline/useDurableNote', async (importOriginal) => ({
  ...(await importOriginal()),
  recordLandedRevision: vi.fn(async ({ updatedAt }) => updatedAt),
}))

import NotebookTab from './NotebookTab'
import { recordLandedRevision } from '../lib/offline/useDurableNote'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { TITLE as ADOPT_TITLE } from '../components/notebook/library/AdoptSheet'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const LIB_ROW = { id: 'g-night', title: 'Night-before prep', description: 'planning tomorrow', group: 'night_before',
  category: 'journal', author: 'UCT', itemType: 'style', usedBy: 0, helpfulCount: 0, contains: [], inYourTemplates: false }
const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'What worked' }] }] }
let calls
let templateRead
let templateBody
beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  templateRead = { ok: true }
  templateBody = BODY
  setCurrentAccountId('acct-A')
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = init.method || 'GET'
    calls.push({ url: u, method, body: init.body ? JSON.parse(init.body) : null })
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/j2/note-templates' && method === 'GET') return ok({ templates: [{ id: 't1', name: 'Weekly review', title: 'Week', createdAt: '1' }] })
    if (u === '/api/j2/note-templates/t1') {
      return templateRead.ok
        ? ok({ template: { id: 't1', name: 'Weekly review', title: 'Week', bodyJson: templateBody, properties: { 'builtin:thesis_status': 'active' } } })
        : { ok: false, status: 404, json: async () => ({}) }
    }
    if (u === '/api/j2/notes' && method === 'POST') return ok({ note: { id: 'new1', title: 'Week', updatedAt: 'R0' } })
    if (u === '/api/j2/notes/new1' && method === 'PUT') return ok({ note: { id: 'new1', title: 'Week', updatedAt: 'R1' } })
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    // Wave 11 (11.20 walk D1): the Template library, one listed template, and its Use.
    if (u === '/api/j2/template-gallery/library') return ok({ templates: [LIB_ROW] })
    if (u === `/api/j2/template-gallery/${LIB_ROW.id}` && method === 'GET') return ok({ template: { id: LIB_ROW.id, bodyJson: BODY } })
    if (u === `/api/j2/template-gallery/${LIB_ROW.id}/preview-mine`) return ok({ slots: [], cards: [], tools: [], questions: [] })
    if (u === `/api/j2/template-gallery/${LIB_ROW.id}/use-template` && method === 'POST') {
      return ok({ note: { id: 'lib1', title: 'Night-before prep', bodyJson: BODY, updatedAt: 'L0' }, skipped: [], style: { id: 's1' },
        credit: null, created: { routines: [], trackers: [], widgets: [] } })
    }
    return ok({})
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const renderTab = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)

describe('creating from a member template', () => {
  it('reads the template, creates the note through createNoteViaApi, lands its properties, and opens it', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    // Scoped: the built-in catalog has its own "Weekly review" card.
    // (An empty notebook also shows the picker inline, so there are two.)
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
    const post = calls.find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    expect(post.body).toMatchObject({ title: 'Week', bodyJson: BODY })
    const put = calls.find((c) => c.url === '/api/j2/notes/new1' && c.method === 'PUT')
    expect(put.body).toEqual({ properties: { 'builtin:thesis_status': 'active' } })
    expect(recordLandedRevision).toHaveBeenCalledWith(expect.objectContaining({ noteId: 'new1', updatedAt: 'R1' }))
  })

  it('a template that cannot be read creates nothing and says so', async () => {
    templateRead.ok = false
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    // Scoped: the built-in catalog has its own "Weekly review" card.
    // (An empty notebook also shows the picker inline, so there are two.)
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t open the template “Weekly review”. Nothing was created.'.replace('’', "'"))
    expect(calls.some((c) => c.url === '/api/j2/notes' && c.method === 'POST')).toBe(false)
  })

  // Wave 10 (DR-C follow-up, M-open-item 7): Preview already reads the full
  // template (title/bodyJson/properties) to render it. "Use this template"
  // used to hand the picker's bare SUMMARY (no bodyJson) back to
  // `createFromMemberTemplate`, which unconditionally re-read it -- a second
  // GET for data already sitting in the preview's own state.
  it('using a template from its preview does not re-read what the preview already fetched', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: 'Preview Weekly review' }))
    const dialog = await screen.findByRole('dialog', { name: 'Weekly review' })
    await within(dialog).findByText('What worked')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this template' }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
    const reads = calls.filter((c) => c.url === '/api/j2/note-templates/t1' && c.method === 'GET')
    expect(reads).toHaveLength(1)
    const post = calls.find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    expect(post.body).toMatchObject({ title: 'Week', bodyJson: BODY })
    const put = calls.find((c) => c.url === '/api/j2/notes/new1' && c.method === 'PUT')
    expect(put.body).toEqual({ properties: { 'builtin:thesis_status': 'active' } })
  })
})

// 11.20 walk D1 (major): "Use" from the Template library left the New note sheet open over the new note, focus trapped
// in it, because the library's Use only navigated. It now lands the note through the SAME door a member template's
// pick lands through (the sheet closes, the note opens with focus in its title).
// W11-R80 m-1: a real browser refuses focus to an element inside an `inert` subtree (jsdom does not implement that), so
// these rails make jsdom refuse it too: focus() on an element with an inert ancestor does nothing.
const realFocus = HTMLElement.prototype.focus
function refuseFocusUnderInert() {
  HTMLElement.prototype.focus = function focus(...a) { if (!this.closest('[inert]')) realFocus.apply(this, a) }
}
afterEach(() => { HTMLElement.prototype.focus = realFocus })

describe('using a Template library template (wave 11, walk D1)', () => {
  const newNoteSheet = () => screen.queryByRole('dialog', { name: 'New note' })
  it('closes the New note sheet and opens the new note with focus where a member template puts it', async () => {
    latchNotebookFlags({ notebook_widgets_w11_enabled: true })
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const sheet = await screen.findByRole('dialog', { name: 'New note' })
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Preview Night-before prep, from the Template library' }))
    const detail = await screen.findByRole('dialog', { name: 'Night-before prep' })
    fireEvent.click(within(detail).getByRole('button', { name: 'Use this template' }))
    const adopt = await screen.findByRole('dialog', { name: ADOPT_TITLE }, { timeout: 4000 })
    const use = await within(adopt).findByRole('button', { name: 'Use' })
    await waitFor(() => expect(use).not.toBeDisabled())
    fireEvent.click(use)
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'lib1'))
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-open-focus', 'title')
    await waitFor(() => expect(newNoteSheet()).toBeNull())
    expect(calls.filter((c) => c.url.endsWith('/use-template'))).toHaveLength(1)
  })

  it("m-1: focus ENDS in the new note's title, with no inert ancestor (the adoption sheet released the page first)", async () => {
    refuseFocusUnderInert()
    latchNotebookFlags({ notebook_widgets_w11_enabled: true })
    const appRoot = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' }))
    try {
      render(<MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>, { container: appRoot })
      fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
      const sheet = await screen.findByRole('dialog', { name: 'New note' })
      fireEvent.click(await within(sheet).findByRole('button', { name: 'Preview Night-before prep, from the Template library' }))
      const detail = await screen.findByRole('dialog', { name: 'Night-before prep' })
      fireEvent.click(within(detail).getByRole('button', { name: 'Use this template' }))
      const adopt = await screen.findByRole('dialog', { name: ADOPT_TITLE }, { timeout: 4000 })
      const use = await within(adopt).findByRole('button', { name: 'Use' })
      await waitFor(() => expect(use).not.toBeDisabled())
      fireEvent.click(use)
      await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'lib1'))
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' })))
      expect(document.activeElement.closest('[inert]')).toBeNull()
      expect(appRoot.hasAttribute('inert')).toBe(false)
    } finally {
      appRoot.remove()
    }
  })

  it('CONTROL: a member template lands the same way (sheet closed, focus in the title)', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    await screen.findByRole('dialog', { name: 'New note' })
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
    expect(screen.getByTestId('note-editor')).toHaveAttribute('data-open-focus', 'title')
    await waitFor(() => expect(newNoteSheet()).toBeNull())
  })
})

// W11-R80 m-3: a note made from Your templates ends the way the editor will hold it. A template ending on a list (or a
// heading, a table) made a note TipTap's TrailingNode appends a paragraph to as it opens: one PUT on the first open.
// The client normalises the body through the editor itself (lib/editorNormalForm.js) before the create.
describe("a note from Your templates is created in the editor's own form (W11-R80 m-3)", () => {
  const list = { type: 'bulletList', content: [{ type: 'listItem', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Check the gap' }] }] }] }
  it('a template ending on a list makes a note ending on the trailing paragraph', async () => {
    templateBody = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Checklist' }] }, list] }
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
    const post = calls.find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    expect(post.body.bodyJson.content.map((n) => n.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
    expect(post.body.bodyJson.content.at(-1)).toEqual({ type: 'paragraph' })
  })
  it('CONTROL: a template already ending on a paragraph is sent with its blocks unchanged', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const [mine] = await screen.findAllByRole('region', { name: 'Your templates' })
    fireEvent.click(await within(mine).findByRole('button', { name: /^Weekly review/ }))
    await waitFor(() => expect(screen.getByTestId('note-editor')).toHaveAttribute('data-note-id', 'new1'))
    const post = calls.find((c) => c.url === '/api/j2/notes' && c.method === 'POST')
    expect(post.body.bodyJson).toEqual(BODY)
  })
})

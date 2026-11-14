// Follow-up C (one room for templates): the manager's Plain templates group, the member's "Save as template" copies
// (`/api/j2/note-templates`), below the per-note-type lists. The REAL manager and the real clients over a faked
// network; the share form (lazy, dark behind the gallery switch) is a stand-in that shows what it was handed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { AuthContext } from '../../../../../context/AuthContext'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { __resetOfferApplied } from './offerApplied'

const setPref = vi.fn()
vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref, setPrefMerged: vi.fn(), loading: false }),
}))
vi.mock('../GalleryPublishForm', () => ({
  default: ({ template, onDone }) => (
    <div data-testid="share-form">
      <p>{`Sharing ${template.name}`}</p>
      <button type="button" onClick={() => onDone('Sent for review.')}>Send</button>
    </div>
  ),
}))

import StylesManager from './StylesManager'

const KINDS = BUILTIN_NOTE_KINDS.map((k, i) => ({ ...k, builtin: true, sortOrder: i }))
const STYLE_LIST = { kinds: KINDS, styles: [{ id: 'builtin:trade_plan', name: 'Trade plan', kindId: 'trade_plan', builtin: true, isDefault: true, version: 1, blocks: [], properties: {} }], blockKinds: [] }
const PLAIN = [{ id: 't1', name: 'Morning plan', title: 'Plan', createdAt: '2' }, { id: 't2', name: 'Weekly wrap', title: '', createdAt: '1' }]
const BODY = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Levels to watch' }] }] }

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let calls
function installFetch({ plain = PLAIN } = {}) {
  calls = []
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const path = String(typeof input === 'string' ? input : input.url)
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    if (method === 'GET' && path === '/api/j2/journal-styles') return json(200, STYLE_LIST)
    if (method === 'GET' && path === '/api/j2/note-kinds/mapping-offer') return json(200, { offer: null })
    if (method === 'GET' && path === '/api/j2/note-templates') return json(200, { templates: plain })
    const one = /^\/api\/j2\/note-templates\/([^/]+)$/.exec(path)
    if (one && method === 'GET') return json(200, { template: { ...plain.find((t) => t.id === one[1]), bodyJson: BODY, properties: {} } })
    if (one && method === 'PATCH') return json(200, { template: { ...plain.find((t) => t.id === one[1]), name: body.name } })
    if (one && method === 'DELETE') return json(200, { ok: true })
    return json(404, { detail: 'Not found' })
  })
}
const sent = (method, path) => calls.filter((c) => c.method === method && c.path === path)

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_template_gallery_enabled: true })
  __resetOfferApplied()
  setPref.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
  installFetch()
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

const tree = (props = {}) => (
  <AuthContext.Provider value={{ user: { id: 'u1' } }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StylesManager open onClose={vi.fn()} {...props} />
    </SWRConfig>
  </AuthContext.Provider>
)
const group = async () => (await screen.findByRole('heading', { name: 'Plain templates', level: 3 })).closest('section')
const item = (name) => document.querySelector(`[data-plain-template="${PLAIN.find((t) => t.name === name).id}"]`)

describe('Manage templates: the Plain templates group', () => {
  it('sits below the per-note-type lists, says what a plain template is, and lists each one with its actions', async () => {
    render(tree({ onUsePlain: vi.fn() }))
    const g = await group()
    expect(g).toHaveTextContent('Copies of a note made with Save as template. They start a note as plain text, without live blocks or a note type.')
    // below the per-note-type lists (the last note type's section comes first in the document)
    const lastKind = screen.getByRole('heading', { name: KINDS[KINDS.length - 1].name, level: 3 })
    expect(lastKind.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(item('Morning plan')).toBeTruthy())
    const row = item('Morning plan')
    for (const name of ['Use Morning plan', 'Preview Morning plan', 'Rename Morning plan', 'Delete Morning plan',
      'Share Morning plan to the Template library']) {
      expect(within(row).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(item('Weekly wrap')).toBeTruthy()
    cleanup()
    installFetch()
    render(tree())                                                          // no door to make a note: no Use
    await waitFor(() => expect(item('Morning plan')).toBeTruthy())
    expect(within(item('Morning plan')).queryByRole('button', { name: 'Use Morning plan' })).toBeNull()
  })

  it('Rename sends the new name and says so', async () => {
    render(tree())
    await group()
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Morning plan' }))
    const field = screen.getByRole('textbox', { name: 'New name for Morning plan' })
    fireEvent.change(field, { target: { value: 'Opening plan' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Renamed to “Opening plan”.')).toBeInTheDocument()
    expect(sent('PATCH', '/api/j2/note-templates/t1')[0].body).toEqual({ name: 'Opening plan' })
  })

  it('Delete asks once, says it cannot be undone, and only then deletes', async () => {
    render(tree())
    await group()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Morning plan' }))
    const ask = screen.getByRole('group', { name: 'Delete Morning plan?' })
    expect(ask).toHaveTextContent("Delete “Morning plan”? This can't be undone.")
    expect(sent('DELETE', '/api/j2/note-templates/t1')).toHaveLength(0)
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Deleted “Morning plan”. Notes made from it are unchanged.')).toBeInTheDocument()
    expect(sent('DELETE', '/api/j2/note-templates/t1')).toHaveLength(1)
  })

  it('Share opens the Template library form for that template', async () => {
    render(tree())
    await group()
    fireEvent.click(await screen.findByRole('button', { name: 'Share Morning plan to the Template library' }))
    expect(await screen.findByText('Sharing Morning plan')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Sent for review.')).toBeInTheDocument()
  })

  it('Use closes the manager and hands the template to the door that makes the note (the picker\'s own action)', async () => {
    const onUsePlain = vi.fn()
    const onClose = vi.fn()
    render(tree({ onUsePlain, onClose }))
    await group()
    fireEvent.click(await screen.findByRole('button', { name: 'Use Morning plan' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onUsePlain).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', name: 'Morning plan' }))
  })

  it('Preview opens the body, and its Use makes the note from that same read', async () => {
    const onUsePlain = vi.fn()
    render(tree({ onUsePlain }))
    await group()
    fireEvent.click(await screen.findByRole('button', { name: 'Preview Morning plan' }))
    const sheet = await screen.findByRole('dialog', { name: 'Morning plan' })
    expect(await within(sheet).findByText('Levels to watch')).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Use' }))
    await waitFor(() => expect(onUsePlain).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', bodyJson: BODY })))
  })

  it('the daily control is at the top of the group and writes the preference', async () => {
    render(tree())
    const g = await group()
    const select = await within(g).findByRole('combobox', { name: 'Daily notes start from' })
    expect(select).toHaveAccessibleDescription('Daily notes can start from a plain template.')
    const first = within(g).getAllByRole('button')[0]
    expect(select.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()   // above every row
    fireEvent.change(select, { target: { value: 't2' } })
    expect(setPref).toHaveBeenCalledWith('notebook_daily_template', 't2')
  })

  it('empty: one line that says where plain templates come from, and no daily control', async () => {
    installFetch({ plain: [] })
    render(tree())
    const g = await group()
    expect(await within(g).findByText("No plain templates yet. Open a note's More menu and choose Save as template.")).toBeInTheDocument()
    expect(within(g).queryByRole('combobox')).toBeNull()
  })

  it('show "plain" opens Active at the group (its heading takes focus); show "daily" lands on the control', async () => {
    render(tree({ show: 'plain', showKey: 1 }))
    const head = await screen.findByRole('heading', { name: 'Plain templates', level: 3 })
    await waitFor(() => expect(head).toHaveFocus())
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    cleanup()
    installFetch()
    render(tree({ show: 'daily', showKey: 1 }))
    const select = await screen.findByRole('combobox', { name: 'Daily notes start from' })
    await waitFor(() => expect(select).toHaveFocus())
  })

  it('CONTROL: opened with no place, focus goes to the dialog\'s Close button, not the group', async () => {
    render(tree())
    const head = await screen.findByRole('heading', { name: 'Plain templates', level: 3 })
    await waitFor(() => expect(item('Morning plan')).toBeTruthy())
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByRole('button', { name: 'Close' })[0]))
    expect(head).not.toHaveFocus()
  })
})

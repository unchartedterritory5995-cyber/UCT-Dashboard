// Follow-up C (one room for templates): the manager's three views (Active, Archived, Recently deleted), a member row's
// Archive and "Used in N notes" in Active, the Undo line that says where a deleted template went, and `show`.
// The REAL clients (lib/journalStyles.js, lib/templateLibrary.js) over a fake server that MOVES rows between its three
// lists the way the store does, so a row archived in Active is really in Archived next time it is read. Every
// assertion reads what the member sees (roles, names, text) or what the server was sent.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { AuthContext } from '../../../../../context/AuthContext'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { __resetOfferApplied } from './offerApplied'

vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), setPrefMerged: vi.fn(), loading: false }),
}))

import StylesManager from './StylesManager'

const KINDS = BUILTIN_NOTE_KINDS.map((k, i) => ({ ...k, builtin: true, sortOrder: i }))
const own = (x) => ({ builtin: false, isDefault: false, version: 1, blocks: [], properties: {}, credit: null,
  fromLibrary: false, sourceGalleryId: null, archivedAt: null, deletedAt: null, ...x })
const BUILTIN = { id: 'builtin:trade_plan', name: 'Trade plan', kindId: 'trade_plan', builtin: true, isDefault: true, version: 1, blocks: [], properties: {} }
const USED_IN = { s1: [{ id: 'n1', title: 'Monday prep', updatedAt: '2025-03-03T17:00:00Z' },
  { id: 'n2', title: 'Tuesday', updatedAt: '2025-03-02T17:00:00Z' }, { id: 'n3', title: '', updatedAt: '2025-03-01T17:00:00Z' }] }

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
let server
function installServer(overrides = {}) {
  const lists = {
    live: [own({ id: 's1', name: 'Morning prep', kindId: 'daily_prep', usedIn: 3 }),
      own({ id: 's2', name: 'Gap plan', kindId: 'trade_plan', usedIn: 0, credit: "Based on Sam's Gap plan", fromLibrary: true,
        sourceGalleryId: 'g9' })],
    archived: [own({ id: 'sa1', name: 'Old prep', kindId: 'daily_prep', usedIn: 2, archivedAt: '2025-01-10T17:00:00Z' })],
    deleted: [own({ id: 'sx1', name: 'Gone prep', kindId: 'daily_prep', usedIn: 0, deletedAt: '2025-01-20T17:00:00Z' })],
  }
  const calls = []
  const move = (id, from, to, patch) => {
    const i = lists[from].findIndex((s) => s.id === id)
    if (i < 0) return null
    const [row] = lists[from].splice(i, 1)
    const next = { ...row, ...patch }
    lists[to].unshift(next)
    return next
  }
  globalThis.fetch = vi.fn(async (input, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const url = String(typeof input === 'string' ? input : input.url)
    const path = url.replace(/^\/api\/j2\//, '')
    calls.push({ method, path })
    const over = overrides[`${method} ${path}`]
    if (over) return over()
    if (method === 'GET' && path === 'journal-styles') return json(200, { kinds: KINDS, styles: [BUILTIN, ...lists.live], blockKinds: [] })
    const view = /^journal-styles\?view=(\w+)$/.exec(path)
    if (method === 'GET' && view) return json(200, { kinds: KINDS, styles: lists[view[1]] })
    const used = /^journal-styles\/([^/]+)\/used-in$/.exec(path)
    if (method === 'GET' && used) return json(200, { notes: USED_IN[used[1]] || [] })
    const act = /^journal-styles\/([^/]+)\/(archive|unarchive|restore)$/.exec(path)
    if (method === 'POST' && act) {
      const [, id, verb] = act
      let style = null
      if (verb === 'archive') style = move(id, 'live', 'archived', { archivedAt: '2025-04-01T17:00:00Z' })
      if (verb === 'unarchive') style = move(id, 'archived', 'live', { archivedAt: null })
      if (verb === 'restore') {
        const row = lists.deleted.find((s) => s.id === id)
        style = row && move(id, 'deleted', row.archivedAt ? 'archived' : 'live', { deletedAt: null })
      }
      return style ? json(200, { style }) : json(404, { detail: 'Not found' })
    }
    const one = /^journal-styles\/([^/?]+)$/.exec(path)
    if (method === 'DELETE' && one) {
      const style = move(one[1], 'live', 'deleted', { deletedAt: '2025-04-02T17:00:00Z' })
      return style ? json(200, { ok: true, style }) : json(404, { detail: 'Not found' })
    }
    if (method === 'GET' && path === 'note-kinds/mapping-offer') return json(200, { offer: null })
    if (method === 'GET' && path === 'note-templates') return json(200, { templates: [] })
    return json(404, { detail: 'Not found' })
  })
  return { lists, calls }
}
const sent = (method, path) => server.calls.filter((c) => c.method === method && c.path === path)

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_widgets_w11_enabled: true })
  __resetOfferApplied()
  Element.prototype.scrollIntoView = vi.fn()
  server = installServer()
})
afterEach(() => { cleanup(); __resetNotebookFlags() })

const tree = (props = {}) => (
  <AuthContext.Provider value={{ user: { id: 'u1' } }}>
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <StylesManager open onClose={vi.fn()} {...props} />
    </SWRConfig>
  </AuthContext.Provider>
)
const open = (props) => render(tree(props))
const tab = (name) => screen.getByRole('tab', { name })
const kindSection = async (name) => (await screen.findByRole('heading', { name, level: 3 })).closest('section')
const activeRow = async (name) => (await screen.findByText(name, { selector: 'span' })).closest('li')
const listRow = (name) => screen.getAllByTestId('my-tools-template-row')
  .find((r) => r.querySelector('[data-template-name]')?.textContent === name)
const live = () => screen.getByTestId('my-tools-message')

describe('the manager is the one room: its views', () => {
  it('a real tablist: three named tabs, Active selected, the panel named by the selected tab', async () => {
    open()
    const tabs = await screen.findByRole('tablist', { name: 'Show' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Active', 'Archived', 'Recently deleted'])
    expect(tab('Active')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: 'Active' })).toBeInTheDocument()
    // roving tab stop: only the selected tab is in the Tab order
    expect(tab('Active')).toHaveAttribute('tabindex', '0')
    expect(tab('Recently deleted')).toHaveAttribute('tabindex', '-1')
  })

  it('arrow keys move the selection and focus between the tabs (Home and End too, wrapping)', async () => {
    open()
    await screen.findByRole('tablist', { name: 'Show' })
    tab('Active').focus()
    fireEvent.keyDown(tab('Active'), { key: 'ArrowRight' })
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Archived')).toHaveFocus()
    fireEvent.keyDown(tab('Archived'), { key: 'End' })
    expect(tab('Recently deleted')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Recently deleted'), { key: 'ArrowRight' })              // wraps to the first
    expect(tab('Active')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Active')).toHaveFocus()
    fireEvent.keyDown(tab('Active'), { key: 'ArrowLeft' })                         // and back round to the last
    expect(tab('Recently deleted')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(tab('Recently deleted'), { key: 'Home' })
    expect(tab('Active')).toHaveAttribute('aria-selected', 'true')
  })

  it('each view lists the right rows', async () => {
    open()
    // Active: today's content, the templates by note type (the built-in too)
    expect(within(await kindSection('Daily prep')).getByText('Morning prep')).toBeInTheDocument()
    expect(within(await kindSection('Trade plan')).getByText('Gap plan')).toBeInTheDocument()
    expect(screen.queryByText('Old prep')).toBeNull()
    expect(screen.queryByText('Gone prep')).toBeNull()
    // Archived: My tools' list for that filter
    fireEvent.click(tab('Archived'))
    expect(await screen.findByRole('heading', { name: '1 archived' })).toBeInTheDocument()
    expect(listRow('Old prep')).toBeTruthy()
    expect(screen.queryByText('Morning prep')).toBeNull()
    expect(screen.getByRole('tabpanel', { name: 'Archived' })).toBeInTheDocument()
    // Recently deleted: the deleted row with its "Kept until" date
    fireEvent.click(tab('Recently deleted'))
    expect(await screen.findByRole('heading', { name: '1 recently deleted' })).toBeInTheDocument()
    expect(listRow('Gone prep')).toHaveTextContent('Kept until Feb 19, 2025')
    expect(sent('GET', 'journal-styles?view=archived')).toHaveLength(1)
    expect(sent('GET', 'journal-styles?view=deleted')).toHaveLength(1)
  })

  it('Archive moves a row to Archived (asking first when it is in notes), and Restore brings it back', async () => {
    open()
    const row = await activeRow('Morning prep')
    const archive = await within(row).findByRole('button', { name: 'Archive Morning prep' })
    // the hint that its notes keep it, as My tools' menu item said it
    await waitFor(() => expect(archive).toHaveAttribute('aria-description', "It stays in your 3 notes. New notes can't use it until you restore it."))
    fireEvent.click(archive)
    expect(await screen.findByTestId('archive-sentence')).toHaveTextContent("It stays in your 3 notes. New notes can't use it until you restore it.")
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(0)              // asked first: nothing sent yet
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await screen.findByText('Archived “Morning prep”. Restore it from Archived.')
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByText('Morning prep', { selector: 'span' })).toBeNull())
    // it is in Archived now, and Restore brings it back to Active
    fireEvent.click(tab('Archived'))
    await screen.findByRole('heading', { name: '2 archived' })
    fireEvent.click(screen.getByRole('button', { name: 'Restore Morning prep' }))
    await waitFor(() => expect(live()).toHaveTextContent('Restored “Morning prep” to your templates.'))
    expect(sent('POST', 'journal-styles/s1/unarchive')).toHaveLength(1)
    fireEvent.click(tab('Active'))
    expect(within(await kindSection('Daily prep')).getByText('Morning prep')).toBeInTheDocument()
  })

  it('a template in no note archives at once (nothing to ask), with the hint that says only what new notes lose', async () => {
    open()
    const row = await activeRow('Gap plan')
    const archive = await within(row).findByRole('button', { name: 'Archive Gap plan' })
    expect(archive).toHaveAttribute('aria-description', "New notes can't use it until you restore it.")
    fireEvent.click(archive)
    await screen.findByText('Archived “Gap plan”. Restore it from Archived.')
    expect(screen.queryByTestId('archive-sentence')).toBeNull()
    expect(sent('POST', 'journal-styles/s2/archive')).toHaveLength(1)
  })

  it('soft Delete moves a row to Recently deleted, and the Undo line names it and says so', async () => {
    open()
    const row = await activeRow('Morning prep')
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Morning prep' }))
    const line = await screen.findByText('Deleted “Morning prep”. Moved to Recently deleted.')
    expect(within(line.closest('p')).getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    expect(sent('DELETE', 'journal-styles/s1')).toHaveLength(1)
    fireEvent.click(tab('Recently deleted'))
    await screen.findByRole('heading', { name: '2 recently deleted' })
    expect(listRow('Morning prep')).toBeTruthy()
  })

  it('"Used in N notes" opens the list of those notes; Back returns focus to the line', async () => {
    open()
    const row = await activeRow('Morning prep')
    const used = await within(row).findByRole('button', { name: 'Used in 3 notes: list the notes made with Morning prep' })
    expect(within(await activeRow('Gap plan')).getByText('Not in any note')).toBeInTheDocument()   // no zeros
    fireEvent.click(used)
    expect(await screen.findByRole('heading', { name: '“Morning prep” is in 3 notes' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Monday prep/ })).toHaveAttribute('href', '/journal/notebook?note=n1')
    expect(sent('GET', 'journal-styles/s1/used-in')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back to your templates' }))
    await waitFor(() => expect(within(row).getByRole('button', { name: /^Used in 3 notes/ })).toHaveFocus())
  })

  it('`show` opens Archived or Recently deleted once; an unknown value opens Active', async () => {
    open({ show: 'archived', showKey: 1 })
    expect(await screen.findByRole('heading', { name: '1 archived' })).toBeInTheDocument()
    expect(tab('Archived')).toHaveAttribute('aria-selected', 'true')
    cleanup()
    server = installServer()
    open({ show: 'deleted', showKey: 1 })
    expect(await screen.findByRole('heading', { name: '1 recently deleted' })).toBeInTheDocument()
    cleanup()
    server = installServer()
    open({ show: 'everything', showKey: 1 })
    await screen.findByRole('tablist', { name: 'Show' })
    expect(tab('Active')).toHaveAttribute('aria-selected', 'true')
    expect(within(await kindSection('Daily prep')).getByText('Morning prep')).toBeInTheDocument()
  })

  it('with wave 11 off: no view switch, no Archive, no "Used in", the Undo line only names it, and `show` is ignored', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_widgets_w11_enabled: false })
    open({ show: 'archived', showKey: 1 })
    const row = await activeRow('Morning prep')                                   // control: Active rendered
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(within(row).queryByRole('button', { name: /^Archive/ })).toBeNull()
    expect(within(row).queryByText(/Used in|Not in any note/)).toBeNull()
    expect(server.calls.some((c) => c.path.includes('?view='))).toBe(false)        // the wave 11 routes are not asked
    fireEvent.click(within(row).getByRole('button', { name: 'Delete Morning prep' }))
    expect(await screen.findByText('Deleted “Morning prep”.')).toBeInTheDocument()
    expect(screen.queryByText(/Moved to Recently deleted/)).toBeNull()
  })

  // ── fix round 1 ──────────────────────────────────────────────────────────────────────────────────
  it('(1) Archive pressed BEFORE the usage read answers asks with the real count, and archives only on confirm', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    server = installServer({ 'GET journal-styles?view=live': async () => { await gate; return json(200, { kinds: KINDS, styles: [] }) } })
    open()
    const row = await activeRow('Morning prep')
    const archive = within(row).getByRole('button', { name: 'Archive Morning prep' })
    // the count is not known yet: the hint never claims "no notes"
    expect(archive).toHaveAttribute('aria-description', "Notes that use it keep it. New notes can't use it until you restore it.")
    fireEvent.click(archive)
    expect(await screen.findByTestId('archive-sentence')).toHaveTextContent("It stays in your 3 notes. New notes can't use it until you restore it.")
    expect(sent('GET', 'journal-styles/s1/used-in')).toHaveLength(1)        // its own notes, read on the press
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(0)       // asked, nothing sent
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await screen.findByText('Archived “Morning prep”. Restore it from Archived.')
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(1)
    release()
  })

  it('(1) with the usage read answering 500 the panel still asks, and with its own read failing too it asks without a number', async () => {
    server = installServer({
      'GET journal-styles?view=live': async () => json(500, {}),
      'GET journal-styles/s2/used-in': async () => json(500, {}),
    })
    open()
    const row = await activeRow('Gap plan')
    await waitFor(() => expect(sent('GET', 'journal-styles?view=live').length).toBeGreaterThan(0))
    fireEvent.click(within(row).getByRole('button', { name: 'Archive Gap plan' }))
    expect(await screen.findByText('Archive this template? Notes that use it keep it.')).toBeInTheDocument()
    expect(sent('POST', 'journal-styles/s2/archive')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await screen.findByText('Archived “Gap plan”. Restore it from Archived.')
    expect(sent('POST', 'journal-styles/s2/archive')).toHaveLength(1)
  })

  it('(final 2a) while the template\'s own notes are being read, the panel\'s Archive is off and pressing it sends nothing', async () => {
    let releaseList
    let releaseUsed
    const listGate = new Promise((r) => { releaseList = r })
    const usedGate = new Promise((r) => { releaseUsed = r })
    server = installServer({
      'GET journal-styles?view=live': async () => { await listGate; return json(200, { kinds: KINDS, styles: [] }) },
      'GET journal-styles/s1/used-in': async () => { await usedGate; return json(200, { notes: USED_IN.s1 }) },
    })
    open()
    const row = await activeRow('Morning prep')
    fireEvent.click(within(row).getByRole('button', { name: 'Archive Morning prep' }))
    expect(await screen.findByTestId('archive-sentence')).toHaveTextContent('Checking which notes use it…')
    const confirm = within(screen.getByTestId('my-tools-archive')).getByRole('button', { name: 'Archive' })
    expect(confirm).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(confirm)
    await new Promise((r) => setTimeout(r, 0))
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(0)          // nothing sent while checking
    // CONTROL: the read answers, the sentence has its count, and the same button now archives
    releaseUsed()
    expect(await screen.findByText("It stays in your 3 notes. New notes can't use it until you restore it.")).toBeInTheDocument()
    expect(confirm).not.toHaveAttribute('aria-disabled')
    fireEvent.click(confirm)
    await screen.findByText('Archived “Morning prep”. Restore it from Archived.')
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(1)
    releaseList()
  })

  it('(1) CONTROL: a KNOWN zero archives at once, as before (no panel, no extra read)', async () => {
    open()
    const row = await activeRow('Gap plan')
    const archive = await within(row).findByRole('button', { name: 'Archive Gap plan' })
    await waitFor(() => expect(archive).toHaveAttribute('aria-description', "New notes can't use it until you restore it."))
    fireEvent.click(archive)
    await screen.findByText('Archived “Gap plan”. Restore it from Archived.')
    expect(screen.queryByTestId('my-tools-archive')).toBeNull()
    expect(sent('GET', 'journal-styles/s2/used-in')).toHaveLength(0)
  })

  it('(2f) Escape in the Active "Used in" and Archive panels goes back one level; the next Escape closes the manager', async () => {
    const onClose = vi.fn()
    open({ onClose })
    const row = await activeRow('Morning prep')
    const used = await within(row).findByRole('button', { name: /^Used in 3 notes/ })
    fireEvent.click(used)
    await screen.findByRole('heading', { name: '“Morning prep” is in 3 notes' })
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('heading', { name: '“Morning prep” is in 3 notes' })).toBeNull())
    await waitFor(() => expect(within(row).getByRole('button', { name: /^Used in 3 notes/ })).toHaveFocus())
    expect(onClose).not.toHaveBeenCalled()
    // the Archive panel the same way
    fireEvent.click(within(row).getByRole('button', { name: 'Archive Morning prep' }))
    await screen.findByTestId('archive-sentence')
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('archive-sentence')).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(0)
    // nothing open: Escape is the Sheet's again
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("(2h) an adopted copy's Active row shows the library credit line, the member's own work none", async () => {
    open()
    expect(await within(await activeRow('Gap plan')).findByText("Based on Sam's Gap plan")).toBeInTheDocument()
    expect(await activeRow('Morning prep')).not.toHaveTextContent('Based on')
  })
})

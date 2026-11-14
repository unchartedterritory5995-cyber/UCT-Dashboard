// Follow-up C (one room for templates): the member's archived and recently deleted templates, drawn by TemplateList
// inside Manage templates' Archived and Recently deleted views. These are My tools' Templates tab rails
// (TemplatesTab.test.jsx until follow-up C, wave 11 Task 11.19), pointed at the manager, where the list now lives;
// the tab's Active-only rails (Open, Rename, Duplicate, Share, Archive) moved with their actions: the manager's own Edit,
// Duplicate and Share are railed by styles/StylesManager.test.jsx, its Archive and "Used in" by
// styles/StylesManager.views.test.jsx. Every assertion reads what the member SEES (rendered text, roles, names) or what
// the server is SENT (method, path, body), never component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { contractBody } from '../../../__fixtures__/contract'
import { __resetNotebookFlags, latchNotebookFlags } from '../../../lib/offline/notebookFlags'
import { AuthContext } from '../../../../../context/AuthContext'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../../../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: vi.fn(), setPrefMerged: vi.fn(), loading: false }),
}))

import StylesManager from '../styles/StylesManager'

const KINDS = [...BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })), { id: 'k-mine', name: 'Swing check', builtin: false }]
const own = (x) => ({ builtin: false, isDefault: false, version: 1, blocks: [], properties: {}, credit: null,
  fromLibrary: false, sourceGalleryId: null, ...x })
const STYLES = {
  live: [own({ id: 's1', name: 'Morning prep', kindId: 'daily_prep', usedIn: 3, updatedAt: '2025-03-04T17:00:00Z' })],
  archived: [own({ id: 'sa1', name: 'Old prep', kindId: 'daily_prep', usedIn: 2, updatedAt: '2025-01-09T17:00:00Z',
    archivedAt: '2025-01-10T17:00:00Z' }),
  own({ id: 'sa2', name: 'Swing review', kindId: 'k-mine', usedIn: 0, updatedAt: '2025-02-10T17:00:00Z',
    archivedAt: '2025-02-11T17:00:00Z', credit: "Based on Sam's Swing review", fromLibrary: true, sourceGalleryId: 'g9' })],
  deleted: [own({ id: 'sx1', name: 'Gone prep', kindId: 'daily_prep', usedIn: 0, updatedAt: '2025-01-02T17:00:00Z',
    archivedAt: '2025-01-10T17:00:00Z', deletedAt: '2025-01-20T17:00:00Z' })],
}
const USED_IN = { sa1: [{ id: 'n1', title: 'Monday prep', updatedAt: '2025-03-03T17:00:00Z' },
  { id: 'n2', title: '', updatedAt: '2025-03-01T17:00:00Z' }] }

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
function installFetch(overrides = []) {
  const calls = []
  const lists = { live: [...STYLES.live], archived: [...STYLES.archived], deleted: [...STYLES.deleted] }
  const fn = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const u = String(url)
    const path = u.startsWith('/api/j2/') ? u.slice('/api/j2/'.length) : u
    let body = null
    try { body = init.body ? JSON.parse(init.body) : null } catch { body = init.body }
    const req = { method, path, body }
    calls.push(req)
    for (const [m, p, handler] of overrides) {
      if (m !== method || (typeof p === 'string' ? p !== path : !p.test(path))) continue
      const out = await handler(req)
      return out && typeof out.ok === 'boolean' && typeof out.json === 'function' ? out : json(200, out)
    }
    if (method === 'GET' && path === 'journal-styles') return json(200, { kinds: KINDS, styles: lists.live, blockKinds: [] })
    if (method === 'GET' && path === 'note-kinds/mapping-offer') return json(200, { offer: null })
    if (method === 'GET' && path === 'note-templates') return json(200, { templates: [] })
    const view = /^journal-styles\?view=(\w+)$/.exec(path)
    if (method === 'GET' && view) return json(200, { kinds: KINDS, styles: lists[view[1]] || [] })
    const used = /^journal-styles\/([^/]+)\/used-in$/.exec(path)
    if (method === 'GET' && used) return json(200, { notes: USED_IN[used[1]] || [] })
    const act = /^journal-styles\/([^/]+)\/(unarchive|delete|restore)$/.exec(path)
    if (method === 'POST' && act) {
      const hit = Object.values(lists).flat().find((s) => s.id === act[1])
      return json(200, { style: hit })
    }
    return json(404, { detail: 'Not found' })
  })
  vi.stubGlobal('fetch', fn)
  return { fn, calls, lists }
}

const live = () => screen.getByTestId('my-tools-message')
const saysLive = (text) => waitFor(() => expect(live()).toHaveTextContent(text))
let net
beforeEach(() => {
  bp.phone = false
  bp.touch = false
  __resetNotebookFlags()
  latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_widgets_w11_enabled: true })
  Element.prototype.scrollIntoView = vi.fn()
  net = installFetch()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetNotebookFlags()
})

async function openManager() {
  render(
    <AuthContext.Provider value={{ user: { id: 'u1' } }}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <StylesManager open onClose={() => {}} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
  await screen.findByRole('tablist', { name: 'Show' })
}
const rows = () => screen.getAllByTestId('my-tools-template-row')
const rowOf = (name) => rows().find((r) => r.querySelector('[data-template-name]')?.textContent === name)
async function menuFor(name) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return bp.touch ? screen.findByRole('dialog', { name }) : screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole(bp.touch ? 'button' : 'menuitem', { name: label })
const menuLabels = () => screen.queryAllByRole(bp.touch ? 'button' : 'menuitem').map((b) => b.textContent)
const showList = (label) => fireEvent.click(screen.getByRole('tab', { name: label }))
const sent = (method, path) => net.calls.filter((c) => c.method === method && c.path === path)

describe('Manage templates: Archived and Recently deleted (TemplateList)', () => {
  it("merge review I-2: the server's REAL archived list and used-in answer (contract fixtures) render as the member's rows", async () => {
    const archivedBody = contractBody('journal-styles.list.archived')
    const usedBody = contractBody('journal-styles.used-in')
    const gone = archivedBody.styles.find((st) => !st.builtin)
    expect(gone).toBeTruthy()                                               // non-vacuity: the member's own row
    // the recorded row is in no note; a variation in notes (spread + override of the fixture) lists the used-in answer
    const inNotes = { ...archivedBody, styles: archivedBody.styles.map((st) => (st.id === gone.id ? { ...st, usedIn: usedBody.notes.length } : st)) }
    net = installFetch([
      ['GET', 'journal-styles?view=archived', () => inNotes],
      ['GET', `journal-styles/${gone.id}/used-in`, () => usedBody],
    ])
    await openManager()
    showList('Archived')
    await waitFor(() => expect(rowOf(gone.name)).toBeTruthy())
    const row = rowOf(gone.name)
    expect(row).toHaveTextContent(gone.credit)                              // "Based on UCT's Watchlist review"
    fireEvent.click(within(row).getByRole('button', { name: new RegExp(`^Used in ${usedBody.notes.length} notes`) }))
    expect(await screen.findByRole('heading', { name: `“${gone.name}” is in ${usedBody.notes.length} notes` })).toBeInTheDocument()
    const links = await screen.findAllByRole('link', { name: /Untitled note/ })
    expect(links.map((a) => a.getAttribute('href')).sort())
      .toEqual(usedBody.notes.map((n) => `/journal/notebook?note=${n.id}`).sort())
  })

  it('archived rows: the kind of note, "Used in N notes" (or "Not in any note"), the edited date, the credit line', async () => {
    await openManager()
    showList('Archived')
    expect(await screen.findByRole('heading', { name: '2 archived' })).toBeInTheDocument()
    const old = rowOf('Old prep')
    expect(old).toHaveTextContent('Daily prep')
    expect(within(old).getByRole('button', { name: /^Used in 2 notes/ })).toBeInTheDocument()
    expect(old).toHaveTextContent('Edited Jan 9, 2025')
    expect(old).not.toHaveTextContent('Based on')
    const swing = rowOf('Swing review')
    expect(swing).toHaveTextContent('Swing check')                          // the member's own kind, by its name
    expect(swing).toHaveTextContent('Not in any note')
    expect(swing).not.toHaveTextContent(/\b0\b/)                            // no zeros
    expect(swing).toHaveTextContent("Based on Sam's Swing review")
    // Used in: each note a real link; Back returns to the row's actions
    fireEvent.click(within(old).getByRole('button', { name: /^Used in 2 notes/ }))
    expect(await screen.findByRole('link', { name: /Monday prep/ })).toHaveAttribute('href', '/journal/notebook?note=n1')
    fireEvent.click(screen.getByRole('button', { name: 'Back to your templates' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Old prep' })).toHaveFocus())
  })

  it('delete_only_from_archived_with_typed_name', async () => {
    await openManager()
    await screen.findByText('Morning prep', { selector: 'span' })
    expect(screen.queryByRole('button', { name: /Delete permanently/ })).toBeNull()      // never from Active
    showList('Archived')
    await screen.findByRole('heading', { name: '2 archived' })
    await menuFor('Old prep')
    expect(menuLabels()).toEqual(expect.arrayContaining(['Restore', 'Used in 2 notes', 'Delete permanently']))
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByTestId('delete-typed-name')
    expect(screen.getByText(/It moves to Recently deleted for 30 days/)).toBeInTheDocument()
    expect(screen.getByText(/Your 2 notes stay as they are\./)).toBeInTheDocument()
    fireEvent.change(field, { target: { value: 'Old pre' } })
    fireEvent.submit(field.closest('form'))
    expect(net.calls.filter((c) => c.path.endsWith('/delete'))).toHaveLength(0)   // not the name: no request
    fireEvent.change(field, { target: { value: 'Old prep' } })
    fireEvent.submit(field.closest('form'))
    await saysLive('“Old prep” moved to Recently deleted. It\'s kept for 30 days.')
    expect(sent('POST', 'journal-styles/sa1/delete')[0].body).toEqual({ typedName: 'Old prep' })
  })

  it("a refused delete shows the server's own sentence", async () => {
    const S_ARCHIVE_FIRST = 'SERVER: Archive this template before deleting it.'
    net = installFetch([['POST', 'journal-styles/sa1/delete', () => json(400, { detail: S_ARCHIVE_FIRST })]])
    await openManager()
    showList('Archived')
    await screen.findByRole('heading', { name: '2 archived' })
    await menuFor('Old prep')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByTestId('delete-typed-name')
    fireEvent.change(field, { target: { value: 'Old prep' } })
    fireEvent.submit(field.closest('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent(S_ARCHIVE_FIRST)
  })

  it('recently_deleted_kept_until', async () => {
    await openManager()
    showList('Recently deleted')
    await screen.findByRole('heading', { name: '1 recently deleted' })
    const row = rowOf('Gone prep')
    expect(row).toHaveTextContent('Deleted Jan 20, 2025')
    expect(row).toHaveTextContent('Kept until Feb 19, 2025')
    await menuFor('Gone prep')
    expect(menuLabels()).toEqual(['Restore'])
    fireEvent.click(menuItem('Restore'))
    await saysLive('Restored “Gone prep”. It\'s in Archived.')
    expect(sent('POST', 'journal-styles/sx1/restore')).toHaveLength(1)
  })

  it('no zeros and no blank date: an empty list names itself, a dateless deleted row says nothing (m-2, m-6)', async () => {
    net.lists.archived = []
    net.lists.deleted = [{ ...STYLES.deleted[0], deletedAt: null }]
    await openManager()
    showList('Archived')
    expect(await screen.findByRole('heading', { name: 'Archived', level: 3 })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Archived' })).not.toHaveTextContent(/\b0\b/)
    showList('Recently deleted')
    await screen.findByRole('heading', { name: '1 recently deleted' })
    expect(rowOf('Gone prep')).not.toHaveTextContent('Deleted')
  })

  it('a restore past the 30 days shows the server’s sentence; Restore from Archived unarchives', async () => {
    const S_TOO_OLD = 'SERVER: This template was deleted more than 30 days ago.'
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => json(400, { detail: S_TOO_OLD })]])
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive(S_TOO_OLD)
    showList('Archived')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Old prep' }))
    await saysLive('Restored “Old prep” to your templates.')
    expect(sent('POST', 'journal-styles/sa1/unarchive')).toHaveLength(1)
  })

  it('F-FE-1 F4: the restore line is worded from the returned archivedAt (W11-R36)', async () => {
    // A template deleted from Archived keeps archived_at and lands back in Archived; one deleted from Active (never
    // archived) lands back in the live list. The SERVER's answer says which, never an assumption.
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => ({ style: { ...STYLES.deleted[0], archivedAt: null, deletedAt: null } })]])
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive('Restored “Gone prep” to your templates.')
    expect(live()).not.toHaveTextContent('Archived')
    cleanup()
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => ({ style: { ...STYLES.deleted[0], deletedAt: null } })]])
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive("Restored “Gone prep”. It's in Archived.")
  })

  it('F-FE-1 F5: a restore the server refuses for good (its kind of note was deleted) says so on the row, focus kept', async () => {
    const S_KIND_GONE = "SERVER: This template's kind of note was deleted, so it can't be restored."
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => json(400, { detail: S_KIND_GONE })]])
    await openManager()
    showList('Recently deleted')
    const restore = await screen.findByRole('button', { name: 'Restore Gone prep' })
    restore.focus()
    fireEvent.click(restore)
    await saysLive(S_KIND_GONE)
    const row = rowOf('Gone prep')
    await waitFor(() => expect(within(row).getByText(S_KIND_GONE)).toBeTruthy())
    expect(row.querySelector('[data-restore-refused]')).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore Gone prep' }))
    expect(sent('POST', 'journal-styles/sx1/restore')).toHaveLength(1)
  })

  it('fix round 1 m-1: a pinned refusal is cleared by a later successful restore, so a re-deleted row starts clean', async () => {
    const S_CAP = 'SERVER: You can keep up to 20 styles. Delete one first.'
    let n = 0
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => (++n === 1 ? json(400, { detail: S_CAP })
      : { style: { ...STYLES.deleted[0], deletedAt: null } })]])
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await waitFor(() => expect(rowOf('Gone prep').querySelector('[data-restore-refused]')).not.toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Restore Gone prep' }))
    await saysLive("Restored “Gone prep”. It's in Archived.")
    await waitFor(() => expect(sent('GET', 'journal-styles?view=deleted').length).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(rowOf('Gone prep')).toBeTruthy())
    expect(rowOf('Gone prep').querySelector('[data-restore-refused]')).toBeNull()
    expect(screen.queryByText(S_CAP)).toBeNull()
  })

  it('fix round 1 m-6: an answer with no archivedAt at all is worded from the row it restored', async () => {
    const bare = () => { const style = { ...STYLES.deleted[0], deletedAt: null }; delete style.archivedAt; return { style } }
    net = installFetch([['POST', 'journal-styles/sx1/restore', bare]])
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive("Restored “Gone prep”. It's in Archived.")
    cleanup()
    net = installFetch([['POST', 'journal-styles/sx1/restore', bare]])
    net.lists.deleted = [{ ...STYLES.deleted[0], archivedAt: null }]
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive('Restored “Gone prep” to your templates.')
  })

  it('F-FE-1 F5 CONTROL: a restore that could not be SENT (offline, a lost answer) is not pinned to the row', async () => {
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => { throw new TypeError('Failed to fetch') }]])
    await openManager()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive("That didn't go through. Try again.")
    expect(rowOf('Gone prep').querySelector('[data-restore-refused]')).toBeNull()
  })

  it('a Restore re-reads the manager\'s own list, so Active shows the template again', async () => {
    await openManager()
    showList('Archived')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Old prep' }))
    await saysLive('Restored “Old prep” to your templates.')
    await waitFor(() => expect(sent('GET', 'journal-styles').length).toBeGreaterThanOrEqual(2))
  })

  it('phone: rows hold no second button, and every action is in the row menu', async () => {
    bp.phone = true
    await openManager()
    showList('Archived')
    await screen.findByRole('heading', { name: '2 archived' })
    const old = rowOf('Old prep')
    expect(within(old).queryByRole('button', { name: 'Restore Old prep' })).toBeNull()
    expect(within(old).queryByRole('button', { name: /Used in/ })).toBeNull()
    expect(old).toHaveTextContent('Used in 2 notes')
    expect(within(old).getByRole('button', { name: 'Actions for Old prep' })).toBeInTheDocument()
  })

  it('member words only: no engine noun reaches the screen', async () => {
    const BANNED = /\b(definitions?|shelf|slots?|payloads?|reducers?|scopes?|journal styles?|styles?|layouts?)\b/i
    await openManager()
    const seen = []
    for (const label of ['Archived', 'Recently deleted']) {
      showList(label)
      await screen.findByRole('heading', { name: /archived|deleted/ })
      seen.push(screen.getByRole('tabpanel', { name: label }).textContent)
    }
    await menuFor('Gone prep')
    seen.push(document.body.textContent.replace(/Manage templates/, ''))
    expect(seen.filter((t) => BANNED.test(t))).toEqual([])
    expect(BANNED.test('a journal style')).toBe(true)                        // CONTROL: the check can see one
  })
})

// Wave 11 (Task 11.19): My tools, the Templates tab. Every assertion reads what the member SEES (rendered text, roles,
// names) or what the server is SENT (method, path, body), never component state. The journal-styles routes are Task
// 11.12's (over Task 11.13's store), not built yet: this fetch stand-in answers them in the plan's shapes
// (`{kinds, styles}`, `{style}`, `{notes}`, a plain-sentence `{detail}` on a refusal).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { BUILTIN_NOTE_KINDS } from '../../../lib/noteKinds'
import { openSharePreview } from '../library/openSharePreview.js'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
const flags = vi.hoisted(() => ({ eleven: true, library: true }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 11 && flags.eleven }))
vi.mock('../../../lib/styleLibraryFlag', async (orig) => ({ ...(await orig()), styleLibraryEnabled: () => flags.library }))
vi.mock('../library/openSharePreview.js', () => ({ openSharePreview: vi.fn(() => () => {}) }))
// The template editor (a static import inside My tools' lazy chunk, fix round 4); a stand-in shows what it was handed.
const editorMounts = vi.hoisted(() => ({ n: 0 }))
vi.mock('../styles/StyleEditor', async () => {
  const { createElement } = await import('react')
  const FakeEditor = ({ style, kinds, onSaved, onCancel }) => (editorMounts.n += 1, createElement('div', { 'data-testid': 'fake-style-editor' },
    createElement('p', null, `Editing ${style.name} with ${kinds.length} kinds`),
    createElement('button', { type: 'button', onClick: () => onSaved({ ...style, name: 'Morning prep v2' }) }, 'Save style'),
    createElement('button', { type: 'button', onClick: onCancel }, 'Cancel edit')))
  return { default: FakeEditor }
})

const KINDS = [...BUILTIN_NOTE_KINDS.map((k) => ({ ...k, builtin: true })), { id: 'k-mine', name: 'Swing check', builtin: false }]
const own = (x) => ({ builtin: false, isDefault: false, version: 1, blocks: [], properties: {}, credit: null,
  fromLibrary: false, sourceGalleryId: null, ...x })
const STYLES = {
  live: [
    { id: 'builtin:trade_plan', name: 'Trade plan (starter)', kindId: 'trade_plan', builtin: true, isDefault: true, usedIn: 9 },
    own({ id: 's1', name: 'Morning prep', kindId: 'daily_prep', usedIn: 3, updatedAt: '2025-03-04T17:00:00Z' }),
    own({ id: 's2', name: 'Swing review', kindId: 'k-mine', usedIn: 0, updatedAt: '2025-02-10T17:00:00Z',
      credit: "Based on Sam's Swing review", fromLibrary: true, sourceGalleryId: 'g9' }),
    own({ id: 's3', name: 'Gap plan', kindId: 'trade_plan', usedIn: 1, updatedAt: '2025-02-01T17:00:00Z',
      credit: "Based on a former member's Gap plan", fromLibrary: true, sourceGalleryId: 'g3' }),
  ],
  archived: [own({ id: 'sa1', name: 'Old prep', kindId: 'daily_prep', usedIn: 2, updatedAt: '2025-01-09T17:00:00Z',
    archivedAt: '2025-01-10T17:00:00Z' })],
  deleted: [own({ id: 'sx1', name: 'Gone prep', kindId: 'daily_prep', usedIn: 0, updatedAt: '2025-01-02T17:00:00Z',
    archivedAt: '2025-01-10T17:00:00Z', deletedAt: '2025-01-20T17:00:00Z' })],
}
const USED_IN = { s1: [{ id: 'n1', title: 'Monday prep', updatedAt: '2025-03-03T17:00:00Z' },
  { id: 'n2', title: '', updatedAt: '2025-03-01T17:00:00Z' }, { id: 'n3', title: 'Tuesday', updatedAt: '2025-03-02T17:00:00Z' }] }

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
    const view = /^journal-styles\?view=(\w+)$/.exec(path)
    if (method === 'GET' && view) return json(200, { kinds: KINDS, styles: lists[view[1]] || [] })
    const used = /^journal-styles\/([^/]+)\/used-in$/.exec(path)
    if (method === 'GET' && used) return json(200, { notes: USED_IN[used[1]] || [] })
    const one = /^journal-styles\/([^/?]+)$/.exec(path)
    if (method === 'GET' && one) {
      const hit = Object.values(lists).flat().find((s) => s.id === decodeURIComponent(one[1]))
      if (hit) return json(200, { style: { ...hit, outlineBodyJson: null } })
    }
    const act = /^journal-styles\/([^/]+)\/(archive|unarchive|duplicate|delete|restore)$/.exec(path)
    if (method === 'POST' && act) {
      const hit = Object.values(lists).flat().find((s) => s.id === act[1])
      if (act[2] === 'duplicate') return json(200, { style: { ...hit, id: `${hit.id}-copy`, name: `${hit.name} copy` } })
      return json(200, { style: hit })
    }
    if (method === 'PUT' && one) return json(200, { style: { ...lists.live.find((s) => s.id === one[1]), name: body?.name } })
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
  flags.eleven = true
  flags.library = true
  net = installFetch()
  openSharePreview.mockClear()
  editorMounts.n = 0
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openTab() {
  render(<MyToolsSheet onClose={() => {}} uid="u1" tab="templates" />)
  await screen.findByRole('heading', { name: /templates?$/ })
}
const rows = () => screen.getAllByTestId('my-tools-template-row')
const rowOf = (name) => rows().find((r) => r.querySelector('[data-template-name]')?.textContent === name)
async function menuFor(name) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return bp.touch ? screen.findByRole('dialog', { name }) : screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole(bp.touch ? 'button' : 'menuitem', { name: label })
const menuLabels = () => screen.queryAllByRole(bp.touch ? 'button' : 'menuitem').map((b) => b.textContent)
const showList = (label) => fireEvent.click(screen.getByRole('button', { name: label, pressed: false }))
const sent = (method, path) => net.calls.filter((c) => c.method === method && c.path === path)

describe('My tools, Templates tab', () => {
  it('templates_rows_used_in_kind_and_credit', async () => {
    await openTab()
    expect(net.calls[0]).toMatchObject({ method: 'GET', path: 'journal-styles?view=live' })
    expect(screen.getByRole('tabpanel', { name: 'Templates' })).toBeInTheDocument()
    // The built-in starter template is not the member's: three rows, never four.
    expect(screen.getByRole('heading', { name: '3 templates' })).toBeInTheDocument()
    expect(rows()).toHaveLength(3)
    expect(screen.queryByText('Trade plan (starter)')).toBeNull()
    const s1 = rowOf('Morning prep')
    expect(s1).toHaveTextContent('Daily prep')                               // the kind of note, by name
    expect(within(s1).getByRole('button', { name: /^Used in 3 notes/ })).toBeInTheDocument()
    expect(s1).toHaveTextContent('Edited Mar 4, 2025')
    expect(s1).not.toHaveTextContent('Based on')                            // the member's own work has no credit
    const s2 = rowOf('Swing review')
    expect(s2).toHaveTextContent('Swing check')                             // the member's own kind, by its name
    expect(s2).toHaveTextContent('Not in any note')
    expect(s2).not.toHaveTextContent(/\b0\b/)                               // no zeros
    expect(within(s2).queryByRole('button', { name: /Used in/ })).toBeNull()
    expect(s2).toHaveTextContent("Based on Sam's Swing review")
    expect(rowOf('Gap plan')).toHaveTextContent("Based on a former member's Gap plan")

    // Used in: the template's notes (the server names their id `id`), each a real link; Back returns to the row.
    fireEvent.click(within(s1).getByRole('button', { name: /^Used in 3 notes/ }))
    expect(await screen.findByRole('heading', { name: '“Morning prep” is in 3 notes' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Monday prep/ })).toHaveAttribute('href', '/journal/notebook?note=n1')
    expect(screen.getByRole('link', { name: /Untitled note/ })).toHaveAttribute('href', '/journal/notebook?note=n2')
    expect(sent('GET', 'journal-styles/s1/used-in')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Back to your templates' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Morning prep' })).toHaveFocus())
  })

  it('archive_sentence_with_count', async () => {
    await openTab()
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Archive'))
    expect(await screen.findByTestId('archive-sentence'))
      .toHaveTextContent("It stays in your 3 notes. New notes can't use it until you restore it.")
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await saysLive('Archived “Morning prep”. Restore it from Archived.')
    expect(sent('POST', 'journal-styles/s1/archive')).toHaveLength(1)
    // One note says "1 note"; a template in no note archives at once, its hint without a zero.
    await menuFor('Gap plan')
    fireEvent.click(menuItem('Archive'))
    expect(await screen.findByTestId('archive-sentence'))
      .toHaveTextContent("It stays in your 1 note. New notes can't use it until you restore it.")
    fireEvent.click(screen.getByRole('button', { name: 'Back to your templates' }))
    await menuFor('Swing review')
    expect(menuItem('Archive')).toHaveAttribute('aria-description', "New notes can't use it until you restore it.")
    fireEvent.click(menuItem('Archive'))
    await saysLive('Archived “Swing review”.')
    expect(sent('POST', 'journal-styles/s2/archive')).toHaveLength(1)
  })

  it('delete_only_from_archived_with_typed_name', async () => {
    await openTab()
    await menuFor('Morning prep')
    expect(menuLabels()).not.toContain('Delete permanently')                 // never from Active
    fireEvent.keyDown(window, { key: 'Escape' })
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
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
    await openTab()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    await menuFor('Old prep')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByTestId('delete-typed-name')
    fireEvent.change(field, { target: { value: 'Old prep' } })
    fireEvent.submit(field.closest('form'))
    expect(await screen.findByRole('alert')).toHaveTextContent(S_ARCHIVE_FIRST)
  })

  it('recently_deleted_kept_until', async () => {
    await openTab()
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
    net.lists.live = []
    net.lists.deleted = [{ ...STYLES.deleted[0], deletedAt: null }]
    await openTab()
    expect(screen.getByRole('heading', { name: 'Your templates' })).toBeInTheDocument()
    showList('Archived')
    expect(await screen.findByRole('heading', { name: 'Archived' })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Templates' })).not.toHaveTextContent(/\b0\b/)
    showList('Recently deleted')
    await screen.findByRole('heading', { name: '1 recently deleted' })
    expect(rowOf('Gone prep')).not.toHaveTextContent('Deleted')
  })

  it('a restore past the 30 days shows the server’s sentence; Restore from Archived unarchives', async () => {
    const S_TOO_OLD = 'SERVER: This template was deleted more than 30 days ago.'
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => json(400, { detail: S_TOO_OLD })]])
    await openTab()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive(S_TOO_OLD)
    showList('Archived')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Old prep' }))
    await saysLive('Restored “Old prep” to your templates.')
    expect(sent('POST', 'journal-styles/sa1/unarchive')).toHaveLength(1)
  })

  it('F-FE-1 F4: the restore line is worded from the returned archivedAt (W11-R36)', async () => {
    // A template deleted from Archived keeps archived_at and lands back in Archived; one deleted from the styles manager
    // (never archived) lands back in the live list. The SERVER's answer says which, never an assumption.
    net = installFetch([['POST', 'journal-styles/sx1/restore', ({ path }) => ({ style: { ...STYLES.deleted[0], archivedAt: null, deletedAt: null } })]])
    await openTab()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive('Restored “Gone prep” to your templates.')
    expect(live()).not.toHaveTextContent('Archived')
    cleanup()
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => ({ style: { ...STYLES.deleted[0], deletedAt: null } })]])
    await openTab()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive("Restored “Gone prep”. It's in Archived.")
  })

  it('F-FE-1 F5: a restore the server refuses for good (its kind of note was deleted) says so on the row, focus kept', async () => {
    const S_KIND_GONE = "SERVER: This template's kind of note was deleted, so it can't be restored."
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => json(400, { detail: S_KIND_GONE })]])
    await openTab()
    showList('Recently deleted')
    const restore = await screen.findByRole('button', { name: 'Restore Gone prep' })
    restore.focus()
    fireEvent.click(restore)
    await saysLive(S_KIND_GONE)
    // The refusal stays on the row it is about, after the live line moves on, in the server's words.
    const row = rowOf('Gone prep')
    await waitFor(() => expect(within(row).getByText(S_KIND_GONE)).toBeTruthy())
    expect(row.querySelector('[data-restore-refused]')).not.toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Restore Gone prep' }))
    expect(sent('POST', 'journal-styles/sx1/restore')).toHaveLength(1)
  })

  it('F-FE-1 F5 CONTROL: a restore that could not be SENT (offline, a lost answer) is not pinned to the row', async () => {
    net = installFetch([['POST', 'journal-styles/sx1/restore', () => { throw new TypeError('Failed to fetch') }]])
    await openTab()
    showList('Recently deleted')
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Gone prep' }))
    await saysLive("That didn't go through. Try again.")
    expect(rowOf('Gone prep').querySelector('[data-restore-refused]')).toBeNull()
  })

  it('share_action_opens_preview_and_absent_for_copies', async () => {
    await openTab()
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Share to library'))
    await waitFor(() => expect(openSharePreview).toHaveBeenCalledTimes(1))
    expect(openSharePreview.mock.calls[0][0]).toMatchObject({ kind: 'template', id: 's1' })
    openSharePreview.mock.calls[0][0].onDone('Sent for review.')
    await saysLive('Sent for review.')
    // A copy from the library is never shared again: no Share on either copy.
    for (const copy of ['Swing review', 'Gap plan']) {
      await menuFor(copy)
      expect(menuLabels(), copy).not.toContain('Share to library')
      expect(menuLabels(), copy).toContain('Duplicate')                     // non-vacuity: the menu is open
      fireEvent.keyDown(window, { key: 'Escape' })
    }
  })

  it('no Share while the library switch is off', async () => {
    flags.library = false
    await openTab()
    await menuFor('Morning prep')
    expect(menuLabels()).toEqual(expect.arrayContaining(['Open', 'Rename', 'Duplicate', 'Archive']))
    expect(menuLabels()).not.toContain('Share to library')
  })

  it('coming_soon_when_w11_off', async () => {
    flags.eleven = false
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="templates" />)
    const panel = screen.getByRole('tabpanel', { name: 'Templates' })
    expect(panel).toHaveTextContent('Templates are coming soon.')
    expect(panel.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
    expect(net.calls.filter((c) => c.path.startsWith('journal-styles'))).toHaveLength(0)
    cleanup()
    flags.eleven = true                                                      // CONTROL: on, the real tab
    await openTab()
    expect(screen.queryByTestId('my-tools-soon')).toBeNull()
  })

  it('Rename sends the name only; Duplicate makes "<name> copy"', async () => {
    await openTab()
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Rename'))
    const field = await screen.findByLabelText('Name')
    expect(field).toHaveAttribute('maxLength', '80')
    fireEvent.change(field, { target: { value: 'Morning routine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await saysLive('Renamed to “Morning routine”.')
    expect(sent('PUT', 'journal-styles/s1')[0].body).toEqual({ name: 'Morning routine' })
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Duplicate'))
    await saysLive('Made “Morning prep copy”.')
    expect(sent('POST', 'journal-styles/s1/duplicate')).toHaveLength(1)
  })

  it('Open shows the template editor, over the whole template', async () => {
    await openTab()
    fireEvent.click(within(rowOf('Morning prep')).getByRole('button', { name: 'Open Morning prep' }))
    expect(await screen.findByTestId('fake-style-editor')).toHaveTextContent(`Editing Morning prep with ${KINDS.length} kinds`)
    expect(editorMounts.n).toBeGreaterThan(0)
    expect(sent('GET', 'journal-styles/s1')).toHaveLength(1)                 // the whole template, outline too
    fireEvent.click(screen.getByRole('button', { name: 'Save style' }))
    await saysLive('Saved “Morning prep v2”.')
    await waitFor(() => expect(sent('GET', 'journal-styles?view=live').length).toBeGreaterThanOrEqual(2))
  })

  it('phone: rows hold no second button, and every action is in the row menu', async () => {
    bp.phone = true
    await openTab()
    const s1 = rowOf('Morning prep')
    expect(within(s1).queryByRole('button', { name: 'Open Morning prep' })).toBeNull()
    expect(within(s1).queryByRole('button', { name: /Used in/ })).toBeNull()
    expect(s1).toHaveTextContent('Used in 3 notes')
    expect(within(s1).getByRole('button', { name: 'Actions for Morning prep' })).toBeInTheDocument()
  })

  it('member words only: no engine noun reaches the screen', async () => {
    // ("Trade plan" is a kind of note's own name, so "plan" is not on this list; R-33 is about the engine's noun.)
    const BANNED = /\b(definitions?|shelf|slots?|payloads?|reducers?|scopes?|journal styles?)\b/i
    await openTab()
    const seen = [document.body.textContent]
    await menuFor('Morning prep')
    seen.push(document.body.textContent)
    for (const label of ['Archived', 'Recently deleted']) {
      fireEvent.keyDown(window, { key: 'Escape' })
      showList(label)
      await screen.findByRole('heading', { name: /archived|deleted/ })
      seen.push(document.body.textContent)
    }
    expect(seen.filter((t) => BANNED.test(t))).toEqual([])
    expect(BANNED.test('a journal style')).toBe(true)                        // CONTROL: the check can see one
  })
})

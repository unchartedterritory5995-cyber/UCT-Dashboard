// Wave 9 (Task 9.18): My tools, the Routines tab. Every assertion reads what the member SEES (rendered text, roles,
// names) or what the server is SENT (method, path, If-Match, body), never component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import MyToolsSheet from './MyToolsSheet'
import { installToolsFetch, refuse } from './__fixtures__/toolsFixtures'
import { openRoutineEditor } from '../routines/openRoutineEditor.js'
import { openSharePreview } from '../library/openSharePreview.js'
import { openAdoptSheet } from '../library/openAdoptSheet.js'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../routines/openRoutineEditor.js', () => ({ openRoutineEditor: vi.fn(() => () => {}) }))
vi.mock('../routines/openTrackerEditor.js', () => ({ openTrackerEditor: vi.fn(() => () => {}) }))
// Wave 11 (Task 11.19): the library doors show only while wave 11 and the library switch are on (off by default here,
// so every wave 9 assertion below reads exactly what it read before).
const flags = vi.hoisted(() => ({ eleven: false, library: false }))
vi.mock('../../../lib/notebookWidgetsFlags', async (orig) => ({ ...(await orig()), widgetsWaveOn: (w) => w === 11 && flags.eleven }))
vi.mock('../../../lib/styleLibraryFlag', async (orig) => ({ ...(await orig()), styleLibraryEnabled: () => flags.library }))
vi.mock('../library/openSharePreview.js', () => ({ openSharePreview: vi.fn(() => () => {}) }))
vi.mock('../library/openAdoptSheet.js', () => ({ openAdoptSheet: vi.fn(() => () => {}) }))

// Server sentences are the SERVER'S: each test sends one the client cannot know, so showing anything else fails.
const S_CONFLICT = 'SERVER: changed in another tab, reload.'
const S_TYPE_NAME = 'SERVER: type the routine name exactly.'
const live = () => screen.getByTestId('my-tools-message')
const saysLive = (text) => waitFor(() => expect(live()).toHaveTextContent(text))

let net
beforeEach(() => {
  bp.phone = false
  bp.touch = false
  net = installToolsFetch()
  openRoutineEditor.mockClear()
  openSharePreview.mockClear()
  openAdoptSheet.mockClear()
  flags.eleven = false
  flags.library = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openTab() {
  render(<MyToolsSheet onClose={() => {}} uid="u1" tab="routines" />)
  await screen.findByRole('heading', { name: /routines?$/ })
}
const rows = () => screen.getAllByTestId('my-tools-tool-row')
const rowOf = (name) => rows().find((r) => within(r).queryByText(name, { exact: true }))
async function menuFor(name) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return bp.touch ? screen.findByRole('dialog', { name: name }) : screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole(bp.touch ? 'button' : 'menuitem', { name: label })
const menuLabels = () => screen.queryAllByRole(bp.touch ? 'button' : 'menuitem').map((b) => b.textContent)
const showList = (label) => fireEvent.click(screen.getByRole('button', { name: label, pressed: false }))
const sent = (method, path) => net.calls.filter((c) => c.method === method && c.path === path)

describe('My tools, Routines tab', () => {
  it('routines_rows_with_schedule_words_and_used_in', async () => {
    await openTab()
    expect(net.calls[0]).toMatchObject({ method: 'GET', path: 'routines?filter=active' })
    expect(screen.getByRole('tabpanel', { name: 'Routines' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '3 routines' })).toBeInTheDocument()
    const r1 = rowOf('Morning prep')
    expect(r1).toHaveTextContent('Every trading day')
    expect(within(r1).getByRole('button', { name: /^Used in 2 notes/ })).toBeInTheDocument()
    expect(r1).toHaveTextContent('Edited Mar 4, 2025')
    expect(r1.querySelector('svg')).not.toBeNull()                    // the static glyph
    expect(r1).not.toHaveTextContent('From template')
    const r2 = rowOf('Rules I keep')
    expect(r2).toHaveTextContent('Mon, Wed, Fri')
    expect(r2).toHaveTextContent('Not in any note')
    expect(within(r2).queryByRole('button', { name: /Used in/ })).toBeNull()
    const r3 = rowOf('Trade-day check')
    expect(r3).toHaveTextContent('Only days I trade')
    // The server sends the template's KEY only: the row says so in words, never the key itself.
    expect(r3).toHaveTextContent('From a template')
    expect(r3).not.toHaveTextContent(/review/i)
    expect(r3).not.toHaveTextContent('From template:')

    // Used in: the notes, each a real link; Back returns focus to the row it came from.
    fireEvent.click(within(r1).getByRole('button', { name: /^Used in 2 notes/ }))
    expect(await screen.findByRole('heading', { name: '“Morning prep” is in 2 notes' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Weekly review/ })).toHaveAttribute('href', '/journal/notebook?note=n1')
    expect(screen.getByRole('link', { name: /Untitled note/ })).toBeInTheDocument()
    expect(sent('GET', 'routines/r1/used-in')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Morning prep' })).toHaveFocus())
  })

  it('from_template_reads_setting', async () => {
    // W11-R13: a template-made routine carries the template's title in `settings.fromTemplate` (at most 80 characters).
    const base = net.data.routines.active[2]
    net = installToolsFetch([['GET', 'routines?filter=active', () => ({
      routines: [
        { ...base, settings: { fromTemplate: 'Pre-market prep' }, sourceTemplateKey: 'tpl:uct-template-pre-market-prep-v1' },
        { ...base, id: 'r8', name: 'Old wave nine name', sourceTemplateName: 'Trade review' },        // no longer read
        { ...base, id: 'r9', name: 'Long one', settings: { fromTemplate: `${'x'.repeat(90)}` }, sourceTemplateKey: null },
      ],
    })]])
    await openTab()
    const r = rowOf('Trade-day check')
    expect(r).toHaveTextContent('From template: Pre-market prep')
    expect(r).not.toHaveTextContent(/tpl:|uct-template/)                   // never the key
    expect(rowOf('Old wave nine name')).not.toHaveTextContent('Trade review')
    expect(rowOf('Old wave nine name')).toHaveTextContent('From a template')     // a wave 9 key-only row, as before
    expect(rowOf('Long one')).toHaveTextContent(`From template: ${'x'.repeat(80)}`)
    expect(rowOf('Long one')).not.toHaveTextContent('x'.repeat(81))
  })

  it('tools_rows_show_credit_and_share', async () => {
    flags.eleven = true
    flags.library = true
    net = installToolsFetch([['GET', 'routines?filter=active', () => ({
      routines: [
        net.data.routines.active[0],
        { ...net.data.routines.active[1], credit: "Based on Sam's Rules I keep", sourceGalleryId: 'g4', fromLibrary: true },
      ],
    })]])
    await openTab()
    expect(rowOf('Rules I keep')).toHaveTextContent("Based on Sam's Rules I keep")
    expect(rowOf('Morning prep')).not.toHaveTextContent('Based on')
    await menuFor('Morning prep')
    expect(menuLabels()).toContain('Share to library')
    fireEvent.click(menuItem('Share to library'))
    await waitFor(() => expect(openSharePreview).toHaveBeenCalledTimes(1))
    expect(openSharePreview.mock.calls[0][0]).toMatchObject({ kind: 'routine', id: 'r1' })
    await menuFor('Rules I keep')
    expect(menuLabels()).not.toContain('Share to library')                  // a copy is never shared again
    expect(menuLabels()).not.toContain('Update from the library')           // and nothing newer is listed
    expect(menuLabels()).toContain('Duplicate')
  })

  it('no Update for a copy the server cannot name the listing of (fix round 1, m-4)', async () => {
    flags.eleven = true
    flags.library = true
    net = installToolsFetch([['GET', 'routines?filter=active', () => ({
      routines: [{ ...net.data.routines.active[1], fromLibrary: true, updateAvailable: true, sourceGalleryId: null }],
    })]])
    await openTab()
    await menuFor('Rules I keep')
    expect(menuLabels()).not.toContain('Update from the library')
    expect(menuLabels()).not.toContain('Share to library')                  // still a copy
    expect(menuLabels()).toContain('Rename')
  })

  it('update_from_library_calls_update_or_opens_sheet', async () => {
    flags.eleven = true
    flags.library = true
    const copy = { ...net.data.routines.active[1], credit: "Based on Sam's Rules I keep", sourceGalleryId: 'g4',
      fromLibrary: true, updateAvailable: true }
    let answer = () => ({ kind: 'routine', id: 'r2' })
    net = installToolsFetch([
      ['GET', 'routines?filter=active', () => ({ routines: [copy] })],
      ['POST', 'template-gallery/tools/updates/routine/r2', () => answer()],
    ])
    await openTab()
    await menuFor('Rules I keep')
    fireEvent.click(menuItem('Update from the library'))
    await saysLive('Updated “Rules I keep” from the library.')
    expect(sent('POST', 'template-gallery/tools/updates/routine/r2')[0].body).toEqual({})
    expect(openAdoptSheet).not.toHaveBeenCalled()
    // The new version asks a "pick yours" question: "Make it yours" opens for the copy, nothing is said over it.
    answer = () => refuse(400, 'unresolved', 'SERVER: pick a value for each choice.')
    await menuFor('Rules I keep')
    fireEvent.click(menuItem('Update from the library'))
    await waitFor(() => expect(openAdoptSheet).toHaveBeenCalledTimes(1))
    expect(openAdoptSheet.mock.calls[0][0]).toMatchObject({ galleryId: 'g4', kind: 'routine', mode: 'update', copyId: 'r2' })
    // Any other refusal is the server's sentence, verbatim.
    answer = () => refuse(409, 'count_cap', 'SERVER: you have 100 routines.')
    await menuFor('Rules I keep')
    fireEvent.click(menuItem('Update from the library'))
    await saysLive('SERVER: you have 100 routines.')
    expect(openAdoptSheet).toHaveBeenCalledTimes(1)
  })

  it('opens the routine editor from Open, and a new routine from New routine', async () => {
    await openTab()
    fireEvent.click(within(rowOf('Morning prep')).getByRole('button', { name: 'Open Morning prep' }))
    await waitFor(() => expect(openRoutineEditor).toHaveBeenCalledTimes(1))
    expect(openRoutineEditor.mock.calls[0][0]).toMatchObject({ routineId: 'r1' })
    fireEvent.click(screen.getByRole('button', { name: /New routine/ }))
    await waitFor(() => expect(openRoutineEditor).toHaveBeenCalledTimes(2))
    expect(openRoutineEditor.mock.calls[1][0].routineId ?? null).toBeNull()
  })

  it('the list reads itself again when the editor closes', async () => {
    openRoutineEditor.mockImplementation(() => {
      const host = document.createElement('div')
      host.setAttribute('data-routine-editor-root', '')
      document.body.appendChild(host)
      return () => host.remove()
    })
    await openTab()
    fireEvent.click(within(rowOf('Morning prep')).getByRole('button', { name: 'Open Morning prep' }))
    await waitFor(() => expect(openRoutineEditor).toHaveBeenCalled())
    const before = sent('GET', 'routines?filter=active').length
    net.data.routines.active[0] = { ...net.data.routines.active[0], name: 'Morning routine' }
    document.querySelector('[data-routine-editor-root]').remove()
    expect(await screen.findByText('Morning routine')).toBeInTheDocument()
    expect(sent('GET', 'routines?filter=active').length).toBe(before + 1)
  })

  it('rename_if_match_conflict_sentence', async () => {
    let etag = 9
    net = installToolsFetch([
      ['PUT', 'routines/r1', (req) => (req.headers['If-Match'] === '5'
        ? refuse(409, 'conflict', S_CONFLICT)
        : { ...net.data.routines.active[0], name: req.body.name, etag: etag + 1 })],
      ['GET', 'routines/r1', () => ({ ...net.data.routines.active[0], etag })],
    ])
    await openTab()
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Rename'))
    const field = await screen.findByRole('textbox', { name: 'Name' })
    expect(field).toHaveValue('Morning prep')
    // Blank: refused before any request, in the server's own words for the rule.
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(sent('PUT', 'routines/r1')).toHaveLength(0)
    fireEvent.change(field, { target: { value: 'Morning routine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    // A stale tab: the server's own sentence, beside the field and in the live region, with Reload.
    expect(await screen.findByText(S_CONFLICT, { selector: 'p:not([data-testid])' })).toBeInTheDocument()
    await saysLive(S_CONFLICT)
    const put = sent('PUT', 'routines/r1')
    expect(put).toHaveLength(1)
    expect(put[0].headers['If-Match']).toBe('5')
    expect(put[0].body).toEqual({ name: 'Morning routine' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    await saysLive('Loaded the latest “Morning prep”.')
    expect(field).toHaveValue('Morning routine')                       // the member's new name is kept
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await saysLive('Renamed to “Morning routine”.')
    expect(sent('PUT', 'routines/r1')[1].headers['If-Match']).toBe('9')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Morning prep' })).toHaveFocus())
  })

  it('a rename conflict left with Cancel reads the list again (the next Rename starts from the newer etag)', async () => {
    net = installToolsFetch([['PUT', 'routines/r1', () => refuse(409, 'conflict', S_CONFLICT)]])
    await openTab()
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Rename'))
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name' }), { target: { value: 'Morning routine' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await saysLive(S_CONFLICT)
    const before = sent('GET', 'routines?filter=active').length
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(sent('GET', 'routines?filter=active').length).toBe(before + 1))
  })

  it('a read failure of the notes says the editor’s sentence, not the network one', async () => {
    net = installToolsFetch([['GET', 'routines/r1/used-in', () => { throw new Error('down') }]])
    await openTab()
    fireEvent.click(within(rowOf('Morning prep')).getByRole('button', { name: /^Used in 2 notes/ }))
    expect(await screen.findByTestId('used-in-failed')).toHaveTextContent("The notes couldn't be loaded just now.")
    expect(screen.getByRole('button', { name: 'Back to your routines' })).toBeInTheDocument()
  })

  it('a malformed usedIn counts as no notes everywhere (ONE guard): no panel, no count', async () => {
    net = installToolsFetch([
      ['GET', 'routines?filter=active', () => ({ routines: [{ ...net.data.routines.active[0], usedIn: '2' }] })],
      ['POST', 'routines/r1/archive', () => ({ id: 'r1', archived: true })],
    ])
    await openTab()
    expect(rowOf('Morning prep')).toHaveTextContent('Not in any note')
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Archive'))
    await saysLive('Archived “Morning prep”.')
    expect(screen.queryByRole('heading', { name: /^Archive “/ })).toBeNull()
  })

  it('archive_sentence_with_count', async () => {
    net = installToolsFetch([
      ['POST', /^routines\/r[12]\/archive$/, (req) => ({ id: req.path.split('/')[1], archived: true })],
    ])
    await openTab()
    await menuFor('Morning prep')
    const item = menuItem('Archive')
    expect(item.getAttribute('aria-description') || item.getAttribute('title')).toBe('It stays in your 2 notes. Its history is kept.')
    fireEvent.click(item)
    expect(await screen.findByRole('heading', { name: 'Archive “Morning prep”?' })).toBeInTheDocument()
    expect(screen.getByText('It stays in your 2 notes. Its history is kept.')).toBeInTheDocument()
    expect(sent('POST', 'routines/r1/archive')).toHaveLength(0)       // nothing until the member confirms
    // Back says where it goes: the list (ToolManage's panel, labelled by My tools), never "the routine".
    expect(screen.getByRole('button', { name: 'Back to your routines' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to the routine' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Archive routine' }))
    await saysLive('Archived “Morning prep”. Restore it from Archived.')
    expect(sent('POST', 'routines/r1/archive')).toHaveLength(1)
    // A routine in no note archives at once (there is nothing for the notes to keep).
    await menuFor('Rules I keep')
    fireEvent.click(menuItem('Archive'))
    await saysLive('Archived “Rules I keep”. Restore it from Archived.')
    expect(sent('POST', 'routines/r2/archive')).toHaveLength(1)
  })

  it('delete_only_from_archived_with_typed_name', async () => {
    let refuseOnce = true
    net = installToolsFetch([
      ['POST', 'routines/ra1/delete', (req) => {
        if (refuseOnce) { refuseOnce = false; return refuse(400, 'invalid', S_TYPE_NAME) }
        return { id: 'ra1', deletedAt: '2025-03-05T17:00:00Z', typed: req.body.typedName }
      }],
    ])
    await openTab()
    await menuFor('Morning prep')
    expect(menuLabels()).not.toContain('Delete permanently')           // never from Active
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    showList('Archived')
    expect(await screen.findByRole('heading', { name: '1 archived' })).toBeInTheDocument()
    await menuFor('Old routine')
    expect(menuLabels()).toEqual(expect.arrayContaining(['Restore', 'Delete permanently']))
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByRole('textbox', { name: /Type Old routine to confirm/ })
    const del = screen.getByRole('button', { name: 'Delete permanently' })
    expect(screen.getByRole('button', { name: 'Back to your routines' })).toBeInTheDocument()
    expect(del).toHaveAttribute('aria-disabled', 'true')
    expect(del).not.toBeDisabled()
    fireEvent.change(field, { target: { value: 'old routine' } })     // not exact
    fireEvent.click(del)
    expect(sent('POST', 'routines/ra1/delete')).toHaveLength(0)
    fireEvent.change(field, { target: { value: 'Old routine' } })
    fireEvent.click(del)
    await saysLive(S_TYPE_NAME)                                       // the server checks again; its sentence shows
    // ...and the refusal is tied to the button that was refused, not only announced.
    const refusal = await screen.findByText(S_TYPE_NAME, { selector: 'p:not([data-testid])' })
    expect(screen.getByRole('button', { name: 'Delete permanently' }).getAttribute('aria-describedby').split(' ')).toContain(refusal.id)
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await saysLive('“Old routine” moved to Recently deleted. It\'s kept for 30 days.')
    const calls = sent('POST', 'routines/ra1/delete')
    expect(calls).toHaveLength(2)
    expect(calls[1].body).toEqual({ typedName: 'Old routine' })
  })

  it('recently_deleted_restore', async () => {
    net = installToolsFetch([['POST', 'routines/rx1/undelete', () => ({ ...net.data.routines.deleted[0], deleted: false })]])
    await openTab()
    showList('Recently deleted')
    expect(await screen.findByRole('heading', { name: '1 recently deleted' })).toBeInTheDocument()
    const row = rowOf('Gone routine')
    expect(row).toHaveTextContent('Deleted Jan 20, 2025')
    expect(row).toHaveTextContent('Kept until Feb 19, 2025')
    await menuFor('Gone routine')
    expect(menuLabels()).toEqual(['Restore'])
    fireEvent.click(menuItem('Restore'))
    await saysLive('Restored “Gone routine”. It\'s in Archived.')
    expect(sent('POST', 'routines/rx1/undelete')).toHaveLength(1)
  })

  it('Restore from Archived goes through the one restore write, and Duplicate makes a copy', async () => {
    net = installToolsFetch([
      ['POST', 'routines/ra1/unarchive', () => ({ ...net.data.routines.archived[0], archived: false })],
      ['POST', 'routines/r1/duplicate', () => ({ ...net.data.routines.active[0], id: 'r9', name: 'Morning prep copy' })],
    ])
    await openTab()
    await menuFor('Morning prep')
    fireEvent.click(menuItem('Duplicate'))
    await saysLive('Made “Morning prep copy”.')
    expect(sent('POST', 'routines/r1/duplicate')).toHaveLength(1)
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    fireEvent.click(within(rowOf('Old routine')).getByRole('button', { name: 'Restore Old routine' }))
    await saysLive('Restored “Old routine”.')
    expect(sent('POST', 'routines/ra1/unarchive')).toHaveLength(1)
  })

  it('a second Restore while the first is out sends nothing (aria-disabled, never disabled)', async () => {
    let release
    net = installToolsFetch([['POST', 'routines/ra1/unarchive', () => new Promise((r) => { release = r })]])
    await openTab()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    const restore = within(rowOf('Old routine')).getByRole('button', { name: 'Restore Old routine' })
    fireEvent.click(restore)
    await waitFor(() => expect(restore).toHaveAttribute('aria-disabled', 'true'))
    expect(restore).not.toBeDisabled()
    fireEvent.click(restore)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Old routine' }))
    expect(sent('POST', 'routines/ra1/unarchive')).toHaveLength(1)
    release({ ok: true, status: 200, json: async () => ({ ...net.data.routines.archived[0], archived: false }) })
    await saysLive('Restored “Old routine”.')
    expect(sent('POST', 'routines/ra1/unarchive')).toHaveLength(1)
  })

  it('no_share_action_in_w9', async () => {
    await openTab()
    for (const [list, name] of [[null, 'Morning prep'], ['Archived', 'Old routine'], ['Recently deleted', 'Gone routine']]) {
      if (list) { showList(list); await screen.findByText(name, { exact: true }) }
      await menuFor(name)
      expect(menuLabels().length).toBeGreaterThan(0)                   // the menu is open (non-vacuity)
      expect(menuLabels().filter((l) => /share|library/i.test(l))).toEqual([])
      fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    }
    expect(screen.queryByText(/Share to library/)).toBeNull()
  })

  it('phone: rows carry no row buttons; every action is in the ContextPopover', async () => {
    bp.phone = true
    bp.touch = true
    await openTab()
    const r1 = rowOf('Morning prep')
    expect(within(r1).queryByRole('button', { name: 'Open Morning prep' })).toBeNull()
    expect(within(r1).queryByRole('button', { name: /^Used in/ })).toBeNull()
    expect(r1).toHaveTextContent('Used in 2 notes')
    // The actions are a ContextPopover: a sheet of its own on touch, above My tools.
    fireEvent.click(within(r1).getByRole('button', { name: 'Actions for Morning prep' }))
    await waitFor(() => expect(document.querySelectorAll('[data-sheet-panel]')).toHaveLength(2))
    const menuSheet = document.querySelectorAll('[data-sheet-panel]')[1]
    expect([...menuSheet.querySelectorAll('button')].map((x) => x.textContent)).toEqual(expect.arrayContaining(
      ['Open', 'Rename', 'Duplicate', 'Used in 2 notes', 'Archive']))
  })

  it('offline: the list says so in routine words and reads itself again when the connection is back', async () => {
    const nav = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    render(<MyToolsSheet onClose={() => {}} uid="u1" tab="routines" />)
    expect(await screen.findByTestId('my-tools-load-failed')).toHaveTextContent("You're offline. Your routines show here when you're back online.")
    expect(net.calls).toHaveLength(0)
    nav.mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByRole('heading', { name: '3 routines' })).toBeInTheDocument()
    nav.mockRestore()
  })
})

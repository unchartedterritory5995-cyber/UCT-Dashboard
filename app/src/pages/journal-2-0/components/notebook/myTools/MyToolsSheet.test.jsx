/* global process */
// Wave 8 (Task 8.17): My tools, the Widgets tab. Every assertion reads what the member SEES (rendered text, roles,
// names) or what the server is SENT (method, path, If-Match, body), never component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import MyToolsSheet from './MyToolsSheet'
import { openMyTools } from './openMyTools'
import { installFetch, refuse, URL_BASE } from './__fixtures__/myToolsFixtures'
import { openWidgetBuilder } from '../widgetBuilder/openWidgetBuilder.js'
import { openSetsDialog } from '../widgets/SetsDialog'
import { FULLSCREEN_SHEET_ATTR } from '../../../../../components/mobile/fullscreenSheetAttr'

const bp = vi.hoisted(() => ({ phone: false, touch: false }))
vi.mock('../../../../../hooks/useBreakpoint', () => ({
  useIsPhone: () => bp.phone, useIsTouch: () => bp.touch, useIsTablet: () => false, useIsDesktop: () => !bp.touch,
  useHasCoarsePointer: () => bp.touch, useHasNoHover: () => bp.touch,
}))
vi.mock('../widgetBuilder/openWidgetBuilder.js', () => ({ openWidgetBuilder: vi.fn(() => () => {}) }))
vi.mock('../widgets/SetsDialog', () => ({ openSetsDialog: vi.fn(() => () => {}) }))

const S_CONFLICT = 'Changed in another tab. Reload to see the newer version.'
const S_CAP = 'You have 100 widgets. Archive one in My tools to make room.'
const S_TYPE_NAME = "Type the widget's name exactly to delete it."

let net
beforeEach(() => {
  bp.phone = false
  bp.touch = false
  net = installFetch()
  openWidgetBuilder.mockClear()
  openSetsDialog.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openSheet(props = {}) {
  const onClose = vi.fn()
  render(<MyToolsSheet onClose={onClose} uid="u1" {...props} />)
  await screen.findByRole('heading', { name: /widgets?$/ })
  return { onClose }
}
const rowOf = (name) => screen.getAllByTestId('my-tools-row').find((r) => within(r).queryByText(name, { exact: true }))
async function menuFor(name) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  return bp.touch ? screen.findByRole('dialog', { name: undefined }) : screen.findByRole('menu', { name })
}
const menuItem = (label) => screen.getByRole(bp.touch ? 'button' : 'menuitem', { name: label })
const showList = (label) => fireEvent.click(screen.getByRole('button', { name: label, pressed: false }))

describe('My tools, Widgets tab', () => {
  it('lists_widgets_with_used_in_and_last_edited', async () => {
    await openSheet()
    expect(screen.getByRole('dialog', { name: 'My tools' })).toBeInTheDocument()
    expect(net.calls[0]).toMatchObject({ method: 'GET', path: '?view=live' })
    expect(screen.getByRole('heading', { name: '2 widgets' })).toBeInTheDocument()
    const w1 = rowOf('Net P&L by setup')
    expect(within(w1).getByRole('button', { name: /^Used in 3 notes/ })).toBeInTheDocument()
    expect(w1).toHaveTextContent('Edited Mar 4, 2025')
    expect(w1).toHaveTextContent('Net P&L, split by setup, for closed trades in the last 90 days.')
    expect(w1.querySelector('svg')).not.toBeNull()                 // the static view drawing
    expect(w1).toHaveTextContent(', Bar')                          // its name, for a screen reader
    const w2 = rowOf('Win rate')
    expect(w2).toHaveTextContent('Not in any note')
    expect(within(w2).queryByRole('button', { name: /Used in/ })).toBeNull()
    expect(w2).toHaveTextContent('Edited Feb 10, 2025')
    // No library sharing before wave 11, and nothing reads "Based on" without an adopted widget.
    await menuFor('Net P&L by setup')
    expect(screen.queryByRole('menuitem', { name: /Share/ })).toBeNull()
    expect(screen.queryByText(/Based on/)).toBeNull()
  })

  it('adopted rows say "Based on X\'s Y", or a former member\'s', async () => {
    net.lists.live = [
      { ...net.lists.live[0], basedOn: { author: 'Sam', name: 'Morning edge' } },
      { ...net.lists.live[1], basedOn: { author: null, name: 'Gap fill' } },
    ]
    await openSheet()
    expect(rowOf('Net P&L by setup')).toHaveTextContent("Based on Sam's Morning edge")
    expect(rowOf('Win rate')).toHaveTextContent("Based on a former member's Gap fill")
  })

  it('used_in_opens_note_list', async () => {
    const { onClose } = await openSheet()
    fireEvent.click(within(rowOf('Net P&L by setup')).getByRole('button', { name: /^Used in 3 notes/ }))
    expect(await screen.findByRole('heading', { name: '“Net P&L by setup” is in 3 notes' })).toHaveFocus()
    expect(net.calls.at(-1)).toMatchObject({ method: 'GET', path: '/w1/used-in' })
    const links = await screen.findAllByRole('link')
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/journal/notebook?note=n1', '/journal/notebook?note=n2', '/journal/notebook?note=n3'])
    expect(links[1]).toHaveTextContent('Untitled note')
    // Back returns to the row it came from.
    fireEvent.click(screen.getByRole('button', { name: 'Back to your widgets' }))
    expect(screen.getByRole('button', { name: 'Actions for Net P&L by setup' })).toHaveFocus()
    // A plain click opens the note in place (the router's own history move) and closes My tools.
    fireEvent.click(within(rowOf('Net P&L by setup')).getByRole('button', { name: /^Used in 3 notes/ }))
    const push = vi.spyOn(window.history, 'pushState')
    const popped = vi.fn()
    window.addEventListener('popstate', popped)
    fireEvent.click(await screen.findByRole('link', { name: /Weekly review/ }), { button: 0 })
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ usr: null }), '', '/journal/notebook?note=n1')
    expect(popped).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    window.removeEventListener('popstate', popped)
    push.mockRestore()
  })

  it('a modified click on a note is left to the browser (a new tab), and My tools stays open', async () => {
    const { onClose } = await openSheet()
    fireEvent.click(within(rowOf('Net P&L by setup')).getByRole('button', { name: /^Used in 3 notes/ }))
    const push = vi.spyOn(window.history, 'pushState')
    fireEvent.click(await screen.findByRole('link', { name: /Weekly review/ }), { button: 0, ctrlKey: true })
    expect(push).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    push.mockRestore()
  })

  it('rename_sends_if_match_and_conflict_sentence', async () => {
    net = installFetch([['PUT', '/w1', () => refuse(409, 'conflict', S_CONFLICT)]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    const input = await screen.findByLabelText('Name')
    expect(input).toHaveFocus()
    expect(screen.getByText('Your 3 notes show the new name the next time you press See it now.')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '  Setup P&L  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(S_CONFLICT)
    const put = net.calls.find((c) => c.method === 'PUT')
    expect(put.path).toBe('/w1')
    expect(put.headers['If-Match']).toBe('7')                  // ruling R-15: the etag, never the rev (3)
    expect(put.body).toMatchObject({ name: 'Setup P&L', apply: 'update_all' })
    expect(put.body.plan.display).toMatchObject({ title: 'Setup P&L', titleAuto: false })
    expect(put.body.plan.split).toEqual({ by: 'setup' })        // nothing else in the plan moved
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  })

  it('a rename that lands says so and the list reads the new name', async () => {
    net = installFetch([['PUT', '/w1', (req) => {
      net.lists.live[0] = { ...net.lists.live[0], name: req.body.name, etag: 8 }
      return net.lists.live[0]
    }]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Rename'))
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Setup P&L' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Renamed to “Setup P&L”.')
    expect(await screen.findByText('Setup P&L', { exact: true })).toBeInTheDocument()
  })

  it('archive_sentence_with_count', async () => {
    net = installFetch([['POST', /^\/w\d\/archive$/, (req) => ({ ...net.lists.live[0], id: req.path.slice(1, 3), archived: true })]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Archive'))
    expect(await screen.findByRole('heading', { name: 'Archive “Net P&L by setup”?' })).toHaveFocus()
    expect(screen.getByTestId('archive-sentence')).toHaveTextContent(
      'It stays in your 3 notes as a snapshot. See it now keeps working from its saved copy.')
    expect(net.calls.some((c) => c.method === 'POST')).toBe(false)   // nothing archived until the member says so
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Archived “Net P&L by setup”. Restore it from Archived.')
    expect(net.calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/w1/archive' })
    // A widget in no note has nothing to warn about: it archives at once.
    await menuFor('Win rate')
    fireEvent.click(menuItem('Archive'))
    await waitFor(() => expect(net.calls.filter((c) => c.method === 'POST').map((c) => c.path)).toEqual(['/w1/archive', '/w2/archive']))
    expect(screen.queryByTestId('archive-sentence')).toBeNull()
  })

  it('archive says "1 note" for one', async () => {
    net.lists.live[0] = { ...net.lists.live[0], usedIn: 1 }
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Archive'))
    expect(await screen.findByTestId('archive-sentence')).toHaveTextContent('It stays in your 1 note as a snapshot.')
  })

  it('delete_only_from_archived_and_needs_typed_name', async () => {
    net = installFetch([['POST', '/a1/delete', (req) => (req.body.typedName === 'Old edge'
      ? { id: 'a1', deletedAt: '2025-03-04T17:00:00Z' } : refuse(400, 'invalid', S_TYPE_NAME))]])
    await openSheet()
    await menuFor('Net P&L by setup')
    expect(screen.queryByRole('menuitem', { name: 'Delete permanently' })).toBeNull()   // never from Active
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape' })
    showList('Archived')
    expect(await screen.findByRole('heading', { name: '1 archived' })).toBeInTheDocument()
    await menuFor('Old edge')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByLabelText('Type Old edge to confirm')
    expect(field).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Delete “Old edge” permanently?' })).toBeInTheDocument()
    const del = screen.getByRole('button', { name: 'Delete permanently' })
    expect(del).toBeDisabled()
    expect(del).toHaveAccessibleDescription('Delete turns on when the name matches exactly.')
    fireEvent.change(field, { target: { value: 'old edge' } })     // the case matters
    expect(del).toBeDisabled()
    fireEvent.change(field, { target: { value: 'Old edge ' } })    // so does a trailing space
    expect(del).toBeDisabled()
    expect(net.calls.some((c) => c.path.endsWith('/delete'))).toBe(false)
    fireEvent.change(field, { target: { value: 'Old edge' } })
    expect(del).toBeEnabled()
    fireEvent.submit(field.closest('form'))
    expect(await screen.findByRole('status')).toHaveTextContent('“Old edge” moved to Recently deleted. It\'s kept for 30 days.')
    expect(net.calls.find((c) => c.path === '/a1/delete')).toMatchObject({ method: 'POST', body: { typedName: 'Old edge' } })
  })

  it('a refused delete shows the server\'s own sentence', async () => {
    net = installFetch([['POST', '/a1/delete', () => refuse(400, 'invalid', S_TYPE_NAME)]])
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    await menuFor('Old edge')
    fireEvent.click(menuItem('Delete permanently'))
    const field = await screen.findByLabelText('Type Old edge to confirm')
    fireEvent.change(field, { target: { value: 'Old edge' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(S_TYPE_NAME)
    expect(field).toHaveAttribute('aria-invalid', 'true')
  })

  it('recently_deleted_restore', async () => {
    net = installFetch([['POST', '/x1/undelete', () => ({ ...net.lists.deleted[0], deletedAt: undefined })]])
    await openSheet()
    showList('Recently deleted')
    expect(await screen.findByRole('heading', { name: '1 recently deleted' })).toBeInTheDocument()
    const row = rowOf('Gone')
    expect(row).toHaveTextContent('Deleted Jan 20, 2025')
    expect(row).toHaveTextContent('Kept until Feb 19, 2025')
    await menuFor('Gone')
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Restore'])
    fireEvent.click(menuItem('Restore'))
    expect(await screen.findByRole('status')).toHaveTextContent('Restored “Gone”. It\'s in Archived.')
    expect(net.calls.find((c) => c.method === 'POST')).toMatchObject({ path: '/x1/undelete' })
  })

  it('archived restore at the cap shows the server\'s count sentence verbatim', async () => {
    net = installFetch([['POST', '/a1/unarchive', () => refuse(409, 'count_cap', S_CAP)]])
    await openSheet()
    showList('Archived')
    await screen.findByRole('heading', { name: '1 archived' })
    fireEvent.click(screen.getByRole('button', { name: 'Restore Old edge' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(S_CAP)
  })

  it('duplicate posts "<name> copy" and the count cap is the server\'s sentence', async () => {
    net = installFetch([['POST', '', () => refuse(409, 'count_cap', S_CAP)]])
    await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Duplicate'))
    expect(await screen.findByRole('alert')).toHaveTextContent(S_CAP)
    const post = net.calls.find((c) => c.method === 'POST')
    expect(post.path).toBe('')
    expect(post.body.name).toBe('Net P&L by setup copy')
    expect(post.body.plan.split).toEqual({ by: 'setup' })
  })

  it('Open opens the builder on the widget, never inserting into a note', async () => {
    await openSheet({ editor: { storage: { uctJournalWidgets: { uid: 'u1' } } } })
    fireEvent.click(screen.getByRole('button', { name: 'Open Net P&L by setup' }))
    await waitFor(() => expect(openWidgetBuilder).toHaveBeenCalledWith({ editor: null, from: { defId: 'w1' }, uid: 'u1' }))
    fireEvent.click(screen.getByRole('button', { name: /Build a widget/ }))
    await waitFor(() => expect(openWidgetBuilder).toHaveBeenLastCalledWith({ editor: null, from: null, uid: 'u1' }))
  })

  it('when the builder closes, the list reads the truth again', async () => {
    openWidgetBuilder.mockImplementationOnce(() => {
      const host = document.createElement('div')
      host.setAttribute('data-widget-builder-root', '')
      document.body.appendChild(host)
      return () => host.remove()
    })
    await openSheet()
    fireEvent.click(screen.getByRole('button', { name: 'Open Net P&L by setup' }))
    await waitFor(() => expect(document.querySelector('[data-widget-builder-root]')).not.toBeNull())
    const before = net.calls.filter((c) => c.path === '?view=live').length
    net.lists.live[0] = { ...net.lists.live[0], name: 'Edited in the builder' }
    await act(async () => { document.querySelector('[data-widget-builder-root]').remove() })
    expect(await screen.findByText('Edited in the builder')).toBeInTheDocument()
    expect(net.calls.filter((c) => c.path === '?view=live').length).toBe(before + 1)
  })

  it('a widget made by a newer app cannot be opened, renamed or copied, and says why', async () => {
    net.lists.live[0] = { ...net.lists.live[0], tooNew: true }
    await openSheet()
    const row = rowOf('Net P&L by setup')
    expect(row).toHaveTextContent('This widget was made with a newer version of the app. Reload to use it.')
    expect(within(row).getByRole('button', { name: 'Open Net P&L by setup' })).toBeDisabled()
    await menuFor('Net P&L by setup')
    for (const label of ['Open', 'Rename', 'Duplicate']) expect(menuItem(label)).toBeDisabled()
  })

  it('Manage chart sets opens the existing chart sets dialog (presets keep their own place)', async () => {
    await openSheet()
    expect(screen.getByText('Chart sets and presets have their own place.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Manage chart sets/ }))
    await waitFor(() => expect(openSetsDialog).toHaveBeenCalledTimes(1))
    expect(openSetsDialog.mock.calls[0][0].editor.storage.uctJournalWidgets.uid).toBe('u1')
  })

  it('empty, failure and offline states each have their words', async () => {
    net.lists.live = []
    net.lists.archived = []
    await openSheet()
    expect(screen.getByTestId('my-tools-empty')).toHaveTextContent('No widgets yet. Build one here, or type /build in a note.')
    showList('Archived')
    expect(await screen.findByTestId('my-tools-empty')).toHaveTextContent('Nothing archived.')
    net.lists.deleted = []
    showList('Recently deleted')
    expect(await screen.findByTestId('my-tools-empty')).toHaveTextContent('Nothing deleted in the last 30 days.')
  })

  it('a list that cannot load says so and offers Try again', async () => {
    net = installFetch([['GET', '?view=live', () => refuse(500, 'failed', '')]])
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Your widgets couldn't be loaded just now.")
    net.calls.length = 0
    net = installFetch()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: '2 widgets' })).toBeInTheDocument()
  })

  it('offline: no request, and the offline sentence', async () => {
    const online = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false)
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent("You're offline. Your widgets show here when you're back online.")
    expect(net.fn).not.toHaveBeenCalled()
    online.mockRestore()
  })

  it('wave 8 dark: the list reads "Not available right now." with nothing to retry', async () => {
    net = installFetch([['GET', '?view=live', () => ({ ok: false, status: 404, json: async () => ({ detail: 'Not Found' }) })]])
    render(<MyToolsSheet onClose={() => {}} uid="u1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not available right now.')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('other_tabs_have_no_controls_in_w8', async () => {
    await openSheet()
    for (const [tab, words] of [['Routines', 'Routines are coming soon.'], ['Trackers', 'Trackers are coming soon.'],
      ['Templates', 'Templates are coming soon.']]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      expect(screen.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true')
      const panel = screen.getByRole('tabpanel', { name: tab })
      expect(panel).toHaveTextContent(words)
      expect(panel.querySelectorAll('button, a, input, select, textarea, [tabindex]')).toHaveLength(0)
    }
  })

  it('the tabs move with the arrow keys', async () => {
    await openSheet()
    const widgets = screen.getByRole('tab', { name: 'Widgets' })
    widgets.focus()
    fireEvent.keyDown(widgets, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Routines' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Templates' })).toHaveFocus()
  })

  it('Escape backs out of a panel to its row first; at the list it closes My tools', async () => {
    const { onClose } = await openSheet()
    await menuFor('Net P&L by setup')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })   // a desktop menu closes first, nothing else
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await menuFor('Net P&L by setup')
    fireEvent.click(menuItem('Version history'))
    await screen.findByRole('heading', { name: 'Version history: Net P&L by setup' })
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Actions for Net P&L by setup' })).toHaveFocus()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opened from a placed widget, that widget\'s row takes focus; an archived one opens Archived', async () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((fn) => { fn(0); return 0 })
    const first = render(<MyToolsSheet onClose={() => {}} uid="u1" defId="w2" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Win rate' })).toHaveFocus())
    expect(rowOf('Win rate')).toHaveAttribute('data-highlight')
    first.unmount()
    render(<MyToolsSheet onClose={() => {}} uid="u1" defId="a1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Actions for Old edge' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Archived', pressed: true })).toBeInTheDocument()
    raf.mockRestore()
  })

  it('member words only: no engine noun reaches the screen in any list or panel', async () => {
    const BANNED = /\b(definitions?|shelf|built widgets?|sources?|plans?|scopes?)\b/i
    const seen = []
    const look = () => seen.push(document.body.textContent)
    await openSheet()
    look()
    await menuFor('Net P&L by setup')
    look()
    fireEvent.click(menuItem('Archive'))
    await screen.findByTestId('archive-sentence')
    look()
    fireEvent.click(screen.getByRole('button', { name: 'Back to your widgets' }))
    fireEvent.click(within(rowOf('Net P&L by setup')).getByRole('button', { name: /^Used in 3 notes/ }))
    await screen.findAllByRole('link')
    look()
    fireEvent.click(screen.getByRole('button', { name: 'Back to your widgets' }))
    for (const label of ['Archived', 'Recently deleted']) {
      showList(label)
      await screen.findAllByTestId('my-tools-row')
      look()
    }
    for (const tab of ['Routines', 'Trackers', 'Templates']) { fireEvent.click(screen.getByRole('tab', { name: tab })); look() }
    expect(seen.length).toBeGreaterThan(6)
    expect(seen.filter((t) => BANNED.test(t))).toEqual([])
    expect(BANNED.test('pick a source')).toBe(true)                    // CONTROL: the check can see one
  })

  it('phone_full_screen_segmented_rows_56', async () => {
    bp.phone = true
    bp.touch = true
    await openSheet()
    expect(document.documentElement.hasAttribute(FULLSCREEN_SHEET_ATTR)).toBe(true)
    // The tabs are the segmented control.
    const tabs = screen.getByRole('tablist', { name: 'My tools' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Widgets', 'Routines', 'Trackers', 'Templates'])
    // A row is name and meta and one actions button: no inline Open, no inline link.
    const row = rowOf('Net P&L by setup')
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Actions for Net P&L by setup'])
    expect(row).toHaveTextContent('Used in 3 notes')
    // The actions are a ContextPopover: a sheet of its own on touch, with Used in among them.
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Net P&L by setup' }))
    await waitFor(() => expect(document.querySelectorAll('[data-sheet-panel]')).toHaveLength(2))
    const menuSheet = document.querySelectorAll('[data-sheet-panel]')[1]
    expect([...menuSheet.querySelectorAll('button')].map((b) => b.textContent)).toEqual(expect.arrayContaining(
      ['Open', 'Rename', 'Duplicate', 'Version history', 'Used in 3 notes', 'Archive']))
    // Rows are 56 px (the stylesheet; jsdom lays nothing out).
    const css = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'components', 'notebook', 'myTools', 'myTools.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const phoneBlock = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(css.slice(css.lastIndexOf('@media (max-width: 640px)')))[1]
    expect(phoneBlock).toMatch(/\.row \{\s*min-height: 56px;/)
  })
})

describe('openMyTools', () => {
  it('mounts My tools on its own root, one at a time, and close() takes it away', async () => {
    const editor = { storage: { uctJournalWidgets: { uid: 'u9' } } }
    let close
    await act(async () => { close = openMyTools({ editor, defId: 'w1' }) })
    expect(typeof close).toBe('function')
    expect(document.querySelectorAll('[data-my-tools-root]')).toHaveLength(1)
    expect(await screen.findByRole('dialog', { name: 'My tools' })).toBeInTheDocument()
    expect(openMyTools({ editor })).toBe(close)                         // a second call is the same one
    expect(document.querySelectorAll('[data-my-tools-root]')).toHaveLength(1)
    await act(async () => { close() })
    await waitFor(() => expect(document.querySelector('[data-my-tools-root]')).toBeNull())
    expect(screen.queryByRole('dialog', { name: 'My tools' })).toBeNull()
    // Closed, a new call opens a new one.
    let again
    await act(async () => { again = openMyTools({ editor }) })
    expect(again).not.toBe(close)
    await act(async () => { again() })
    await waitFor(() => expect(document.querySelector('[data-my-tools-root]')).toBeNull())
  })

  it('My tools is lazy: nothing outside myTools/ imports it statically', () => {
    const SRC = join(process.cwd(), 'src')
    const files = []
    const walk = (d) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p) } else if (/\.(jsx?|tsx?)$/.test(n)) files.push(p)
      }
    }
    walk(SRC)
    const STATIC = /^\s*import\s[^;]*?from\s+['"][^'"]*\/myTools\/[^'"]*['"]/m
    const offenders = files.filter((f) => !/[\\/]myTools[\\/]/.test(f) && !/\.test\.[jt]sx?$/.test(f))
      .filter((f) => STATIC.test(readFileSync(f, 'utf8')))
    expect(files.length).toBeGreaterThan(100)                           // the walk saw the tree
    expect(STATIC.test("import { openMyTools } from '../myTools/openMyTools.js'")).toBe(true)   // and can see one
    expect(STATIC.test("const mod = await import('../myTools/openMyTools.js')")).toBe(false)
    expect(offenders).toEqual([])
  })
})

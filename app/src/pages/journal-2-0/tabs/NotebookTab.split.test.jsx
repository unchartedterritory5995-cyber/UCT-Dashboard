import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 7) — split view, WIRED: `?side=` puts a second note
 * beside the first on desktop; each pane is an ordinary editor; closing the
 * side returns to one.
 *
 * ⛔⛔ THE SAME NOTE IS NEVER OPEN IN BOTH PANES — two editors on one note are
 * two writers, and the offline layer forks it. Every door refuses it and
 * focuses the pane that already holds the note, and the rail below watches the
 * editors themselves (how many are MOUNTED on a note at once), so a guard that
 * only tidies the URL after the fact still fails it.
 */
const track = vi.hoisted(() => ({ live: {}, maxLive: {}, mounts: {} }))
const bp = vi.hoisted(() => ({ desktop: true }))
// The list's notes: empty unless a test gives it rows (M-5 needs rows to open from).
const list = vi.hoisted(() => ({ notes: [] }))

vi.mock('../../../hooks/useBreakpoint', async (importOriginal) => ({
  ...(await importOriginal()),
  useIsDesktop: () => bp.desktop,
}))
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: list.notes, isLoading: false, error: null, refresh: vi.fn(),
    mutate: vi.fn(), total: list.notes.length, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onOpenNote }) => (
    <div data-testid="folder-sidebar">
      {['n1', 'n2', 'n3'].map((id) => (
        <button key={id} type="button" onClick={() => onOpenNote({ id })}>{`sidebar ${id}`}</button>
      ))}
    </div>
  ),
}))
// The editor stand-in: counts how many instances are mounted per note, links
// to three notes through the Notebook's ONE link opener, and renders the note
// menu the way lane D's editor does.
vi.mock('../components/notebook/NoteEditorPage', async () => {
  const React = await import('react')
  const { useNoteNavigation } = await import('../lib/splitView')
  function Editor({ noteId, noteMenu, onBack }) {
    React.useEffect(() => {
      track.mounts[noteId] = (track.mounts[noteId] || 0) + 1
      track.live[noteId] = (track.live[noteId] || 0) + 1
      track.maxLive[noteId] = Math.max(track.maxLive[noteId] || 0, track.live[noteId])
      return () => { track.live[noteId] -= 1 }
    }, [noteId])
    const go = useNoteNavigation()
    return (
      <div data-testid="note-editor" data-note-id={noteId}>
        {['n1', 'n2', 'n3'].map((id) => (
          <button key={id} type="button" onClick={(e) => go(id, e)}>{`link ${id}`}</button>
        ))}
        <button type="button" onClick={onBack}>editor back</button>
        {/* the real editor closes itself this way after a delete (wave 8, 8A) */}
        <button type="button" onClick={() => onBack({ trashed: noteId })}>editor delete</button>
        {noteMenu?.({ id: noteId, title: `Note ${noteId}` }, { refresh() {} })}
      </div>
    )
  }
  return { default: Editor }
})
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.search}</output>
}
const params = () => new URLSearchParams(screen.getByTestId('where').textContent)
const renderAt = (search) => render(
  <MemoryRouter initialEntries={[`/journal${search}`]}><NotebookTab /><Where /></MemoryRouter>,
)
const mainPane = () => document.querySelector('[data-note-pane="main"]')
const sidePane = () => document.querySelector('[data-note-pane="side"]')
const editorIn = (pane) => within(pane).getByTestId('note-editor').getAttribute('data-note-id')
const editors = () => screen.getAllByTestId('note-editor').map((e) => e.getAttribute('data-note-id'))

beforeEach(() => {
  bp.desktop = true
  list.notes = []
  for (const k of Object.keys(track)) track[k] = {}
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.startsWith('/api/j2/notes/switcher')) {
      return { ok: true, json: async () => ({ notes: [{ id: 'n1', title: 'One' }, { id: 'n3', title: 'Three' }] }) }
    }
    if (u.startsWith('/api/j2/note-folders')) return { ok: true, json: async () => ({ folders: [] }) }
    return { ok: true, json: async () => ({}) }
  })
})
afterEach(() => vi.clearAllMocks())

describe('two notes, side by side', () => {
  it('?side= opens a second editor beside the first, each in its own pane', () => {
    renderAt('?note=n1&side=n2')
    expect(editorIn(screen.getByRole('region', { name: 'Main note' }))).toBe('n1')
    expect(editorIn(screen.getByRole('region', { name: 'Side note' }))).toBe('n2')
  })

  it('opening the side pane does not remount the note already open', async () => {
    renderAt('?note=n1')
    expect(track.mounts.n1).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'link n3' }), { ctrlKey: true })
    await waitFor(() => expect(sidePane()).not.toBeNull())
    expect(editorIn(sidePane())).toBe('n3')
    // Same editor instance: nothing flushed, nothing reloaded under the member.
    expect(track.mounts.n1).toBe(1)
  })

  it('Ctrl+click and Cmd+click on a note link open it beside', async () => {
    renderAt('?note=n1')
    fireEvent.click(screen.getByRole('button', { name: 'link n2' }), { metaKey: true })
    await waitFor(() => expect(params().get('side')).toBe('n2'))
    expect(params().get('note')).toBe('n1')
  })

  it('a plain link click inside the side pane opens the note in THAT pane', async () => {
    renderAt('?note=n1&side=n2')
    fireEvent.click(within(sidePane()).getByRole('button', { name: 'link n3' }))
    await waitFor(() => expect(editorIn(sidePane())).toBe('n3'))
    expect(editorIn(mainPane())).toBe('n1')
  })

  it('Close returns to one note; Swap trades the panes', async () => {
    renderAt('?note=n1&side=n2')
    fireEvent.click(within(sidePane()).getByRole('button', { name: 'Swap panes' }))
    await waitFor(() => expect(editorIn(mainPane())).toBe('n2'))
    expect(editorIn(sidePane())).toBe('n1')
    // Both editors changed notes in one step, and neither note ever had two.
    expect(track.maxLive.n1).toBe(1)
    expect(track.maxLive.n2).toBe(1)
    fireEvent.click(within(sidePane()).getByRole('button', { name: 'Close the side note' }))
    await waitFor(() => expect(sidePane()).toBeNull())
    expect(editors()).toEqual(['n2'])
    expect(params().has('side')).toBe(false)
  })

  it('when the main note closes (deleted), the side note becomes the one note', async () => {
    renderAt('?note=n1&side=n2')
    fireEvent.click(within(mainPane()).getByRole('button', { name: 'editor back' }))
    await waitFor(() => expect(editors()).toEqual(['n2']))
    expect(params().get('note')).toBe('n2')
    expect(params().has('side')).toBe(false)
  })

  // ⛔ Wave 8 final-review fix M-5. A delete used to leave a focus plan ("the
  // row after the deleted one") even in split view, where the side note stays
  // open and the pane never empties -- so the plan waited for some LATER,
  // unrelated close and sent focus to that stale row.
  it('M-5: a delete in split view leaves no focus plan for a later, unrelated close', async () => {
    list.notes = ['n1', 'n2', 'n3'].map((id) => ({
      id, title: `Note ${id}`, subtitle: '', tags: [], folderId: null, excerpt: '',
      updatedAt: '2026-09-20T15:00:00Z', createdAt: '2026-09-01T15:00:00Z',
    }))
    // a folder, so the list (and its rows) is what the pane shows again once it empties
    renderAt('?folder=f1')
    // n1 is opened from the list, whose rows read n1, n2, n3
    const row = await waitFor(() => {
      const el = document.querySelector('[data-note-card-id="n1"]')
      if (!el) throw new Error('no row yet')
      return el
    })
    fireEvent.click(row.matches('button') ? row : row.querySelector('button'))
    await waitFor(() => expect(editors()).toEqual(['n1']))
    // n3 beside it, through the editor's own link
    fireEvent.click(within(mainPane()).getByRole('button', { name: 'link n3' }), { ctrlKey: true })
    await waitFor(() => expect(editorIn(sidePane())).toBe('n3'))
    // n1 is deleted: n3 becomes the one note, and the pane never empties
    fireEvent.click(within(mainPane()).getByRole('button', { name: 'editor delete' }))
    await waitFor(() => expect(editors()).toEqual(['n3']))
    // later, n3 (never opened from a row) closes
    document.activeElement?.blur?.()
    fireEvent.click(within(mainPane()).getByRole('button', { name: 'editor back' }))
    await waitFor(() => expect(screen.queryAllByTestId('note-editor')).toEqual([]))
    // -> the pane heading; never n2, the row the DELETE had planned for n1
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H2'))
    expect(document.activeElement.getAttribute('data-note-card-id')).toBeNull()
  })

  it('the note menu opens a note beside, from the Notebook’s own search', async () => {
    renderAt('?note=n1')
    fireEvent.click(screen.getByRole('button', { name: /Open a note beside/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Find a note to open beside' }), { target: { value: 'th' } })
    // n1 is the note already open, so the search never offers it.
    // Wave 8 (8A): a named LIST of buttons, no longer a listbox (axe nested-interactive).
    const list = await screen.findByRole('list', { name: 'Notes to open beside' })
    expect(within(list).queryByText('One')).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Three' }))
    await waitFor(() => expect(sidePane()).not.toBeNull())
    expect(editorIn(sidePane())).toBe('n3')
  })
})

describe('⛔⛔ never the same note in both panes', () => {
  it('a URL naming the same note twice mounts ONE editor on it, and drops the side', async () => {
    renderAt('?note=n1&side=n1')
    await waitFor(() => expect(params().has('side')).toBe(false))
    expect(editors()).toEqual(['n1'])
    expect(track.maxLive.n1).toBe(1)
  })

  it('opening the side note in the main pane is refused, and focuses the side pane', async () => {
    renderAt('?note=n1&side=n2')
    fireEvent.click(screen.getByRole('button', { name: 'sidebar n2' }))
    expect(await within(sidePane()).findByRole('status')).toHaveTextContent(
      'That note is already open in the side pane. A note opens in one pane at a time.')
    expect(document.activeElement).toBe(sidePane())
    expect(editorIn(mainPane())).toBe('n1')
    expect(editorIn(sidePane())).toBe('n2')
    expect(track.maxLive.n2).toBe(1)
  })

  it('opening the main note beside it is refused, and focuses the main pane', async () => {
    renderAt('?note=n1&side=n2')
    fireEvent.click(within(sidePane()).getByRole('button', { name: 'link n1' }))
    expect(await within(mainPane()).findByRole('status')).toHaveTextContent(
      'That note is already open in the main pane. A note opens in one pane at a time.')
    expect(document.activeElement).toBe(mainPane())
    expect(editorIn(sidePane())).toBe('n2')
    expect(track.maxLive.n1).toBe(1)
  })

  it('Ctrl+click on the main note’s own link is refused the same way', async () => {
    renderAt('?note=n1')
    fireEvent.click(screen.getByRole('button', { name: 'link n1' }), { ctrlKey: true })
    expect(await within(mainPane()).findByRole('status')).toHaveTextContent('That note is already open.')
    expect(document.activeElement).toBe(mainPane())
    expect(sidePane()).toBeNull()
    expect(track.maxLive.n1).toBe(1)
  })
})

describe('desktop only (≥1025px)', () => {
  it('at ≤1024px a side note in the URL is not opened, and nothing offers to open one', () => {
    bp.desktop = false
    renderAt('?note=n1&side=n2')
    expect(editors()).toEqual(['n1'])
    expect(screen.queryByRole('button', { name: /Open a note beside/ })).toBeNull()
  })

  it('at ≤1024px Ctrl+click opens the note the ordinary way', async () => {
    bp.desktop = false
    renderAt('?note=n1')
    fireEvent.click(screen.getByRole('button', { name: 'link n3' }), { ctrlKey: true })
    await waitFor(() => expect(editors()).toEqual(['n3']))
    expect(params().has('side')).toBe(false)
  })
})

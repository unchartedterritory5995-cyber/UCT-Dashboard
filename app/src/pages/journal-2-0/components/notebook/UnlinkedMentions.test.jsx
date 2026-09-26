import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

import UnlinkedMentions from './UnlinkedMentions'
import { SplitViewContext, NotePaneContext } from '../../lib/splitView'

const PAYLOAD = {
  title: 'Cup and handle',
  count: 2,
  skipped: null,
  notes: [
    { id: 'a1', title: 'Tuesday', updatedAt: '2026-09-22', occurrences: 1,
      snippet: { before: 'NVDA formed a ', match: 'cup and handle', after: ' on the daily.' } },
    { id: 'b2', title: 'Setups', updatedAt: '2026-09-21', occurrences: 3,
      snippet: { before: '…a clean ', match: 'Cup and Handle', after: ' again' } },
  ],
}

let fetchSpy
function respond(body, ok = true) {
  fetchSpy = vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) }))
  vi.stubGlobal('fetch', fetchSpy)
}

function renderIt(noteId = 'n1') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <UnlinkedMentions noteId={noteId} />
    </SWRConfig>,
  )
}

beforeEach(() => {
  navSpy.mockClear()
  window.localStorage.clear()   // CollapsibleSection persists open/closed by id
})
afterEach(() => { vi.unstubAllGlobals() })

describe('UnlinkedMentions', () => {
  it('asks the server about this note', async () => {
    respond(PAYLOAD)
    renderIt('note 7')
    await screen.findByText('Unlinked mentions (2)')
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/notes/note%207/unlinked-mentions')
  })

  it('renders nothing when there are no mentions, when the title was too short, and on an error', async () => {
    respond({ title: 'x', count: 0, notes: [], skipped: null })
    const a = renderIt()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(a.container).toBeEmptyDOMElement()
    a.unmount()

    respond({ title: 'AI', count: 0, notes: [], skipped: 'short-title' })
    const b = renderIt()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(b.container).toBeEmptyDOMElement()
    b.unmount()

    respond({ detail: 'nope' }, false)
    const c = renderIt()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(c.container).toBeEmptyDOMElement()
  })

  it('shows each snippet with the match highlighted, and Open goes to that note', async () => {
    respond(PAYLOAD)
    renderIt()
    fireEvent.click(await screen.findByText('Unlinked mentions (2)'))
    const marks = document.querySelectorAll('mark')
    expect([...marks].map((m) => m.textContent)).toEqual(['cup and handle', 'Cup and Handle'])
    expect(marks[0].parentElement.textContent).toBe('NVDA formed a cup and handle on the daily.')
    expect(screen.getByText('· 3 mentions', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Setups' }))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=b2')
  })

  it('offers Open ONLY — no "Link it", and nothing here ever writes', async () => {
    // The v1 decision, railed: linking from here would be a second writer
    // into another note, and the offline layer forks that note.
    respond(PAYLOAD)
    renderIt()
    fireEvent.click(await screen.findByText('Unlinked mentions (2)'))
    const list = screen.getByRole('list', { name: 'Notes that mention this one' })
    const buttons = within(list).getAllByRole('button')
    expect(buttons.map((b) => b.textContent.trim())).toEqual(['Open', 'Open'])
    // (The section header "Unlinked mentions" is not a link control.)
    expect(screen.queryByRole('button', { name: /^link\b|link it|add link/i })).toBeNull()
    for (const b of buttons) fireEvent.click(b)
    for (const [, init] of fetchSpy.mock.calls) {
      expect((init?.method || 'GET').toUpperCase()).toBe('GET')
    }
  })

  // Wave 7 carry-over M-3: "Open" follows the split view like every other
  // note link inside a pane (NoteBacklinksSection, NoteLinkView,
  // RelationPropertyValue) -- a bare navigate() replaced the WHOLE split with
  // the opened note and closed the side pane the member was working in.
  it('opens in THIS pane when the page is split, and never replaces the route', async () => {
    respond(PAYLOAD)
    const paneOpen = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SplitViewContext.Provider value={{ canSplit: true, openToSide: vi.fn() }}>
          <NotePaneContext.Provider value={{ pane: 'side', open: paneOpen }}>
            <UnlinkedMentions noteId="n1" />
          </NotePaneContext.Provider>
        </SplitViewContext.Provider>
      </SWRConfig>,
    )
    fireEvent.click(await screen.findByText('Unlinked mentions (2)'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Setups' }))
    expect(paneOpen).toHaveBeenCalledWith('b2')
    expect(navSpy).not.toHaveBeenCalled()
  })

  it('opens BESIDE on Ctrl/Cmd+click where the page can split', async () => {
    respond(PAYLOAD)
    const openToSide = vi.fn()
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <SplitViewContext.Provider value={{ canSplit: true, openToSide }}>
          <UnlinkedMentions noteId="n1" />
        </SplitViewContext.Provider>
      </SWRConfig>,
    )
    fireEvent.click(await screen.findByText('Unlinked mentions (2)'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Tuesday' }), { ctrlKey: true, button: 0 })
    expect(openToSide).toHaveBeenCalledWith('a1')
    expect(navSpy).not.toHaveBeenCalled()
    // Control: a plain click on the same row still takes the route.
    fireEvent.click(screen.getByRole('button', { name: 'Open Tuesday' }))
    expect(navSpy).toHaveBeenCalledWith('/journal/notebook?note=a1')
  })

  it('renders nothing without a note id and never fetches', () => {
    respond(PAYLOAD)
    const { container } = render(
      <SWRConfig value={{ provider: () => new Map() }}><UnlinkedMentions noteId={null} /></SWRConfig>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

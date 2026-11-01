// Research Library widget: lists what the member saved, newest first; search (text and
// notes), ticker and collection filters; collections (create / rename / delete, one
// headline in several); notes; remove with Undo; canonical chart links; the AI
// Explanation on demand; and one shared library across several widgets. The server is
// the synthetic fakeLibraryServer; synthetic headlines only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({
  useWorkspace: () => ({ groupSyms: { A: 'NVDA' }, setGroupSym, applyThemeToAllWidgets: vi.fn() }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))

import ResearchLibraryWidget from './ResearchLibraryWidget'
import * as library from '../../../lib/tradeExchangeNewsLibrary'
import { _resetExplainCacheForTests } from '../../../lib/tradeExchangeNewsExplain'
import { fakeLibraryServer } from '../../../testing/tradeExchangeNews/fakeLibraryServer'

const NOW = Date.now()
const H = (id, content, tickers = []) => ({ type: 'headline', id, seq: 0, source: 'TX-News', content, tickers, mentions: [],
  category: 'News', received_at_ms: NOW - 3_600_000, repeat_count: 0, via: 'push', delayed: false })
const HEADS = [
  H('e1', 'SYNTHETIC: AMD guidance raised', ['AMD']),
  H('e2', 'SYNTHETIC: Fed minutes due at 2pm'),
  H('e3', 'SYNTHETIC: NVDA supplier adds capacity', ['NVDA']),
]

let server
beforeEach(() => {
  library._resetLibraryForTests()
  _resetExplainCacheForTests()
  setGroupSym.mockReset()
  server = fakeLibraryServer(HEADS)
  vi.stubGlobal('fetch', vi.fn((url, init) => {
    if (String(url).includes('/explain')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'e1', explanation: 'SYNTHETIC: The headline reports a raised outlook.', watch: 'AMD peers' }) })
    }
    return server.fetch(url, init)
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

async function saved(...ids) {
  for (const id of ids) await server.fetch(`/api/trade-exchange-news/library/bookmarks/${id}`, { method: 'PUT', body: '{}' })
}
async function mount(opts = {}) {
  const onOptsChange = vi.fn()
  const utils = render(<ResearchLibraryWidget color="A" opts={opts} onOptsChange={onOptsChange} />)
  await waitFor(() => expect(screen.queryByText('Loading your library…')).toBeNull())
  return { ...utils, onOptsChange }
}
const rowIds = (c) => [...c.querySelectorAll('[data-id]')].map((r) => r.dataset.id)
const rowEl = (c, id) => c.querySelector(`[data-id="${id}"]`)

describe('Research Library widget', () => {
  it('says how to start when empty', async () => {
    await mount()
    expect(await screen.findByText(/Your library is empty/)).toBeTruthy()
  })

  it('lists saved headlines newest first, with the receipt time and ticker links that open the chart', async () => {
    await saved('e1', 'e3')
    const { container } = await mount()
    await waitFor(() => expect(rowIds(container)).toEqual(['e3', 'e1']))
    expect(rowEl(container, 'e1').textContent).toContain('AMD guidance raised')
    expect(rowEl(container, 'e1').querySelector('[title^="Received by UCT"]')).toBeTruthy()
    fireEvent.click(within(rowEl(container, 'e1')).getByRole('button', { name: 'AMD' }))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'AMD')                  // the canonical chart action
  })

  it('searches headline text and the member\'s own notes, and filters by ticker', async () => {
    await saved('e1', 'e2', 'e3')
    await server.fetch('/api/trade-exchange-news/library/bookmarks/e2/note', { method: 'PUT', body: JSON.stringify({ note: 'rates thesis' }) })
    const { container, rerender } = await mount()
    await waitFor(() => expect(rowIds(container)).toHaveLength(3))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved headlines and notes' }), { target: { value: 'thesis' } })
    await waitFor(() => expect(rowIds(container)).toEqual(['e2']))
    expect(rowEl(container, 'e2').textContent).toContain('rates thesis')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved headlines and notes' }), { target: { value: '' } })
    rerender(<ResearchLibraryWidget color="A" opts={{ ticker: 'NVDA' }} onOptsChange={vi.fn()} />)
    await waitFor(() => expect(rowIds(container)).toEqual(['e3']))
  })

  it('assigns one headline to several collections and filters by one', async () => {
    await saved('e1', 'e2')
    const { container, onOptsChange, rerender } = await mount()
    await waitFor(() => expect(rowIds(container)).toHaveLength(2))
    fireEvent.click(within(rowEl(container, 'e1')).getByRole('button', { name: 'Collections for this headline' }))
    const menu = await screen.findByRole('dialog', { name: 'Collections' })
    for (const name of ['Earnings', 'Semis']) {
      fireEvent.change(within(menu).getByRole('textbox', { name: 'New collection name' }), { target: { value: name } })
      fireEvent.click(within(menu).getByRole('button', { name: 'Add' }))
      await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Collections' })).getByRole('checkbox', { name: name })).toBeChecked())
    }
    await waitFor(() => expect(rowEl(container, 'e1').textContent).toContain('Earnings'))
    expect(rowEl(container, 'e1').textContent).toContain('Semis')
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by collection' }), { target: { value: 'c2' } })
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ collection: 'c2' }))
    rerender(<ResearchLibraryWidget color="A" opts={{ collection: 'c2' }} onOptsChange={onOptsChange} />)
    await waitFor(() => expect(rowIds(container)).toEqual(['e1']))
  })

  it('renames and deletes a collection; deleting keeps its headlines saved', async () => {
    await saved('e1')
    await server.fetch('/api/trade-exchange-news/library/collections', { method: 'POST', body: JSON.stringify({ name: 'Fed' }) })
    await server.fetch('/api/trade-exchange-news/library/collections/c1/items/e1', { method: 'PUT' })
    const { container } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Manage collections' }))
    const dlg = await screen.findByRole('dialog', { name: 'Manage collections' })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Rename Fed' }))
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Rename Fed' }), { target: { value: 'FOMC' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await within(dlg).findByText('FOMC')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Delete FOMC' }))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm: delete FOMC' }))   // two clicks, no browser dialog
    await waitFor(() => expect(server.cols.size).toBe(0))
    expect(server.marks.has('e1')).toBe(true)
    await waitFor(() => expect(rowIds(container)).toEqual(['e1']))
  })

  it('adds, edits and deletes a personal note', async () => {
    await saved('e2')
    const { container } = await mount()
    await waitFor(() => expect(rowIds(container)).toEqual(['e2']))
    fireEvent.click(within(rowEl(container, 'e2')).getByRole('button', { name: 'Add a note' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your research note' }), { target: { value: 'Watch the 2-year' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(rowEl(container, 'e2').textContent).toContain('Watch the 2-year'))
    fireEvent.click(within(rowEl(container, 'e2')).getByRole('button', { name: 'Edit your note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(server.marks.get('e2').note).toBe(''))
    expect(server.marks.has('e2')).toBe(true)                              // the bookmark stays
  })

  it('removes with Undo, which restores the note and collections', async () => {
    await saved('e1')
    await server.fetch('/api/trade-exchange-news/library/collections', { method: 'POST', body: JSON.stringify({ name: 'Ideas' }) })
    await server.fetch('/api/trade-exchange-news/library/collections/c1/items/e1', { method: 'PUT' })
    await server.fetch('/api/trade-exchange-news/library/bookmarks/e1/note', { method: 'PUT', body: JSON.stringify({ note: 'keep me' }) })
    const { container } = await mount()
    await waitFor(() => expect(rowIds(container)).toEqual(['e1']))
    fireEvent.click(within(rowEl(container, 'e1')).getByRole('button', { name: 'Remove from Research Library' }))
    await waitFor(() => expect(rowIds(container)).toEqual([]))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(rowIds(container)).toEqual(['e1']))
    expect(server.marks.get('e1').note).toBe('keep me')
    expect(server.items.get('c1').has('e1')).toBe(true)
  })

  it('opens the AI Explanation only on a click, and never stores it in the note', async () => {
    await saved('e1')
    const { container } = await mount()
    await waitFor(() => expect(rowIds(container)).toEqual(['e1']))
    expect(fetch.mock.calls.some(([u]) => String(u).includes('/explain'))).toBe(false)   // saving/listing never explains
    fireEvent.click(within(rowEl(container, 'e1')).getByRole('button', { name: 'Explain this headline' }))
    const panel = await screen.findByRole('dialog', { name: 'AI Explanation' })
    await within(panel).findByText(/raised outlook/)
    expect(server.marks.get('e1').note).toBe('')
  })

  it('two Library widgets share one library: a removal in one shows in the other', async () => {
    await saved('e1', 'e2')
    render(<>
      <ResearchLibraryWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      <ResearchLibraryWidget color="A" opts={{ settings: { density: 'compact' } }} onOptsChange={vi.fn()} />
    </>)
    await waitFor(() => expect(document.querySelectorAll('[data-id="e1"]')).toHaveLength(2))
    const first = document.querySelectorAll('[data-id="e1"]')[0]
    fireEvent.click(within(first).getByRole('button', { name: 'Remove from Research Library' }))
    await waitFor(() => expect(document.querySelectorAll('[data-id="e1"]')).toHaveLength(0))
    expect(document.querySelectorAll('[data-id="e2"]')).toHaveLength(2)
    expect(server.calls.filter((c) => c === 'GET /state').length).toBeLessThanOrEqual(2)  // one shared store
  })

  it('a refused load says why and offers Retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }))
    await act(async () => { render(<ResearchLibraryWidget color="A" opts={{}} onOptsChange={vi.fn()} />) })
    expect(await screen.findByText('Sign in to UCT to use your library.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

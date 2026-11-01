// UCT News V2 — Saved Headlines inside the News widget, the ⋯ menu's Collection and
// Notebook actions, and the retired Research Library opening as News. The shared pool,
// the day server and the library server are faked; synthetic only.
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    listeners,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { listeners.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
  }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', async () => {
  const { fakeNewsDay, fakeNewsDays } = await import('../../../testing/tradeExchangeNews/fakeNewsDay')
  return {
    subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
    getSnapshot: () => feed.get(),
    retry: vi.fn(),
    fetchDay: async (body) => fakeNewsDay(feed.get().items, body, {}),
    fetchDays: async () => fakeNewsDays(feed.get().items, {}),
    claimAnnouncement: () => true,
  }
})
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({
  useWorkspace: () => ({ groupSyms: { A: 'NVDA' }, setGroupSym, applyThemeToAllWidgets: vi.fn() }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))
vi.mock('../../../utils/alertSound', async (orig) => ({ ...(await orig()), playAlertSound: vi.fn(), previewSound: vi.fn() }))
vi.mock('swr', () => ({ default: () => ({ data: undefined, mutate: vi.fn() }) }))
vi.mock('../../watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: () => ({}),
}))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, staleSymbols: new Set(), isLoading: false, isStreaming: true }),
}))
const notebook = vi.hoisted(() => ({ send: null }))
vi.mock('../../journal-2-0/lib/sendToJournal', () => ({ sendCaptureToJournal: (...a) => notebook.send(...a) }))

import TradeExchangeNewsWidget from './TradeExchangeNewsWidget'
import { WORKSPACE_WIDGETS } from '../WidgetHost'
import { _resetLibraryForTests } from '../../../lib/tradeExchangeNewsLibrary'
import { _resetNotebookSendsForTests } from '../../../lib/tradeExchangeNewsNotebook'
import { fakeLibraryServer } from '../../../testing/tradeExchangeNews/fakeLibraryServer'

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const NOW = Date.now()
const H = (seq, content, tickers = [], extra = {}) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`,
  source: 'TX-News', content, tickers, category: 'News', received_at_ms: NOW - (50 - seq) * 1000,
  repeat_count: 0, via: 'push', delayed: false, ...extra })
const BASE = [
  H(1, 'SYNTHETIC: AMD guidance raised', ['AMD']),
  H(2, 'SYNTHETIC: Fed minutes due'),
  H(3, 'SYNTHETIC: NVDA and AMD rally', ['NVDA', 'AMD']),
]

let lib
function stateful(initial = {}) {
  const out = { opts: initial }                // the widget's opts as last saved
  function Host() {
    const [o, setO] = useState(initial)
    return <TradeExchangeNewsWidget color="A" opts={o} onOptsChange={(next) => { out.opts = next; setO(next) }} />
  }
  return { Host, out }
}
function mount(initial = {}) {
  const { Host, out } = stateful(initial)
  const utils = render(<Host />)
  act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, replayUntil: 3, lastHeadlineAt: NOW }))
  return { ...utils, out }
}
const feedList = (c) => c.querySelector('[aria-label^="Headlines,"]')
const savedList = () => screen.getByLabelText('Saved headlines')
const rowEl = (c, seq) => c.querySelector(`[data-seq="${seq}"]`)
const savedRow = (id) => savedList().querySelector(`[data-id="${id}"]`)
const toggle = () => screen.getByRole('button', { name: /^(Show saved headlines|Back to the News feed)$/ })

beforeEach(() => {
  feed.reset()
  setGroupSym.mockReset()
  _resetLibraryForTests()
  _resetNotebookSendsForTests()
  lib = fakeLibraryServer(BASE)
  vi.stubGlobal('fetch', vi.fn((url, init) => lib.fetch(url, init)))
  notebook.send = vi.fn(async () => 'Headline sent to “Fed week”')
})
afterEach(() => vi.unstubAllGlobals())

describe('the toolbar bookmark switches views inside the same widget', () => {
  it('sits left of LIVE, shows when Saved is open, and returns to the feed', async () => {
    const { container } = mount()
    const bar = container.querySelector('[class*="_bar_"]')
    const labels = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent)
    expect(labels.indexOf('Show saved headlines')).toBe(labels.findIndex((l) => /LIVE|Connecting|Live/i.test(l)) - 1)
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByText(/Nothing saved yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'News feed' }))
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps the feed exactly as left — the same list, its scroll, search and filters — and live under Saved', async () => {
    const { container, out } = mount({ linked: true })
    const list = feedList(container)
    list.scrollTop = 140
    const search = screen.getByRole('textbox', { name: 'Search headlines' })
    fireEvent.change(search, { target: { value: 'AMD' } })
    fireEvent.click(toggle())
    await screen.findByLabelText('Saved headlines')
    expect(feedList(container)).toBe(list)                                // hidden, never unmounted
    expect(list.closest('[inert]')).toBeTruthy()                         // and out of reach meanwhile
    act(() => feed.set({ items: [...BASE, H(4, 'SYNTHETIC: NVDA and AMD news arrives while Saved is open', ['NVDA', 'AMD'])], lastSeq: 4 }))
    fireEvent.click(toggle())
    expect(feedList(container)).toBe(list)
    expect(list.scrollTop).toBe(140)
    expect(screen.getByRole('textbox', { name: 'Search headlines' }).value).toBe('AMD')
    expect(out.opts.linked).toBe(true)
    await waitFor(() => expect(rowEl(container, 4)).toBeTruthy())        // the stream never stopped
  })

  it('switching back and forth asks the server for the list once', async () => {
    mount()
    fireEvent.click(toggle())
    await screen.findByText(/Nothing saved yet/)
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    fireEvent.click(toggle())
    expect(lib.calls.filter((c) => c.startsWith('GET /items'))).toHaveLength(1)
  })
})

describe('Saved Headlines', () => {
  async function withSaves() {
    const utils = mount()
    await waitFor(() => expect(lib.calls).toContain('GET /state'))
    for (const seq of [1, 3]) {
      fireEvent.click(within(rowEl(utils.container, seq)).getByRole('button', { name: 'Save headline' }))
      await waitFor(() => expect(lib.marks.has(`id${seq}`)).toBe(true))
    }
    return utils
  }

  it('lists what was saved, newest saved first, with its time and chart links', async () => {
    await withSaves()
    fireEvent.click(toggle())
    await waitFor(() => expect(savedList().querySelectorAll('[data-id]')).toHaveLength(2))
    expect([...savedList().querySelectorAll('[data-id]')].map((r) => r.dataset.id)).toEqual(['id3', 'id1'])
    fireEvent.click(within(savedRow('id3')).getByRole('button', { name: 'NVDA' }))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'NVDA')
  })

  it('a note and two collections survive remove + Undo exactly; the headline itself is never touched', async () => {
    await withSaves()
    lib.fetch('/api/trade-exchange-news/library/collections', { method: 'POST', body: JSON.stringify({ name: 'Macro' }) })
    lib.fetch('/api/trade-exchange-news/library/collections', { method: 'POST', body: JSON.stringify({ name: 'AI' }) })
    fireEvent.click(toggle())
    await waitFor(() => expect(savedRow('id1')).toBeTruthy())
    fireEvent.click(within(savedRow('id1')).getByRole('button', { name: 'Add a note' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Your note on this headline' }), { target: { value: 'compare with Q2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(lib.marks.get('id1').note).toBe('compare with Q2'))
    fireEvent.click(within(savedRow('id1')).getByRole('button', { name: 'More actions for this headline' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Collections…' }))
    for (const name of ['Macro', 'AI']) {
      fireEvent.click(await screen.findByRole('checkbox', { name }))
      await waitFor(() => expect([...lib.items.values()].filter((s) => s.has('id1')).length).toBeGreaterThan(name === 'AI' ? 1 : 0))
    }
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    const before = { ...lib.marks.get('id1'), collections: [...lib.items.entries()].filter(([, s]) => s.has('id1')).map(([c]) => c).sort() }
    fireEvent.click(within(savedRow('id1')).getByRole('button', { name: 'Remove bookmark' }))
    await waitFor(() => expect(lib.marks.has('id1')).toBe(false))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lib.marks.has('id1')).toBe(true))
    const after = { ...lib.marks.get('id1'), collections: [...lib.items.entries()].filter(([, s]) => s.has('id1')).map(([c]) => c).sort() }
    expect(after).toEqual(before)
    expect(lib.headlines.get('id1').content).toBe('SYNTHETIC: AMD guidance raised')
  })

  it('search, ticker and collection filter the list on the server', async () => {
    const { out } = await withSaves()
    fireEvent.click(toggle())
    await waitFor(() => expect(savedList().querySelectorAll('[data-id]')).toHaveLength(2))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by ticker' }), { target: { value: 'nvda' } })
    expect(out.opts.ticker).toBe('NVDA')
    await waitFor(() => expect([...savedList().querySelectorAll('[data-id]')].map((r) => r.dataset.id)).toEqual(['id3']))
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter by ticker' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search saved headlines and notes' }), { target: { value: 'guidance' } })
    await waitFor(() => expect([...savedList().querySelectorAll('[data-id]')].map((r) => r.dataset.id)).toEqual(['id1']))
  })

  it('an unsaved note edit asks once before it is dropped', async () => {
    await withSaves()
    fireEvent.click(toggle())
    await waitFor(() => expect(savedRow('id1')).toBeTruthy())
    fireEvent.click(within(savedRow('id1')).getByRole('button', { name: 'Add a note' }))
    const box = screen.getByRole('textbox', { name: 'Your note on this headline' })
    fireEvent.change(box, { target: { value: 'half a thought' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText(/Unsaved changes/)).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Your note on this headline' }).value).toBe('half a thought')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('textbox', { name: 'Your note on this headline' })).toBeNull()
  })
})

describe('⋯ Add to Collection on the feed', () => {
  it('on an unsaved headline saves it, then files it', async () => {
    const { container } = mount()
    await waitFor(() => expect(lib.calls).toContain('GET /state'))
    lib.fetch('/api/trade-exchange-news/library/collections', { method: 'POST', body: JSON.stringify({ name: 'Earnings' }) })
    fireEvent.click(within(rowEl(container, 1)).getByRole('button', { name: 'More actions for this headline' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add to Collection…' }))
    expect(screen.getByText(/also saves this headline/)).toBeTruthy()
    await act(async () => { await (await import('../../../lib/tradeExchangeNewsLibrary')).load({ force: true }) })
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Earnings' }))
    await waitFor(() => expect(lib.marks.has('id1')).toBe(true))
    await waitFor(() => expect(lib.items.get('c1').has('id1')).toBe(true))
    await waitFor(() => expect(within(rowEl(container, 1)).getByRole('button', { name: 'Remove bookmark' })).toBeTruthy())
  })
})

describe('⋯ Send to Notebook', () => {
  const send = async (container, seq = 3) => {
    fireEvent.click(within(rowEl(container, seq)).getByRole('button', { name: 'More actions for this headline' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Send to Notebook/ }))
  }

  it("goes through the Notebook's own capture door with a frozen reference, and says where it went", async () => {
    const { container } = mount()
    await send(container)
    await waitFor(() => expect(notebook.send).toHaveBeenCalledTimes(1))
    const [kind, capture, opts] = notebook.send.mock.calls[0]
    expect(kind).toBe('tradeExchangeHeadline')
    expect(capture).toEqual({ eventId: 'id3', content: 'SYNTHETIC: NVDA and AMD rally', receivedAtMs: BASE[2].received_at_ms,
      source: 'Trade Exchange', tickers: ['NVDA', 'AMD'] })
    expect(opts).toEqual({ label: 'Headline' })
    expect(await screen.findByText('Headline sent to “Fed week”')).toBeTruthy()
    expect(lib.marks.has('id3')).toBe(false)                              // sending never bookmarks
  })

  it('a double click sends once; a send just made asks for a deliberate "again"', async () => {
    let finish
    notebook.send = vi.fn(() => new Promise((res) => { finish = res }))
    const { container } = mount()
    fireEvent.click(within(rowEl(container, 3)).getByRole('button', { name: 'More actions for this headline' }))
    const item = screen.getByRole('menuitem', { name: /Send to Notebook/ })
    fireEvent.click(item)
    fireEvent.click(item)
    await waitFor(() => expect(notebook.send).toHaveBeenCalledTimes(1))
    await act(async () => { finish('Headline captured → Notebook inbox') })
    expect(notebook.send).toHaveBeenCalledTimes(1)
    fireEvent.click(within(rowEl(container, 3)).getByRole('button', { name: 'More actions for this headline' }))
    expect(screen.getByRole('menuitem', { name: 'Send to Notebook again' })).toBeTruthy()
  })

  it('a failed send says so', async () => {
    notebook.send = vi.fn(async () => 'Capture failed — try again')
    const { container } = mount()
    await send(container)
    expect(await screen.findByText('Capture failed — try again')).toBeTruthy()
    fireEvent.click(within(rowEl(container, 3)).getByRole('button', { name: 'More actions for this headline' }))
    expect(screen.getByRole('menuitem', { name: 'Send to Notebook' })).toBeTruthy()   // not "again": nothing landed
  })
})

describe('the retired Research Library widget', () => {
  it('opens as UCT News on Saved Headlines, keeping its filters, and can still reach the feed', async () => {
    const binding = WORKSPACE_WIDGETS.researchLibrary
    expect(binding.component).toBe(TradeExchangeNewsWidget)
    const onOptsChange = vi.fn()
    const props = binding.props({ colorKey: 'A', opts: { ticker: 'NVDA' }, onOptsChange })
    render(<binding.component {...props} />)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    expect(screen.getByRole('button', { name: 'Back to the News feed' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('textbox', { name: 'Filter by ticker' }).value).toBe('NVDA')
    fireEvent.click(screen.getByRole('button', { name: 'Back to the News feed' }))
    expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ view: 'feed', ticker: 'NVDA' }))
  })
})

// UCT News — Linked to chart opens on ALL HISTORY (every archived day, newest first, in
// keyset pages), a day narrows it, All history returns, leaving Linked restores the feed's
// own date; and search hits are marked (the UCT Agent's gold) in feed and Saved rows.
// The pool, the day server and the library are faked; synthetic only.
import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    archive: null, dayCalls: [], fail: false, listeners,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { this.archive = null; this.dayCalls = []; this.fail = false; listeners.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
  }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', async () => {
  const { fakeNewsDay, fakeNewsDays } = await import('../../../testing/tradeExchangeNews/fakeNewsDay')
  return {
    subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
    getSnapshot: () => feed.get(),
    retry: vi.fn(),
    fetchDay: async (body) => {
      feed.dayCalls.push(body)
      if (feed.fail) throw new Error('archive down')
      return fakeNewsDay(feed.archive || feed.get().items, body, {})
    },
    fetchDays: async () => fakeNewsDays(feed.archive || feed.get().items, {}),
    claimAnnouncement: () => true,
  }
})
const ws = vi.hoisted(() => ({ groupSyms: { A: 'NVDA' } }))
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({
  useWorkspace: () => ({ groupSyms: ws.groupSyms, setGroupSym, applyThemeToAllWidgets: vi.fn() }),
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

import TradeExchangeNewsWidget from './TradeExchangeNewsWidget'
import { highlightRuns, searchNeedles } from './tradeExchangeNewsModel'
import { _resetLibraryForTests } from '../../../lib/tradeExchangeNewsLibrary'
import { fakeLibraryServer } from '../../../testing/tradeExchangeNews/fakeLibraryServer'

globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

// Late October 2026 is EDT (UTC-4): an ET wall time as an instant.
const ET = (d, h, m = 0) => Date.UTC(2026, 9, d, h + 4, m)
const H = (seq, content, tickers, received, extra = {}) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`,
  source: 'TX-News', content, tickers, category: 'News', received_at_ms: received, repeat_count: 0, via: 'push',
  delayed: false, ...extra })
// Three archived days (Oct 24, 25, 26) with NVDA on 90 of their rows -- more than a page (60).
const PAST = []
for (const [d, base] of [[24, 100], [25, 300], [26, 500]]) {
  for (let i = 0; i < 40; i++) {
    const nv = i % 4 !== 3
    PAST.push(H(base + i, `SYNTHETIC: oct ${d} ${nv ? 'NVDA' : 'AMD'} update ${i}`, [nv ? 'NVDA' : 'AMD'], ET(d, 9, i),
      { category: i % 5 === 0 ? 'Earnings' : 'News' }))
  }
}
const NOW = Date.now()
const TODAY = [H(1, 'SYNTHETIC: AMD guidance raised', ['AMD'], NOW - 50_000),
  H(2, 'SYNTHETIC: NVDA rallies today', ['NVDA'], NOW - 40_000)]
const NVDA_ALL = [...TODAY, ...PAST].filter((it) => it.tickers.includes('NVDA'))
  .sort((a, b) => b.received_at_ms - a.received_at_ms || b.seq - a.seq)          // newest first

function Host({ initial = {}, out }) {
  const [opts, setOpts] = useState(initial)
  return <TradeExchangeNewsWidget color="A" opts={opts} onOptsChange={(o) => { if (out) out.opts = o; setOpts(o) }} />
}
function mount(initial = {}) {
  const out = { opts: initial }
  feed.archive = [...PAST, ...TODAY]
  const utils = render(<Host initial={initial} out={out} />)
  act(() => feed.set({ status: 'live', items: TODAY, lastSeq: 2, replayUntil: 2, lastHeadlineAt: NOW }))
  return { ...utils, out }
}
const seqs = (c) => [...c.querySelectorAll('[data-seq]')].map((r) => Number(r.dataset.seq))
const bar = () => screen.getByRole('navigation', { name: 'Date' })
const dateBtn = () => within(bar()).getByRole('button', { name: /^Date:/ })
const list = (c) => c.querySelector('[aria-label^="Headlines,"]')
const historyCalls = () => feed.dayCalls.filter((b) => b.history)
const setLinked = (on) => {
  fireEvent.click(screen.getByRole('button', { name: /^News filters/ }))
  const menu = screen.getByRole('dialog', { name: 'News filters' })
  fireEvent.click(within(menu).getByRole('button', { name: on ? /Linked to chart/ : 'All headlines' }))
  fireEvent.keyDown(menu, { key: 'Escape' })
}
const openCalendar = async () => {
  fireEvent.click(dateBtn())
  return screen.findByRole('dialog', { name: 'Choose a date' })
}
const pickDay = async (d) => {
  const dlg = await openCalendar()
  for (let i = 0; i < 3 && !dlg.querySelector(`[data-day="2026-10-${d}"]`); i++) {
    fireEvent.click(within(dlg).getByRole('button', { name: 'Previous month' }))
  }
  fireEvent.click(dlg.querySelector(`[data-day="2026-10-${d}"]`))
}

beforeEach(() => {
  feed.reset()
  ws.groupSyms = { A: 'NVDA' }
  setGroupSym.mockReset()
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
    return this.querySelectorAll ? this.querySelectorAll('[data-seq]').length * 30 : 16
  })
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return 300 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Linked to chart = All history', () => {
  it('switching Linked on shows every archived NVDA headline across days, newest first, labelled All history', async () => {
    const { container } = mount()
    await waitFor(() => expect(seqs(container)).toEqual([2, 1]))
    expect(dateBtn().textContent).toMatch(/Today/)
    setLinked(true)
    await waitFor(() => expect(dateBtn().textContent).toMatch(/All history/))
    expect(historyCalls().at(-1)).toMatchObject({ history: true, symbol: 'NVDA' })
    expect(historyCalls().at(-1).date).toBeUndefined()
    await waitFor(() => expect(seqs(container).length).toBeGreaterThan(30))
    const shown = seqs(container)
    expect(shown[0]).toBe(2)                                                     // today's live NVDA on top
    expect(shown.slice(0, 60)).toEqual(NVDA_ALL.slice(0, 60).map((it) => it.seq))  // across Oct 26 -> 25
    expect(within(bar()).getByRole('button', { name: 'Previous day' })).toBeDisabled()
    expect(within(bar()).getByRole('button', { name: /^Jump to Time/ })).toBeDisabled()
  })

  it('pages through the whole history on scroll, every match once, then says where the archive starts', async () => {
    const { container } = mount({ linked: true })
    await waitFor(() => expect(seqs(container)).toHaveLength(60))
    for (let i = 0; i < 4 && seqs(container).length < NVDA_ALL.length; i++) {
      const el = list(container)
      el.scrollTop = 10 ** 7
      fireEvent.scroll(el)
      await waitFor(() => expect(historyCalls().length).toBeGreaterThan(i + 1))
    }
    await waitFor(() => expect(seqs(container)).toEqual(NVDA_ALL.map((it) => it.seq)))
    expect(historyCalls().slice(1).every((b) => Array.isArray(b.cursor))).toBe(true)
    expect(await within(container).findByText(/^Start of the UCT News archive/)).toBeTruthy()
  })

  it('a day narrows it; All history in the date picker returns', async () => {
    const { container } = mount({ linked: true })
    await waitFor(() => expect(dateBtn().textContent).toMatch(/All history/))
    await pickDay(25)
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: '2026-10-25', symbol: 'NVDA' }))
    await waitFor(() => expect(seqs(container)).toEqual(PAST.filter((it) => it.seq >= 300 && it.seq < 400 && it.tickers[0] === 'NVDA')
      .map((it) => it.seq).reverse()))
    expect(dateBtn().textContent).not.toMatch(/All history/)
    const dlg = await openCalendar()
    expect(within(dlg).getByRole('button', { name: 'All history' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(within(dlg).getByRole('button', { name: 'All history' }))
    await waitFor(() => expect(dateBtn().textContent).toMatch(/All history/))
    await waitFor(() => expect(seqs(container)[0]).toBe(2))
  })

  it('a new chart symbol re-reads All history for it; a picked day stays picked', async () => {
    const { container, rerender } = mount({ linked: true })
    await waitFor(() => expect(seqs(container)[0]).toBe(2))
    ws.groupSyms = { A: 'AMD' }
    rerender(<Host initial={{ linked: true }} />)
    await waitFor(() => expect(historyCalls().at(-1)).toMatchObject({ history: true, symbol: 'AMD' }))
    await waitFor(() => expect(seqs(container)[0]).toBe(1))
    expect(dateBtn().textContent).toMatch(/All history/)
    await pickDay(24)
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: '2026-10-24', symbol: 'AMD' }))
    ws.groupSyms = { A: 'NVDA' }
    rerender(<Host initial={{ linked: true }} />)
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: '2026-10-24', symbol: 'NVDA' }))
  })

  it("leaving Linked restores the feed's own date, and Linked starts on All history again", async () => {
    const { container } = mount()
    await waitFor(() => expect(seqs(container)).toEqual([2, 1]))
    await pickDay(26)                                                             // the feed's own date
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: '2026-10-26' }))
    setLinked(true)
    await waitFor(() => expect(dateBtn().textContent).toMatch(/All history/))
    await pickDay(25)
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: '2026-10-25', symbol: 'NVDA' }))
    setLinked(false)
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: '2026-10-26', symbol: null }))
    expect(dateBtn().textContent).toMatch(/Oct 26/)
    setLinked(true)
    await waitFor(() => expect(dateBtn().textContent).toMatch(/All history/))
  })

  it('search and categories combine with All history', async () => {
    const { container } = mount({ linked: true, categories: ['Earnings'] })
    await waitFor(() => expect(historyCalls().at(-1)).toMatchObject({ symbol: 'NVDA', categories: ['Earnings'] }))
    const want = NVDA_ALL.filter((it) => it.category === 'Earnings').map((it) => it.seq)
    await waitFor(() => expect(seqs(container)).toEqual(want))
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: 'oct 25' } })
    await waitFor(() => expect(historyCalls().at(-1)).toMatchObject({ query: 'oct 25' }))
    await waitFor(() => expect(seqs(container)).toEqual(want.filter((s) => s >= 300 && s < 400)))
    expect(want[0]).toBeGreaterThan(want.at(-1))
  })

  it('a saved Linked widget reopens on All history', async () => {
    mount({ linked: true })
    await waitFor(() => expect(dateBtn().textContent).toMatch(/All history/))
    expect(historyCalls()).toHaveLength(1)
  })

  it('says honestly when nothing in the archive names the symbol, and when the archive cannot be reached', async () => {
    ws.groupSyms = { A: 'ZZZZ' }
    const { container, unmount } = mount({ linked: true })
    expect(await within(container).findByText('No archived headlines name ZZZZ. New ones appear here the moment they arrive.')).toBeTruthy()
    unmount()
    feed.reset()
    ws.groupSyms = { A: 'NVDA' }
    feed.fail = true
    const r2 = mount({ linked: true })
    feed.fail = true
    expect(await within(r2.container).findByText('The UCT News archive could not be reached.')).toBeTruthy()
    expect(within(r2.container).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('search hits are marked', () => {
  it('every occurrence, case-insensitive, original capitals kept; $SYM marks the symbol; overlaps merge', () => {
    const runs = highlightRuns('Fed holds; FED says the fed will hold', searchNeedles('fed'))
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(['Fed', 'FED', 'fed'])
    expect(runs.map((r) => r.text).join('')).toBe('Fed holds; FED says the fed will hold')
    expect(highlightRuns('NVDA and $NVDA', searchNeedles('$nvda')).filter((r) => r.hit).map((r) => r.text)).toEqual(['NVDA', '$NVDA'])
    expect(highlightRuns('aaaa', ['aa']).filter((r) => r.hit).map((r) => r.text)).toEqual(['aaaa'])
    expect(highlightRuns('no hit here', searchNeedles('zzz'))).toEqual([{ text: 'no hit here', hit: false }])
    expect(highlightRuns('anything', searchNeedles('   '))).toEqual([{ text: 'anything', hit: false }])
  })

  it('special characters are literal text, never patterns', () => {
    const text = 'S&P (500) +1.2% vs. [Q3] *est* $NVDA ^ | \\ a.b'
    for (const q of ['(500)', '+1.2%', '[q3]', '*est*', '^', '|', '\\', 'a.b', '.*']) {
      const hits = highlightRuns(text, searchNeedles(q)).filter((r) => r.hit).map((r) => r.text.toLowerCase())
      expect(hits.every((h) => h === q.toLowerCase()), q).toBe(true)
    }
    expect(highlightRuns(text, searchNeedles('.*')).some((r) => r.hit)).toBe(false)
  })

  it('in the feed: marks as you type (multiword as one phrase), keeps ticker links, clears with the search', async () => {
    const { container } = mount()
    await waitFor(() => expect(seqs(container)).toEqual([2, 1]))
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: 'nvda rall' } })
    await waitFor(() => expect(container.querySelector('[data-seq="2"] mark')).toBeTruthy())
    const row = container.querySelector('[data-seq="2"]')
    // one phrase across the ticker link and the text after it: marked in both pieces
    expect([...row.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['NVDA', ' rall'])
    expect(row.querySelector('[class*="headline"]').textContent).toBe('SYNTHETIC: NVDA rallies today')
    const sym = within(row).getByRole('button', { name: 'NVDA' })
    expect(sym.querySelector('mark')).toBeTruthy()                               // the ticker stays a chart link
    fireEvent.click(sym)
    expect(setGroupSym).toHaveBeenCalledWith('A', 'NVDA')
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: '' } })
    await waitFor(() => expect(container.querySelector('mark')).toBeNull())
  })

  it('renders hits as text: markup in a headline is never parsed', async () => {
    feed.reset()
    const odd = [H(7, 'SYNTHETIC <b>bold</b> <img src=x onerror=alert(1)> claim', [], NOW - 1000)]
    feed.archive = odd
    const { container } = render(<Host />)
    act(() => feed.set({ status: 'live', items: odd, lastSeq: 7, lastHeadlineAt: NOW }))
    await waitFor(() => expect(seqs(container)).toEqual([7]))
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: '<b>' } })
    await waitFor(() => expect(container.querySelector('[data-seq="7"] mark')?.textContent).toBe('<b>'))
    expect(container.querySelector('[data-seq="7"] b, [data-seq="7"] img')).toBeNull()
  })

  it('in Saved Headlines too, in the headline and the note', async () => {
    _resetLibraryForTests()
    const lib = fakeLibraryServer(TODAY)
    lib.fetch('/api/trade-exchange-news/library/bookmarks/id2', { method: 'PUT', body: JSON.stringify({ note: 'watch NVDA earnings' }) })
    vi.stubGlobal('fetch', vi.fn((url, init) => lib.fetch(url, init)))
    mount({ view: 'saved' })
    const savedList = await screen.findByLabelText('Saved headlines')
    await waitFor(() => expect(savedList.querySelector('[data-id="id2"]')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Search saved headlines and notes'), { target: { value: 'nvda' } })
    await waitFor(() => expect([...savedList.querySelectorAll('[data-id="id2"] mark')].map((m) => m.textContent)).toEqual(['NVDA', 'NVDA']))
  })
})

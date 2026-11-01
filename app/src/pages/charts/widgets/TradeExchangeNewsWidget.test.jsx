// The News widget (Trade Exchange): rendering, ticker links, search + filters,
// auto-follow / Jump to live, highlight, sound (muted by default, once per headline
// across widgets), settings persistence, error states. The shared pool is mocked
// so the test drives the feed directly. Synthetic headlines only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  const claimed = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    archive: null, dayCalls: [], dayOpts: null, daysOpts: null,
    listeners, claimed,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { this.archive = null; this.dayCalls = []; this.dayOpts = null; this.daysOpts = null; listeners.clear(); claimed.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
  }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', async () => {
  const { fakeNewsDay, fakeNewsDays } = await import('../../../testing/tradeExchangeNews/fakeNewsDay')
  return {
  subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
  getSnapshot: () => feed.get(),
  retry: vi.fn(),
  // The server's days over the synthetic archive (the pool's rows unless a test sets one).
  fetchDay: async (body) => { feed.dayCalls.push(body); return fakeNewsDay(feed.archive || feed.get().items, body, feed.dayOpts || {}) },
  fetchDays: async () => fakeNewsDays(feed.archive || feed.get().items, feed.daysOpts || {}),
  claimAnnouncement: (seq) => (feed.claimed.has(seq) ? false : (feed.claimed.add(seq), true)),
}
})
const setGroupSym = vi.fn()
let groupSyms = { A: 'NVDA' }
vi.mock('../WorkspaceContext', () => ({
  useWorkspace: () => ({ groupSyms, setGroupSym, applyThemeToAllWidgets: vi.fn() }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))
const sound = vi.hoisted(() => ({ play: vi.fn(), preview: vi.fn() }))
vi.mock('../../../utils/alertSound', async (orig) => ({
  ...(await orig()), playAlertSound: sound.play, previewSound: sound.preview,
}))
vi.mock('swr', () => ({
  default: (key) => ({ data: key && String(key).includes('/api/watchlists/prebuilt') ? [{ id: 'pre1', name: 'S&P 500' }]
    : key && String(key).includes('/api/watchlists') ? [{ id: 'wl1', name: 'Mine' }] : undefined, mutate: vi.fn() }),
}))
vi.mock('../../watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: (ids) => (ids.includes('wl1') ? { wl1: [{ sym: 'AMD' }] } : {}),
}))

// The shared price stream, driven directly: { prices, staleSymbols } and the symbols asked for.
const quotes = vi.hoisted(() => ({ prices: {}, stale: new Set(), asked: [] }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: (syms) => { quotes.asked = syms; return { prices: quotes.prices, staleSymbols: quotes.stale, isLoading: false, isStreaming: true } },
}))

import TradeExchangeNewsWidget from './TradeExchangeNewsWidget'

const NOW = Date.now()
const H = (seq, content, tickers = [], extra = {}) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`,
  source: 'TXNews1', content, tickers, received_at_ms: NOW - (10 - seq) * 1000, repeat_count: 0, via: 'push', delayed: false, ...extra })
const HISTORY = [H(1, 'SYNTHETIC: $NVDA beats', ['NVDA']), H(2, 'SYNTHETIC: AMD guidance raised', ['AMD'], { repeat_count: 1 }),
  H(3, 'SYNTHETIC: macro wire', [], { delayed: true })]

function mount(opts = {}, onOptsChange = vi.fn()) {
  const utils = render(<TradeExchangeNewsWidget color="A" opts={opts} onOptsChange={onOptsChange} />)
  act(() => feed.set({ status: 'live', items: HISTORY, lastSeq: 3, lastHeadlineAt: NOW }))
  return { ...utils, onOptsChange }
}
const rows = (c) => [...c.querySelectorAll('[data-seq]')].map((r) => Number(r.dataset.seq))

let heightSpy
beforeEach(() => {
  feed.reset()
  setGroupSym.mockReset()
  sound.play.mockReset(); sound.preview.mockReset()
  groupSyms = { A: 'NVDA' }
  // jsdom has no layout: give the list a height proportional to its rows.
  heightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function () { return this.querySelectorAll ? this.querySelectorAll('[data-seq]').length * 30 : 0 })
})
afterEach(() => heightSpy.mockRestore())

describe('TradeExchangeNewsWidget', () => {
  it('renders newest first with receipt time, repeat and delayed marks, and live status', () => {
    const { container } = mount()
    expect(rows(container)).toEqual([3, 2, 1])
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.getByText('×2')).toBeInTheDocument()
    expect(screen.getByText('delayed')).toBeInTheDocument()
    expect(screen.getAllByTitle(/Received by UCT .* Trade Exchange does not send a publication time/)).toHaveLength(3)
  })

  it('a ticker in a headline links the widget\'s colour group', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'AMD' }))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'AMD')
    expect(screen.getByRole('button', { name: '$NVDA' }).title).toMatch(/provisional/)
  })

  it('shows the server-derived category under each time, with the provider label in the tooltip', () => {
    render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', lastSeq: 2, lastHeadlineAt: NOW, items: [
      H(1, 'SYNTHETIC: ABC - Example Corp Reports Results', ['ABC'], { source: 'TX-PressRelease', category: 'Earnings' }),
      H(2, 'SYNTHETIC: an older row without a category', [])] }))
    const label = screen.getByText('Earnings')
    expect(label.title).toBe('Category (assigned by UCT) · Trade Exchange label: TX-PressRelease')
    expect(label.closest('[data-seq]').dataset.seq).toBe('1')
    expect(document.querySelectorAll('[title^="Category (assigned by UCT)"]')).toHaveLength(1)  // no blank label
  })

  it('the category label can be switched off per widget', () => {
    render(<TradeExchangeNewsWidget color="A" opts={{ settings: { showCategory: 'off' } }} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', lastSeq: 1, lastHeadlineAt: NOW,
      items: [H(1, 'SYNTHETIC: macro', [], { category: 'Macro' })] }))
    expect(screen.queryByText('Macro')).toBeNull()
  })

  it('the header brands the widget and holds, in order, LIVE -> Saved Headlines -> Settings; no pause, no alerts bell', () => {
    const { container } = mount()
    expect(screen.getByText('UCT News')).toBeInTheDocument()
    expect(screen.getByText('Powered by Trade Exchange')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
    const bar = container.querySelector('[class*="_bar_"]')
    const order = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim())
    expect(order).toEqual(['Live', 'Show saved headlines', 'News widget settings'])
    expect(screen.queryByLabelText(/auto-follow/)).toBeNull()
    expect(screen.queryByLabelText('News alerts')).toBeNull()
  })

  it('the toolbar is Search... | Filters | All Lists', () => {
    const { container } = mount()
    const bar = container.querySelector('[class*="searchBar"]')
    expect(screen.getByLabelText('Search headlines')).toHaveAttribute('placeholder', 'Search...')
    const controls = [...bar.querySelectorAll('input, button, select')].map((e) => e.getAttribute('aria-label'))
    expect(controls).toEqual(['Search headlines', expect.stringMatching(/^News filters/), 'Filter by watchlist'])
    expect(screen.getByRole('option', { name: 'All Lists' })).toBeInTheDocument()
  })

  it('tickers take the theme up/down colour from the daily change, neutral when missing or stale', () => {
    quotes.prices = { NVDA: { price: 100, change_pct: 2.1 }, AMD: { price: 50, change_pct: -1.3 } }
    quotes.stale = new Set()
    const { rerender } = mount()
    const sym = (s) => screen.getAllByRole('button', { name: new RegExp(`^\\$?${s}$`) })[0]
    expect(sym('NVDA').className).toMatch(/symUp/)
    expect(sym('AMD').className).toMatch(/symDown/)
    expect(sym('NVDA').title).toMatch(/\$100\.00 · \+2\.10% vs prior close/)
    // crossing zero re-colours on the next quote
    quotes.prices = { NVDA: { price: 98, change_pct: -0.4 }, AMD: { price: 50, change_pct: 0 } }
    rerender(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    expect(sym('NVDA').className).toMatch(/symDown/)
    expect(sym('AMD').className).toMatch(/symFlat/)
    quotes.stale = new Set(['NVDA'])
    rerender(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    expect(sym('NVDA').className).toMatch(/symNone/)
    expect(sym('NVDA').title).not.toMatch(/\$/)
    expect(quotes.asked).toEqual(['AMD', 'NVDA'])                 // newest rows first, distinct
  })

  it('ticker colour mode accent/neutral with % change off needs no quotes at all', () => {
    quotes.asked = null
    render(<TradeExchangeNewsWidget color="A" opts={{ settings: { tickerColorMode: 'neutral', showPct: 'off' } }} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: HISTORY, lastSeq: 3, lastHeadlineAt: NOW }))
    expect(quotes.asked).toEqual([])
    expect(screen.getAllByRole('button', { name: /NVDA/ })[0].className).toMatch(/symNeutral/)
  })

  it('a company NAME links its symbol without rewriting the headline', () => {
    render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', lastSeq: 1, lastHeadlineAt: NOW, items: [
      H(1, 'MICROSOFT EXPECTS TO RAISE ABOUT $25 BILLION', ['MSFT'], { mentions: [['MICROSOFT', 'MSFT']] })] }))
    const btn = screen.getByRole('button', { name: 'MICROSOFT' })
    expect(btn.title).toMatch(/^MSFT \(named in the headline\)/)
    fireEvent.click(btn)
    expect(setGroupSym).toHaveBeenCalledWith('A', 'MSFT')
    expect(document.querySelector('[data-seq="1"]').textContent).toContain('MICROSOFT EXPECTS TO RAISE ABOUT $25 BILLION')
  })

  it('clicking a ticker links the chart but never leaves a highlighted row', () => {
    const { container } = mount()
    fireEvent.click(screen.getAllByRole('button', { name: /NVDA/ })[0])
    expect(setGroupSym).toHaveBeenCalledWith('A', 'NVDA')
    for (const row of container.querySelectorAll('[data-seq]')) expect(row.className).not.toMatch(/Selected/)
    expect(container.querySelector('[class*="flash"]')).toBeNull()
  })

  it('graphic-only posts (CRYPTO, "SPY Daily Weekly") are hidden, counted in the LIVE popover, and can be shown', async () => {
    const items = [...HISTORY, H(4, 'CRYPTO', [], { placeholder: 'graphic' }),
      H(5, 'SPY Daily Weekly', [], { placeholder: 'graphic' })]
    const { unmount } = render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items, lastSeq: 5, lastHeadlineAt: NOW }))
    expect(document.querySelector('[data-seq="4"]')).toBeNull()
    expect(document.querySelector('[data-seq="5"]')).toBeNull()
    expect(screen.queryByText(/graphic-only hidden/)).toBeNull()                 // never in the footer
    fireEvent.click(screen.getByTitle(/Click for feed health/))
    const health = await screen.findByRole('dialog', { name: 'Feed health' })
    expect(health.querySelector('[data-key="graphic"]').textContent).toMatch(/2 hidden/)
    unmount()
    render(<TradeExchangeNewsWidget color="A" opts={{ settings: { graphicPlaceholders: 'show' } }} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items, lastSeq: 5, lastHeadlineAt: NOW }))
    expect(document.querySelector('[data-seq="4"]')).not.toBeNull()
    expect(document.querySelector('[data-seq="5"]')).not.toBeNull()
  })

  it('the footer holds only the date and time controls; the count and notes are in the LIVE popover', async () => {
    const { container } = mount()
    const footer = container.querySelector('[class*="footer"]')
    expect(footer.querySelector('nav[aria-label="Date"]')).not.toBeNull()
    expect(within(footer).getByRole('button', { name: 'Previous day' })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: /Choose a date/ })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Next day' })).toBeInTheDocument()
    expect(within(footer).getByRole('button', { name: 'Jump to Time' })).toBeInTheDocument()
    expect(footer.textContent).not.toMatch(/headline|received times|provisional|graphic-only/)
    fireEvent.click(screen.getByTitle(/Click for feed health/))
    const health = await screen.findByRole('dialog', { name: 'Feed health' })
    expect(health.querySelector('[data-key="view"]').textContent).toMatch(/headline/)
    expect(health.querySelector('[data-key="times"]').textContent).toMatch(/received each headline, in ET/)
  })

  it('the new-headline highlight lasts 2.1 s (1.5 s hold + fade) and never fires for history pages or old replays', () => {
    vi.useFakeTimers({ now: NOW })
    const { container } = mount()
    act(() => feed.set({ items: [H(0, 'SYNTHETIC: older page', [], { received_at_ms: NOW - 3_600_000 }), ...HISTORY], firstSeq: 0 }))
    expect(container.querySelector('[class*="flash"]')).toBeNull()             // loadOlder: not new
    act(() => feed.set({ items: [...HISTORY, H(4, 'SYNTHETIC: replayed', [], { received_at_ms: NOW - 600_000 })], lastSeq: 4 }))
    expect(container.querySelector('[class*="flash"]')).toBeNull()             // reconnect replay: not new
    act(() => feed.set({ items: [...HISTORY, H(5, 'SYNTHETIC: breaking', [], { received_at_ms: Date.now() })], lastSeq: 5 }))
    expect(container.querySelector('[data-seq="5"] [class*="flash"]')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(container.querySelector('[data-seq="5"] [class*="flash"]')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(150) })
    expect(container.querySelector('[data-seq="5"] [class*="flash"]')).toBeNull()
    vi.useRealTimers()
  })

  it('search narrows the feed (debounced)', async () => {
    const { container } = mount()
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: 'guidance' } })
    await waitFor(() => expect(rows(container)).toEqual([2]))
    fireEvent.click(screen.getByLabelText('Clear search'))
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
  })

  it('the linked-symbol and watchlist filters persist in opts and filter the feed', () => {
    const { container, onOptsChange } = mount()
    fireEvent.click(screen.getByRole('button', { name: /^News filters/ }))
    const menu = screen.getByRole('dialog', { name: 'News filters' })
    expect(within(menu).getByRole('button', { name: 'All headlines' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(menu).getByRole('button', { name: /Linked to chart/ }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ linked: true }))
    fireEvent.change(screen.getByLabelText('Filter by watchlist'), { target: { value: 'pre1' } })
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ watchlistId: 'pre1' }))
    expect(screen.getByRole('option', { name: 'UCT · S&P 500' })).toBeInTheDocument()   // prebuilt offered
    container.remove()
    const linked = render(<TradeExchangeNewsWidget color="A" opts={{ linked: true }} onOptsChange={vi.fn()} />)
    act(() => feed.set({ items: HISTORY }))
    expect(rows(linked.container)).toEqual([1])
    linked.unmount()
    const listed = render(<TradeExchangeNewsWidget color="A" opts={{ watchlistId: 'wl1' }} onOptsChange={vi.fn()} />)
    act(() => feed.set({ items: HISTORY }))
    expect(rows(listed.container)).toEqual([2])
  })

  it('history never flashes or chimes; a live headline flashes, and is silent while sound is off', () => {
    const { container } = mount()
    expect(container.querySelector('[class*="flash"]')).toBeNull()
    act(() => feed.set({ items: [...HISTORY, H(4, 'SYNTHETIC: new one')], lastSeq: 4 }))
    expect(container.querySelector('[data-seq="4"] [class*="flash"]')).not.toBeNull()
    expect(sound.play).not.toHaveBeenCalled()                     // muted by default
  })

  it('with sound on, one headline chimes once even with two News widgets open', () => {
    const settings = { sound: 'on', soundKey: 'chime' }
    render(<><TradeExchangeNewsWidget color="A" opts={{ settings }} onOptsChange={vi.fn()} />
      <TradeExchangeNewsWidget color="B" opts={{ settings }} onOptsChange={vi.fn()} /></>)
    act(() => feed.set({ status: 'live', items: HISTORY, lastSeq: 3 }))
    expect(sound.play).not.toHaveBeenCalled()
    act(() => feed.set({ items: [...HISTORY, H(4, 'SYNTHETIC: chime me')], lastSeq: 4 }))
    expect(sound.play).toHaveBeenCalledTimes(1)
    expect(sound.play).toHaveBeenCalledWith('chime')
  })

  it('a recovered (delayed) headline is shown but never announced', () => {
    render(<TradeExchangeNewsWidget color="A" opts={{ settings: { sound: 'on' } }} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: HISTORY, lastSeq: 3 }))
    act(() => feed.set({ items: [...HISTORY, H(4, 'SYNTHETIC: late', [], { delayed: true })], lastSeq: 4 }))
    expect(sound.play).not.toHaveBeenCalled()
  })

  it('auto-follow off holds the reader\'s place and offers Jump to live', () => {
    const { onOptsChange } = mount({ follow: false })
    act(() => feed.set({ items: [...HISTORY, H(4, 'SYNTHETIC: arrives while reading')], lastSeq: 4 }))
    const jump = screen.getByRole('button', { name: /Jump to live · 1 new/ })
    fireEvent.click(jump)
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ follow: true }))
  })

  it('density and sound settings persist per widget through the shared settings panel', () => {
    const { onOptsChange, container } = mount()
    fireEvent.click(screen.getByLabelText('News widget settings'))
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ density: 'compact', sound: 'off' }) }))
    const on = screen.getAllByRole('button', { name: 'On' })
    fireEvent.click(on[on.length - 1])                            // Sound: On
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ sound: 'on' }) }))
    expect(sound.preview).toHaveBeenCalled()
    container.remove()
    const c = render(<TradeExchangeNewsWidget color="A" opts={{ settings: { density: 'compact' } }} onOptsChange={vi.fn()} />)
    expect(c.container.firstChild.className).toMatch(/compact/)
  })

  it('a customised canvas is applied as CSS variables on the widget root', () => {
    const c = render(<TradeExchangeNewsWidget color="A" opts={{ settings: { bg: '#203040', textColor: '#ffffff' } }} onOptsChange={vi.fn()} />)
    const style = c.container.firstChild.style
    expect(style.getPropertyValue('--txn-bg')).toBe('#203040')
    expect(style.getPropertyValue('--txn-text')).toBe('#ffffff')
  })

  it('explains an admin-only refusal and a coverage gap instead of showing an empty feed', () => {
    render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'unavailable', reason: 'admin_only', items: [] }))
    expect(screen.getByText('Admin preview')).toBeInTheDocument()
    expect(screen.getByText(/admin preview and not yet available/)).toBeInTheDocument()
    act(() => feed.set({ status: 'live', items: HISTORY, coverage: { gaps: [{ from_ms: NOW - 7200000, to_ms: NOW - 3600000, reason: 'outage_exceeded_retention' }] } }))
    expect(screen.getByText(/Headlines may be missing between/)).toBeInTheDocument()
  })

  it('unmounting releases its subscription to the shared pool', () => {
    const { unmount } = mount()
    expect(feed.listeners.size).toBe(1)
    unmount()
    expect(feed.listeners.size).toBe(0)
  })
})

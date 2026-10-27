// The News widget (Trade Exchange): rendering, ticker links, search + filters,
// auto-follow / Jump to live, highlight, sound (muted by default, once per headline
// across widgets), settings persistence, error states. The shared pool is mocked
// so the test drives the feed directly. Synthetic headlines only.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  const claimed = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    listeners, claimed,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { listeners.clear(); claimed.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
  }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', () => ({
  subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
  getSnapshot: () => feed.get(),
  retry: vi.fn(),
  loadOlder: vi.fn(),
  claimAnnouncement: (seq) => (feed.claimed.has(seq) ? false : (feed.claimed.add(seq), true)),
}))
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

  it('search narrows the feed (debounced)', async () => {
    const { container } = mount()
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: 'guidance' } })
    await waitFor(() => expect(rows(container)).toEqual([2]))
    fireEvent.click(screen.getByLabelText('Clear search'))
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
  })

  it('the linked-symbol and watchlist filters persist in opts and filter the feed', () => {
    const { container, onOptsChange } = mount()
    fireEvent.click(screen.getByLabelText('Show only the linked symbol'))
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

  it('auto-follow toggle persists per widget', () => {
    const { onOptsChange } = mount()
    fireEvent.click(screen.getByLabelText('Turn auto-follow off'))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ follow: false }))
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

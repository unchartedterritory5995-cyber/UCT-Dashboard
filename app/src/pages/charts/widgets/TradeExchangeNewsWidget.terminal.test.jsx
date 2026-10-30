// News terminal upgrade — the widget: long-headline collapse, category filter,
// plain tickers (no inline %), one-click copy, ⋯ = add to watchlist only, impact
// marks, related groups, feed health, presets, numbered pages of the archive (live
// page 1, stable snapshots behind it), several widgets at once, and re-render
// economy on a quote tick. The shared pool and the page server are faked
// (fakeNewsPages); synthetic only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    archive: null, pageCalls: [],
    listeners,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { this.archive = null; this.pageCalls = []; listeners.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
  }
})
vi.mock('../../../lib/tradeExchangeNewsStreamManager', async () => {
  const { fakeNewsPage } = await import('../../../testing/tradeExchangeNews/fakeNewsPages')
  return {
  subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
  getSnapshot: () => feed.get(),
  retry: vi.fn(),
  // The server's pages over the synthetic archive (the pool's rows unless a test sets one).
  fetchPage: async (body) => { feed.pageCalls.push(body); return fakeNewsPage(feed.archive || feed.get().items, body) },
  claimAnnouncement: () => true,
}
})
const setGroupSym = vi.fn()
vi.mock('../WorkspaceContext', () => ({
  useWorkspace: () => ({ groupSyms: { A: 'NVDA' }, setGroupSym, applyThemeToAllWidgets: vi.fn() }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: vi.fn() }), parsePref: (_v, d) => d }))
vi.mock('../../../utils/alertSound', async (orig) => ({ ...(await orig()), playAlertSound: vi.fn(), previewSound: vi.fn() }))
const server = vi.hoisted(() => ({ alerts: 'off' }))
vi.mock('swr', () => ({
  default: (key) => ({
    data: !key ? undefined
      : String(key).includes('/api/alerts/taxonomy/news-match') ? server.alerts
        : String(key).includes('/api/watchlists/prebuilt') ? [{ id: 'pre1', name: 'S&P 500' }]
          : String(key).includes('/api/watchlists') ? [{ id: 'wl1', name: 'Mine' }, { id: 'pre9', name: 'UCT List', is_prebuilt: true }] : undefined,
    mutate: vi.fn(),
  }),
}))
vi.mock('../../watchlist/prebuiltDirectory', () => ({
  PICKER_MY_LISTS_URL: '/api/watchlists?include_items=0&include_prebuilt=0',
  PREBUILT_DIRECTORY_URL: '/api/watchlists/prebuilt?include_items=0',
  usePrebuiltMembership: () => ({}),
}))
const quotes = vi.hoisted(() => ({ prices: {}, stale: new Set() }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: quotes.prices, staleSymbols: quotes.stale, isLoading: false, isStreaming: true }),
}))
const spy = vi.hoisted(() => ({ tokenize: new Map() }))
vi.mock('./tradeExchangeNewsModel', async (orig) => {
  const real = await orig()
  return { ...real, tokenize: (content, ...rest) => { spy.tokenize.set(content, (spy.tokenize.get(content) || 0) + 1); return real.tokenize(content, ...rest) } }
})

import TradeExchangeNewsWidget from './TradeExchangeNewsWidget'

// The setup's ResizeObserver is inert; the clamp check needs one that reports each
// element once when observed (as a browser does after its next layout).
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb }
  observe(el) { this.cb([{ target: el }]) }
  unobserve() {}
  disconnect() {}
}

const NOW = Date.now()
const LONG = `SYNTHETIC: NVDA ${'a long multi-paragraph wire article that keeps going '.repeat(12)}the end`
const H = (seq, content, tickers = [], extra = {}) => ({ type: 'headline', epoch: 'e', seq, id: `id${seq}`,
  source: 'TX-News', content, tickers, category: 'News', received_at_ms: NOW - (50 - seq) * 1000,
  repeat_count: 0, via: 'push', delayed: false, ...extra })
const BASE = [
  H(1, 'SYNTHETIC: AMD guidance raised', ['AMD'], { category: 'Earnings' }),
  H(2, 'SYNTHETIC: Fed minutes due', [], { category: 'Macro' }),
  H(3, 'SYNTHETIC: NVDA and AMD rally while NVDA leads', ['NVDA', 'AMD']),
]

function mount(opts = {}, items = BASE, onOptsChange = vi.fn()) {
  const utils = render(<TradeExchangeNewsWidget color="A" opts={opts} onOptsChange={onOptsChange} />)
  act(() => feed.set({ status: 'live', items, lastSeq: items.length, replayUntil: items.length, lastHeadlineAt: NOW }))
  return { ...utils, onOptsChange }
}
const rows = (c) => [...c.querySelectorAll('[data-seq]')].map((r) => Number(r.dataset.seq))
const rowEl = (c, seq) => c.querySelector(`[data-seq="${seq}"]`)

let heightSpy
beforeEach(() => {
  feed.reset()
  setGroupSym.mockReset()
  quotes.prices = {}
  quotes.stale = new Set()
  server.alerts = 'off'
  spy.tokenize.clear()
  // jsdom has no layout: a long headline is taller than its clamp, a short one is not.
  heightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function () {
    if (this.querySelectorAll && this.querySelectorAll('[data-seq]').length) return this.querySelectorAll('[data-seq]').length * 30
    return (this.textContent || '').length > 200 ? 400 : 16
  })
})
let clientSpy
beforeEach(() => {
  // a clamped headline shows 3 lines (48 px); its content may be taller
  clientSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function () { return /clamped/.test(this.className || '') ? 48 : 0 })
})
afterEach(() => { heightSpy.mockRestore(); clientSpy.mockRestore(); vi.unstubAllGlobals() })

describe('long headlines', () => {
  it('collapse after 3 lines with Show more / Show less; short ones are unchanged', () => {
    const { container } = mount({}, [...BASE, H(4, LONG, ['NVDA'])])
    const head = rowEl(container, 4).querySelector('[class*="headline"]')
    expect(head.className).toMatch(/clamped/)
    expect(head.style.webkitLineClamp || head.style.WebkitLineClamp).toBe('3')
    expect(within(rowEl(container, 3)).queryByText('Show more')).toBeNull()
    fireEvent.click(within(rowEl(container, 4)).getByText('Show more'))
    expect(rowEl(container, 4).querySelector('[class*="headline"]').className).not.toMatch(/clamped/)
    expect(setGroupSym).not.toHaveBeenCalled()                       // expanding is not a ticker click
    // the ticker link works in both states, and the text is never truncated
    expect(rowEl(container, 4).textContent).toContain('the end')
    fireEvent.click(within(rowEl(container, 4)).getByRole('button', { name: 'NVDA' }))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'NVDA')
    fireEvent.click(within(rowEl(container, 4)).getByText('Show less'))
    expect(rowEl(container, 4).querySelector('[class*="headline"]').className).toMatch(/clamped/)
  })

  it('an expanded headline stays expanded while new headlines arrive', () => {
    const items = [...BASE, H(4, LONG)]
    const { container } = mount({}, items)
    fireEvent.click(within(rowEl(container, 4)).getByText('Show more'))
    act(() => feed.set({ items: [...items, H(5, 'SYNTHETIC: new one')], lastSeq: 5 }))
    expect(rows(container)[0]).toBe(5)
    expect(within(rowEl(container, 4)).getByText('Show less')).toBeTruthy()
  })

  it('5 lines, or always expanded, per widget', () => {
    const { container, unmount } = mount({ settings: { longHeadlines: '5' } }, [H(4, LONG)])
    expect(rowEl(container, 4).querySelector('[class*="headline"]').style.webkitLineClamp).toBe('5')
    unmount()
    const r2 = mount({ settings: { longHeadlines: 'all' } }, [H(4, LONG)])
    expect(rowEl(r2.container, 4).querySelector('[class*="headline"]').className).not.toMatch(/clamped/)
    expect(within(rowEl(r2.container, 4)).queryByText('Show more')).toBeNull()
  })
})

describe('category filter', () => {
  it('filters instantly, persists per widget, and combines with the linked filter', async () => {
    const { container, onOptsChange } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Categories: All/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filters and presets' })).getByRole('button', { name: 'Earnings' }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ['Earnings'] }))
    const r2 = mount({ categories: ['Earnings', 'News'] })
    expect(rows(r2.container)).toEqual([3, 1])
    const r3 = mount({ categories: ['Earnings'], linked: true })              // linked = NVDA: AND
    expect(rows(r3.container)).toEqual([])
    expect(await within(r3.container).findByText('No headlines match these filters.')).toBeTruthy()
    expect(container).toBeTruthy()
  })

  it('the empty state offers Clear filters', async () => {
    const onOptsChange = vi.fn()
    const { container } = mount({ categories: ['Filing'] }, BASE, onOptsChange)
    fireEvent.click(await within(container).findByRole('button', { name: 'Clear filters' }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ categories: [], linked: false, watchlistId: null }))
  })
})

describe('tickers without inline % change', () => {
  it('shows no % beside a ticker; links, up/down colours and the price tooltip stay', () => {
    quotes.prices = { NVDA: { price: 100, change_pct: 2.43 }, AMD: { price: 50, change_pct: -1.06 } }
    const { container } = mount()
    const r = rowEl(container, 3)
    expect(r.textContent).not.toMatch(/%/)
    expect(r.querySelector('[class*="pct"]')).toBeNull()
    const [nvda] = within(r).getAllByRole('button', { name: 'NVDA' })
    expect(nvda.className).toMatch(/symUp/)
    expect(within(r).getByRole('button', { name: 'AMD' }).className).toMatch(/symDown/)
    expect(nvda.title).toMatch(/\$100\.00 · \+2\.43% vs prior close/)
    fireEvent.click(nvda)
    expect(setGroupSym).toHaveBeenCalledWith('A', 'NVDA')
  })

  it('the retired % setting is gone from ⚙ and ignored in saved settings', () => {
    quotes.prices = { NVDA: { price: 100, change_pct: 2.43 } }
    const { container } = mount({ settings: { showPct: 'on' } })
    expect(container.textContent).not.toMatch(/\+2\.4%/)
    fireEvent.click(screen.getByRole('button', { name: 'News widget settings' }))
    expect(screen.queryByText('Ticker % change')).toBeNull()
  })
})

describe('one-click copy', () => {
  const copyBtn = (container, seq) => within(rowEl(container, seq)).getByRole('button', { name: 'Copy headline' })

  it('copies the whole original text, also of a collapsed headline, and confirms with a check', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const odd = `SYNTHETIC: "Q3" — $NVDA (+4.6%) & AMD's * note… ${LONG}`
    const { container } = mount({}, [...BASE, H(4, odd, ['NVDA'])])
    expect(rowEl(container, 4).querySelector('[class*="headline"]').className).toMatch(/clamped/)
    fireEvent.click(copyBtn(container, 4))
    expect(writeText).toHaveBeenCalledWith(odd)                           // exact, untruncated
    expect(await within(rowEl(container, 4)).findByRole('status')).toHaveTextContent('Headline copied')
    expect(within(rowEl(container, 4)).getByRole('button', { name: 'Headline copied' })).toBeTruthy()
    // copying is not a ticker click, an expansion, or a menu
    expect(setGroupSym).not.toHaveBeenCalled()
    expect(rowEl(container, 4).querySelector('[class*="headline"]').className).toMatch(/clamped/)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('sits to the left of ⋯ and is there on rows without a ticker too', () => {
    const { container } = mount()
    const btns = [...rowEl(container, 3).querySelectorAll('[class*="rowActions"] button')].map((b) => b.getAttribute('aria-label'))
    expect(btns).toEqual(['Copy headline', 'Add a symbol to a watchlist'])
    expect([...rowEl(container, 2).querySelectorAll('[class*="rowActions"] button')].map((b) => b.getAttribute('aria-label')))
      .toEqual(['Copy headline'])                                          // no ticker: no ⋯
  })

  it('a blocked clipboard says so instead of failing silently', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true })
    document.execCommand = vi.fn(() => false)
    const { container } = mount()
    fireEvent.click(copyBtn(container, 2))
    expect(await within(rowEl(container, 2)).findByRole('status')).toHaveTextContent(/Copy failed/)
  })

  it('falls back to the legacy copy command when the async clipboard is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    document.execCommand = vi.fn(() => true)
    const { container } = mount()
    fireEvent.click(copyBtn(container, 2))
    expect(await within(rowEl(container, 2)).findByRole('status')).toHaveTextContent('Headline copied')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })
})

describe('⋯ = add to watchlist', () => {
  const openMenu = (container, seq) => {
    fireEvent.click(within(rowEl(container, seq)).getByRole('button', { name: 'Add a symbol to a watchlist' }))
    return screen.getByRole('menu', { name: 'Add to watchlist' })
  }

  it('holds only the watchlist action: no Open chart, Copy or news alert, even with alerts on', () => {
    server.alerts = 'on'
    const { container } = mount()
    const menu = openMenu(container, 3)
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent.trim())).toEqual(['Mine'])
    expect(within(menu).queryByText(/Open .* chart/)).toBeNull()
    expect(within(menu).queryByText(/Copy/)).toBeNull()
    expect(within(menu).queryByText(/alert/i)).toBeNull()
    expect(within(menu).queryByText('UCT List')).toBeNull()               // personal lists only
  })

  it('several securities let you choose, and the server answer is the result', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'x' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ duplicate: true }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Watchlist not found' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = mount()
    const menu = openMenu(container, 3)
    expect(within(menu).getByText('Add NVDA to watchlist')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('button', { name: 'AMD', pressed: false }))
    expect(within(menu).getByText('Add AMD to watchlist')).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(within(menu).getByRole('status').textContent).toBe('Added AMD to Mine'))
    expect(fetchMock).toHaveBeenCalledWith('/api/watchlists/wl1/items', expect.objectContaining({ method: 'POST', body: JSON.stringify({ sym: 'AMD', notes: '' }) }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(within(menu).getByRole('status').textContent).toBe('AMD is already on Mine'))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(within(menu).getByRole('status').textContent).toBe('Watchlist not found'))
    expect(setGroupSym).not.toHaveBeenCalled()
  })

  it('is keyboard reachable: focus lands on a list, Escape returns focus to ⋯', () => {
    const { container } = mount()
    const btn = within(rowEl(container, 1)).getByRole('button', { name: 'Add a symbol to a watchlist' })
    btn.focus()
    fireEvent.click(btn)
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0])
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(btn)
  })
})

describe('impact marks and grouping', () => {
  it('a fresh marked headline reads Breaking, with the criteria in its tooltip; the setting turns it off', () => {
    const items = [...BASE, H(4, 'SYNTHETIC: ACME HALTED', ['ACME'], { impact: 'halt', received_at_ms: NOW - 10_000 })]
    const { container, unmount } = mount({}, items)
    const mark = within(rowEl(container, 4)).getByText('Breaking')
    expect(mark.title).toMatch(/^Trading halt or resumption\. Marked only when/)
    expect(container.querySelectorAll('[class*="impact"]')).toHaveLength(1)    // only the marked row
    unmount()
    const r2 = mount({ settings: { impactMarks: 'off' } }, items)
    expect(within(r2.container).queryByText('Breaking')).toBeNull()
  })

  it('groups the same story re-sent, keeps every copy, and expands to show them', () => {
    const story = 'SYNTHETIC: Example Corp agrees to sell its cloud unit to Sample Holdings for $2 billion'
    const items = [...BASE, H(4, story, ['EXMP']), H(5, `EXMP - ${story}`, ['EXMP'], { source: 'TX-PressRelease' })]
    const { container } = mount({ settings: { groupRelated: 'on' } }, items)
    expect(rows(container)).toEqual([5, 3, 2, 1])
    fireEvent.click(within(rowEl(container, 5)).getByRole('button', { name: '+1 related' }))
    expect(rows(container)).toEqual([5, 4, 3, 2, 1])
    expect(rowEl(container, 4).className).toMatch(/related/)
    const off = mount({}, items)
    expect(rows(off.container)).toEqual([5, 4, 3, 2, 1])                     // off by default
  })
})

describe('feed health', () => {
  it('opens from LIVE, separates connection from provider, closes on Escape', () => {
    mount({}, BASE)
    act(() => feed.set({ lastLatencyMs: 900, lastLatencyAt: NOW }))
    fireEvent.click(screen.getByRole('button', { name: /Live/ }))
    const dlg = screen.getByRole('dialog', { name: 'Feed health' })
    expect(within(dlg).getByText(/Connected/)).toBeTruthy()
    expect(within(dlg).getByText(/does not mean Trade Exchange is publishing/)).toBeTruthy()
    expect(within(dlg).getByText(/0\.9 s from UCT receipt/)).toBeTruthy()
    expect(within(dlg).getByText('Caught up')).toBeTruthy()
    fireEvent.keyDown(dlg, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Feed health' })).toBeNull()
  })
})

describe('presets', () => {
  it('save, apply, rename and delete — in this widget\'s opts only', () => {
    const onOptsChange = vi.fn()
    const opts = { categories: ['Macro'], settings: { longHeadlines: '5' } }
    mount(opts, BASE, onOptsChange)
    fireEvent.click(screen.getByRole('button', { name: /Categories: Macro/ }))
    const dlg = screen.getByRole('dialog', { name: 'Filters and presets' })
    fireEvent.change(within(dlg).getByLabelText('New preset name'), { target: { value: 'Macro only' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    const saved = onOptsChange.mock.lastCall[0]
    expect(saved.presets).toHaveLength(1)
    expect(saved.presets[0]).toMatchObject({ name: 'Macro only', categories: ['Macro'], settings: { longHeadlines: '5' } })
    expect(saved.presetId).toBe(saved.presets[0].id)
    expect(Object.keys(saved).sort()).toEqual(['categories', 'presetId', 'presets', 'settings'])

    onOptsChange.mockClear()
    const p = { ...saved.presets[0] }
    const r2 = mount({ presets: [p], categories: [] }, BASE, onOptsChange)
    fireEvent.click(within(r2.container).getByRole('button', { name: /Categories: All/ }))
    const d2 = screen.getAllByRole('dialog', { name: 'Filters and presets' }).at(-1)
    fireEvent.click(within(d2).getByRole('button', { name: 'Macro only' }))
    expect(onOptsChange.mock.lastCall[0]).toMatchObject({ categories: ['Macro'], presetId: p.id })
    fireEvent.click(within(d2).getByRole('button', { name: 'Rename preset Macro only' }))
    fireEvent.change(within(d2).getByLabelText('Preset name'), { target: { value: 'Fed watch' } })
    fireEvent.submit(within(d2).getByLabelText('Preset name'))
    expect(onOptsChange.mock.lastCall[0].presets[0].name).toBe('Fed watch')
    fireEvent.click(within(d2).getByRole('button', { name: /Delete preset/ }))
    expect(onOptsChange.mock.lastCall[0].presets).toEqual([])
    expect(setGroupSym).not.toHaveBeenCalled()                               // never a chart symbol
  })
})

describe('several widgets and large histories', () => {
  it('two News widgets keep their own filters and display settings', () => {
    render(<>
      <TradeExchangeNewsWidget color="A" opts={{ categories: ['Macro'] }} onOptsChange={vi.fn()} />
      <TradeExchangeNewsWidget color="A" opts={{ categories: ['Earnings'], settings: { density: 'compact' } }} onOptsChange={vi.fn()} />
    </>)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    const lists = [...document.querySelectorAll('[class*="_list_"]')]
    expect(lists.map((l) => [...l.querySelectorAll('[data-seq]')].map((r) => Number(r.dataset.seq)))).toEqual([[2], [1]])
  })

  it('a quote tick re-renders only the rows naming that symbol (1,000 pooled, one page shown)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => H(i + 1, `SYNTHETIC: row ${i + 1} about ${i % 2 ? 'NVDA' : 'AMD'}`, [i % 2 ? 'NVDA' : 'AMD']))
    quotes.prices = { NVDA: { price: 100, change_pct: 1 }, AMD: { price: 50, change_pct: 1 } }
    const { container } = mount({}, items)
    expect(rows(container)).toHaveLength(25)                              // one page, not the pool
    spy.tokenize.clear()
    quotes.prices = { ...quotes.prices, AMD: { price: 51, change_pct: 3 } }
    const t0 = performance.now()
    act(() => feed.set({ lastEventAt: NOW + 5 }))
    const ms = performance.now() - t0
    const rerendered = [...spy.tokenize.keys()]
    expect(rerendered.length).toBe(rows(container).filter((seq) => seq % 2 === 1).length)   // odd seq = AMD
    expect(rerendered.every((c) => c.endsWith('AMD'))).toBe(true)
    expect(ms).toBeLessThan(3000)
  })
})

describe('numbered pages', () => {
  // An archive larger than the pool: the pool holds the newest 200, the server 5,000.
  const ARCH = Array.from({ length: 5000 }, (_, i) => H(i + 1, `SYNTHETIC: archive row ${i + 1}${i % 10 === 0 ? ' about AMD' : ''}`,
    i % 10 === 0 ? ['AMD'] : [], { category: i % 4 === 0 ? 'Macro' : 'News', received_at_ms: NOW - (5000 - i) * 60_000 }))
  const pool = () => ARCH.slice(-200)
  const mountArchive = (opts = {}) => {
    feed.archive = ARCH
    const utils = render(<TradeExchangeNewsWidget color="A" opts={opts} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: pool(), lastSeq: 5000, replayUntil: 5000, lastHeadlineAt: NOW }))
    return utils
  }
  const nav = () => screen.getByRole('navigation', { name: 'Headline pages' })
  const btn = (name) => within(nav()).getByRole('button', { name })
  const pageInput = () => within(nav()).getByRole('textbox', { name: /Page number/ })
  const waitRows = async (c, first) => waitFor(() => expect(rows(c)[0]).toBe(first))

  it('page 1 is the newest 25; the exact page count comes from the server', async () => {
    const { container } = mountArchive()
    expect(rows(container)).toHaveLength(25)
    expect(rows(container)[0]).toBe(5000)
    await waitFor(() => expect(within(nav()).getByText('/ 200')).toBeTruthy())
    expect(btn('First page (newest)')).toBeDisabled()
    expect(btn('Previous page (newer)')).toBeDisabled()
    expect(within(container).queryByText('Load older headlines')).toBeNull()
    expect(container.textContent).toMatch(/5,000 headlines/)
  })

  it('moves in both directions, and First / Last reach the ends', async () => {
    const { container } = mountArchive()
    await waitFor(() => expect(btn('Next page (older)')).not.toBeDisabled())
    fireEvent.click(btn('Next page (older)'))
    await waitRows(container, 4975)
    expect(pageInput().value).toBe('2')
    fireEvent.click(btn('Last page (oldest)'))
    await waitRows(container, 25)
    expect(rows(container).at(-1)).toBe(1)
    expect(btn('Next page (older)')).toBeDisabled()
    expect(btn('Last page (oldest)')).toBeDisabled()
    fireEvent.click(btn('Previous page (newer)'))
    await waitRows(container, 50)
    fireEvent.click(btn('First page (newest)'))
    await waitRows(container, 5000)
    expect(within(nav()).queryByRole('button', { name: 'Latest' })).toBeNull()
  })

  it('a typed page number jumps there; out-of-range or non-numeric input is refused', async () => {
    const { container } = mountArchive()
    await waitFor(() => expect(within(nav()).getByText('/ 200')).toBeTruthy())
    fireEvent.change(pageInput(), { target: { value: '137' } })
    fireEvent.keyDown(pageInput(), { key: 'Enter' })
    await waitRows(container, 5000 - 136 * 25)
    fireEvent.change(pageInput(), { target: { value: '201' } })
    fireEvent.keyDown(pageInput(), { key: 'Enter' })
    expect(pageInput().value).toBe('137')
    expect(pageInput().getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(pageInput(), { target: { value: '0' } })
    fireEvent.keyDown(pageInput(), { key: 'Enter' })
    expect(pageInput().value).toBe('137')
    fireEvent.change(pageInput(), { target: { value: '4x' } })            // letters are dropped as typed
    expect(pageInput().value).toBe('4')
    fireEvent.keyDown(pageInput(), { key: 'Escape' })
    expect(pageInput().value).toBe('137')
    expect(rows(container)[0]).toBe(5000 - 136 * 25)
  })

  it('pages the FILTERED archive, not the rows this browser holds', async () => {
    const { container } = mountArchive({ categories: ['Macro'] })
    // Macro = every 4th row: 1,250 in the archive, 50 in the pool
    await waitFor(() => expect(within(nav()).getByText('/ 50')).toBeTruthy())
    expect(container.textContent).toMatch(/1,250 of 5,000 headlines/)
    fireEvent.change(pageInput(), { target: { value: '50' } })
    fireEvent.keyDown(pageInput(), { key: 'Enter' })
    await waitRows(container, 97)
    expect(rows(container).at(-1)).toBe(1)
    const last = feed.pageCalls.at(-1)
    expect(last).toMatchObject({ categories: ['Macro'], page: 50, top: 5000, size: 25 })
  })

  it('a live headline never shifts an older page; it is counted and Return to latest brings it', async () => {
    const { container } = mountArchive()
    await waitFor(() => expect(btn('Next page (older)')).not.toBeDisabled())
    fireEvent.click(btn('Next page (older)'))
    await waitRows(container, 4975)
    const before = rows(container)
    const items = [...pool(), H(5001, 'SYNTHETIC: breaking while reading page 2', [], { received_at_ms: Date.now() })]
    ARCH.push(items.at(-1))
    act(() => feed.set({ items, lastSeq: 5001 }))
    expect(rows(container)).toEqual(before)                               // no insert, no shift
    expect(pageInput().value).toBe('2')                                   // not sent back to page 1
    fireEvent.click(btn('Next page (older)'))
    await waitRows(container, 4950)                                       // the snapshot still holds
    expect(feed.pageCalls.at(-1)).toMatchObject({ page: 3, top: 5000 })
    fireEvent.click(screen.getByRole('button', { name: /1 newer · Return to latest/ }))
    await waitRows(container, 5001)
    expect(pageInput().value).toBe('1')
    ARCH.pop()
  })

  it('stable boundaries: walking every page of a snapshot gives each row exactly once', async () => {
    feed.archive = ARCH.slice(0, 260)
    render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: feed.archive.slice(-200), lastSeq: 260, lastHeadlineAt: NOW }))
    await waitFor(() => expect(within(nav()).getByText('/ 11')).toBeTruthy())
    const seen = [...document.querySelectorAll('[data-seq]')].map((r) => Number(r.dataset.seq))
    for (let n = 2; n <= 11; n++) {
      fireEvent.click(btn('Next page (older)'))
      const want = 260 - (n - 1) * 25
      await waitFor(() => expect(Number(document.querySelector('[data-seq]').dataset.seq)).toBe(want))
      seen.push(...[...document.querySelectorAll('[data-seq]')].map((r) => Number(r.dataset.seq)))
    }
    expect(seen).toEqual(Array.from({ length: 260 }, (_, i) => 260 - i))
  })

  it('a filter change returns to page 1 and never resets the filters', async () => {
    const onOptsChange = vi.fn()
    feed.archive = ARCH
    const { container, rerender } = render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={onOptsChange} />)
    act(() => feed.set({ status: 'live', items: pool(), lastSeq: 5000, lastHeadlineAt: NOW }))
    await waitFor(() => expect(btn('Next page (older)')).not.toBeDisabled())
    fireEvent.click(btn('Next page (older)'))
    await waitRows(container, 4975)
    rerender(<TradeExchangeNewsWidget color="A" opts={{ categories: ['Macro'] }} onOptsChange={onOptsChange} />)
    await waitFor(() => expect(pageInput().value).toBe('1'))
    expect(onOptsChange).not.toHaveBeenCalled()
  })

  it('a recreated database (new epoch) returns to the live page; a reconnect keeps the reader\'s page', async () => {
    const { container } = mountArchive()
    await waitFor(() => expect(btn('Next page (older)')).not.toBeDisabled())
    fireEvent.click(btn('Next page (older)'))
    await waitRows(container, 4975)
    act(() => feed.set({ status: 'reconnecting' }))
    act(() => feed.set({ status: 'live' }))
    expect(pageInput().value).toBe('2')
    expect(screen.getByRole('button', { name: /Live/ })).toBeTruthy()      // LIVE stays honest on page 2
    act(() => feed.set({ epoch: 'e2' }))
    await waitFor(() => expect(pageInput().value).toBe('1'))
  })

  it('a page that fails to load says so and retries', async () => {
    const { container } = mountArchive()
    await waitFor(() => expect(btn('Next page (older)')).not.toBeDisabled())
    const real = feed.archive
    feed.archive = { filter: () => { throw new Error('HTTP 503') } }
    fireEvent.click(btn('Next page (older)'))
    fireEvent.click(await within(container).findByRole('button', { name: 'Retry' }))
    feed.archive = real
    await waitFor(() => expect(within(container).queryByText('This page could not be loaded.')).toBeNull())
  })

  it('several widgets page independently', async () => {
    feed.archive = ARCH
    render(<>
      <TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      <TradeExchangeNewsWidget color="A" opts={{ categories: ['Macro'] }} onOptsChange={vi.fn()} />
    </>)
    act(() => feed.set({ status: 'live', items: pool(), lastSeq: 5000, lastHeadlineAt: NOW }))
    const navs = () => screen.getAllByRole('navigation', { name: 'Headline pages' })
    await waitFor(() => expect(within(navs()[0]).getByRole('button', { name: 'Next page (older)' })).not.toBeDisabled())
    fireEvent.click(within(navs()[0]).getByRole('button', { name: 'Next page (older)' }))
    const lists = () => [...document.querySelectorAll('[class*="_list_"]')]
    await waitFor(() => expect(Number(lists()[0].querySelector('[data-seq]').dataset.seq)).toBe(4975))
    expect(Number(lists()[1].querySelector('[data-seq]').dataset.seq)).toBe(4997)   // still page 1 of Macro
    expect(within(navs()[1]).getByRole('textbox').value).toBe('1')
  })

  it('pager controls are labelled buttons and keyboard-operable', async () => {
    mountArchive()
    await waitFor(() => expect(btn('Next page (older)')).not.toBeDisabled())
    for (const name of ['First page (newest)', 'Previous page (newer)', 'Next page (older)', 'Last page (oldest)']) {
      expect(btn(name).tagName).toBe('BUTTON')
      expect(btn(name).title).toBe(name)
    }
    expect(pageInput().getAttribute('inputmode')).toBe('numeric')
    expect(pageInput().getAttribute('aria-label')).toBe('Page number, 1 to 200')
  })
})

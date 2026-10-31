// News terminal upgrade — the widget: long-headline collapse, category filter,
// plain tickers (no inline %), one-click copy, ⋯ = add to watchlist only, no
// impact labels, related groups, feed health, presets, one ET calendar day at a time
// (continuous scrolling, calendar, previous/next day, jump to time, live Today),
// several widgets at once, and re-render economy on a quote tick. The shared pool
// and the day server are faked (fakeNewsDay); synthetic only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const feed = vi.hoisted(() => {
  const listeners = new Set()
  let state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true }
  return {
    archive: null, dayCalls: [], dayOpts: null, daysOpts: null,
    listeners,
    get: () => state,
    set(next) { state = { ...state, ...next }; for (const fn of [...listeners]) fn(state) },
    reset() { this.archive = null; this.dayCalls = []; this.dayOpts = null; this.daysOpts = null; listeners.clear(); state = { status: 'idle', items: [], epoch: 'e', lastSeq: 0, firstSeq: 0, coverage: null, provisional: true } },
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
    expect(await within(r3.container).findByText(/^No headlines on .+ match these filters\.$/)).toBeTruthy()
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

describe('no impact labels, and grouping', () => {
  it('never shows Breaking or High impact, whatever the server marks, and offers no such setting', () => {
    const items = [...BASE, H(4, 'SYNTHETIC: ACME HALTED', ['ACME'], { impact: 'halt', received_at_ms: NOW - 10_000 }),
      H(5, 'SYNTHETIC: ACME TO ACQUIRE BETA', ['ACME'], { impact: 'mna', received_at_ms: NOW - 3_600_000 })]
    const { container } = mount({ settings: { impactMarks: 'on' } }, items)
    expect(container.textContent).not.toMatch(/Breaking|High impact/i)
    expect(container.querySelector('[class*="impact"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'News widget settings' }))
    expect(screen.queryByText('Impact marks')).toBeNull()
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

  it('a quote tick re-renders only the rows naming that symbol (1,000 pooled, the loaded part of the day shown)', async () => {
    const items = Array.from({ length: 1000 }, (_, i) => H(i + 1, `SYNTHETIC: row ${i + 1} about ${i % 2 ? 'NVDA' : 'AMD'}`, [i % 2 ? 'NVDA' : 'AMD']))
    quotes.prices = { NVDA: { price: 100, change_pct: 1 }, AMD: { price: 50, change_pct: 1 } }
    feed.archive = items                                                     // the server holds the day too
    const { container } = mount({}, items)
    await waitFor(() => expect(rows(container)).toHaveLength(60))         // the day's first step, not the pool
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

describe('one calendar day at a time', () => {
  // Late October 2026 is EDT (UTC-4): an ET wall time as an instant.
  const ET = (d, h, m = 0) => Date.UTC(2026, 9, d, h + 4, m)
  const key = (d) => `2026-10-${String(d).padStart(2, '0')}`
  // Oct 26: 200 headlines 08:00-11:19 ET (1 min apart); Oct 27: none; Oct 25: 3.
  // Today: the pool's own rows.
  const D26 = Array.from({ length: 200 }, (_, i) => H(1000 + i, `SYNTHETIC: oct 26 row ${i}${i % 10 === 0 ? ' about AMD' : ''}`,
    i % 10 === 0 ? ['AMD'] : [], { category: i % 4 === 0 ? 'Macro' : 'News', received_at_ms: ET(26, 8, i) }))
  const D25 = [0, 1, 2].map((i) => H(900 + i, `SYNTHETIC: oct 25 row ${i}`, [], { received_at_ms: ET(25, 12, i) }))
  const atMs = (date, hhmm) => {
    const [h, m] = hhmm.split(':').map(Number)
    return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h + 4, m) + 59_999
  }
  /** The selected day's count, read where it now lives: the LIVE feed-health popover. */
  const viewCount = async () => {
    if (!screen.queryByRole('dialog', { name: 'Feed health' })) fireEvent.click(screen.getAllByTitle(/Click for feed health/)[0])
    const dlg = await screen.findByRole('dialog', { name: 'Feed health' })
    const text = dlg.querySelector('[data-key="view"]').textContent
    fireEvent.click(screen.getAllByTitle(/Click for feed health/)[0])
    return text
  }
  const mountDays = (opts = {}) => {
    feed.archive = [...D25, ...D26, ...BASE]
    feed.dayOpts = { atMs }
    const utils = render(<TradeExchangeNewsWidget color="A" opts={opts} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, replayUntil: 3, lastHeadlineAt: NOW }))
    return utils
  }
  const bar = () => screen.getByRole('navigation', { name: 'Date' })
  const list = (c) => c.querySelector('[class*="_list_"]')
  const pickDate = async (dateKey) => {
    fireEvent.click(within(bar()).getByRole('button', { name: /Choose a date/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Choose a date' })
    const want = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(dateKey.slice(5, 7)) - 1]} ${dateKey.slice(0, 4)}`
    for (let i = 0; i < 40 && !within(dlg).queryByText(want); i++) {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Previous month' }))
    }
    fireEvent.click(dlg.querySelector(`[data-day="${dateKey}"]`))
  }
  const scrollToEnd = (c) => {
    const el = list(c)
    el.scrollTop = 10 ** 7
    fireEvent.scroll(el)
  }
  const scrollToTop = (c) => {
    const el = list(c)
    el.scrollTop = 0
    fireEvent.scroll(el)
  }

  it('Today is the live default: newest first, and a live headline appears on top', async () => {
    const { container } = mountDays()
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
    expect(within(bar()).getByRole('button', { name: /Date: Today/ })).toBeTruthy()
    expect(within(bar()).getByRole('button', { name: 'Next day' })).toBeDisabled()
    expect(within(bar()).queryByRole('button', { name: 'Latest' })).toBeNull()
    act(() => feed.set({ items: [...BASE, H(4, 'SYNTHETIC: just in', [], { received_at_ms: Date.now() })], lastSeq: 4 }))
    expect(rows(container)[0]).toBe(4)
    expect(container.querySelector('nav [aria-label*="Page number"]')).toBeNull()       // no page numbers
    expect(within(container).queryByText(/Load older/)).toBeNull()                     // no Load More
  })

  it('a past date scrolls continuously to its first headline, loading as it goes, with nothing twice', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    expect(rows(container)).toHaveLength(60)                                           // a step, not the day
    for (let i = 0; i < 6 && rows(container).length < 200; i++) {
      scrollToEnd(container)
      await waitFor(() => expect(rows(container).length).toBeGreaterThan(60 * (i + 1) > 200 ? 199 : 60 * (i + 1)))
    }
    const got = rows(container)
    expect(got).toEqual(Array.from({ length: 200 }, (_, i) => 1199 - i))
    expect(await within(container).findByText(/^Start of Mon, Oct 26/)).toBeTruthy()
    expect(await viewCount()).toMatch(/200 headlines/)                               // in the LIVE popover, not the footer
    expect(feed.dayCalls.filter((b) => b.date === key(26)).every((b) => b.limit <= 60)).toBe(true)
  })

  it('filters run over the whole selected day, not only the loaded rows, and keep the date', async () => {
    feed.archive = [...D25, ...D26, ...BASE]
    const { container, rerender } = render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    rerender(<TradeExchangeNewsWidget color="A" opts={{ categories: ['Macro'] }} onOptsChange={vi.fn()} />)
    await waitFor(async () => expect(await viewCount()).toMatch(/50 of 200 headlines/))
    expect(within(bar()).getByRole('button', { name: /Date: Mon, Oct 26/ })).toBeTruthy()  // same date
    expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), categories: ['Macro'] })
    for (let i = 0; i < 3; i++) scrollToEnd(container)
    await waitFor(() => expect(rows(container)).toHaveLength(50))
    expect(rows(container).every((s) => (s - 1000) % 4 === 0)).toBe(true)
  })

  it('search reaches the whole day', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    fireEvent.change(screen.getByLabelText('Search headlines'), { target: { value: 'row 3' } })
    await waitFor(() => expect(rows(container)).toEqual([1039, 1038, 1037, 1036, 1035, 1034, 1033, 1032, 1031, 1030, 1003]))
  })

  it('previous / next day move one date; past dates offer Latest, which returns to live Today', async () => {
    const { container } = mountDays()
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Previous day' }))
    await waitFor(() => expect(rows(container)).toEqual([902, 901, 900]))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Next day' }))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Next day' }))           // Oct 27: retained, empty
    expect(await within(container).findByText('No headlines retained for Tue, Oct 27.')).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Latest' }))
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
  })

  it('a live headline never enters a past date, and the date never changes by itself', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    act(() => feed.set({ items: [...BASE, H(4, 'SYNTHETIC: today, live', [], { received_at_ms: Date.now() })], lastSeq: 4 }))
    expect(rows(container)).not.toContain(4)
    expect(within(bar()).getByRole('button', { name: /Date: Mon, Oct 26/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Live/ })).toBeTruthy()                 // LIVE stays honest
    fireEvent.click(within(bar()).getByRole('button', { name: 'Latest' }))
    await waitFor(() => expect(rows(container)[0]).toBe(4))
  })

  it('the calendar: month and year navigation, future and unretained dates disabled, news dates marked', async () => {
    mountDays()
    fireEvent.click(within(bar()).getByRole('button', { name: /Choose a date/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Choose a date' })
    const title = () => dlg.querySelector('[class*="calTitle"]').textContent
    const start = title()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Previous year' }))
    expect(title()).toBe(start.replace(/\d{4}/, (y) => String(Number(y) - 1)))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Next year' }))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Next month' }))
    fireEvent.click(within(dlg).getByRole('button', { name: 'Previous month' }))
    expect(title()).toBe(start)
    await waitFor(() => expect(dlg.querySelector('[class*="calToday"]')).not.toBeNull())
    const today = dlg.querySelector('[class*="calToday"]').dataset.day
    const nextDay = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    if (dlg.querySelector(`[data-day="${nextDay}"]`)) expect(dlg.querySelector(`[data-day="${nextDay}"]`)).toBeDisabled()
    for (let i = 0; i < 40 && !within(dlg).queryByText('October 2026'); i++) {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Previous month' }))
    }
    const cell = (d) => dlg.querySelector(`[data-day="${key(d)}"]`)
    expect(cell(24)).toBeDisabled()                                                      // before retention
    expect(cell(24).title).toMatch(/Not retained/)
    expect(cell(26).className).toMatch(/calNews/)
    expect(cell(26).title).toBe('200 headlines')
    expect(cell(27).className).toMatch(/calEmpty/)
    expect(cell(27)).not.toBeDisabled()
    expect(within(dlg).getByText(/History from Sun, Oct 25/)).toBeTruthy()
  })

  it('the calendar is keyboard-operable: arrows move by day and week, Enter picks, Escape closes', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    fireEvent.click(within(bar()).getByRole('button', { name: /Choose a date/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Choose a date' })
    expect(document.activeElement.dataset.day).toBe(key(26))
    fireEvent.keyDown(document.activeElement, { key: 'ArrowLeft' })
    expect(document.activeElement.dataset.day).toBe(key(25))
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.dataset.day).toBe('2026-11-01')
    fireEvent.keyDown(dlg, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose a date' })).toBeNull()
  })

  it('jump to a time starts at or before it, says so, and scrolling up loads the later rows', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to a time' }))
    const dlg = await screen.findByRole('dialog', { name: 'Jump to a time' })
    fireEvent.change(within(dlg).getByLabelText('Time, hour and minute (ET)'), { target: { value: '09:30' } })
    fireEvent.submit(within(dlg).getByLabelText('Time, hour and minute (ET)'))
    const jump = await waitFor(() => {
      const c = feed.dayCalls.find((b) => b.at === '09:30')
      expect(c).toMatchObject({ date: key(26), limit: 60 })
      return c
    })
    expect(jump.cursor).toBeUndefined()
    await waitFor(() => expect(rows(container)).toContain(1090))                     // 09:30 ET = row 90
    expect(rows(container)).not.toContain(1091 + 120)                                // the day's top is not loaded up front
    expect(within(bar()).getByRole('button', { name: /From 9:30 AM ET/ }).textContent).toMatch(/≤ 9:30 AM/)
    // at the top of the list, the later rows load (newer steps), each held in place
    for (let i = 0; i < 4 && rows(container)[0] !== 1199; i++) {
      scrollToTop(container)
      await waitFor(() => expect(feed.dayCalls.at(-1).direction).toBe('newer'))
    }
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    expect(rows(container).slice(0, 110)).toEqual(Array.from({ length: 110 }, (_, i) => 1199 - i))
  })

  it('presets for the time picker, and a time before the first headline lands on the earliest, saying so', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to a time' }))
    const dlg = await screen.findByRole('dialog', { name: 'Jump to a time' })
    expect(within(dlg).getAllByRole('button').map((b) => b.textContent).slice(0, 3)).toEqual(['4:00 AM ET', '9:30 AM ET', '4:00 PM ET'])
    fireEvent.change(within(dlg).getByLabelText('Time, hour and minute (ET)'), { target: { value: '06:00' } })
    fireEvent.submit(within(dlg).getByLabelText('Time, hour and minute (ET)'))
    await waitFor(() => expect(rows(container).at(-1)).toBe(1000))
    expect(within(bar()).getByRole('button', { name: /From 6:00 AM ET/ }).title).toMatch(/Nothing at or before 6:00 AM ET/)
  })

  it('the three shortcuts: 4:00 AM, 9:30 AM and 4:00 PM ET, each on the selected date only', async () => {
    const { container } = mountDays()
    await pickDate(key(26))                                       // rows 8:00 .. 11:19 ET
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    const pick = async (label) => {
      fireEvent.click(within(bar()).getByRole('button', { name: /Jump to a time|Change the time/ }))
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Jump to a time' })).getByText(label))
    }
    await pick('4:00 AM ET')                                      // nothing that early: the day's first, never Oct 25
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), at: '04:00' }))
    await waitFor(() => expect(rows(container).at(-1)).toBe(1000))
    expect(rows(container)).not.toContain(902)
    expect(within(bar()).getByRole('button', { name: /From 4:00 AM ET/ }).title).toMatch(/Nothing at or before 4:00 AM ET/)
    await pick('9:30 AM ET')
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), at: '09:30' }))
    await waitFor(() => expect(rows(container)).toContain(1090))
    await pick('4:00 PM ET')                                      // after the last row: the day's newest
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), at: '16:00' }))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    expect(within(bar()).getByRole('button', { name: /From 4:00 PM ET/ })).toBeTruthy()
  })

  it('a filter change returns to the top of the same date and clears the time jump', async () => {
    feed.archive = [...D25, ...D26, ...BASE]
    feed.dayOpts = { atMs }
    const { container, rerender } = render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    await pickDate(key(26))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to a time' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Jump to a time' })).getByText('9:30 AM ET'))
    await waitFor(() => expect(rows(container)).toContain(1090))
    rerender(<TradeExchangeNewsWidget color="A" opts={{ categories: ['News'] }} onOptsChange={vi.fn()} />)
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    expect(feed.dayCalls.at(-1).at).toBeUndefined()
    expect(within(bar()).getByRole('button', { name: /Date: Mon, Oct 26/ })).toBeTruthy()
  })

  it('a day that fails to load says so and retries', async () => {
    const { container } = mountDays()
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
    const real = feed.archive
    feed.archive = { filter: () => { throw new Error('HTTP 503') }, reduce: () => 0 }
    await pickDate(key(26))
    const retry = await within(container).findByRole('button', { name: 'Retry' })
    expect(within(container).getByText(/Headlines for this date could not be loaded/)).toBeTruthy()
    feed.archive = real
    fireEvent.click(retry)
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
  })

  it('a recreated database (new epoch) reloads the selected date', async () => {
    const { container } = mountDays()
    await pickDate(key(26))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    const n = feed.dayCalls.length
    act(() => feed.set({ epoch: 'e2' }))
    await waitFor(() => expect(feed.dayCalls.length).toBeGreaterThan(n))
    expect(feed.dayCalls.at(-1).date).toBe(key(26))
  })

  it('several widgets browse dates independently', async () => {
    feed.archive = [...D25, ...D26, ...BASE]
    render(<>
      <TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      <TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
    </>)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    const bars = () => screen.getAllByRole('navigation', { name: 'Date' })
    fireEvent.click(within(bars()[0]).getByRole('button', { name: /Choose a date/ }))
    const dlg = await screen.findByRole('dialog', { name: 'Choose a date' })
    for (let i = 0; i < 40 && !within(dlg).queryByText('October 2026'); i++) {
      fireEvent.click(within(dlg).getByRole('button', { name: 'Previous month' }))
    }
    fireEvent.click(dlg.querySelector(`[data-day="${key(26)}"]`))
    const lists = () => [...document.querySelectorAll('[class*="_list_"]')]
    await waitFor(() => expect(Number(lists()[0].querySelector('[data-seq]').dataset.seq)).toBe(1199))
    expect(Number(lists()[1].querySelector('[data-seq]').dataset.seq)).toBe(3)
    expect(within(bars()[1]).getByRole('button', { name: /Date: Today/ })).toBeTruthy()
  })
})

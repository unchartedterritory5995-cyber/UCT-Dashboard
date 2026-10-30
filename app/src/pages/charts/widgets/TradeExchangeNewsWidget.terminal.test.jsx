// News terminal upgrade — the widget: long-headline collapse, category filter,
// inline % change, row actions (chart / watchlist / copy / alert, permission-gated),
// impact marks, related groups, feed health, presets, several widgets at once, and
// re-render economy on a quote tick. The shared pool is mocked; synthetic only.
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
vi.mock('../../../lib/tradeExchangeNewsStreamManager', () => ({
  subscribe: (fn) => { feed.listeners.add(fn); return () => feed.listeners.delete(fn) },
  getSnapshot: () => feed.get(),
  retry: vi.fn(),
  loadOlder: vi.fn(),
  claimAnnouncement: () => true,
}))
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
  it('filters instantly, persists per widget, and combines with the linked filter', () => {
    const { container, onOptsChange } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Categories: All/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filters and presets' })).getByRole('button', { name: 'Earnings' }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ['Earnings'] }))
    const r2 = mount({ categories: ['Earnings', 'News'] })
    expect(rows(r2.container)).toEqual([3, 1])
    const r3 = mount({ categories: ['Earnings'], linked: true })              // linked = NVDA: AND
    expect(rows(r3.container)).toEqual([])
    expect(within(r3.container).getByText('No headlines match these filters.')).toBeTruthy()
    expect(container).toBeTruthy()
  })

  it('the empty state offers Clear filters', () => {
    const onOptsChange = vi.fn()
    const { container } = mount({ categories: ['Filing'] }, BASE, onOptsChange)
    fireEvent.click(within(container).getByRole('button', { name: 'Clear filters' }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ categories: [], linked: false, watchlistId: null }))
  })
})

describe('inline % change', () => {
  it('shows each security once per headline, in the up/down colours; stale is omitted', () => {
    quotes.prices = { NVDA: { price: 100, change_pct: 2.43 }, AMD: { price: 50, change_pct: -1.06 } }
    const { container } = mount()
    const r = rowEl(container, 3)
    expect(within(r).getAllByText('+2.4%')).toHaveLength(1)                  // NVDA named twice
    expect(within(r).getByText('-1.1%').className).toMatch(/symDown/)
    quotes.stale = new Set(['AMD'])
    act(() => feed.set({ lastEventAt: NOW + 1 }))
    expect(within(rowEl(container, 3)).queryByText('-1.1%')).toBeNull()
    expect(within(rowEl(container, 1)).queryByText(/%$/)).toBeNull()
  })

  it('is off by default in Compact; neutral (uncoloured) in Accent mode', () => {
    quotes.prices = { NVDA: { price: 100, change_pct: 2.43 } }
    const { container, unmount } = mount({ settings: { density: 'compact' } })
    expect(within(container).queryByText('+2.4%')).toBeNull()
    unmount()
    const r2 = mount({ settings: { tickerColorMode: 'accent' } })
    expect(within(r2.container).getByText('+2.4%').className).not.toMatch(/symUp/)
  })
})

describe('row actions', () => {
  const openMenu = (container, seq) => {
    fireEvent.click(within(rowEl(container, seq)).getByRole('button', { name: 'Headline actions' }))
    return screen.getByRole('menu', { name: 'Headline actions' })
  }

  it('Open chart links the colour group, like a ticker click; several securities let you choose', () => {
    const { container } = mount()
    const menu = openMenu(container, 3)
    fireEvent.click(within(menu).getByRole('button', { name: 'AMD', pressed: false }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Open AMD chart/ }))
    expect(setGroupSym).toHaveBeenCalledWith('A', 'AMD')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Add to watchlist offers personal lists only and reports the server answer', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'x' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ duplicate: true }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Watchlist not found' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = mount()
    const menu = openMenu(container, 1)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Add AMD to watchlist/ }))
    expect(within(menu).queryByText('UCT List')).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(within(menu).getByRole('status').textContent).toBe('Added AMD to Mine'))
    expect(fetchMock).toHaveBeenCalledWith('/api/watchlists/wl1/items', expect.objectContaining({ method: 'POST', body: JSON.stringify({ sym: 'AMD', notes: '' }) }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Add AMD to watchlist/ }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(within(menu).getByRole('status').textContent).toBe('AMD is already on Mine'))
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Add AMD to watchlist/ }))
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mine' }))
    await waitFor(() => expect(within(menu).getByRole('status').textContent).toBe('Watchlist not found'))
  })

  it('Copy headline copies the original text', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = mount()
    fireEvent.click(within(openMenu(container, 2)).getByRole('menuitem', { name: /Copy headline/ }))
    expect(writeText).toHaveBeenCalledWith('SYNTHETIC: Fed minutes due')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Headline copied'))
  })

  it('a headline with no ticker offers Copy only', () => {
    const { container } = mount()
    const menu = openMenu(container, 2)
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent.trim())).toEqual(['Copy headline'])
    expect(within(menu).getByText('No ticker identified in this headline.')).toBeTruthy()
  })

  it('Create news alert does not exist while news alerts are switched off', () => {
    const { container } = mount()
    expect(within(openMenu(container, 1)).queryByRole('menuitem', { name: /Create news alert/ })).toBeNull()
  })

  it('with alerts on, it opens the alert form prefilled — nothing is saved for you', () => {
    server.alerts = 'on'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { container } = mount()
    fireEvent.click(within(openMenu(container, 3)).getByRole('menuitem', { name: /Create news alert/ }))
    expect(screen.getByLabelText('Alert tickers').value).toBe('NVDA AMD')
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('news-match'), expect.objectContaining({ method: 'POST' }))
  })

  it('is keyboard reachable: focus lands on the first item, arrows move, Escape returns focus', () => {
    const { container } = mount()
    const btn = within(rowEl(container, 3)).getByRole('button', { name: 'Headline actions' })
    btn.focus()
    fireEvent.click(btn)
    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
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

  it('a quote tick re-renders only the rows naming that symbol (1,000 headlines)', () => {
    const items = Array.from({ length: 1000 }, (_, i) => H(i + 1, `SYNTHETIC: row ${i + 1} about ${i % 2 ? 'NVDA' : 'AMD'}`, [i % 2 ? 'NVDA' : 'AMD']))
    quotes.prices = { NVDA: { price: 100, change_pct: 1 }, AMD: { price: 50, change_pct: 1 } }
    mount({}, items)
    spy.tokenize.clear()
    quotes.prices = { ...quotes.prices, AMD: { price: 51, change_pct: 3 } }
    const t0 = performance.now()
    act(() => feed.set({ lastEventAt: NOW + 5 }))
    const ms = performance.now() - t0
    const rerendered = [...spy.tokenize.keys()]
    expect(rerendered.length).toBe(500)
    expect(rerendered.every((c) => c.endsWith('AMD'))).toBe(true)
    expect(ms).toBeLessThan(3000)
  })
})

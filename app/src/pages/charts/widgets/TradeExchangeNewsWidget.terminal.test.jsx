// News terminal upgrade — the widget: long-headline collapse, category filter,
// plain tickers (no inline %), one-click copy, ⋯ = Watchlist / Notebook / Collection / Copy, no
// impact labels, related groups, feed health, presets, one ET calendar day at a time
// (continuous scrolling, calendar, previous/next day, jump to time, live Today),
// several widgets at once, and re-render economy on a quote tick. The shared pool
// and the day server are faked (fakeNewsDay); synthetic only.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../../context/AuthContext'
import { setAgentFlag } from '../../../agent/agentFlag'
import { NewsAgentContext } from './tradeExchangeNewsAgent'
import { useContext, useState as useStateForStub } from 'react'
import { openAgent as agentOpenAgent, useAgentAsk } from '../../../agent/newsAsk'

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
import { _resetExplainCacheForTests } from '../../../lib/tradeExchangeNewsExplain'
import { _resetLibraryForTests } from '../../../lib/tradeExchangeNewsLibrary'
import { fakeLibraryServer } from '../../../testing/tradeExchangeNews/fakeLibraryServer'

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

function mount(opts = {}, items = BASE, onOptsChange = vi.fn(), { role, agent } = {}) {
  let widget = <TradeExchangeNewsWidget color="A" opts={opts} onOptsChange={onOptsChange} />
  // `agent`: what UCT Agent provides News ({ useAsk, openAgent }); a stub here, or null for "no Agent". Omitted = the real exports.
  if (agent !== undefined) widget = <NewsAgentContext.Provider value={agent}>{widget}</NewsAgentContext.Provider>
  // `role`: the signed-in member's role, for what only an admin sees (UCT Agent's mark).
  // Unset = no AuthProvider, which the widget treats as a member.
  const utils = render(role ? <AuthContext.Provider value={{ user: { id: 'u1', role }, isPaid: true }}>{widget}</AuthContext.Provider> : widget)
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
    fireEvent.click(screen.getByRole('button', { name: /^News filters/ }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'News filters' })).getByRole('button', { name: 'Earnings' }))
    expect(onOptsChange).toHaveBeenLastCalledWith(expect.objectContaining({ categories: ['Earnings'] }))
    const r2 = mount({ categories: ['Earnings', 'News'] })
    expect(rows(r2.container)).toEqual([3, 1])
    const r3 = mount({ categories: ['Earnings'], linked: true })              // linked = NVDA: AND
    expect(rows(r3.container)).toEqual([])
    // Linked to chart searches All history: the empty answer says so, and offers to clear the rest
    expect(await within(r3.container).findByText('No archived headlines naming NVDA match these filters.')).toBeTruthy()
    expect(within(r3.container).getByRole('button', { name: 'Clear other filters' })).toBeTruthy()
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
    expect(btns).toEqual(['Explain this headline', 'Save headline', 'Copy headline', 'More actions for this headline'])
    expect([...rowEl(container, 2).querySelectorAll('[class*="rowActions"] button')].map((b) => b.getAttribute('aria-label')))
      .toEqual(['Explain this headline', 'Save headline', 'Copy headline', 'More actions for this headline'])   // ⋯ holds more than the watchlist
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

describe('⋯ = the secondary actions', () => {
  const openMenu = (container, seq) => {
    fireEvent.click(within(rowEl(container, seq)).getByRole('button', { name: 'More actions for this headline' }))
    return screen.getByRole('menu', { name: 'Headline actions' })
  }
  const openWatchlist = (container, seq) => {
    const menu = openMenu(container, seq)
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add to Watchlist' }))
    return menu
  }

  it('holds Watchlist, Notebook, Collection and Copy: no Open chart or news alert, even with alerts on', () => {
    server.alerts = 'on'
    const { container } = mount()
    const menu = openMenu(container, 3)
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent.trim()))
      .toEqual(['Add to Watchlist', 'Send to Notebook', 'Add to Collection…', 'Copy Headline'])
    expect(within(menu).queryByText(/Open .* chart/)).toBeNull()
    expect(within(menu).queryByText(/alert/i)).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add to Watchlist' }))
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent.trim())).toEqual(['Back', 'Mine'])
    expect(within(menu).queryByText('UCT List')).toBeNull()               // personal lists only
  })

  it('a headline with no ticker still has Notebook, Collection and Copy; Watchlist is off', () => {
    const { container } = mount()
    const menu = openMenu(container, 2)
    expect(within(menu).getByRole('menuitem', { name: 'Add to Watchlist' })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Send to Notebook' })).not.toBeDisabled()
  })

  it('Copy Headline copies the whole original text and closes the menu', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { container } = mount()
    fireEvent.click(within(openMenu(container, 1)).getByRole('menuitem', { name: 'Copy Headline' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SYNTHETIC: AMD guidance raised'))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(await screen.findByText('Headline copied')).toBeTruthy()
  })

  it('several securities let you choose, and the server answer is the result', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'x' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ duplicate: true }) })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Watchlist not found' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = mount()
    const menu = openWatchlist(container, 3)
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

  it('is keyboard reachable: focus lands on the first action, Escape returns focus to ⋯', () => {
    const { container } = mount()
    const btn = within(rowEl(container, 1)).getByRole('button', { name: 'More actions for this headline' })
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
    fireEvent.click(screen.getByRole('button', { name: /^News filters.*categories Macro/ }))
    const dlg = screen.getByRole('dialog', { name: 'News filters' })
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
    fireEvent.click(within(r2.container).getByRole('button', { name: /^News filters/ }))
    const d2 = screen.getAllByRole('dialog', { name: 'News filters' }).at(-1)
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

  // Latest (back to today's live feed) is the first item of the clock's menu on a past day or time.
  const toLatest = async () => {
    fireEvent.click(within(bar()).getByRole('button', { name: /^Jump to Time/ }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Jump to a time' })).getByRole('button', { name: /^Latest/ }))
  }

  it('Today is the live default: newest first, and a live headline appears on top', async () => {
    const { container } = mountDays()
    await waitFor(() => expect(rows(container)).toEqual([3, 2, 1]))
    expect(within(bar()).getByRole('button', { name: /Date: Today/ })).toBeTruthy()
    expect(within(bar()).getByRole('button', { name: 'Next day' })).toBeDisabled()
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to Time' }))
    expect(within(await screen.findByRole('dialog', { name: 'Jump to a time' })).queryByRole('button', { name: /Latest/ })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Jump to a time' }), { key: 'Escape' })
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
    await toLatest()
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
    await toLatest()
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
    expect(cell(24).title).toMatch(/Before the UCT News archive began/)
    expect(cell(26).className).toMatch(/calNews/)
    expect(cell(26).title).toBe('200 headlines')
    expect(cell(27).className).toMatch(/calEmpty/)
    expect(cell(27)).not.toBeDisabled()
    expect(within(dlg).getByText(/Archive from Sun, Oct 25/)).toBeTruthy()
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
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to Time' }))
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
    expect(within(bar()).getByRole('button', { name: /showing from 9:30 AM ET/ }).title).toMatch(/closest headline at or before 9:30 AM ET/)
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
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to Time' }))
    const dlg = await screen.findByRole('dialog', { name: 'Jump to a time' })
    const labels = within(dlg).getAllByRole('button').map((b) => b.textContent)
    expect(labels[0]).toMatch(/^Latest/)                                 // a past day: back to live first
    expect(labels.slice(1, 4)).toEqual(['4:00 AM ET', '9:30 AM ET', '4:00 PM ET'])
    fireEvent.change(within(dlg).getByLabelText('Time, hour and minute (ET)'), { target: { value: '06:00' } })
    fireEvent.submit(within(dlg).getByLabelText('Time, hour and minute (ET)'))
    await waitFor(() => expect(rows(container).at(-1)).toBe(1000))
    expect(within(bar()).getByRole('button', { name: /showing after 6:00 AM ET/ }).title).toMatch(/nothing at or before 6:00 AM ET/)
  })

  it('the three shortcuts: 4:00 AM, 9:30 AM and 4:00 PM ET, each on the selected date only', async () => {
    const { container } = mountDays()
    await pickDate(key(26))                                       // rows 8:00 .. 11:19 ET
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    const pick = async (label) => {
      fireEvent.click(within(bar()).getByRole('button', { name: /^Jump to Time/ }))
      fireEvent.click(within(await screen.findByRole('dialog', { name: 'Jump to a time' })).getByText(label))
    }
    await pick('4:00 AM ET')                                      // nothing that early: the day's first, never Oct 25
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), at: '04:00' }))
    await waitFor(() => expect(rows(container).at(-1)).toBe(1000))
    expect(rows(container)).not.toContain(902)
    expect(within(bar()).getByRole('button', { name: /showing after 4:00 AM ET/ }).title).toMatch(/nothing at or before 4:00 AM ET/)
    await pick('9:30 AM ET')
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), at: '09:30' }))
    await waitFor(() => expect(rows(container)).toContain(1090))
    await pick('4:00 PM ET')                                      // after the last row: the day's newest
    await waitFor(() => expect(feed.dayCalls.at(-1)).toMatchObject({ date: key(26), at: '16:00' }))
    await waitFor(() => expect(rows(container)[0]).toBe(1199))
    expect(within(bar()).getByRole('button', { name: /showing from 4:00 PM ET/ })).toBeTruthy()
  })

  it('a filter change returns to the top of the same date and clears the time jump', async () => {
    feed.archive = [...D25, ...D26, ...BASE]
    feed.dayOpts = { atMs }
    const { container, rerender } = render(<TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    await pickDate(key(26))
    fireEvent.click(within(bar()).getByRole('button', { name: 'Jump to Time' }))
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

describe('Explanation', () => {
  const EXPL = { id: 'id2', explanation: 'SYNTHETIC: The headline reports that Fed minutes are due, which could shape rate expectations.',
    watch: 'Fed funds futures, 2-year Treasury yield', generated_at_ms: NOW, cached: false, version: 'v1' }
  const explainBtn = (container, seq) => within(rowEl(container, seq)).getByRole('button', { name: 'Explain this headline' })
  const ok = (body = EXPL) => ({ ok: true, status: 200, json: async () => body })
  const refused = (status, reason, detail) => ({ ok: false, status, json: async () => ({ reason, detail }) })
  beforeEach(() => _resetExplainCacheForTests())
  afterEach(() => setAgentFlag(null))

  it('is offered only on headlines with text: never on a graphic-only post or a row without an id', () => {
    const { container } = mount({ settings: { graphicPlaceholders: 'show' } }, [...BASE,
      H(4, 'CRYPTO', [], { placeholder: 'graphic' }), H(5, 'SYNTHETIC: no id', [], { id: undefined }), H(6, '$$$ !!!')])
    expect(within(rowEl(container, 2)).queryByRole('button', { name: 'Explain this headline' })).toBeTruthy()
    // ⛔ a plain currentColor glyph: a gold UIcon carries a gradient + drop-shadow FILTER per row,
    // and a second one per row tripled the 5,000-row scroll cost in the harness (2026-10-31).
    const svg = within(rowEl(container, 2)).getByRole('button', { name: 'Explain this headline' }).querySelector('svg')
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.style.filter || '').toBe('')
    for (const seq of [4, 5, 6]) {
      expect(within(rowEl(container, seq)).queryByRole('button', { name: 'Explain this headline' })).toBeNull()
    }
  })

  it('asks only when clicked, by id alone, and expands "What this means" and "What to watch" INSIDE that row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { container } = mount()
    expect(fetchMock).not.toHaveBeenCalled()                               // nothing on render
    const before = rows(container)
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(EXPL.explanation)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/trade-exchange-news/explain')
    expect(JSON.parse(init.body)).toEqual({ id: 'id2' })                    // the server explains its own text
    // two labelled sections, in order, each followed by its text
    const labels = [...panel.querySelectorAll('h4')]
    expect(labels.map((h) => h.textContent)).toEqual(['What this means', 'What to watch'])
    expect(labels[0].nextElementSibling.textContent).toBe(EXPL.explanation)
    expect(labels[1].nextElementSibling.textContent).toBe(EXPL.watch)
    // the old footer is gone, and nothing else stands in for it
    expect(panel.textContent).not.toMatch(/AI-generated|not advice|Watch:/)
    expect(panel.closest('[data-seq]')).toBe(rowEl(container, 2))         // under ITS headline, in the row
    expect(rowEl(container, 2).className).toMatch(/rowExplaining/)
    expect(rowEl(container, 2).textContent.indexOf('Fed minutes due'))
      .toBeLessThan(rowEl(container, 2).textContent.indexOf(EXPL.explanation)) // the headline stays on top
    expect(rows(container)).toEqual(before)                               // no row moved, none covered
    expect(setGroupSym).not.toHaveBeenCalled()
  })

  it('renders the answer as text, never as markup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok({ ...EXPL, explanation: 'SYNTHETIC <b>bold</b> <img src=x onerror=alert(1)> text here' })))
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(/SYNTHETIC <b>bold<\/b>/)
    expect(panel.querySelector('b, img')).toBeNull()
  })

  it('the Explain button says just "Explain"', () => {
    const { container } = mount()
    expect(explainBtn(container, 2).getAttribute('title')).toBe('Explain')
  })

  it('a member reads it under a neutral "Explanation" heading: no UCT Agent mark or name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    for (const role of [undefined, 'member']) {
      const { container, unmount } = mount({}, BASE, vi.fn(), { role })
      fireEvent.click(explainBtn(container, 2))
      const panel = await screen.findByRole('region', { name: 'Explanation' })
      await within(panel).findByText(EXPL.explanation)
      expect(panel.textContent).toContain('Explanation')
      expect(panel.textContent).not.toMatch(/UCT Agent|AI Explanation/)
      expect(panel.querySelector('img')).toBeNull()
      unmount()
    }
  })

  it('an admin with the Agent switch OFF reads the neutral heading, like the /charts panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    setAgentFlag(false)
    const { container } = mount({}, BASE, vi.fn(), { role: 'admin' })
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(EXPL.explanation)
    expect(panel.textContent).not.toContain('UCT Agent')
    expect(panel.querySelector('img')).toBeNull()
  })

  it('a member with the switch ON (a shared browser) still reads the neutral heading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    setAgentFlag(true)
    const { container } = mount({}, BASE, vi.fn(), { role: 'member' })
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(EXPL.explanation)
    expect(panel.textContent).not.toContain('UCT Agent')
  })

  it('an admin with the Agent switch on reads it in UCT Agent\'s voice: the compass mark and the name, same sections, no footer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    setAgentFlag(true)
    const { container } = mount({}, BASE, vi.fn(), { role: 'admin' })
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(EXPL.explanation)
    const head = panel.firstElementChild
    expect(head.textContent).toContain('UCT Agent')
    expect(head.textContent).not.toMatch(/AI Explanation|^Explanation/)
    const img = head.querySelector('img')
    expect(img).toBeTruthy()
    expect(img.getAttribute('alt')).toBe('')                            // decorative: the name is the text
    expect([...panel.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['What this means', 'What to watch'])
    expect(panel.textContent).not.toMatch(/AI-generated|not advice/)
  })

  it('Copy explanation copies the compact format as plain text', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    fireEvent.click(await within(panel).findByRole('button', { name: /Copy explanation/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`What this means: ${EXPL.explanation}\n\nWhat to watch: ${EXPL.watch}`))
    expect(await within(panel).findByRole('button', { name: 'Explanation copied' })).toBeTruthy()
  })

  it('a temporary failure offers Retry, which asks again', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refused(503, 'busy', 'Explanations are busy right now. Try again in a moment.'))
      .mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText('Explanations are busy right now. Try again in a moment.')
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    await within(panel).findByText(EXPL.explanation)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a final refusal says why and offers no Retry; a lost connection does', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(refused(429, 'daily_limit', "You've used today's headline explanations. They reset at midnight ET.")))
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    let panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(/reset at midnight ET/)
    expect(within(panel).queryByRole('button', { name: 'Retry' })).toBeNull()
    fireEvent.click(within(panel).getByRole('button', { name: 'Close explanation' }))
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    fireEvent.click(explainBtn(container, 1))
    panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(/Could not reach UCT/)
    expect(within(panel).getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('closes with its button, with Escape, or by clicking Explain again; another headline replaces it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    let panel = await screen.findByRole('region', { name: 'Explanation' })
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Explanation' })).toBeNull()
    fireEvent.click(explainBtn(container, 2))
    await screen.findByRole('region', { name: 'Explanation' })
    fireEvent.click(explainBtn(container, 2))
    expect(screen.queryByRole('region', { name: 'Explanation' })).toBeNull()
    fireEvent.click(explainBtn(container, 2))
    panel = await screen.findByRole('region', { name: 'Explanation' })
    expect(panel.closest('[data-seq]')).toBe(rowEl(container, 2))
    fireEvent.click(explainBtn(container, 1))                              // the expansion moves: one at a time
    await waitFor(() => expect(screen.getByRole('region', { name: 'Explanation' }).closest('[data-seq]')).toBe(rowEl(container, 1)))
    expect(screen.getAllByRole('region', { name: 'Explanation' })).toHaveLength(1)
    panel = screen.getByRole('region', { name: 'Explanation' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Close explanation' }))
    expect(screen.queryByRole('region', { name: 'Explanation' })).toBeNull()
  })

  it('stays open while live headlines arrive: the feed keeps updating, the reader keeps their place', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    act(() => feed.set({ items: [...BASE, H(4, 'SYNTHETIC: a new one')], lastSeq: 4 }))
    expect(rows(container)[0]).toBe(4)
    expect(screen.getByRole('region', { name: 'Explanation' })).toBe(panel)
    expect(await screen.findByRole('button', { name: /Jump to live · 1 new/ })).toBeTruthy()   // held, not followed
  })

  it('Escape closes it and returns focus to that headline\'s Explain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
    const { container } = mount()
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    fireEvent.keyDown(panel, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Explanation' })).toBeNull()
    expect(rowEl(container, 2).className).not.toMatch(/rowExplaining/)
    expect(document.activeElement).toBe(explainBtn(container, 2))
  })

  it('two News widgets share one answer per headline: the second asks nothing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    render(<>
      <TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      <TradeExchangeNewsWidget color="B" opts={{ settings: { density: 'compact' } }} onOptsChange={vi.fn()} />
    </>)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    const lists = [...document.querySelectorAll('[class*="_list_"]')]
    const btn = (i) => within(lists[i].querySelector('[data-seq="2"]')).getByRole('button', { name: 'Explain this headline' })
    fireEvent.click(btn(0))
    fireEvent.click(btn(1))                                                // while the first is still in flight
    await waitFor(() => expect(screen.getAllByRole('region', { name: 'Explanation' })).toHaveLength(2))
    for (const d of screen.getAllByRole('region', { name: 'Explanation' })) await within(d).findByText(EXPL.explanation)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

// ── Ask UCT Agent (increments 2/3): News renders the thread; the Agent runs it ──
// The stub stands in for agent-lead's `useAgentAsk` / `openAgent` (the agreed contract):
// it records exactly what News hands the Agent, and answers like the server would.
describe('Ask UCT Agent', () => {
  const EXPL = { id: 'id2', explanation: 'SYNTHETIC: The headline reports Fed minutes are due.', watch: '2-year yield',
    generated_at_ms: NOW, cached: false, version: 'v2' }
  const ok = () => ({ ok: true, status: 200, json: async () => EXPL })
  const explainBtn = (container, seq) => within(rowEl(container, seq)).getByRole('button', { name: 'Explain this headline' })
  let calls, threads, pending, openAgent
  // Threads live OUTSIDE React (as the Agent's own store would): render only reads them.
  const thread = (key) => threads.get(key) || { turns: [], busy: false, error: null, conversationId: null }
  const patch = (key, fn) => threads.set(key, fn(thread(key)))
  const settle = (key, answer) => patch(key, (t) => (answer instanceof Error
    ? { ...t, busy: false, error: { text: answer.message, retry: true } }
    : { ...t, busy: false, conversationId: 'ac_news_1', turns: [...t.turns, { id: `a${t.turns.length}`, role: 'agent', text: answer }] }))
  function useAskStub(args) {
    recordCall(args)
    const key = args.newsId
    const [, bump] = useStateForStub(0)
    return { ...thread(key), ask: (text) => {
      patch(key, (t) => ({ ...t, busy: true, error: null, turns: [...t.turns, { id: `m${t.turns.length}`, role: 'member', text }] }))
      bump((n) => n + 1)
      pending.push((answer) => { settle(key, answer); bump((n) => n + 1) })
    } }
  }
  const recordCall = (args) => calls.push(args)
  const agent = () => ({ useAsk: useAskStub, openAgent })
  beforeEach(() => {
    _resetExplainCacheForTests()
    calls = []; threads = new Map(); pending = []; openAgent = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok()))
  })
  afterEach(() => setAgentFlag(null))
  const open = async (who) => {
    const utils = mount({}, BASE, vi.fn(), who)
    fireEvent.click(explainBtn(utils.container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    await within(panel).findByText(EXPL.explanation)
    return { ...utils, panel }
  }
  const answer = (x) => act(() => { pending.shift()(x) })
  const askBox = (panel) => within(panel).getByRole('textbox', { name: 'Ask UCT Agent about this headline' })
  const say = (panel, text) => {
    fireEvent.change(askBox(panel), { target: { value: text } })
    fireEvent.submit(askBox(panel).closest('form'))
  }

  it('shows nowhere the Agent is not allowed: member, admin with the switch off, or no Agent provided yet', async () => {
    for (const [flag, who] of [[true, { role: 'member', agent: agent() }], [false, { role: 'admin', agent: agent() }],
      [true, { role: 'admin', agent: null }], [true, { agent: agent() }]]) {
      setAgentFlag(flag)
      const { panel, unmount } = await open(who)
      expect(within(panel).queryByRole('textbox', { name: 'Ask UCT Agent about this headline' })).toBeNull()
      expect(calls).toEqual([])                                           // the Agent was never even asked to mount
      unmount()
    }
  })

  it('an admin with the switch on gets the box under the explanation, once the explanation is there', async () => {
    setAgentFlag(true)
    let release
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise((r) => { release = r })))
    const { container } = mount({}, BASE, vi.fn(), { role: 'admin', agent: agent() })
    fireEvent.click(explainBtn(container, 2))
    const panel = await screen.findByRole('region', { name: 'Explanation' })
    expect(within(panel).queryByRole('textbox')).toBeNull()               // not while it is still being written
    await act(async () => release(ok()))
    const box = await within(panel).findByRole('textbox', { name: 'Ask UCT Agent about this headline' })
    expect(box.getAttribute('placeholder')).toBe('Ask UCT Agent…')
    expect(box.getAttribute('maxlength')).toBe('500')
    expect(within(panel).queryByRole('button', { name: /Continue in UCT Agent/ })).toBeNull()  // nothing to continue yet
  })

  it('asks by headline id only, shows the question, typing, then the answer; follow-ups stay in the same thread', async () => {
    setAgentFlag(true)
    const { panel } = await open({ role: 'admin', agent: agent() })
    expect(calls.every((c) => JSON.stringify(c) === JSON.stringify({ newsId: 'id2' }))).toBe(true)  // never the headline text
    say(panel, '  What does this mean for banks?  ')
    expect(askBox(panel).value).toBe('')
    const log = within(panel).getByRole('log', { name: 'Conversation with UCT Agent' })
    expect(log.textContent).toContain('What does this mean for banks?')
    expect(log.textContent).toContain('UCT Agent is typing…')
    expect(within(panel).getByRole('button', { name: 'Send question' }).disabled).toBe(true)
    answer('SYNTHETIC: Banks may watch the rate path; I don’t have a live quote here.')
    expect(log.textContent).not.toContain('is typing')
    say(panel, 'And regional banks?')
    answer('SYNTHETIC: Regional lenders are more rate-sensitive; the headline says nothing specific about them.')
    const lines = [...log.querySelectorAll('p')].map((p) => p.textContent.replace('UCT Agent: ', ''))
    expect(lines).toEqual(['What does this mean for banks?', 'SYNTHETIC: Banks may watch the rate path; I don’t have a live quote here.',
      'And regional banks?', 'SYNTHETIC: Regional lenders are more rate-sensitive; the headline says nothing specific about them.'])
  })

  it('an empty question sends nothing; an answer renders as text, never markup', async () => {
    setAgentFlag(true)
    const { panel } = await open({ role: 'admin', agent: agent() })
    say(panel, '   ')
    expect(pending).toHaveLength(0)
    say(panel, 'q')
    answer('SYNTHETIC <b>bold</b> <img src=x onerror=alert(1)>')
    expect(within(panel).getByRole('log').querySelector('b, img')).toBeNull()
  })

  it('a failed answer shows the Agent’s own words and Retry asks the same question again', async () => {
    setAgentFlag(true)
    const { panel } = await open({ role: 'admin', agent: agent() })
    say(panel, 'Why now?')
    answer(new Error('UCT Agent has used today’s budget. It resets at midnight ET.'))
    expect(within(panel).getByRole('log').textContent).toContain('used today’s budget')
    fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }))
    expect(thread('id2').turns.filter((t) => t.role === 'member').map((t) => t.text)).toEqual(['Why now?', 'Why now?'])
  })

  it('Continue in UCT Agent hands the SAME conversation id to the Agent panel', async () => {
    setAgentFlag(true)
    const { panel } = await open({ role: 'admin', agent: agent() })
    say(panel, 'Context?')
    answer('SYNTHETIC: context.')
    fireEvent.click(within(panel).getByRole('button', { name: /Continue in UCT Agent/ }))
    expect(openAgent).toHaveBeenCalledTimes(1)
    expect(openAgent).toHaveBeenCalledWith({ conversationId: 'ac_news_1' })
  })

  it('typing stays in the box; Esc still closes the explanation, and reopening keeps the thread', async () => {
    setAgentFlag(true)
    const { container, panel } = await open({ role: 'admin', agent: agent() })
    say(panel, 'Kept?')
    answer('SYNTHETIC: kept.')
    fireEvent.keyDown(askBox(panel), { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Explanation' })).toBeNull()
    fireEvent.click(explainBtn(container, 2))
    const again = await screen.findByRole('region', { name: 'Explanation' })
    expect((await within(again).findByRole('log')).textContent).toContain('SYNTHETIC: kept.')
  })

  it('a long thread folds its earlier turns behind "Show earlier"', async () => {
    setAgentFlag(true)
    const { panel } = await open({ role: 'admin', agent: agent() })
    for (let i = 0; i < 4; i++) { say(panel, `Q${i}`); answer(`A${i}`) }
    const log = within(panel).getByRole('log')
    expect(log.querySelectorAll('p')).toHaveLength(6)
    fireEvent.click(within(log).getByRole('button', { name: 'Show 2 earlier' }))
    expect(log.querySelectorAll('p')).toHaveLength(8)
  })
})

describe('Bookmark a headline', () => {
  let lib
  beforeEach(() => {
    _resetLibraryForTests()
    lib = fakeLibraryServer(BASE)
    vi.stubGlobal('fetch', vi.fn((url, init) => lib.fetch(url, init)))
  })
  const saveBtn = (root, seq) => within(root.querySelector(`[data-seq="${seq}"]`))
    .getByRole('button', { name: /^(Save headline|Remove bookmark)$/ })

  it('one click saves without touching the feed; a second click removes, with Undo', async () => {
    const { container } = mount()
    await waitFor(() => expect(lib.calls).toContain('GET /state'))
    const before = rows(container)
    fireEvent.click(saveBtn(container, 1))
    await waitFor(() => expect(saveBtn(container, 1)).toHaveAttribute('aria-pressed', 'true'))
    expect(lib.marks.has('id1')).toBe(true)
    expect(rows(container)).toEqual(before)                                // the live feed is untouched
    expect(feed.dayCalls.length).toBeLessThanOrEqual(1)                    // and nothing reloaded
    fireEvent.click(saveBtn(container, 1))
    await waitFor(() => expect(saveBtn(container, 1)).toHaveAttribute('aria-pressed', 'false'))
    expect(lib.marks.has('id1')).toBe(false)
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(saveBtn(container, 1)).toHaveAttribute('aria-pressed', 'true'))
    expect(lib.marks.has('id1')).toBe(true)
  })

  it('the saved mark is consistent across several News widgets', async () => {
    render(<>
      <TradeExchangeNewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      <TradeExchangeNewsWidget color="B" opts={{ settings: { density: 'compact' } }} onOptsChange={vi.fn()} />
    </>)
    act(() => feed.set({ status: 'live', items: BASE, lastSeq: 3, lastHeadlineAt: NOW }))
    const lists = () => [...document.querySelectorAll('[class*="_list_"]')]
    await waitFor(() => expect(lists()[1].querySelector('[data-seq="2"]')).toBeTruthy())
    fireEvent.click(saveBtn(lists()[0], 2))
    await waitFor(() => expect(saveBtn(lists()[1], 2)).toHaveAttribute('aria-pressed', 'true'))
    expect(lib.calls.filter((c) => c === 'GET /state')).toHaveLength(1)      // one shared store per page
  })

  it('a refused save is rolled back and says why', async () => {
    vi.stubGlobal('fetch', vi.fn((url, init) => ((init?.method === 'PUT')
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ reason: 'full', detail: 'Your library holds 5,000 headlines. Remove some to save more.' }) })
      : lib.fetch(url, init))))
    const { container } = mount()
    await waitFor(() => expect(lib.calls).toContain('GET /state'))
    fireEvent.click(saveBtn(container, 3))
    expect(await screen.findByText(/Your library holds 5,000 headlines/)).toBeTruthy()
    expect(saveBtn(container, 3)).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('News ↔ UCT Agent seam', () => {
  it('by default News uses UCT Agent’s own News exports (nothing else)', () => {
    let got
    function Probe() { got = useContext(NewsAgentContext); return null }
    render(<Probe />)
    expect(got).toEqual({ useAsk: useAgentAsk, openAgent: agentOpenAgent })
  })
})

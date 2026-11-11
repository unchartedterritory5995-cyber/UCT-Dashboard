// Watchlists — the list menu from the TITLE in the Charts watchlist widget (owner GO 2026-11-09).
//
// ⛔ RAIL-WIDE RULE (AUDIT 2026-11-09): jsdom does no layout, so nothing here proves a REAL press reaches a control. A press
// dispatched to an element here proves only what that element does once it has the press. Whether a real right-click,
// long-press or click at a point REACHES it (pointer-events, stacking, hit-testing) is proved only in a real browser:
// testing/agent/acceptance/watchlistTitleHit.mjs and the RAW artifact cited in docs/agent/program/PR-watchlist-title-hit.md.
// The structural rail below is labelled STRUCTURAL ONLY.
import { render, screen, waitFor, fireEvent, act, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, beforeEach, afterEach, test, expect, describe } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'


// ── Heavy leaves that never render in embedded mode but cost real import time ──
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))

// ── Data hooks ──
// AAPL carries a note the user WROTE — it is the field the declutter orphaned, so
// seeing it in the editor is half the point of this restore.
const WL = {
  id: 'wl1', name: 'Momentum Plays', description: '',
  items: [{ id: 'i1', sym: 'AAPL', notes: 'waiting on the 50d reclaim' }],
}
const COMMUNITY_WL = {
  id: 'cw1', name: "Ravi's Board", description: '', owner_name: 'Ravi',
  items: [{ id: 'ci1', sym: 'TSLA', notes: 'his note, not yours' }],
}
const mutateMine = vi.fn()
// Prebuilt rows are swapped per test (an alias pick needs one carrying `alias`).
const hoisted = vi.hoisted(() => ({ prebuilt: [], role: 'user', copyOrLink: false, toggleShare: null, flagged: ['NVDA'] }))
// Keys are matched on the PATH: the prebuilt catalogue is now requested as the
// slim directory (`?include_items=0`), and a prebuilt list's MEMBERSHIP arrives
// through a separate array-keyed fetch. Matching whole URL strings made this mock
// silently answer `[]` the moment a flag was added — which is how the page under
// test lost its rows without any production code being wrong.
const _key = (k) => (typeof k === 'string' ? k.split('?')[0] : null)
vi.mock('swr', () => ({
  default: (key) => {
    if (_key(key) === '/api/watchlists') return { data: [WL], mutate: mutateMine }
    if (_key(key) === '/api/watchlists/public') return { data: [COMMUNITY_WL], mutate: () => {} }
    if (_key(key) === '/api/watchlists/prebuilt') return { data: hoisted.prebuilt, mutate: () => {} }
    return { data: undefined, mutate: () => {} }
  },
}))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: hoisted.role, display_name: 'Pat' }, watchlistCopyOrLinkEnabled: hoisted.copyOrLink }),
}))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: hoisted.flagged, toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: (...a) => hoisted.toggleShare?.(...a), flaggedName: 'Flagged', renameFlagged: () => {},
  }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }),
}))
const createAlert = vi.fn()
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({
    alerts: [], createAlert, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false,
  }),
}))
vi.mock('../hooks/useTagColors', () => ({
  default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: () => {} }),
}))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistThemes', () => ({ default: () => ({ themeData: {}, isLoading: false }) }))
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('./charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))
const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))

const Watchlists = (await import('./Watchlists')).default

let fetchMock
beforeEach(() => {
  hoisted.prebuilt = []
  mutateMine.mockClear()
  createAlert.mockClear()
  navigateMock.mockClear()
  localStorage.clear()
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })
// ⭐ OWNER GO 2026-11-09: the list menu, reachable from the list TITLE in the Charts watchlist widget (pick mode hides the
// list's own header). The SAME menu and handlers; right-click, a ⋯ menu button (Enter, Space, Shift+F10) and a long-press
// open it; Escape closes it and focus returns to the trigger; pick mode and selection are unchanged. LOCAL / SIMULATED.
const renderPick = (pickList = 'user:wl1', pickName = 'Momentum Plays') => render(<Watchlists embedded pickList={pickList} pickName={pickName} />)
const titleEl = () => document.querySelector('[data-guide="watchlist.title"]')
const menuBtn = () => screen.queryByRole('button', { name: 'List actions' })
const menu = () => document.querySelector('[data-guide="watchlist.rowMenu"]')
const inMenu = (name) => [...(menu()?.querySelectorAll('button') || [])].find(b => b.textContent.trim() === name)
const itemNames = () => [...(menu()?.querySelectorAll('button') || [])].map(b => b.textContent.trim())
const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET').map(([u, init]) => [init.method, String(u), init.body || null])

beforeEach(() => { hoisted.role = 'user'; hoisted.copyOrLink = false; hoisted.toggleShare = vi.fn() })

describe('the list menu from the title', () => {
  test('right-click on the title opens the list menu, with the list-level actions pick mode hides', async () => {
    renderPick()
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    expect(menu()).toBeTruthy()
    const names = itemNames()
    for (const n of ['Rename', 'Copy list to clipboard', 'Export CSV', 'Import tickers', 'Share with community']) expect(names).toContain(n)
    // the menu is the LIST menu, never the row menu
    expect(names.some(n => /Remove from watchlist|Full Research/.test(n))).toBe(false)
  })

  test('keyboard: the ⋯ menu button opens it (Enter / Space are its clicks, Shift+F10 too), the first item takes focus, Escape closes it and focus returns to ⋯', async () => {
    const user = userEvent.setup()
    renderPick()
    const btn = menuBtn()
    expect(btn).toHaveAttribute('aria-haspopup', 'menu')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    btn.focus()
    await user.keyboard('{Enter}')
    expect(menu()).toBeTruthy()
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(menu().contains(document.activeElement)).toBe(true)
    await user.keyboard('{ArrowDown}')
    expect(menu().contains(document.activeElement)).toBe(true)
    await user.keyboard('{Escape}')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(btn)
    // Shift+F10, the platform's context-menu key
    fireEvent.keyDown(btn, { key: 'F10', shiftKey: true })
    expect(menu()).toBeTruthy()
    // a click outside closes it, and focus goes back to ⋯ as well
    fireEvent.click(menu().parentElement)
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(btn)
  })

  test('touch: a long-press on the title opens it, and so does a tap on ⋯', async () => {
    vi.useFakeTimers()
    try {
      renderPick()
      fireEvent.pointerDown(titleEl(), { pointerType: 'touch', clientX: 30, clientY: 15 })
      act(() => { vi.advanceTimersByTime(500) })
      expect(menu()).toBeTruthy()
    } finally { vi.useRealTimers() }
    cleanup()
    renderPick()
    fireEvent.click(menuBtn())
    expect(menu()).toBeTruthy()
  })

  test('the same handlers as the original buttons: Share from the title = the header\'s own lock button', async () => {
    renderPick()
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    fireEvent.click(inMenu('Share with community'))
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    const fromTitle = writes()
    fetchMock.mockClear()
    // the header's own button (rendered, hidden by pick mode's CSS)
    fireEvent.click(document.querySelector('[title="Share with community"]'))
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    expect(writes()).toEqual(fromTitle)
  })

  test('the same handlers: Rename from the title = Rename from the list name\'s own right-click (the same name field, the same save)', async () => {
    const user = userEvent.setup()
    renderPick()
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const box = await screen.findByDisplayValue('Momentum Plays')
    // the list header shows (only) while its name is edited
    expect(box.closest('[class*="wlHeaderRenaming"]')).toBeTruthy()
    await user.clear(box)
    await user.type(box, 'Leaders{Enter}')
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    const fromTitle = writes()
    cleanup(); fetchMock.mockClear()
    renderPick()
    // the original trigger: right-click the list's own name (in the header pick mode hides)
    const name = [...document.querySelectorAll('span')].find(s => s.textContent === 'Momentum Plays' && !s.contains(titleEl()))
    fireEvent.contextMenu(name, { clientX: 40, clientY: 20 })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const box2 = await screen.findByDisplayValue('Momentum Plays')
    await user.clear(box2)
    await user.type(box2, 'Leaders{Enter}')
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    expect(writes()).toEqual(fromTitle)
  })

  test('an admin: Publish to Prebuilt from the title = the header\'s star button', async () => {
    hoisted.role = 'admin'
    renderPick()
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    fireEvent.click(inMenu('Publish to Prebuilt (UCT)'))
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    const fromTitle = writes()
    fetchMock.mockClear()
    fireEvent.click(document.querySelector('[title="Publish to Prebuilt (UCT)"]'))
    await waitFor(() => expect(writes().length).toBeGreaterThan(0))
    expect(writes()).toEqual(fromTitle)
  })

  test('Flagged: its share toggle from the title calls the same toggleShare', async () => {
    renderPick('flagged', 'Flagged')
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    expect(itemNames()).toContain('Rename')
    fireEvent.click(inMenu('Share with community'))
    expect(hoisted.toggleShare).toHaveBeenCalledTimes(1)
  })

  test('a community list: Copy, and Save to My Lists (the header button\'s dialog) when that is on; no owner actions', async () => {
    hoisted.copyOrLink = true
    renderPick('community:cw1', "Ravi's Board")
    fireEvent.contextMenu(titleEl(), { clientX: 40, clientY: 20 })
    const names = itemNames()
    expect(names).toContain('Copy list to clipboard')
    expect(names).toContain('Save to My Lists…')
    for (const n of ['Rename', 'Export CSV', 'Import tickers', 'Share with community']) expect(names).not.toContain(n)
  })
})

describe('STRUCTURAL ONLY (not a hit test): the title\'s text is the element that takes the list-menu presses', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/pages/Watchlists.module.css'), 'utf8')
  const rule = (name) => (new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css) || [])[1] || ''
  test('the full-width label stays pointer-events: none; the inner text span is pointer-events: auto and carries the anchor', () => {
    expect(rule('pickTitle')).toMatch(/pointer-events:\s*none/)
    expect(rule('pickTitleHit')).toMatch(/pointer-events:\s*auto/)
    renderPick()
    const hit = titleEl()
    expect(hit.className).toMatch(/pickTitleHit/)
    expect(hit.parentElement.className).toMatch(/pickTitle/)
    expect(hit.parentElement.getAttribute('data-guide')).toBeNull()
    expect(hit.textContent).toBe('Momentum Plays')
  })
  test('the inner span adds only the list-menu presses: no click handler, so a left click on it bubbles as before', () => {
    renderPick()
    const hit = titleEl()
    const props = Object.entries(hit).find(([k]) => k.startsWith('__reactProps'))?.[1] || {}
    expect(typeof props.onContextMenu).toBe('function')
    expect(typeof props.onPointerDown).toBe('function')   // the long-press (touch only; a mouse returns at once)
    expect(props.onClick).toBeUndefined()
    expect(props.onMouseDown).toBeUndefined()
  })
})

describe('pick mode and selection are unchanged', () => {
  test('clicking the title does what it did (nothing): no menu, no write, no navigation', () => {
    renderPick()
    fireEvent.click(titleEl())
    expect(menu()).toBeNull()
    expect(writes()).toEqual([])
    expect(navigateMock).not.toHaveBeenCalled()
  })
  test('a row click opens no list menu', async () => {
    const user = userEvent.setup()
    renderPick()
    await user.click(screen.getByText('AAPL'))
    expect(itemNames().filter(n => n === 'Rename')).toEqual([])
  })
  test('a list with no list menu (a host\'s own title, a scan) gets no ⋯ and no title menu', () => {
    render(<Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" pickTitleSlot={<span>Host title</span>} />)
    expect(menuBtn()).toBeNull()
    expect(titleEl()).toBeNull()
    cleanup()
    render(<Watchlists embedded pickList="scan:x" pickName="A scan" scanSymbols={['AAPL']} />)
    expect(menuBtn()).toBeNull()
  })
  test('the list header stays hidden in pick mode when nothing is being renamed', () => {
    renderPick()
    expect(document.querySelector('[class*="wlHeaderRenaming"]')).toBeNull()
  })
})

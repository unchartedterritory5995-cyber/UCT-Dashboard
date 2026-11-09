// The Agent on the Watchlists page: a READ-ONLY, teaching-only page host (owner-approved, 2026-11-09).
// Rails for the owner's limits: the host carries no write method and no watchlist door, registering it writes
// nothing to any watchlist store, it never navigates on its own, and the Charts widget's embedded list never
// registers it. LOCAL / SIMULATED.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

// ── the Watchlists page's heavy leaves and data hooks (as Watchlists.rowmenu.test.jsx stubs them) ──
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
vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))

const WL = { id: 'wl1', name: 'Momentum Plays', description: '', items: [{ id: 'i1', sym: 'AAPL', notes: '' }] }
const store = vi.hoisted(() => ({ mutates: [], setPrefs: [], flagWrites: [], tagWrites: [], alertWrites: [] }))
const _key = (k) => (typeof k === 'string' ? k.split('?')[0] : null)
vi.mock('swr', async (orig) => {
  const real = await orig()
  const mutate = (key) => (...a) => { store.mutates.push([key, ...a]) }
  return {
    ...real,
    default: (key) => {
      if (_key(key) === '/api/watchlists') return { data: [WL], mutate: mutate(key) }
      if (_key(key) === '/api/watchlists/public') return { data: [], mutate: mutate(key) }
      if (_key(key) === '/api/watchlists/prebuilt') return { data: [], mutate: mutate(key) }
      return { data: undefined, mutate: mutate(key) }
    },
    mutate: (...a) => { store.mutates.push(['global', ...a]); return Promise.resolve() },
  }
})
vi.mock('../context/AuthContext', async (orig) => ({ ...(await orig()), useAuth: () => ({ user: { id: 'u1', role: 'admin', display_name: 'Pat' } }) }))
vi.mock('../hooks/useFlagged', () => ({
  useFlagged: () => ({
    flagged: [], toggle: (...a) => store.flagWrites.push(a), remove: (...a) => store.flagWrites.push(a), isFlagged: () => false,
    isShared: false, toggleShare: (...a) => store.flagWrites.push(a), flaggedName: 'Flagged', renameFlagged: (...a) => store.flagWrites.push(a),
  }),
}))
vi.mock('../hooks/useTickerTags', () => ({
  default: () => ({
    tags: {}, setTag: (...a) => store.tagWrites.push(a), removeTag: (...a) => store.tagWrites.push(a), getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: (...a) => store.tagWrites.push(a), communityTags: [],
  }),
}))
vi.mock('../hooks/useWatchlistAlerts', () => ({
  default: () => ({ alerts: [], createAlert: (...a) => store.alertWrites.push(a), deleteAlert: (...a) => store.alertWrites.push(a), getAlertsForSym: () => [], hasAlert: () => false }),
}))
vi.mock('../hooks/useTagColors', () => ({ default: () => ({ tagColors: [], tagByKey: {}, setTagLabel: (...a) => store.tagWrites.push(a) }) }))
vi.mock('../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: (...a) => store.setPrefs.push(a), loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
vi.mock('../hooks/useWatchlistPerformance', () => ({ default: () => ({ perfData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistMeta', () => ({ default: () => ({ metaData: {}, isLoading: false }) }))
vi.mock('../hooks/useWatchlistThemes', () => ({ default: () => ({ themeData: {}, isLoading: false }) }))
vi.mock('../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../pages/charts/ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))
const routerNavigate = vi.fn()
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => routerNavigate }))

import { AgentContext } from './agentApp'
import { useWatchlistsAgentHost } from './hosts/usePageAgentHosts'
import { buildPageHost } from './hosts/pageHosts'
import AgentPanel from './AgentPanel'
const Watchlists = (await import('../pages/Watchlists')).default

let fetched
let setItems
beforeEach(() => {
  for (const k of Object.keys(store)) store[k] = []
  routerNavigate.mockClear()
  try { localStorage.clear() } catch { /* */ }
  fetched = []
  const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } })
  globalThis.fetch = vi.fn(async (url, init) => {
    fetched.push({ url: String(url), method: String(init?.method || 'GET').toUpperCase(), body: init?.body ? JSON.parse(init.body) : null })
    if (url === '/api/agent/turn') return json({ conversationId: 'ac_1', turnId: 1, envelope: { disposition: 'answer', reply: 'ok', question: null, ops: [], unsupported_category: null }, usage: { citations: [] } })
    if (url === '/api/agent/record') return json({ conversationId: 'ac_1' })
    if (String(url).startsWith('/api/agent/conversations')) return json({ conversations: [] })
    return json({})
  })
  const real = Storage.prototype.setItem
  setItems = []
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (k, v) { setItems.push(k); return real.call(this, k, v) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const writes = () => fetched.filter(f => f.method !== 'GET')
const makeApp = () => {
  const registered = []
  return {
    registered,
    app: {
      allowed: true,
      navigate: vi.fn(),
      registerPage: vi.fn((entry) => { registered.push(entry); return () => {} }),
    },
  }
}

function Probe({ embedded, onHost }) {
  onHost(useWatchlistsAgentHost({ embedded }))
  return null
}

describe('The Agent on the Watchlists page: read-only, teaching only', () => {
  it('the host is the bare page frame: surface, location, navigate; no write method, no watchlist door', () => {
    const { app, registered } = makeApp()
    let host
    render(<AgentContext.Provider value={app}><Probe embedded={false} onHost={(h) => { host = h }} /></AgentContext.Provider>)
    expect(Object.keys(host).sort()).toEqual(['location', 'navigate', 'surface'])
    expect(host.surface).toBe('watchlists')
    // none of the doors a capability writes through (host.js's watchlists library, a page's applyScreen / create …)
    for (const door of ['watchlists', 'lists', 'applyScreen', 'create', 'refresh', 'refreshSaved', 'persist', 'setPref', 'request', 'apply', 'mutate']) expect(host[door]).toBeUndefined()
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ surface: 'watchlists', host, owned: false })
    // reading where the member is changes nothing, and the host never navigates on its own
    host.location()
    expect(app.navigate).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('navigate only forwards to the app\'s allow-listed navigation when called (the member\'s Yes), once per call', () => {
    const { app } = makeApp()
    let host
    render(<AgentContext.Provider value={app}><Probe embedded={false} onHost={(h) => { host = h }} /></AgentContext.Provider>)
    expect(app.navigate).not.toHaveBeenCalled()
    host.navigate('/charts')
    expect(app.navigate).toHaveBeenCalledTimes(1)
    expect(app.navigate).toHaveBeenCalledWith('/charts')
  })

  it('the Charts widget\'s embedded list never registers it', () => {
    const { app } = makeApp()
    let host = 'unset'
    render(<AgentContext.Provider value={app}><Probe embedded onHost={(h) => { host = h }} /></AgentContext.Provider>)
    expect(host).toBeNull()
    expect(app.registerPage).not.toHaveBeenCalled()
  })

  it('outside a provider (a member, a pop-out, tests) it registers nothing and returns null', () => {
    let host = 'unset'
    render(<Probe embedded={false} onHost={(h) => { host = h }} />)
    expect(host).toBeNull()
  })

  it('a member without the Agent (allowed false) registers nothing', () => {
    const { app } = makeApp()
    app.allowed = false
    render(<AgentContext.Provider value={app}><Probe embedded={false} onHost={() => {}} /></AgentContext.Provider>)
    expect(app.registerPage).not.toHaveBeenCalled()
  })

  it('mounting the page with the Agent writes nothing more to any watchlist store than mounting it without', () => {
    const snapshot = () => ({
      writes: writes(), mutates: store.mutates.length, setPrefs: store.setPrefs.length, flags: store.flagWrites.length,
      tags: store.tagWrites.length, alerts: store.alertWrites.length, storage: [...setItems].sort(), nav: routerNavigate.mock.calls.length,
    })
    const bare = render(<Watchlists pickList="user:wl1" pickName="Momentum Plays" />)
    const without = snapshot()
    bare.unmount()
    for (const k of Object.keys(store)) store[k] = []
    fetched = []
    setItems = []
    routerNavigate.mockClear()

    const { app, registered } = makeApp()
    const { container } = render(<AgentContext.Provider value={app}><Watchlists pickList="user:wl1" pickName="Momentum Plays" /></AgentContext.Provider>)
    expect(registered.map(r => r.surface)).toEqual(['watchlists'])
    const host = registered[0].host
    host.location()
    expect(snapshot()).toEqual(without)
    expect(writes()).toEqual([])
    expect(app.navigate).not.toHaveBeenCalled()
    // the attribute-only anchors: the page root and the list name
    expect(container.querySelector('[data-guide="watchlists.page"]')).not.toBeNull()
  })

  it('the Charts widget\'s list (embedded) carries no page anchor and registers no host', () => {
    const { app } = makeApp()
    const { container } = render(<AgentContext.Provider value={app}><Watchlists embedded pickList="user:wl1" pickName="Momentum Plays" /></AgentContext.Provider>)
    expect(app.registerPage).not.toHaveBeenCalled()
    expect(container.querySelector('[data-guide="watchlists.page"]')).toBeNull()
    expect(container.querySelector('[data-guide="watchlist.listName"]')).toBeNull()
    expect(container.innerHTML).toContain('Momentum Plays')
  })

  it('the manifest the Agent sends from this page offers no watchlist, chart or widget capability, and every non-read is navigation', async () => {
    // everything else offered here is a read (`query`): the everyPage data reads, guide.show / guide.explain (teaching)
    const host = buildPageHost({ surface: 'watchlists', location: () => '/watchlists', navigate: () => {} })
    render(<AgentPanel host={host} surface="watchlists" onClose={() => {}} />)
    const box = screen.getByLabelText('Message UCT Agent')
    fireEvent.change(box, { target: { value: 'hello there' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await screen.findByText('ok')
    const turn = fetched.find(f => f.url === '/api/agent/turn')
    const caps = turn.body.capabilities
    const names = caps.map(c => c.name)
    expect(names.some(n => /^(watchlist|chart|widget|journal|layout|alert|indicator|digest)\./.test(n))).toBe(false)
    expect(caps.filter(c => !c.query).map(c => c.name)).toEqual(['app.open'])
    expect(turn.body.context.surface).toBe('watchlists')
    expect(writes().filter(f => !f.url.startsWith('/api/agent/'))).toEqual([])
  })
})

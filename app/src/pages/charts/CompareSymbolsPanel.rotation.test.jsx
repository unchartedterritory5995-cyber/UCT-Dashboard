// Compare Symbols → Rotation (UCT RS Phase 3, unit 3-12): the tabs, where the names come from,
// the cap and its sentence, ONE formula (the graph's points are `rrgPath`'s on the shared
// fixture), the `uct:compare-open` event, and keyboard and aria. Nothing on the path under test is
// mocked except the network (`fetch`).
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import CompareSymbolsPanel from './CompareSymbolsPanel'
import { capSentence, capUniverse, resolveRotationUniverse } from './rotationUniverse'
import { COMPARE_OPEN_EVENT } from './compareGroups'
import { RRG_MAX } from '../terminal/panels/RrgPanel'
import { closesFromBars, rrgPath } from '../terminal/panels/relativeMath'
import { clearClosesCache } from '../terminal/panels/useCloses'
import { graphGeometry } from '../../components/rotation/RrgGraph'
import { barsPayload, fridays, series, wiggle } from '../terminal/panels/__fixtures__/compareFixtures'

const here = dirname(fileURLToPath(import.meta.url))
const WAIT = { timeout: 5000 }

function makeApi(initial = []) {
  let comp = initial
  return {
    getComparison: vi.fn(() => comp),
    setComparison: vi.fn((arr) => { comp = arr }),
    getPercentScale: vi.fn(() => false),
    setPercentScale: vi.fn(),
  }
}

function Wrap({ api, initialIntent = null }) {
  const chartApiById = useRef(new Map([['chart-1', api]]))
  const activeChartRef = useRef('chart-1')
  return <CompareSymbolsPanel chartApiById={chartApiById} activeChartRef={activeChartRef} onClose={() => {}} initialIntent={initialIntent} />
}

const comps = (...syms) => syms.map((sym) => ({ sym, enabled: true, color: '#60a5fa', scaleMode: 'new' }))

// ── a fake network ────────────────────────────────────────────────────────────────────────
const dates = fridays(60)
const bench = series(dates, (i) => 0.002 * wiggle(i, 4))
const leader = (k = 1) => series(dates, (i) => 0.002 * wiggle(i, 4) + 0.0004 * k)
const laggard = (k = 1) => series(dates, (i) => 0.002 * wiggle(i, 4) - 0.0004 * k)

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body })
const realFetch = globalThis.fetch
let calls
function serve({ bars = {}, routes = {} } = {}) {
  calls = []
  globalThis.fetch = vi.fn((url, init) => {
    const u = String(url)
    calls.push({ url: u, init })
    const m = u.match(/\/api\/bars\/([^?]+)/)
    if (m) {
      const s = bars[decodeURIComponent(m[1])]
      if (!s) return json({ detail: 'no data' }, 404)
      return json(Array.isArray(s) ? barsPayload(s) : s)
    }
    for (const [prefix, answer] of Object.entries(routes)) {
      if (u.startsWith(prefix)) return typeof answer === 'function' ? answer(u, init) : json(answer)
    }
    return json({}, 404)
  })
}
const barsAsked = () => calls.map((c) => c.url.match(/\/api\/bars\/([^?]+)/)?.[1]).filter(Boolean).map(decodeURIComponent)

beforeEach(() => { clearClosesCache() })
afterEach(() => { globalThis.fetch = realFetch })

async function openRotation() {
  fireEvent.click(screen.getByRole('tab', { name: 'Rotation' }))
  return screen.findByTestId('compare-rotation', {}, WAIT)
}

describe('tabs', () => {
  it('a proper tablist: Overlay is selected first, Rotation is the second tab, arrows and Home/End move', async () => {
    serve()
    render(<Wrap api={makeApi()} />)
    const list = screen.getByRole('tablist', { name: 'Compare view' })
    const tabs = within(list).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Overlay', 'Rotation'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs[0].tabIndex).toBe(0)
    expect(tabs[1].tabIndex).toBe(-1)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[0].id)
    // the overlay panel is today's panel
    expect(screen.getByPlaceholderText(/Add symbol/i)).toBeInTheDocument()

    tabs[0].focus()
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tabs[1].id)
    expect(screen.queryByPlaceholderText(/Add symbol/i)).toBeNull()
    fireEvent.keyDown(tabs[1], { key: 'Home' })
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[0], { key: 'End' })
    expect(tabs[1].getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' })
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })
})

describe('universe', () => {
  it('pure: own symbols first, then a group, then a watchlist; an explicit choice wins; SPY never plots', () => {
    const group = { type: 'theme', name: 'G', symbols: ['AAA', 'BBB'] }
    const watchlist = { id: '1', name: 'W', symbols: ['CCC'] }
    expect(resolveRotationUniverse({ own: ['xlk', 'SPY', 'XLK'], group, watchlist })).toMatchObject({ source: 'own', syms: ['XLK'] })
    expect(resolveRotationUniverse({ own: [], group, watchlist })).toMatchObject({ source: 'group', syms: ['AAA', 'BBB'] })
    expect(resolveRotationUniverse({ own: [], group: null, watchlist })).toMatchObject({ source: 'watchlist', syms: ['CCC'] })
    expect(resolveRotationUniverse({ own: ['XLK'], group, watchlist, prefer: 'watchlist' })).toMatchObject({ source: 'watchlist' })
    expect(resolveRotationUniverse({})).toMatchObject({ source: null, syms: [] })
  })

  it("the panel's own compared symbols plot first, and only they (plus SPY) are read", async () => {
    serve({ bars: { SPY: bench, XLK: leader(), XLU: laggard() } })
    render(<Wrap api={makeApi(comps('XLK', 'XLU'))} />)
    await openRotation()
    expect((await screen.findByTestId('rrg-point-XLK', {}, WAIT)).getAttribute('data-quadrant')).toBeTruthy()
    expect(screen.getByTestId('compare-rotation-source').textContent).toBe('Your compared symbols · 2 names')
    expect(barsAsked().sort()).toEqual(['SPY', 'XLK', 'XLU'])
    expect(calls.some((c) => c.url.startsWith('/api/watchlists'))).toBe(false)
    expect(screen.queryByTestId('compare-rotation-cap')).toBeNull()
  })

  it('with no compared symbols, a picked group plots through the panel\'s group resolver', async () => {
    serve({
      bars: { SPY: bench, NVDA: leader(2), AMD: leader(1), INTC: laggard() },
      routes: {
        '/api/watchlists': [],
        '/api/compare/groups?type=theme': { groups: [{ name: 'AI Chips', count: 3 }] },
        '/api/compare/group-members?type=theme&name=AI%20Chips': { name: 'AI Chips', symbols: ['NVDA', 'AMD', 'INTC'], total: 3, truncated: false },
      },
    })
    render(<Wrap api={makeApi()} />)
    await openRotation()
    fireEvent.click(screen.getByRole('button', { name: 'Themes' }))
    fireEvent.click(await screen.findByRole('button', { name: /AI Chips/ }, WAIT))
    await screen.findByTestId('rrg-point-NVDA', {}, WAIT)
    expect(screen.getByTestId('compare-rotation-source').textContent).toBe('Theme: AI Chips · 3 names')
    expect(barsAsked().sort()).toEqual(['AMD', 'INTC', 'NVDA', 'SPY'])
  })

  it('else a watchlist picked from GET /api/watchlists?include_items', async () => {
    serve({
      bars: { SPY: bench, MSFT: leader(), ORCL: laggard() },
      routes: {
        '/api/watchlists': [
          { id: 'w1', name: 'Core', items: [{ sym: 'MSFT' }, { sym: 'ORCL' }] },
          { id: 'w2', name: 'Empty', items: [] },
        ],
      },
    })
    render(<Wrap api={makeApi()} />)
    await openRotation()
    const select = screen.getByTestId('compare-rotation-watchlist')
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Watchlist…', 'Core (2)']), WAIT)
    expect(calls.find((c) => c.url.startsWith('/api/watchlists')).url).toBe('/api/watchlists?include_items=1&include_prebuilt=0')
    fireEvent.change(select, { target: { value: 'w1' } })
    await screen.findByTestId('rrg-point-MSFT', {}, WAIT)
    expect(screen.getByTestId('compare-rotation-source').textContent).toBe('Watchlist: Core · 2 names')
  })
})

describe('the cap', () => {
  const big = Array.from({ length: 15 }, (_, i) => `N${String(i).padStart(2, '0')}`)
  const bigBars = () => Object.fromEntries([['SPY', bench], ...big.map((s, i) => [s, i % 2 ? leader(1 + i / 10) : laggard(1 + i / 10)])])
  const groupRoutes = {
    '/api/watchlists': [],
    '/api/compare/groups?type=theme': { groups: [{ name: 'Big', count: 15 }] },
    '/api/compare/group-members?type=theme&name=Big': { name: 'Big', symbols: big, total: 15, truncated: false },
  }

  it('pure: the 12 highest ratings (unrated last), else the first 12 by symbol, and the sentence says which', () => {
    expect(RRG_MAX).toBe(12)
    const ratings = Object.fromEntries(big.map((s, i) => [s, i]))   // N14 is the highest
    const top = capUniverse(big, ratings)
    expect(top).toMatchObject({ total: 15, order: 'rating' })
    expect(top.shown).toEqual([...big].reverse().slice(0, 12))
    expect(capSentence(top)).toBe('12 of 15 names, highest RS rating first.')
    const alpha = capUniverse([...big].reverse(), null)
    expect(alpha.shown).toEqual(big.slice(0, 12))
    expect(capSentence(alpha)).toBe('12 of 15 names, first 12 by symbol.')
    expect(capSentence(capUniverse(big.slice(0, 5), null))).toBe('')
    expect(capSentence({ shown: big.slice(0, 12), total: 50, order: 'rating' }, { total: 120, truncated: true }))
      .toBe('12 of 50 names, highest RS rating first. This group has 120 names; the panel reads its first 50.')
  })

  it('a bigger group plots the 12 highest RS ratings from the screener rows, and says so', async () => {
    const scan = vi.fn(() => json({ rows: big.map((s, i) => ({ ticker: s, rs_rating_ibd: i * 5 })) }))
    serve({ bars: bigBars(), routes: { ...groupRoutes, '/api/screener/scan': scan } })
    render(<Wrap api={makeApi()} />)
    await openRotation()
    fireEvent.click(screen.getByRole('button', { name: 'Themes' }))
    fireEvent.click(await screen.findByRole('button', { name: /Big/ }, WAIT))
    expect((await screen.findByTestId('compare-rotation-cap', {}, WAIT)).textContent).toBe('12 of 15 names, highest RS rating first.')
    await screen.findByTestId('compare-rotation-table', {}, WAIT)
    expect(barsAsked().sort()).toEqual(['SPY', ...big.slice(3)].sort())
    const body = JSON.parse(scan.mock.calls[0][1].body)
    expect(body).toMatchObject({ filters: [{ key: 'tickers', op: 'in', values: big }], sort: { key: 'rs_rating_ibd', dir: 'desc' }, columns: ['rs_rating_ibd'] })
  })

  it('when the screener refuses (a free plan), the first 12 by symbol, and it says that instead', async () => {
    serve({ bars: bigBars(), routes: { ...groupRoutes, '/api/screener/scan': () => json({ detail: 'The screener requires a paid plan' }, 402) } })
    render(<Wrap api={makeApi()} />)
    await openRotation()
    fireEvent.click(screen.getByRole('button', { name: 'Themes' }))
    fireEvent.click(await screen.findByRole('button', { name: /Big/ }, WAIT))
    expect((await screen.findByTestId('compare-rotation-cap', {}, WAIT)).textContent).toBe('12 of 15 names, first 12 by symbol.')
    await screen.findByTestId('compare-rotation-table', {}, WAIT)
    expect(barsAsked().sort()).toEqual(['SPY', ...big.slice(0, 12)].sort())
  })
})

describe('one formula', () => {
  const FIX = [join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'), join(process.cwd(), 'tests', 'fixtures', 'indicators')]
    .find((p) => existsSync(join(p, 'rs_rrg.json')))
  const fx = JSON.parse(readFileSync(join(FIX, 'rs_rrg.json'), 'utf8'))

  it("the graph's points and the table's numbers are rrgPath's on the shared fixture (rs_rrg.json)", async () => {
    serve({ bars: { SPY: { bars: fx.benchmarkBars }, FIXT: { bars: fx.bars } } })
    render(<Wrap api={makeApi(comps('FIXT'))} />)
    await openRotation()
    fireEvent.click(screen.getByRole('button', { name: 'Daily' }))
    await waitFor(() => expect(screen.getByTestId('compare-rotation-lede').textContent).toContain('daily'), WAIT)
    const g = screen.getByTestId('rrg-point-FIXT')
    const path = rrgPath(closesFromBars({ bars: fx.bars }), closesFromBars({ bars: fx.benchmarkBars }))
    const { px, py } = graphGeometry([{ sym: 'FIXT', ...path }])
    expect(g.querySelector('polyline').getAttribute('points')).toBe(path.tail.map((p) => `${px(p.x)},${py(p.y)}`).join(' '))
    expect(g.getAttribute('data-quadrant')).toBe(path.quadrant)
    const row = screen.getByTestId('compare-rotation-row-FIXT')
    expect(row.textContent).toContain(path.ratio.toFixed(2))
    expect(row.textContent).toContain(path.momentum.toFixed(2))
    // the Terminal's method line, under the graph
    const method = screen.getByTestId('compare-rotation-method').textContent
    expect(method).toContain("UCT's approximation, not JdK's proprietary formula: RS = 100 × price ÷ SPY;")
    expect(method).toContain('RS-Ratio = 100 × RS ÷ its 10-session average; RS-Momentum = 100 × RS-Ratio ÷ its 5-session average. Tails show the last 8 sessions.')
    const daily = calls.filter((c) => c.url.includes('/api/bars/') && c.url.includes('tf=D')).map((c) => c.url.match(/\/api\/bars\/([^?]+)/)[1])
    expect(daily.sort()).toEqual(['FIXT', 'SPY'])
  })

  it('weekly closes by default; the toggle reads daily', async () => {
    serve({ bars: { SPY: bench, XLK: leader() } })
    render(<Wrap api={makeApi(comps('XLK'))} />)
    await openRotation()
    await screen.findByTestId('rrg-point-XLK', {}, WAIT)
    expect(screen.getByRole('button', { name: 'Weekly' }).getAttribute('aria-pressed')).toBe('true')
    expect(calls.filter((c) => c.url.includes('/api/bars/')).every((c) => c.url.includes('tf=W'))).toBe(true)
    expect(screen.getByTestId('compare-rotation-lede').textContent).toContain('weekly')
  })
})

describe('uct:compare-open', () => {
  const routes = {
    '/api/ticker-meta/NVDA': { name: 'NVIDIA', sector: 'Technology', industry: 'Semiconductors', theme: 'AI Chips' },
    '/api/compare/group-members?type=theme&name=AI%20Chips': { name: 'AI Chips', symbols: ['NVDA', 'AMD'], total: 2, truncated: false },
    '/api/watchlists': [],
  }

  it("an open while the panel is up switches to Rotation and plots the symbol's theme", async () => {
    serve({ bars: { SPY: bench, NVDA: leader(), AMD: laggard() }, routes })
    render(<Wrap api={makeApi(comps('QQQ'))} />)
    expect(screen.getByRole('tab', { name: 'Overlay' }).getAttribute('aria-selected')).toBe('true')
    act(() => { window.dispatchEvent(new CustomEvent(COMPARE_OPEN_EVENT, { detail: { tab: 'rotation', sym: 'NVDA', group: 'theme' } })) })
    expect(screen.getByRole('tab', { name: 'Rotation' }).getAttribute('aria-selected')).toBe('true')
    await screen.findByTestId('rrg-point-NVDA', {}, WAIT)
    expect(screen.getByTestId('compare-rotation-source').textContent).toBe('Theme: AI Chips · 2 names')
  })

  it('the detail that opened the panel lands it on Rotation; a symbol with no theme on file says so', async () => {
    serve({ routes: { ...routes, '/api/ticker-meta/ZZZ': { name: null, sector: null, industry: null, theme: null } } })
    render(<Wrap api={makeApi()} initialIntent={{ tab: 'rotation', sym: 'ZZZ', group: 'theme' }} />)
    await screen.findByTestId('compare-rotation', {}, WAIT)
    expect(screen.getByRole('tab', { name: 'Rotation' }).getAttribute('aria-selected')).toBe('true')
    expect((await screen.findByTestId('compare-rotation-note', {}, WAIT)).textContent).toBe('No theme is on file for ZZZ.')
  })
})

describe('aria and brand', () => {
  it('the graph has an accessible name naming each quadrant, and each name has a text row with its quadrant', async () => {
    serve({ bars: { SPY: bench, XLK: leader(), XLU: laggard() } })
    render(<Wrap api={makeApi(comps('XLK', 'XLU'))} />)
    await openRotation()
    await screen.findByTestId('rrg-point-XLK', {}, WAIT)
    const graph = within(screen.getByTestId('compare-rotation-graph')).getByRole('img')
    expect(graph.getAttribute('aria-label')).toMatch(/^Relative rotation graph vs SPY, RS-Ratio across and RS-Momentum up, centred on 100\. /)
    const table = screen.getByRole('table', { name: 'Where each name sits, vs SPY' })
    for (const sym of ['XLK', 'XLU']) {
      const q = screen.getByTestId(`rrg-point-${sym}`).getAttribute('data-quadrant')
      expect(graph.getAttribute('aria-label')).toContain(sym)
      const row = within(table).getByTestId(`compare-rotation-row-${sym}`)
      expect(within(row).getByRole('rowheader').textContent).toContain(sym)
      expect(row.textContent).toContain(q)
    }
    expect(screen.getByTestId('compare-rotation-legend').textContent).toContain('Leading: stronger than SPY and gaining on it.')
  })

  it('no gold in the Rotation view: its rules use no accent, gold or --warn, and the graph takes the non-gold amber', () => {
    const css = readFileSync(join(here, 'CompareSymbolsPanel.module.css'), 'utf8')
    const rot = css.slice(css.indexOf('Tabs: Overlay | Rotation'))
    expect(rot.length).toBeGreaterThan(500)
    expect(rot).not.toMatch(/--accent|--ut-gold|var\(--warn\)|#dcbb5e|#c9a84c/i)
    expect(rot).toMatch(/\.rot \{[^}]*--rrg-weakening: var\(--ind-warn\)/)
    const graphCss = readFileSync(join(here, '..', '..', 'components', 'rotation', 'RrgGraph.module.css'), 'utf8')
    expect(graphCss).toMatch(/\.qWeakening \{ stroke: var\(--rrg-weakening, var\(--warn\)\)/)
  })

  it('no text under 11 px in the Rotation view (spec §12.2): every font-size its rules declare is 11 px or more', () => {
    const css = readFileSync(join(here, 'CompareSymbolsPanel.module.css'), 'utf8').replace(/[/][*][^]*?[*][/]/g, '')
    const rot = css.slice(css.indexOf('.rot {'))
    const sizes = [...rot.matchAll(/font-size:[ ]*([0-9.]+)px/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBeGreaterThan(5)
    expect(sizes.filter((n) => n < 11)).toEqual([])
    expect(rot).toMatch(/[.]rotPill [{][^}]*font-size: 11px/)
  })
})

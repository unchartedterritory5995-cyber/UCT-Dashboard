// Panel fit, part 5: FA and EE hold a table with one column per period, wider than a 592px desktop
// panel or a phone. It scrolls sideways inside its own box (`.scroll`), the row labels stay in
// place (FmpDepth.stickyColumn.test.js) and, while it scrolls, the box is a Tab stop and a named
// region. Every number and name below is invented.
//
// jsdom lays nothing out (scrollWidth and clientWidth read 0), so the two widths are stated here,
// and the stylesheet half is pinned from the source.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SWRConfig } from 'swr'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../research-kit', () => ({
  SeriesChart: () => <div data-testid="chart" />,
  MetricTrendChart: () => <div data-testid="trend" />,
  EmptyState: ({ title }) => <div data-testid="empty-state">{title}</div>,
}))

import SidewaysScroll from './SidewaysScroll'
import StatementTables from './StatementTables'
import ConsensusEstimates from './ConsensusEstimates'

const here = dirname(fileURLToPath(import.meta.url))
const source = (name) => readFileSync(join(here, name), 'utf8').replace(/\r\n/g, '\n')

// The box is the element that holds a <table>; `room` is what it shows, `need` what the table takes.
let room
let need
let observers
const holdsTable = (el) => el.firstElementChild?.tagName === 'TABLE'
const original = {}
beforeEach(() => {
  room = 540
  need = 540
  observers = []
  for (const [prop, read] of [['scrollWidth', () => need], ['clientWidth', () => room]]) {
    original[prop] = Object.getOwnPropertyDescriptor(Element.prototype, prop)
    Object.defineProperty(Element.prototype, prop, {
      configurable: true,
      get() { return holdsTable(this) ? read() : 0 },
    })
  }
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb; this.seen = []; this.off = false; observers.push(this) }
    observe(el) { this.seen.push(el) }
    unobserve() {}
    disconnect() { this.off = true }
  })
})
afterEach(() => {
  for (const prop of Object.keys(original)) Object.defineProperty(Element.prototype, prop, original[prop])
  vi.unstubAllGlobals()
})

const Sample = () => (
  <SidewaysScroll label="Financials by period, scrolls sideways">
    <table aria-label="Income, quarterly, newest first"><tbody><tr><th scope="row">Revenue</th><td>12.3</td></tr></tbody></table>
  </SidewaysScroll>
)
const box = () => screen.getByRole('table').parentElement

describe('SidewaysScroll: the box a wide period table scrolls in', () => {
  it('while the table is wider than the box, the box is a Tab stop and a named region', () => {
    need = 736
    render(<Sample />)
    const region = screen.getByRole('region', { name: 'Financials by period, scrolls sideways' })
    expect(region).toBe(box())
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table')).toBeInTheDocument()
  })

  it('while the table fits, the box is a plain <div>: no dead Tab stop, no region that claims to scroll', () => {
    render(<Sample />)
    expect(screen.queryByRole('region')).toBeNull()
    expect(box().getAttributeNames()).toEqual(['class'])
  })

  it('one pixel of rounding is not "wider"; two are', () => {
    need = 541
    const { unmount } = render(<Sample />)
    expect(screen.queryByRole('region')).toBeNull()
    unmount()
    need = 542
    render(<Sample />)
    expect(screen.getByRole('region')).toBe(box())
  })

  it('follows the panel: narrowed it becomes a region, widened again it stops being one', () => {
    render(<Sample />)
    expect(observers).toHaveLength(1)
    expect(observers[0].seen).toEqual([box(), screen.getByRole('table')])
    room = 316
    act(() => observers[0].cb())
    expect(box()).toHaveAttribute('role', 'region')
    expect(box()).toHaveAttribute('tabindex', '0')
    room = 900
    need = 736
    act(() => observers[0].cb())
    expect(box().getAttributeNames()).toEqual(['class'])
  })

  it('stops watching when it goes away', () => {
    const { unmount } = render(<Sample />)
    unmount()
    expect(observers[0].off).toBe(true)
  })
})

describe('FA and EE put every period table in that one box', () => {
  const PERIODS = ['Q1 2031', 'Q2 2031', 'Q3 2031']
  const HISTORY = {
    sym: 'ZZZQ', period: 'quarter', periods: PERIODS, dates: ['2031-03-31', '2031-06-30', '2031-09-30'], count: 3,
    currency: 'USD',
    series: { revenue: [1.1e9, 1.2e9, 1.3e9], net_income: [1e8, 1.1e8, 1.2e8], eps: [0.11, 0.12, 0.13] },
    ratios: {},
    source: { vendor: 'FMP', basis: 'fiscal', endpoints: ['/stable/income-statement'], fetched_at: 1924992000 },
  }
  const CONSENSUS = {
    state: 'ok', source: 'FMP /stable/analyst-estimates', fetched_at: 1924992000, currency: 'USD',
    annual: ['2032', '2033'].map((y, i) => ({
      period_end: `${y}-12-31`, label: `FY${y}`,
      eps: { avg: 1.5 + i, low: 1.25 + i, high: 1.75 + i, n: 9 },
      revenue: { avg: 5e9 + i * 1e9, low: 4.5e9, high: 6.5e9, n: 8 },
      eps_growth: 11, revenue_growth: 7, ebitda_avg: 1e9, net_income_avg: 6e8,
    })),
    quarterly: [],
  }
  const REVISIONS = {
    sym: 'ZZZQ', sources: { revisions: 'Yahoo Finance' },
    revisions: [{ period: 'Current Qtr', current: 0.5, ago30: 0.45, ago90: 0.4, up30: 3, down30: 1 }],
  }
  const FORWARD = {
    sym: 'ZZZQ', entity: null, consensus: { state: 'empty' }, sources: { consensus: 'FMP', forward: 'Yahoo Finance' },
    forward: [{ period: 'Current Qtr', eps_avg: 0.5, eps_low: 0.4, eps_high: 0.6, num_analysts: 7, eps_growth: 9, rev_avg: 1.2e9 }],
  }
  let routes
  beforeEach(() => {
    routes = {}
    need = 736
    room = 316
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const r = Object.entries(routes).find(([k]) => url.startsWith(k))
      return r ? { ok: true, status: 200, json: async () => r[1] } : { ok: false, status: 404, json: async () => ({}) }
    }))
  })
  const mount = (node) => render(
    <AuthContext.Provider value={{}}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>{node}</SWRConfig>
    </AuthContext.Provider>,
  )

  it('FA: the statement table sits in "Financials by period, scrolls sideways", newest period next to the labels', async () => {
    routes['/api/research/financial-history/ZZZQ?period=quarter'] = HISTORY
    mount(<StatementTables sym="ZZZQ" />)
    const region = await screen.findByRole('region', { name: 'Financials by period, scrolls sideways' })
    expect(region).toHaveAttribute('tabindex', '0')
    const heads = within(within(region).getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent)
    // the order is the table's own (newest first); nothing was reordered to get it
    expect(heads).toEqual(['Fiscal quarter', 'Q3 2031', 'Q2 2031', 'Q1 2031'])
  })

  it('EE: the consensus table sits in "Estimates by period, scrolls sideways"', async () => {
    routes['/api/research/estimates/ZZZQ?consensus=1'] = { sym: 'ZZZQ', entity: null, forward: [], consensus: CONSENSUS, sources: { consensus: 'FMP' } }
    mount(<ConsensusEstimates sym="ZZZQ" />)
    const region = await screen.findByRole('region', { name: 'Estimates by period, scrolls sideways' })
    expect(region).toHaveAttribute('tabindex', '0')
    expect(within(region).getByRole('table', { name: 'Analyst consensus, annual' })).toBeInTheDocument()
  })

  it('EE: the Yahoo forward table and the revisions table each get their own name', async () => {
    routes['/api/research/estimates/ZZZQ?consensus=1'] = FORWARD
    routes['/api/research/estimates/ZZZQ?revisions=1'] = REVISIONS
    mount(<ConsensusEstimates sym="ZZZQ" />)   // the revisions card is part of it, with its own read
    const forward = await screen.findByRole('region', { name: 'Forward estimates by period, scrolls sideways' })
    const revisions = await screen.findByRole('region', { name: 'Estimate revisions by period, scrolls sideways' })
    expect(within(forward).getByRole('table', { name: 'Forward estimates, Yahoo Finance' })).toBeInTheDocument()
    expect(within(revisions).getByRole('table', { name: 'EPS estimate revisions, Yahoo Finance' })).toBeInTheDocument()
  })

  it('no table of FA or EE is left in a bare scroll box (there is one scroller, not two)', () => {
    for (const [file, boxes] of [['StatementTables.jsx', 1], ['ConsensusEstimates.jsx', 3]]) {
      const text = source(file)
      expect(text, file).not.toMatch(/styles\.scroll\b/)
      const labels = [...text.matchAll(/<SidewaysScroll label="([^"]+)">\n\s*<table /g)].map((m) => m[1])
      expect(labels, file).toHaveLength(boxes)
      expect(text.match(/<table /g), file).toHaveLength(boxes)
      for (const label of labels) expect(label, file).toMatch(/^[A-Z][a-z]+( [a-z]+)* by period, scrolls sideways$/)
      expect(new Set(labels).size, file).toBe(boxes)
    }
    expect(source('SidewaysScroll.jsx').match(/styles\.scroll\b/g)).toHaveLength(1)
  })
})

describe('the scroll box in the stylesheet', () => {
  const css = source('FmpDepth.module.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
  const scrollRules = blocks.filter(([selector]) => /\.scroll(?![\w-])/.test(selector))

  it('scrolls sideways in its own box, at every width (no width condition anywhere near it)', () => {
    expect(scrollRules.map(([selector]) => selector)).toEqual(['.scroll', '.scroll:focus-visible'])
    expect(scrollRules[0][1]).toMatch(/overflow-x:\s*auto/)
  })

  it('the row labels stay in place while the periods scroll: sticky at the left edge, above the figures, on an opaque ground', () => {
    const frozen = blocks.filter(([selector]) => selector === '.table th:first-child, .table td:first-child')
    expect(frozen).toHaveLength(1)
    const rule = frozen[0][1]
    expect(rule).toMatch(/position:\s*sticky\s*;/)
    expect(rule).toMatch(/(^|;|\s)left:\s*0\s*;/)
    expect(rule).toMatch(/z-index:\s*[1-9]\d*\s*;/)
    // the ground is the card's own token (FmpDepth.stickyColumn.test.js pins which), never transparent
    expect(rule).toMatch(/background:\s*var\(--sticky-ground,\s*var\(--bg-surface\)\)\s*;/)
  })

  it('shows the gold ring on keyboard focus, drawn outside the box so the frozen column cannot cover it', () => {
    const ring = scrollRules[1][1]
    expect(ring).toMatch(/outline:\s*2px solid var\(--ut-gold\)/)
    expect(ring).toMatch(/outline-offset:\s*(0|[1-9]\d*px)\s*;/)
  })
})

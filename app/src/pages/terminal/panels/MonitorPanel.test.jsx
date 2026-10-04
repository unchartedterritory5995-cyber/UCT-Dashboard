// Lane T5 — MON, the watchlist monitor. Rails:
//   * the lists are the member's EXISTING ones (flagged, tag colours, watchlists) — no new storage;
//   * prices come from ONE useRealtimePrices call over the shown symbols (the shared pool),
//     and the panel opens no stream and no poll of its own;
//   * sorting: header click cycles desc → asc → list order, a missing value always sorts last;
//   * keyboard: arrows move the active row, Enter drives the channel; a click drives it too;
//   * row <GO>: the numbered rows are published with a `go` that drives row i (never replaces MON);
//   * a list longer than the 100-name performance cap SAYS so.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'

const h = vi.hoisted(() => ({
  flagged: [], tags: {}, lists: [], listsError: null, prices: {}, perf: {}, meta: {},
  priceCalls: [], perfCalls: [], metaCalls: [], swrCalls: [],
}))

vi.mock('swr', () => ({
  default: (key, _fetcher, opts) => {
    h.swrCalls.push([key, opts])
    return { data: h.listsError ? undefined : h.lists, error: h.listsError }
  },
}))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ flagged: h.flagged, flaggedName: null }) }))
vi.mock('../../../hooks/useTickerTags', () => ({ default: () => ({ tags: h.tags }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: (syms) => { h.priceCalls.push(syms); return { prices: h.prices, isStreaming: true } },
}))
vi.mock('../../../hooks/useWatchlistPerformance', () => ({
  default: (syms) => { h.perfCalls.push(syms); return { perfData: h.perf } },
}))
vi.mock('../../../hooks/useWatchlistMeta', () => ({
  default: (syms) => { h.metaCalls.push(syms); return { metaData: h.meta } },
}))

import MonitorPanel, {
  LISTS_URL, MAX_ROWS, buildSources, nextSort, pickSource, rowValues, sortRows,
} from './MonitorPanel'

const WL = { id: 7, name: 'Semis', items: [{ sym: 'NVDA' }, { sym: 'AMD' }, { sym: 'smci' }] }

beforeEach(() => {
  Object.assign(h, {
    flagged: [], tags: {}, lists: [WL], listsError: null,
    prices: {
      NVDA: { price: 120.5, change_pct: 2.5, volume: 3_000_000 },
      AMD: { price: 150, change_pct: -1.25, volume: 1_000_000 },
      SMCI: { price: 40, change_pct: null, volume: null },
    },
    perf: { NVDA: { '5d': 4, ytd: 80, refs: { '30d': 100 } }, AMD: { '5d': -2, ytd: 10 } },
    meta: { NVDA: { avg_vol_20d: 2_000_000, next_earnings: '2026-11-19' }, AMD: { rvol: 80 } },
    priceCalls: [], perfCalls: [], metaCalls: [], swrCalls: [],
  })
})

const symsShown = () => screen.getAllByTestId(/^terminal-monitor-row-/)
  .map((tr) => within(tr).getAllByRole('cell')[1].textContent)

describe('pure helpers', () => {
  it('buildSources: flagged first, then each NON-EMPTY tag colour, then every watchlist (deduped, upper-cased)', () => {
    const s = buildSources({ flagged: ['aapl', 'AAPL', ''], tags: { TSLA: 'green', MSFT: 'green', X: 'red' },
      lists: [WL, { id: 9, name: 'Empty', items: [] }, null] })
    expect(s.map((x) => x.id)).toEqual(['flagged', 'tag:green', 'tag:red', 'wl:7', 'wl:9'])
    expect(s[0].syms).toEqual(['AAPL'])
    expect(s[1].syms).toEqual(['MSFT', 'TSLA'])
    expect(s[3].syms).toEqual(['NVDA', 'AMD', 'SMCI'])
  })

  it('pickSource: the chosen list, else the first with names, else flagged', () => {
    const s = buildSources({ flagged: [], lists: [WL] })
    expect(pickSource(s, null).id).toBe('wl:7')
    expect(pickSource(s, 'flagged').id).toBe('flagged')
    expect(pickSource(buildSources({}), null).id).toBe('flagged')
  })

  it('rowValues: N-day returns tick against the live price when a reference close exists; RVOL from the 20d average', () => {
    const r = rowValues('NVDA', h.prices.NVDA, h.perf.NVDA, h.meta.NVDA)
    expect(r['30d']).toBeCloseTo(20.5)        // (120.5 - 100) / 100
    expect(r['5d']).toBe(4)                    // no ref: the batch's own value
    expect(r.rvol).toBe(150)                   // 3M / 2M, as a percent
    expect(r.earn).toBe('2026-11-19')
    expect(rowValues('AMD', h.prices.AMD, h.perf.AMD, h.meta.AMD).rvol).toBe(80)   // a supplied ratio wins
    expect(rowValues('ZZZ', undefined, undefined, undefined).last).toBeNull()
  })

  it('sortRows: a missing value sorts LAST both ways; key null keeps list order', () => {
    const rows = [{ sym: 'A', chg: null }, { sym: 'B', chg: 1 }, { sym: 'C', chg: 3 }]
    expect(sortRows(rows, { key: 'chg', dir: 'desc' }).map((r) => r.sym)).toEqual(['C', 'B', 'A'])
    expect(sortRows(rows, { key: 'chg', dir: 'asc' }).map((r) => r.sym)).toEqual(['B', 'C', 'A'])
    expect(sortRows(rows, { key: null }).map((r) => r.sym)).toEqual(['A', 'B', 'C'])
  })

  it('nextSort: a numeric column starts high-low, flips, then returns to list order; ticker starts A-Z', () => {
    let s = nextSort({ key: null }, 'chg')
    expect(s).toEqual({ key: 'chg', dir: 'desc' })
    s = nextSort(s, 'chg'); expect(s).toEqual({ key: 'chg', dir: 'asc' })
    s = nextSort(s, 'chg'); expect(s).toEqual({ key: null, dir: null })
    expect(nextSort({ key: 'chg', dir: 'desc' }, 'sym')).toEqual({ key: 'sym', dir: 'asc' })
  })
})

describe('MonitorPanel', () => {
  it('reads the member\'s own lists (no prebuilt, NO poll) and renders formatted columns', () => {
    render(<MonitorPanel />)
    expect(h.swrCalls[0][0]).toBe(LISTS_URL)
    expect(h.swrCalls[0][1]?.refreshInterval).toBeUndefined()
    expect(symsShown()).toEqual(['NVDA', 'AMD', 'SMCI'])
    const nvda = within(screen.getByTestId('terminal-monitor-row-1')).getAllByRole('cell').map((c) => c.textContent)
    // # · Ticker · Last · Chg · 5D · 30D · 90D · YTD · Volume · RVOL · Next ER
    expect(nvda).toEqual(['1', 'NVDA', '120.50', '+2.50%', '+4.00%', '+20.50%', '—', '+80.00%', '3.0M', '1.5x', '2026-11-19'])
    const smci = within(screen.getByTestId('terminal-monitor-row-3')).getAllByRole('cell').map((c) => c.textContent)
    expect(smci.slice(3)).toEqual(['—', '—', '—', '—', '—', '—', '—', '—'])
  })

  it('prices come from ONE shared-pool subscription over exactly the shown symbols', () => {
    render(<MonitorPanel />)
    const last = h.priceCalls[h.priceCalls.length - 1]
    expect(last).toEqual(['NVDA', 'AMD', 'SMCI'])
    // every render hands the SAME array (one subscription key, never a churn of them)
    expect(new Set(h.priceCalls).size).toBe(1)
    expect(h.perfCalls[h.perfCalls.length - 1]).toBe(last)
    expect(h.metaCalls[h.metaCalls.length - 1]).toBe(last)
  })

  it('a header click sorts (aria-sort says so) and a missing value stays last', () => {
    render(<MonitorPanel />)
    fireEvent.click(screen.getByTestId('terminal-monitor-sort-chg'))
    expect(symsShown()).toEqual(['NVDA', 'AMD', 'SMCI'])
    fireEvent.click(screen.getByTestId('terminal-monitor-sort-chg'))
    expect(symsShown()).toEqual(['AMD', 'NVDA', 'SMCI'])
    expect(screen.getByTestId('terminal-monitor-sort-chg').closest('th').getAttribute('aria-sort')).toBe('ascending')
  })

  it('the labelled Sort control sorts too (the touch / keyboard path)', () => {
    render(<MonitorPanel />)
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'sym:asc' } })
    expect(symsShown()).toEqual(['AMD', 'NVDA', 'SMCI'])
  })

  it('keyboard: arrows move the active row (aria-activedescendant), Enter drives the channel', () => {
    const onDrive = vi.fn()
    render(<MonitorPanel onDrive={onDrive} channel={{ id: 'A', name: 'Group A' }} />)
    const table = screen.getByTestId('terminal-monitor-table')
    fireEvent.keyDown(table, { key: 'ArrowDown' })
    fireEvent.keyDown(table, { key: 'ArrowDown' })
    fireEvent.keyDown(table, { key: 'ArrowUp' })
    expect(table.getAttribute('aria-activedescendant')).toBe(screen.getByTestId('terminal-monitor-row-2').id)
    fireEvent.keyDown(table, { key: 'Enter' })
    expect(onDrive).toHaveBeenCalledWith('AMD')
    fireEvent.keyDown(table, { key: 'End' })
    fireEvent.keyDown(table, { key: 'Enter' })
    expect(onDrive).toHaveBeenLastCalledWith('SMCI')
  })

  it('Enter on a sort button is that button, not a row drive', () => {
    const onDrive = vi.fn()
    render(<MonitorPanel onDrive={onDrive} />)
    fireEvent.keyDown(screen.getByTestId('terminal-monitor-sort-chg'), { key: 'Enter' })
    expect(onDrive).not.toHaveBeenCalled()
  })

  it('a row click drives the channel; the linked security is marked', () => {
    const onDrive = vi.fn()
    render(<MonitorPanel onDrive={onDrive} channel={{ id: 'A', name: 'Group A' }} linkedSym="AMD" />)
    fireEvent.click(screen.getByTestId('terminal-monitor-row-3'))
    expect(onDrive).toHaveBeenCalledWith('SMCI')
    expect(screen.getByTestId('terminal-monitor-row-2').dataset.linked).toBe('true')
    expect(screen.getByTestId('terminal-monitor-status').textContent).toContain('Selecting a row sets Group A')
  })

  it('row <GO>: publishes the shown order with a go(i) that drives row i', () => {
    const onRows = vi.fn()
    const onDrive = vi.fn()
    render(<MonitorPanel onRows={onRows} onDrive={onDrive} />)
    const [rows, go] = onRows.mock.calls[onRows.mock.calls.length - 1]
    expect(rows).toEqual(['NVDA', 'AMD', 'SMCI'])
    act(() => { go(2) })
    expect(onDrive).toHaveBeenCalledWith('SMCI')
    expect(screen.getByTestId('terminal-monitor-row-3').dataset.active).toBe('true')
    // a re-sort republishes the NEW order
    fireEvent.click(screen.getByTestId('terminal-monitor-sort-sym'))
    expect(onRows.mock.calls[onRows.mock.calls.length - 1][0]).toEqual(['AMD', 'NVDA', 'SMCI'])
  })

  it('the List control switches to the flagged list and a tag list', () => {
    h.flagged = ['TSLA']
    h.tags = { META: 'gold' }
    render(<MonitorPanel />)
    const pick = screen.getByLabelText('List')
    expect(within(pick).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Flagged (1)', 'Tag: Top Pick (1)', 'Semis (3)'])
    fireEvent.change(pick, { target: { value: 'tag:gold' } })
    expect(symsShown()).toEqual(['META'])
  })

  it('an empty list and a failed list read are each SAID, never a blank panel', () => {
    h.lists = []
    const { unmount } = render(<MonitorPanel />)
    expect(screen.getByTestId('terminal-monitor-empty').textContent).toContain('Flagged is empty')
    unmount()
    h.listsError = new Error('500')
    h.flagged = ['TSLA']
    render(<MonitorPanel />)
    expect(screen.getByTestId('terminal-monitor-lists-error')).toBeTruthy()
    expect(symsShown()).toEqual(['TSLA'])
  })

  it(`a list longer than ${MAX_ROWS} names shows the first ${MAX_ROWS} and says so`, () => {
    h.lists = [{ id: 1, name: 'Big', items: Array.from({ length: 130 }, (_, i) => ({ sym: `T${i}` })) }]
    render(<MonitorPanel />)
    expect(screen.getAllByTestId(/^terminal-monitor-row-/)).toHaveLength(MAX_ROWS)
    expect(screen.getByTestId('terminal-monitor-capped').textContent).toContain('130 names')
    expect(h.priceCalls[h.priceCalls.length - 1]).toHaveLength(MAX_ROWS)
  })

  it('opens no stream and no fetch of its own (the source has none)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.join(process.cwd(), 'src/pages/terminal/panels/MonitorPanel.jsx'), 'utf8')
      .replace(/\/\/.*$/gm, '')
    expect(src).not.toMatch(/EventSource|WebSocket|setInterval|refreshInterval|\bfetch\(/)
  })
})

// RS screens, unit U12, item W3.4: why each stock left the list. On an RS screen the "N dropped"
// popover gives each name the first rule of the screen it now fails, from ONE batched row read
// (GET /api/screener/rows) made when the popover opens.
//
// ⭐ The reason is VISIBLE text beside the name (a `title` is never seen on a phone). The popover
// becomes a list of rows only when a name has a reason; with none (every other screen, no answer
// yet, a failed read) it stays the wrap of ticker chips it always was.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import NewTodayLine, { MAX_NAMED } from '../NewTodayLine'
import { droppedReasons, reasonFor, GONE_REASON, STALE_REASON, LOST_PLACE_REASON, MAX_REASON_TICKERS } from '../droppedReasons'
import { RS_NOTE_PREF, steadyOf } from '../rsScreens'
import { net, resetNet, installFetch, mount, pin } from './rsHarness'
import { NEW_HIGHS, LEADERS, PLAIN_STARTERS, SERVED } from './rsScreensFixture'

beforeEach(() => {
  __resetCountCache()
  __resetRevisionStateForTests()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  resetNet()
  net.prefs = { [RS_NOTE_PREF]: '1' }
  net.meta = { filters: SERVED.meta.filters, categories: [{ key: 'relative_strength', label: 'Relative strength' }], views: SERVED.meta.views }
  installFetch()
})
const META = SERVED.meta.filters
const keyed = st => Object.fromEntries(st.spec.filters.map(({ key, ...rest }) => [key, rest]))
const ok = exited => ({ state: 'ok', entered: [], exited, new_since_label: 'New since Nov 12 close' })
const landedOn = name => waitFor(() => expect(screen.getByRole('button', { name: new RegExp(`^${name}.*Change screen`) })).toBeInTheDocument())
const rowsCalls = () => fetch.mock.calls.map(([u]) => String(u)).filter(u => u.startsWith('/api/screener/rows'))
const chip = t => screen.getByTestId(`nt-dropped-${t}`)
// A stock that passes every rule of RS New Highs as it opens.
const ON_NH = { price: 50, dollar_vol_30d: 5e7, pct_vs_sma200: 12, rs_nh_bars_ago: 2, rs_flag: null, security_type: 'Stock' }
// A stock that passes every qualifying rule of UCT RS Leaders.
const ON_LEADERS = { price: 300, dollar_vol_30d: 2e10, adr_pct: 4.1, market_cap: 9e11, rs_rank: 91, pct_vs_sma200: 22, sma200_rising: 1,
  dist_52w_high_pct: -9, rs_line_above_ma: 1, rs_flag: null, security_type: 'Stock' }

describe('one stock\'s reason', () => {
  const opts = { filters: keyed(NEW_HIGHS), metaFilters: META }
  test('the first rule it now fails, worded as "Why isn\'t a stock here?" words it', () => {
    const why = reasonFor({ row: { ...ON_NH, rs_nh_bars_ago: 9 }, stale: false }, opts)
    expect(why).toMatch(/: 9/)
    expect(why).not.toBe('')
    // two misses: the first in the screen's own order is the one said
    const both = reasonFor({ row: { ...ON_NH, price: 4, rs_nh_bars_ago: 9 }, stale: false }, opts)
    expect(both).toMatch(/^Price/)
    expect(both).toMatch(/\$4$/)
  })
  test('a blank value is "no value"', () => {
    expect(reasonFor({ row: { ...ON_NH, rs_nh_bars_ago: null }, stale: false }, opts)).toMatch(/: no value$/)
  })
  test('no row, a stale row, and a stock that still passes', () => {
    expect(reasonFor(undefined, opts)).toBe(GONE_REASON)
    expect(reasonFor({ row: null }, opts)).toBe(GONE_REASON)
    expect(reasonFor({ row: ON_NH, stale: true }, opts)).toBe(STALE_REASON)
    expect(reasonFor({ row: ON_NH, stale: false }, opts)).toBe('')
    expect(GONE_REASON).toBe('No longer in the Screener')
    expect(STALE_REASON).toBe('Its price data stopped updating')
  })
  test('on a list that keeps its own members, membership is never the reason given', () => {
    const lead = { filters: keyed(LEADERS), metaFilters: META, steady: steadyOf(LEADERS) }
    // still passes every rule: it lost its place
    expect(reasonFor({ row: { ...ON_LEADERS, rs_leaders_member: 0 }, stale: false }, lead)).toBe(LOST_PLACE_REASON)
    expect(LOST_PLACE_REASON).toBe('Passes every rule; lost its place on the list')
    // misses a rule: the rule, not "On the list: No"
    const why = reasonFor({ row: { ...ON_LEADERS, rs_rank: 74, rs_leaders_member: 0 }, stale: false }, lead)
    expect(why).toMatch(/: 74$/)
    expect(why).not.toMatch(/list/i)
    // without the starter's rule the membership clause is read like any other
    expect(reasonFor({ row: { ...ON_LEADERS, rs_leaders_member: 0 }, stale: false }, { filters: keyed(LEADERS), metaFilters: META })).not.toBe('')
  })
})

describe('the one batched read', () => {
  test('every name in ONE request, for the columns the screen\'s rules read', async () => {
    net.rowsBatch = tickers => ({
      rows: { IBM: { row: { ...ON_NH, ticker: 'IBM', rs_nh_bars_ago: 7 }, stale: false }, OLD: { row: { ...ON_NH, ticker: 'OLD' }, stale: true },
        FINE: { row: { ...ON_NH, ticker: 'FINE' }, stale: false } },
      missing: tickers.filter(t => t === 'GONE'),
    })
    const got = await droppedReasons(['IBM', 'OLD', 'GONE', 'FINE'], { filters: keyed(NEW_HIGHS), metaFilters: META })
    expect(rowsCalls()).toHaveLength(1)
    const url = new URL(rowsCalls()[0], 'http://x')
    expect(url.pathname).toBe('/api/screener/rows')
    expect(url.searchParams.get('tickers')).toBe('IBM,OLD,GONE,FINE')
    const cols = url.searchParams.get('columns').split(',')
    for (const f of NEW_HIGHS.spec.filters) expect(cols).toContain(f.key)
    expect(Object.keys(got).sort()).toEqual(['GONE', 'IBM', 'OLD'])
    expect(got.IBM).toMatch(/: 7/)
    expect(got.OLD).toBe(STALE_REASON)
    expect(got.GONE).toBe(GONE_REASON)
    expect('FINE' in got).toBe(false)              // still passes: no reason is made up
  })
  test('the membership column is not asked for, and not judged, on UCT RS Leaders', async () => {
    net.rowsBatch = () => ({ rows: { TSLA: { row: { ...ON_LEADERS, ticker: 'TSLA' }, stale: false } }, missing: [] })
    const got = await droppedReasons(['TSLA'], { filters: keyed(LEADERS), metaFilters: META, steady: steadyOf(LEADERS) })
    const cols = new URL(rowsCalls()[0], 'http://x').searchParams.get('columns').split(',')
    expect(cols).not.toContain('rs_leaders_member')
    expect(got).toEqual({ TSLA: LOST_PLACE_REASON })
  })
  test('a refusal, a dropped connection or an answer in another shape gives no reason to anybody', async () => {
    net.rowsBatch = () => ({ status: 500 })
    expect(await droppedReasons(['IBM'], { filters: keyed(NEW_HIGHS), metaFilters: META })).toEqual({})
    net.rowsBatch = () => { throw new Error('offline') }
    expect(await droppedReasons(['IBM'], { filters: keyed(NEW_HIGHS), metaFilters: META })).toEqual({})
    net.rowsBatch = () => ({ nothing: true })
    expect(await droppedReasons(['IBM'], { filters: keyed(NEW_HIGHS), metaFilters: META })).toEqual({})
  })
  test('no name asks nothing, and never more than the server\'s cap is named', async () => {
    expect(await droppedReasons([], { filters: keyed(NEW_HIGHS), metaFilters: META })).toEqual({})
    expect(rowsCalls()).toEqual([])
    net.rowsBatch = () => ({ rows: {}, missing: [] })
    await droppedReasons(Array.from({ length: 40 }, (_, i) => `T${i}`), { filters: keyed(NEW_HIGHS), metaFilters: META })
    expect(MAX_REASON_TICKERS).toBe(25)
    expect(new URL(rowsCalls()[0], 'http://x').searchParams.get('tickers').split(',')).toHaveLength(25)
  })
})

describe('the popover', () => {
  test('asks once when it opens, for the names it shows, and each name carries its reason', async () => {
    const asker = vi.fn(async names => Object.fromEntries(names.filter(t => t !== 'B').map(t => [t, `Why ${t}`])))
    render(<NewTodayLine nt={ok(['A', 'B', 'C'])} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={asker} />)
    expect(asker).not.toHaveBeenCalled()                 // nothing is asked until the member looks
    fireEvent.click(screen.getByRole('button', { name: '3 dropped' }))
    await waitFor(() => expect(chip('A')).toHaveAttribute('title', 'Why A'))
    expect(asker).toHaveBeenCalledTimes(1)
    expect(asker).toHaveBeenCalledWith(['A', 'B', 'C'])
    expect(chip('C')).toHaveAttribute('title', 'Why C')
    // in plain sight, beside the ticker: nothing here depends on a hover
    expect(screen.getByTestId('nt-reason-A')).toHaveTextContent('Why A')
    expect(screen.getByTestId('nt-reason-A')).not.toHaveClass('sr-only')
    expect(chip('A').textContent).toBe('AWhy A')
    expect(screen.getByRole('list')).toHaveAttribute('data-layout', 'rows')
    // a name with no reason is its ticker alone
    expect(chip('B')).not.toHaveAttribute('title')
    expect(chip('B').textContent).toBe('B')
    expect(screen.queryByTestId('nt-reason-B')).toBeNull()
  })
  test('with no reason for anybody the popover is the wrap of chips it always was', async () => {
    const asker = vi.fn(async () => ({}))
    render(<NewTodayLine nt={ok(['A', 'B'])} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={asker} />)
    fireEvent.click(screen.getByRole('button', { name: '2 dropped' }))
    await waitFor(() => expect(asker).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('list')).toHaveAttribute('data-layout', 'chips')
    expect(screen.getByRole('list').className).not.toMatch(/ntPopRows/)
    expect(chip('A').textContent).toBe('A')
  })
  test('a screen that never asks keeps the chips', () => {
    render(<NewTodayLine nt={ok(['A', 'B'])} newOnly={false} onToggleNewOnly={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '2 dropped' }))
    expect(screen.getByRole('list')).toHaveAttribute('data-layout', 'chips')
  })
  test('only the names shown are asked about', async () => {
    const asker = vi.fn(async () => ({}))
    const exited = Array.from({ length: 15 }, (_, i) => `T${i}`)
    render(<NewTodayLine nt={ok(exited)} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={asker} />)
    fireEvent.click(screen.getByRole('button', { name: '15 dropped' }))
    await waitFor(() => expect(asker).toHaveBeenCalledTimes(1))
    expect(asker.mock.calls[0][0]).toEqual(exited.slice(0, MAX_NAMED))
    expect(screen.getByText('+3 more')).toBeInTheDocument()
  })
  test('without an asker (every screen that is not an RS screen) nothing is asked and nothing changes', () => {
    render(<NewTodayLine nt={ok(['A', 'B'])} newOnly={false} onToggleNewOnly={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '2 dropped' }))
    expect(chip('A').textContent).toBe('A')
    expect(chip('A')).not.toHaveAttribute('title')
    expect(screen.getByRole('list').children).toHaveLength(2)
  })
  test('an asker that fails, or answers with nothing, leaves the names as they were', async () => {
    const boom = vi.fn(async () => { throw new Error('offline') })
    const { unmount } = render(<NewTodayLine nt={ok(['A'])} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={boom} />)
    fireEvent.click(screen.getByRole('button', { name: '1 dropped' }))
    await waitFor(() => expect(boom).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect(chip('A')).not.toHaveAttribute('title')
    unmount()
    const none = vi.fn(async () => null)
    render(<NewTodayLine nt={ok(['A'])} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={none} />)
    fireEvent.click(screen.getByRole('button', { name: '1 dropped' }))
    await waitFor(() => expect(none).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect(chip('A')).not.toHaveAttribute('title')
  })
  test('a reason for one set of names is never shown on another', async () => {
    // The second answer is held back, so the moment between the two sets of names can be read.
    let release
    const asker = vi.fn()
      .mockImplementationOnce(async names => Object.fromEntries(names.map(t => [t, `Why ${t}`])))
      .mockImplementationOnce(() => new Promise(r => { release = () => r({ Z: 'Why Z' }) }))
    const { rerender } = render(<NewTodayLine nt={ok(['A'])} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={asker} />)
    fireEvent.click(screen.getByRole('button', { name: '1 dropped' }))
    await waitFor(() => expect(chip('A')).toHaveAttribute('title', 'Why A'))
    rerender(<NewTodayLine nt={ok(['A', 'Z'])} newOnly={false} onToggleNewOnly={() => {}} reasonsFor={asker} />)
    await waitFor(() => expect(asker).toHaveBeenCalledTimes(2))
    expect(asker.mock.calls[1][0]).toEqual(['A', 'Z'])
    // the names changed and their answer is not in yet: A's reason was for the other set (mutation W3.4-k)
    expect(chip('A')).not.toHaveAttribute('title')
    expect(chip('Z')).not.toHaveAttribute('title')
    await act(async () => { release() })
    await waitFor(() => expect(chip('Z')).toHaveAttribute('title', 'Why Z'))
    expect(chip('A')).not.toHaveAttribute('title')          // this answer gave A none
  })
})

// The new/dropped line is drawn for a member the New-today flag reaches.
const MEMBER = { user: { id: 'member-a' }, screenerNewTodayEnabled: true }

describe('on the page', () => {
  test('RS New Highs: opening "dropped" asks for the rows once and says why each name left', async () => {
    net.diff = ok(['IBM', 'TSLA', 'FINE'])
    net.rowsBatch = () => ({
      rows: { IBM: { row: { ...ON_NH, ticker: 'IBM', rs_nh_bars_ago: 7 }, stale: false }, FINE: { row: { ...ON_NH, ticker: 'FINE' }, stale: false } },
      missing: ['TSLA'],
    })
    pin(['starter_rs_new_high'])
    mount(MEMBER)
    await landedOn('RS New Highs')
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    expect(rowsCalls()).toEqual([])                       // nothing until the popover opens
    fireEvent.click(await screen.findByRole('button', { name: '3 dropped' }))
    await waitFor(() => expect(chip('IBM')).toHaveAttribute('title'))
    expect(chip('IBM').getAttribute('title')).toMatch(/: 7/)
    expect(chip('TSLA')).toHaveAttribute('title', GONE_REASON)
    expect(chip('FINE')).not.toHaveAttribute('title')
    expect(rowsCalls()).toHaveLength(1)
    expect(new URL(rowsCalls()[0], 'http://x').searchParams.get('tickers')).toBe('IBM,TSLA,FINE')
  })

  test('a screen without `row` asks for nothing when its popover opens', async () => {
    net.diff = ok(['IBM'])
    pin([PLAIN_STARTERS[0].id])
    mount(MEMBER)
    await landedOn(PLAIN_STARTERS[0].name)
    await waitFor(() => screen.getByTestId('focus-row-NVDA'))
    fireEvent.click(await screen.findByRole('button', { name: '1 dropped' }))
    expect(chip('IBM')).toBeInTheDocument()
    await act(async () => { await new Promise(r => setTimeout(r, 50)) })
    expect(rowsCalls()).toEqual([])
    expect(chip('IBM')).not.toHaveAttribute('title')
  })
})

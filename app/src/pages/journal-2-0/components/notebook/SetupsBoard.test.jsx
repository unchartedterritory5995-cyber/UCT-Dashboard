// Wave 13 lane 13J -- the active setups board (SetupsBoard.jsx, BoardCard.jsx).
//
//   * ⛔ HERD SAFETY (plan risk R-10, the 2026-05-24 outage class): a board of 40 setups
//     mounts AT MOST 3 charts loading at once, every chart has backgroundWarm={false} and no
//     deep warm, a slot frees only on the chart's own onBarsReady, and the warm goes through
//     the prefetch module ONLY after the page has painted -- never a direct fetch.
//   * THE ORDER is the server's (closest to the entry first) and the first charts admitted
//     are the closest setups.
//   * The card words the server's numbers: distance in % and R, days in setup, the levels.
//   * DARK: both flags off -> the page fetches nothing.
//   * Find more like this opens tonight's precomputed matches for the card's tagged chart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ live: new Map(), everMounted: [], released: new Set() }))

vi.mock('../../../../components/StockChart', async () => {
  const React = await import('react')
  function MockStockChart(props) {
    // Latest props on every render (a Map keeps first-insertion order), gone on unmount.
    React.useEffect(() => { h.live.set(props.sym, props) })
    React.useEffect(() => {
      h.everMounted.push(props.sym)
      return () => { h.live.delete(props.sym) }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return React.createElement('div', { 'data-chart': props.sym })
  }
  return { default: MockStockChart }
})
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchListAllTimeframes: vi.fn() }))

import SetupsBoard, { MOUNT_LIMIT, PAGE_SIZE } from './SetupsBoard'
import { distanceText, daysText, planPriceLines } from './BoardCard'
import { prefetchListAllTimeframes } from '../../../../utils/prefetchBars'
import { Providers } from '../../a11y/fixtures'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

const sym = (i) => `S${String(i).padStart(2, '0')}`
const CARDS = Array.from({ length: 40 }, (_, i) => ({
  noteId: `n${i}`, noteTitle: `Plan ${i}`, symbol: sym(i), entry: 100 + i, stop: 95 + i, target: 120 + i,
  levelShape: 'chart', setupTag: null, daysInSetup: i % 5, since: '2026-09-28',
  similarEmbedKey: i === 0 ? 'e-0' : null, side: 'long', state: 'waiting', price: 99 + i,
  priceSource: 'close', priceAsOf: '2026-10-01', distancePct: Number((0.1 * (i + 1)).toFixed(2)),
  distanceR: Number((0.02 * (i + 1)).toFixed(2)),
}))
const BOARD = { cards: CARDS, count: 40, today: '2026-10-02', pageSize: 16, scanned: 40, capped: false }
const MATCHES = {
  template: { noteId: 'n0', embedKey: 'e-0', noteTitle: 'Plan 0', symbol: 'S00', setupTag: 'VCP', asOf: '2026-09-30', frozen: true },
  asOf: '2026-10-01', computedAt: 'x', status: 'ready', matches: [
    { rank: 1, symbol: 'CRWD', score: 88, distance: 0.12, coverage: 1,
      reasons: { fields: [
        { field: 'rs_rank', label: 'RS', unit: '', template: 92, candidate: 94, delta: 2, same: null, d: 0.08 },
        { field: 'pullback_depth_pct', label: 'depth', unit: '%', template: 12, candidate: 11, delta: -1, same: null, d: 0.1 },
      ], patterns: { shared: ['vcp'], templateOnly: [], missing: null } } },
  ],
}

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(body) })
function stub(routes) {
  const calls = []
  global.fetch = vi.fn((url) => {
    const path = String(url).split('?')[0]
    calls.push(path)
    const hit = routes.find(([re]) => re.test(path))
    return hit ? respond(200, hit[1]) : respond(404, {})
  })
  return calls
}

const pending = () => [...h.live.keys()].filter((s) => !h.released.has(s)).length
async function release(s) {
  h.released.add(s)
  await act(async () => { h.live.get(s).onBarsReady() })
}

describe('SetupsBoard', () => {
  beforeEach(() => {
    __resetNotebookFlags(); h.live.clear(); h.everMounted.length = 0; h.released.clear()
    prefetchListAllTimeframes.mockClear()
  })
  afterEach(() => { __resetNotebookFlags() })

  it('both flags OFF: shows no page of its own and fetches nothing (it sends the member back; finFeMinors.test.jsx)', async () => {
    const calls = stub([[/setups-board$/, BOARD]])
    render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    expect(screen.queryByText('This page is not available yet.')).toBeNull()
    expect(document.querySelector('[data-setups-page]')).toBeNull()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toEqual([])
    expect(h.everMounted).toEqual([])
  })

  it('a board of 40 mounts at most 3 charts at once, none warming itself, in closeness order', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    const calls = stub([[/\/api\/j2\/setups-board$/, BOARD]])
    const { container } = render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    await screen.findByText('Plan 0')
    // one page of the grid's cell cap, in the server's order
    const order = [...container.querySelectorAll('[data-board-card]')].map((el) => el.getAttribute('data-board-card'))
    expect(order).toEqual(CARDS.slice(0, PAGE_SIZE).map((c) => c.symbol))
    await waitFor(() => expect(h.live.size).toBe(MOUNT_LIMIT))
    // the closest three are admitted first
    expect([...h.live.keys()]).toEqual(['S00', 'S01', 'S02'])
    for (const p of h.live.values()) {
      expect(p.backgroundWarm).toBe(false)
      expect(p.deepWarm).toBe(false)
      expect(p.tf).toBe('D')
      // Wave 13 integration walk (13X), 390px: the shared A/L/% scale-toggle renders at
      // 11px in this card's lite profile, under the touch floor -- BoardCard.jsx vetoes
      // it the same way TradeBeforeAfter.jsx's mini-charts already do.
      expect(p.hideScaleToggle).toBe(true)
    }
    expect(prefetchListAllTimeframes).not.toHaveBeenCalled()       // not before the page paints

    // drain the queue: never more than 3 loading at once
    let maxPending = pending()
    while ([...h.live.keys()].some((s) => !h.released.has(s))) {
      const next = [...h.live.keys()].find((s) => !h.released.has(s))
      await release(next)
      await waitFor(() => expect(pending()).toBeLessThanOrEqual(MOUNT_LIMIT))
      maxPending = Math.max(maxPending, pending())
    }
    expect(maxPending).toBe(MOUNT_LIMIT)
    expect(h.live.size).toBe(PAGE_SIZE)                              // the whole page, eventually

    // painted -> ONE warm of the NEXT page's daily bars, through the prefetch module
    await waitFor(() => expect(prefetchListAllTimeframes).toHaveBeenCalledTimes(1))
    expect(prefetchListAllTimeframes).toHaveBeenCalledWith(
      CARDS.slice(PAGE_SIZE, 2 * PAGE_SIZE).map((c) => c.symbol), { tfs: ['D'] })
    // and no fetch but the board's own read
    expect(calls).toEqual(['/api/j2/setups-board'])
  })

  it('the card words the server numbers', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    stub([[/\/api\/j2\/setups-board$/, BOARD]])
    const { container } = render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    await screen.findByText('Plan 0')
    const first = container.querySelector('[data-board-card="S00"]')
    expect(first.querySelector('[data-distance]').textContent).toBe('0.10% to the entry · 0.02R')
    expect(first.textContent).toContain('$100.00')
    expect(first.textContent).toContain('New today')
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
  })

  it('pure wording: distance, days, price lines', () => {
    expect(distanceText({ state: 'waiting', distancePct: 2.94, distanceR: 0.6 })).toBe('2.94% to the entry · 0.60R')
    expect(distanceText({ state: 'triggered', distancePct: -0.94, distanceR: -0.2 })).toBe('Triggered · 0.94% through the entry · 0.20R')
    expect(distanceText({ state: 'invalidated', distancePct: 5, distanceR: 1 })).toBe('Through the stop · 5.00% from the entry · 1.00R')
    expect(distanceText({ state: 'watching', distancePct: 5.26, distanceR: null })).toBe('5.26% to the entry')
    expect(distanceText({ state: 'no_price', distancePct: null })).toBe('No price yet')
    expect([daysText(0), daysText(1), daysText(11)]).toEqual(['New today', '1 day in setup', '11 days in setup'])
    expect(planPriceLines({ entry: 105, stop: 100, target: null }).map((l) => [l.title, l.price])).toEqual(
      [['Entry', 105], ['Stop', 100]])
  })

  it('find more like this opens the precomputed matches for the tagged chart', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true, notebook_find_similar_enabled: true })
    const calls = stub([
      [/\/api\/j2\/setups-board$/, BOARD],
      [/\/api\/j2\/similar-names\/templates$/, { templates: [], count: 0, maxTemplates: 25 }],
      [/\/api\/j2\/similar-names\/n0\/e-0$/, MATCHES],
    ])
    render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    fireEvent.click(await screen.findByRole('button', { name: 'Find more like S00' }))
    expect(await screen.findByText('RS 94 vs 92 · depth 11% vs 12% · VCP')).toBeTruthy()
    expect(calls).toContain('/api/j2/similar-names/n0/e-0')
    expect(screen.queryByRole('button', { name: 'Find more like S01' })).toBeNull()   // untagged
  })
})

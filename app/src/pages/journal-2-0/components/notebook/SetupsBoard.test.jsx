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
//
// CONTRACT: the board (forty setups, and one card in each state) is the REAL server's answer
// (`__fixtures__/contract`, written by tools/notebook_contract_fixtures.py from
// GET /api/j2/setups-board), and so are the similar-names matches: the generator runs the real
// nightly job over a fixed universe and the route reads the rows it stored.
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
import { contract, contractBody } from '../../__fixtures__/contract'

const BOARD = contractBody('setups-board.forty')
const CARDS = BOARD.cards
const FIRST = CARDS[0]                 // the closest setup, and the one with a tagged chart
// The matches the REAL nightly job stored for the one tagged chart on the six-state board.
const MATCHES = contractBody('similar-names.matches')

const SECOND_ROW = 'vs 20-day 2% vs 2% · vs 50-day 10% vs 10% · vs 200-day 30% vs 30%'

const respond = (status, body) => Promise.resolve({ ok: status < 400, status, headers: { get: () => null }, json: () => Promise.resolve(body) })
function stub(routes) {
  const calls = []
  global.fetch = vi.fn((url) => {
    const path = String(url).split('?')[0]
    calls.push(path)
    const hit = routes.find(([re]) => re.test(path))
    return hit ? respond(hit[2] || 200, hit[1]) : respond(404, {})
  })
  return calls
}
const renderBoard = () => render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)

const pending = () => [...h.live.keys()].filter((s) => !h.released.has(s)).length
async function release(s) {
  h.released.add(s)
  await act(async () => { h.live.get(s).onBarsReady() })
}

describe('the recorded board is the shape this page was built for (non-vacuity)', () => {
  it('forty cards, closest first, a page of sixteen, one tagged chart', () => {
    expect(CARDS).toHaveLength(40)
    expect(BOARD).toMatchObject({ count: 40, pageSize: PAGE_SIZE, capped: false })
    const pcts = CARDS.map((c) => c.distancePct)
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts)
    expect(CARDS.filter((c) => c.similarEmbedKey).map((c) => c.symbol)).toEqual([FIRST.symbol])
  })
})

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
    expect([...h.live.keys()]).toEqual(CARDS.slice(0, 3).map((c) => c.symbol))
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
    // The closest setup: entry 100, stop 95, last close 99.90 (0.10 away: 0.10% and 0.02R).
    expect(FIRST).toMatchObject({ symbol: 'SQ00', entry: 100, stop: 95, price: 99.9, distancePct: 0.1, distanceR: 0.02, daysInSetup: 0 })
    const first = container.querySelector(`[data-board-card="${FIRST.symbol}"]`)
    expect(first.querySelector('[data-distance]').textContent).toBe('0.10% to the entry · 0.02R')
    expect(first.textContent).toContain('$100.00')
    expect(first.textContent).toContain('New today')
    expect(screen.getByText('Page 1 of 3')).toBeTruthy()
  })

  it('words every state the server sends: waiting, triggered, watching, invalidated, no price', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    const board = contractBody('setups-board')
    stub([[/\/api\/j2\/setups-board$/, board]])
    const { container } = renderBoard()
    await screen.findByText('SBNV breakout')
    const said = Object.fromEntries(board.cards.map((c) => [
      c.state + (c.side === 'short' ? ':short' : ''),
      container.querySelector(`[data-board-card="${c.symbol}"] [data-distance]`).textContent,
    ]))
    expect(said).toEqual({
      waiting: '2.94% to the entry · 0.60R',
      'waiting:short': '2.44% to the entry · 0.50R',
      triggered: 'Triggered · 0.94% through the entry · 0.20R',
      watching: '7.69% to the entry',
      invalidated: 'Through the stop · 5.00% from the entry · 1.00R',
      no_price: 'No price yet',
    })
    // the server's order is kept: closest to the entry first, the broken and the blind last
    expect([...container.querySelectorAll('[data-board-card]')].map((el) => el.getAttribute('data-board-card')))
      .toEqual(board.cards.map((c) => c.symbol))
    expect(screen.queryByText(/^Page /)).toBeNull()              // one page: no pager
  })

  it('a member with no drawn plan is told how to start, and no chart mounts', async () => {
    // with the chart plan ON; with it off the line names no step (honestWhenOff.finFe2.test.jsx)
    latchNotebookFlags({ notebook_setups_board_enabled: true, notebook_chart_plan_enabled: true })
    stub([[/\/api\/j2\/setups-board$/, contractBody('setups-board.empty')]])
    renderBoard()
    expect(await screen.findByText(/No open setups yet\. Draw an entry line on a chart in a plan note/)).toBeTruthy()
    expect(h.everMounted).toEqual([])
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('a failed read is an error, never "No open setups yet"', async () => {
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    stub([[/\/api\/j2\/setups-board$/, contractBody('setups-board.signed-out'), 401]])
    renderBoard()
    await waitFor(() => expect(screen.queryByText('Reading your plans…')).toBeNull())
    expect(screen.queryByText(/No open setups yet/)).toBeNull()
    expect(document.querySelector('[data-setups-board]').textContent).toMatch(/your setups/)
    expect(h.everMounted).toEqual([])
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
    const board = contractBody('setups-board')
    const tagged = board.cards.filter((c) => c.similarEmbedKey)
    expect(tagged.map((c) => c.symbol)).toEqual(['SBNV'])
    expect(MATCHES.template).toMatchObject({ noteId: tagged[0].noteId, embedKey: tagged[0].similarEmbedKey, symbol: 'SBNV' })
    expect(MATCHES).toMatchObject({ status: 'ready', asOf: '2026-10-02' })
    expect(MATCHES.matches).toHaveLength(10)
    const path = `/api/j2/similar-names/${tagged[0].noteId}/${tagged[0].similarEmbedKey}`
    expect(path).toBe(contract('similar-names.matches')._contract.path)
    const calls = stub([
      [/\/api\/j2\/setups-board$/, board],
      [/\/api\/j2\/similar-names\/templates$/, contractBody('similar-names.templates')],
      [new RegExp(`${path}$`), MATCHES],
    ])
    const { container } = renderBoard()
    fireEvent.click(await screen.findByRole('button', { name: 'Find more like SBNV' }))
    // the second-closest name: its three nearest fields, the name's value first, the chart's second
    const second = MATCHES.matches[1]
    expect(second).toMatchObject({ symbol: 'SM01', score: 98, rank: 2 })
    await screen.findByText('SM01')
    const rows = [...container.ownerDocument.querySelectorAll('[data-reasons]')].map((el) => el.textContent)
    expect(rows).toHaveLength(10)
    expect(rows[1]).toBe(SECOND_ROW)
    expect(screen.getByText('98 match')).toBeTruthy()
    expect(screen.getByText(/as of 2026-10-02/)).toBeTruthy()
    expect(calls).toContain(path)
    expect(screen.queryByRole('button', { name: 'Find more like SBAM' })).toBeNull()   // untagged
  })
})

// ── round 2 (owner ruling): an example card says "Example" and is never one of your setups ──
const findEl = (selector) => waitFor(() => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`not rendered yet: ${selector}`)
  return el
})

describe('SetupsBoard — sample cards', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_setups_board_enabled: true })
    h.live.clear(); h.everMounted.length = 0; h.released.clear()
  })
  afterEach(() => { __resetNotebookFlags() })
  const EXAMPLE = { ...CARDS[0], noteId: 'ex', noteTitle: 'Active setup: example', symbol: 'MSFT', example: true }

  it('a member whose only card is the sample sees the card, its label, AND the "none yet" guidance', async () => {
    stub([[/setups-board$/, { ...BOARD, cards: [EXAMPLE], count: 0, exampleCount: 1 }]])
    render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    const cardEl = await findEl('[data-board-card="MSFT"]')
    expect(cardEl).toBeTruthy()
    expect(cardEl.querySelector('[data-example]').textContent).toBe('Example')   // text, not colour alone
    expect(screen.getByText(/No open setups yet/)).toBeTruthy()
  })

  it('a member\'s own card carries no label, and with one of their own the guidance is gone', async () => {
    stub([[/setups-board$/, { ...BOARD, cards: [CARDS[1], EXAMPLE], count: 1, exampleCount: 1 }]])
    render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    const own = await findEl(`[data-board-card="${CARDS[1].symbol}"]`)
    expect(own.querySelector('[data-example]')).toBeNull()
    expect(document.querySelector('[data-board-card="MSFT"] [data-example]')).toBeTruthy()
    expect(screen.queryByText(/No open setups yet/)).toBeNull()
  })

  it('the client never infers "example" from a title: only the server\'s flag labels a card', async () => {
    stub([[/setups-board$/, { ...BOARD, cards: [{ ...EXAMPLE, example: false }], count: 1, exampleCount: 0 }]])
    render(<Providers route="/journal/notebook/setups"><SetupsBoard /></Providers>)
    const cardEl = await findEl('[data-board-card="MSFT"]')
    expect(cardEl.querySelector('[data-example]')).toBeNull()
  })
})

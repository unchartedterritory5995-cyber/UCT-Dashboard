/**
 * Order Ticket rails (docs/study/GAMES.md, kind `ticket`): the start arena with its stakes and three steps; a run dealt
 * from the seed taken at Start; a ticket scores only when the side, the type and the price are all right; Check takes
 * over the screen, and on a miss it shows why each wrong field was wrong and a heart goes; the review marks the fields,
 * hangs the right order on the ladder and gives the working; the number keys fill the lit field and Enter checks; the run
 * ends at eight or when the hearts are gone, reports itself once to POST /api/study/game-runs, and the end screen's level
 * bar reads the server's numbers (and is left out, the screen whole, when the report fails). A run the hearts end early
 * is scored on the tickets played; an answer for an earlier run never lands on a later one; the ladder's labels hang for
 * the card's measured width.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import UIcon from '../../../components/ui/UIcon'
import OrderTicketGame, { GAME } from './OrderTicketGame'
import { LABEL_CHAR_W_WIDE, NO_PRICE, SIDES, TICKET_BEST_KEY, TYPES, buildRun, fmt, labelFit, orderMarks, rightTicket, working } from './games/orderTicket'

const SEED = 1762560000000
const RUN = buildRun(SEED)
const RUNS_URL = '/api/study/game-runs'

const okFetcher = () => vi.fn(async (url) => {
  if (url === RUNS_URL) return { xp_gained: 2, duplicate: false, capped: false, progress: { xp_gained: 2, xp: 1002, level: 3, weekly_xp: 40, badges_new: [] }, badges_new: [] }
  throw new Error(`unexpected ${url}`)
})

function begin(fetcher) {
  render(<OrderTicketGame fetcher={fetcher} onClose={() => {}} />)
  const spy = vi.spyOn(Date, 'now').mockReturnValue(SEED)   // the seed the run is dealt from
  fireEvent.click(screen.getByTestId('ticket-start'))
  spy.mockRestore()
}
function fill(sit, { side = sit.side, type = sit.type, price = sit.price } = {}) {
  fireEvent.click(screen.getByTestId(`ticket-side-${SIDES.indexOf(side)}`))
  fireEvent.click(screen.getByTestId(`ticket-type-${TYPES.indexOf(type)}`))
  fireEvent.click(screen.getByTestId(`ticket-price-${price}`))
}
const otherSide = (sit) => SIDES.find((x) => x !== sit.side)
const otherType = (sit) => TYPES.find((x) => x !== sit.type)
const otherPrice = (sit) => (sit.price + 1) % 3
const checkAndOpen = () => { fireEvent.click(screen.getByTestId('ticket-check')); fireEvent.click(screen.getByTestId('ticket-takeover-go')) }
const missAll = (sits) => { for (const sit of sits) { fill(sit, { side: otherSide(sit) }); checkAndOpen(); fireEvent.click(screen.getByTestId('ticket-next')) } }

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('OrderTicketGame', () => {
  it('registers from one export, with an icon the registry draws', () => {
    expect(GAME).toEqual({ kind: 'ticket', title: 'Order Ticket', sub: expect.any(String), icon: 'document', plate: 'Ticket', accent: 'green', group: 'skill' })
    expect(GAME.sub).not.toMatch(/[—–]|\bfirm\b/i)
    const { container } = render(<UIcon name={GAME.icon} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('opens on the arena: the stakes, the three steps, Start', () => {
    render(<OrderTicketGame fetcher={okFetcher()} />)
    const intro = screen.getByTestId('ticket-intro')
    expect(intro).toHaveTextContent('Order Ticket')
    expect(intro).toHaveTextContent('situations')
    expect(intro).toHaveTextContent('hearts')
    const howto = screen.getByTestId('ticket-howto')
    expect(howto).toHaveTextContent('Read the situation')
    expect(howto).toHaveTextContent('Fill the ticket')
    expect(howto).toHaveTextContent('Three hearts')
    expect(screen.getByTestId('ticket-best')).toHaveTextContent('Made-up quotes, real order rules')
    expect(screen.getByTestId('ticket-start')).toHaveTextContent('Deal the tickets')
  })

  it('shows the best run kept on this device', () => {
    localStorage.setItem(TICKET_BEST_KEY, '5')
    render(<OrderTicketGame fetcher={okFetcher()} />)
    expect(screen.getByTestId('ticket-best')).toHaveTextContent('Your best run: 5 of 8 filled')
  })

  it('plays a run: a right ticket, a wrong one with its working, the hearts running out, the end screen and one report', async () => {
    const fetcher = okFetcher()
    begin(fetcher)
    const [a, b, c, d] = RUN

    // ticket 1: the situation, the quote, the empty ticket
    expect(screen.getByTestId('ticket-situation')).toHaveTextContent(a.text.join(' '))
    expect(screen.getByTestId('quote-bid')).toHaveTextContent(fmt(a.quote.bid))
    expect(screen.getByTestId('quote-ask')).toHaveTextContent(fmt(a.quote.ask))
    expect(screen.getByTestId(`quote-${a.levels[0].key}`)).toHaveTextContent(fmt(a.levels[0].cents))
    expect(screen.getByTestId('ticket-step')).toHaveTextContent('ticket 1 of 8')
    expect(screen.getByTestId('ticket-hearts')).toHaveAttribute('data-left', '3')
    expect(screen.getByTestId('ticket-hearts').querySelectorAll('svg')).toHaveLength(3)    // the kit's glyph, one a heart
    expect(screen.getByTestId('ticket-check')).toBeDisabled()
    expect(screen.getByTestId('ticket-check')).toHaveTextContent('Pick the side')

    // a right answer: all three fields
    fill(a)
    expect(screen.getByTestId('ticket-check')).toBeEnabled()
    fireEvent.click(screen.getByTestId('ticket-check'))
    const win = screen.getByTestId('ticket-takeover')
    expect(win).toHaveAttribute('data-correct', '1')
    expect(win).toHaveTextContent('Filled right.')
    expect(win).toHaveTextContent(rightTicket(a))
    expect(screen.getByTestId('ticket-takeover-rule')).toHaveTextContent(a.rule)
    fireEvent.click(screen.getByTestId('ticket-takeover-go'))
    expect(screen.queryByTestId('ticket-takeover')).toBeNull()
    expect(screen.getByTestId('ticket-round')).toHaveAttribute('data-state', 'ok')
    expect(screen.getByTestId(`ticket-side-${SIDES.indexOf(a.side)}`)).toHaveAttribute('data-state', 'right')
    expect(screen.getByTestId('ticket-mark-right')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-working')).toHaveTextContent(rightTicket(a))
    expect(screen.getByTestId('ticket-hearts')).toHaveAttribute('data-left', '3')
    fireEvent.click(screen.getByTestId('ticket-next'))

    // ticket 2: a wrong side, the answer takes over the screen with the working
    expect(screen.getByTestId('ticket-situation')).toHaveTextContent(b.text.join(' '))
    const wrong = otherSide(b)
    fill(b, { side: wrong })
    fireEvent.click(screen.getByTestId('ticket-check'))
    const miss = screen.getByTestId('ticket-takeover')
    expect(miss).toHaveAttribute('data-correct', '0')
    expect(miss).toHaveTextContent('Not this ticket.')
    expect(miss).toHaveTextContent(rightTicket(b))
    const w = working(b, { side: wrong, type: b.type, price: b.price })
    // each field marked, the wrong one's lesson in one line (the takeover cannot scroll, so it stays short)
    expect(screen.getByTestId('ticket-takeover-side')).toHaveAttribute('data-ok', '0')
    expect(screen.getByTestId('ticket-takeover-type')).toHaveAttribute('data-ok', '1')
    expect(screen.getByTestId('ticket-takeover-price')).toHaveAttribute('data-ok', '1')
    expect(screen.getByTestId('ticket-takeover-why')).toHaveTextContent(`Side: You said ${wrong}. ${w.rows[0].saidWhy}`)
    expect(miss).toHaveTextContent('2 hearts left')
    fireEvent.click(screen.getByTestId('ticket-takeover-go'))
    expect(screen.getByTestId(`ticket-side-${SIDES.indexOf(wrong)}`)).toHaveAttribute('data-state', 'wrong')
    expect(screen.getByTestId(`ticket-side-${SIDES.indexOf(b.side)}`)).toHaveAttribute('data-state', 'right')
    const sideRow = screen.getByTestId('ticket-working-side')
    expect(sideRow).toHaveTextContent(`you said ${wrong}`)
    expect(sideRow).toHaveTextContent(w.rows[0].saidWhy)
    expect(sideRow).toHaveTextContent(w.rows[0].why)
    expect(screen.getByTestId('ticket-working')).toHaveTextContent(b.rule)
    expect(screen.getByTestId('ticket-working')).toHaveTextContent(b.source)
    expect(screen.getByTestId('ticket-hearts')).toHaveAttribute('data-left', '2')
    expect(screen.getByTestId('ticket-next')).toHaveTextContent('Next ticket')
    fireEvent.click(screen.getByTestId('ticket-next'))

    // tickets 3 and 4: a wrong price, then a wrong type; the last heart goes
    fill(c, { price: otherPrice(c) })
    checkAndOpen()
    expect(screen.getByTestId('ticket-working-price')).toHaveTextContent(`you said ${c.prices[otherPrice(c)].label}`)
    fireEvent.click(screen.getByTestId('ticket-next'))
    fill(d, { type: otherType(d) })
    fireEvent.click(screen.getByTestId('ticket-check'))
    expect(screen.getByTestId('ticket-takeover')).toHaveTextContent('Out of hearts')
    fireEvent.click(screen.getByTestId('ticket-takeover-go'))
    expect(screen.getByTestId('ticket-hearts')).toHaveAttribute('data-left', '0')
    expect(screen.getByTestId('ticket-next')).toHaveTextContent('See the run')
    expect(fetcher).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('ticket-next'))

    // the end: out of hearts, scored on the four played (1 of 4, 25%, no medal line for a run cut short), the run log,
    // one report and the level bar from the server's numbers
    const done = screen.getByTestId('ticket-done')
    expect(done).toHaveTextContent('Out of hearts')
    expect(done).toHaveTextContent('1 of 4 tickets filled right')
    expect(done).toHaveTextContent('25% accuracy')
    expect(done).not.toHaveTextContent('lights the Legendary medal')
    expect(done).toHaveTextContent('The hearts ran out on ticket 4 of 8.')
    expect(done).toHaveTextContent('A new best all the same: 1 filled right.')
    const rows = within(screen.getByTestId('run-log')).getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent(a.title)
    expect(rows[0]).toHaveTextContent(rightTicket(a))
    expect(rows[1]).toHaveTextContent(`you said ${wrong} · ${b.type}`)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(RUNS_URL, { method: 'POST', body: { kind: 'ticket', run_id: `ticket-${SEED}`, right: 1, total: 4 } })
    const bar = await screen.findByTestId('ticket-level')
    expect(bar).toHaveTextContent('+2 XP this run')
    await waitFor(() => expect(screen.getByTestId('ticket-xp')).toHaveTextContent('+2'))
  })

  it('a failed report never breaks the end screen: it shows without the level bar', async () => {
    const fetcher = vi.fn(async () => { const e = new Error('POST /api/study/game-runs answered 500'); e.status = 500; throw e })
    begin(fetcher)
    missAll(RUN.slice(0, 3))
    expect(screen.getByTestId('ticket-done')).toHaveTextContent('Out of hearts')
    expect(screen.getByTestId('ticket-done')).toHaveTextContent('0 of 3 tickets filled right')
    await waitFor(() => expect(screen.getByTestId('ticket-xp-failed')).toHaveTextContent("This run's XP did not save."))
    expect(screen.queryByTestId('ticket-level')).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][1].body).toEqual({ kind: 'ticket', run_id: `ticket-${SEED}`, right: 0, total: 3 })
    expect(screen.getByTestId('ticket-again')).toBeInTheDocument()
  })

  it('the number keys fill the lit field, then Enter checks and opens the review', () => {
    begin(okFetcher())
    const a = RUN[0]
    expect(screen.getByTestId('ticket-field-side')).toHaveAttribute('data-active', '1')
    fireEvent.keyDown(window, { key: String(SIDES.indexOf(a.side) + 1) })
    expect(screen.getByTestId(`ticket-side-${SIDES.indexOf(a.side)}`)).toHaveAttribute('data-state', 'sel')
    expect(screen.getByTestId('ticket-field-type')).toHaveAttribute('data-active', '1')
    fireEvent.keyDown(window, { key: String(TYPES.indexOf(a.type) + 1) })
    expect(screen.getByTestId('ticket-field-price')).toHaveAttribute('data-active', '1')
    fireEvent.keyDown(window, { key: '9' })                                            // no ninth price: nothing happens
    expect(screen.getByTestId('ticket-check')).toBeDisabled()
    fireEvent.keyDown(window, { key: String(a.price + 1) })
    expect(screen.getByTestId('ticket-check')).toBeEnabled()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('ticket-takeover')).toHaveAttribute('data-correct', '1')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('ticket-takeover')).toBeNull()
    expect(screen.getByTestId('ticket-working')).toBeInTheDocument()
  })

  it('a perfect run of eight reports 8 of 8 and lights the Legendary medal', async () => {
    const fetcher = okFetcher()
    begin(fetcher)
    RUN.forEach((sit, k) => {
      expect(screen.getByTestId('ticket-step')).toHaveTextContent(`ticket ${k + 1} of 8`)
      fill(sit)
      checkAndOpen()
      fireEvent.click(screen.getByTestId('ticket-next'))
    })
    const done = screen.getByTestId('ticket-done')
    expect(done).toHaveTextContent('Eight for eight.')
    expect(done).toHaveTextContent('8 of 8 tickets filled right')
    expect(fetcher).toHaveBeenCalledWith(RUNS_URL, { method: 'POST', body: { kind: 'ticket', run_id: `ticket-${SEED}`, right: 8, total: 8 } })
    expect(localStorage.getItem(TICKET_BEST_KEY)).toBe('8')
    await screen.findByTestId('ticket-level')
  })

  it('a market ticket names no price, and the ladder shows where it fills', () => {
    begin(okFetcher())
    const k = RUN.findIndex((s) => s.type === 'Market')
    expect(k).toBeGreaterThanOrEqual(0)
    for (let j = 0; j < k; j++) { fill(RUN[j]); checkAndOpen(); fireEvent.click(screen.getByTestId('ticket-next')) }
    const m = RUN[k]
    expect(screen.getByTestId('quote-spread')).toHaveTextContent('0.01')
    fill(m)
    expect(screen.getByTestId(`ticket-price-${m.price}`)).toHaveTextContent(NO_PRICE)
    checkAndOpen()
    const near = m.side === 'Buy' ? m.quote.ask : m.quote.bid
    expect(screen.getByTestId('ticket-mark-right')).toHaveTextContent(`Fills near ${fmt(near)}`)
  })

  it('a ticket wrong in all three fields marks all three and teaches the first, the rest left to the working', () => {
    begin(okFetcher())
    const a = RUN[0]
    const pick = { side: otherSide(a), type: otherType(a), price: otherPrice(a) }
    fill(a, pick)
    fireEvent.click(screen.getByTestId('ticket-check'))
    for (const f of ['side', 'type', 'price']) expect(screen.getByTestId(`ticket-takeover-${f}`)).toHaveAttribute('data-ok', '0')
    const w = working(a, pick)
    expect(screen.getByTestId('ticket-takeover-why')).toHaveTextContent(`Side: You said ${pick.side}. ${w.rows[0].saidWhy}`)
    expect(screen.getByTestId('ticket-takeover-why')).not.toHaveTextContent(w.rows[1].saidWhy)
    fireEvent.click(screen.getByTestId('ticket-takeover-go'))
    for (const f of ['side', 'type', 'price']) expect(screen.getByTestId(`ticket-working-${f}`)).toHaveTextContent(w.rows.find((r) => r.field === f).saidWhy)
  })

  it('an answer for an earlier run never lands on a later run\'s end screen', async () => {
    const calls = []
    const fetcher = vi.fn((url, opts) => new Promise((resolve) => { calls.push({ body: opts.body, resolve }) }))
    begin(fetcher)
    missAll(RUN.slice(0, 3))
    expect(calls.map((c) => c.body.run_id)).toEqual([`ticket-${SEED}`])
    // a new run starts before the first one's answer is back
    fireEvent.click(screen.getByTestId('ticket-again'))
    const SEED2 = SEED + 60000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(SEED2)
    fireEvent.click(screen.getByTestId('ticket-start'))
    spy.mockRestore()
    missAll(buildRun(SEED2).slice(0, 3))
    expect(calls.map((c) => c.body.run_id)).toEqual([`ticket-${SEED}`, `ticket-${SEED2}`])
    // the first run's answer lands late: its +6 must not show on the second run's end screen
    await act(async () => { calls[0].resolve({ xp_gained: 6, progress: { xp: 506, xp_gained: 6 } }) })
    expect(screen.queryByTestId('ticket-level')).toBeNull()
    await act(async () => { calls[1].resolve({ xp_gained: 2, progress: { xp: 508, xp_gained: 2 } }) })
    expect(await screen.findByTestId('ticket-level')).toHaveTextContent('+2 XP this run')
  })

  it('a full run with a miss or two names a new best, then the best that stands', async () => {
    localStorage.setItem(TICKET_BEST_KEY, '5')
    const fetcher = okFetcher()
    begin(fetcher)
    RUN.forEach((sit, k) => {
      fill(sit, k === 2 ? { side: otherSide(sit) } : {})
      checkAndOpen()
      fireEvent.click(screen.getByTestId('ticket-next'))
    })
    const done = screen.getByTestId('ticket-done')
    expect(done).toHaveTextContent('7 of 8 tickets filled right')
    expect(done).toHaveTextContent('A new best: 7 of 8 filled right.')
    expect(done).toHaveTextContent('lights the Legendary medal')           // a full run keeps the medal line
    expect(localStorage.getItem(TICKET_BEST_KEY)).toBe('7')
    await screen.findByTestId('ticket-level')
    fireEvent.click(screen.getByTestId('ticket-again'))
    expect(screen.getByTestId('ticket-best')).toHaveTextContent('Your best run: 7 of 8 filled')
    const SEED2 = SEED + 90000
    const spy = vi.spyOn(Date, 'now').mockReturnValue(SEED2)
    fireEvent.click(screen.getByTestId('ticket-start'))
    spy.mockRestore()
    buildRun(SEED2).forEach((sit, k) => {
      fill(sit, k < 2 ? { type: otherType(sit) } : {})
      checkAndOpen()
      fireEvent.click(screen.getByTestId('ticket-next'))
    })
    expect(screen.getByTestId('ticket-done')).toHaveTextContent('6 of 8 tickets filled right')
    expect(screen.getByTestId('ticket-done')).toHaveTextContent('Your best run stands at 7 of 8.')
    await screen.findByTestId('ticket-level')
    expect(fetcher.mock.calls.map((c) => [c[1].body.run_id, c[1].body.right])).toEqual([[`ticket-${SEED}`, 7], [`ticket-${SEED2}`, 6]])
  })

  it('hangs the ladder\'s labels for the card\'s measured width: a long flag on a narrow phone card slides onto it', () => {
    const real = globalThis.ResizeObserver
    globalThis.ResizeObserver = class { constructor(cb) { this.cb = cb } observe() { this.cb([{ contentRect: { width: 260 } }]) } unobserve() {} disconnect() {} }
    try {
      begin(okFetcher())
      fill(RUN[0]); checkAndOpen(); fireEvent.click(screen.getByTestId('ticket-next'))
      const b = RUN[1]                                           // a cover stop: "Buy to cover stop 124.91", near the right edge
      expect(b.id).toBe('cover-stop')
      fill(b); checkAndOpen()
      const want = orderMarks(b, { price: b.price }, labelFit(260))[0]
      const guess = orderMarks(b, { price: b.price }, LABEL_CHAR_W_WIDE)[0]
      expect([want.anchor, guess.anchor]).toEqual(['middle', 'end'])   // the fixed guess would hang it off the card's edge
      const flag = screen.getByTestId('ticket-mark-right')
      expect(flag).toHaveAttribute('data-anchor', 'middle')
      expect(flag).toHaveAttribute('data-row', String(want.row))
      expect(want.shift).toBeLessThan(0)
      expect(flag.querySelector('b').style.marginLeft).toBe(`${(want.shift * 260).toFixed(1)}px`)
    } finally {
      globalThis.ResizeObserver = real
    }
  })
})

/**
 * Options Payoff rails: the start arena with its stakes and three steps; a right answer takes over the screen, then the
 * payoff line draws with its breakeven; a wrong one takes over with the working and names the mistake; three misses end
 * the run; the run posts once to /api/study/game-runs and the end screen's level bar reads the server's answer; a failed
 * post still shows the end screen, without the bar. The seed is pinned, so every expected number is the pure module's.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import OptionsPayoffGame, { GAME } from './OptionsPayoffGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { PAYOFF_TOTAL, buildRun, fmtPL, mistakeLine, plAt, price, priceAt, payoffChart } from './games/optionsPayoff'

const SEED = 1731100000000
const RUN = buildRun(SEED)

/** The fetcher: records the game-runs posts; answers with the member's new XP, or fails. */
function fetcherWith(posts, { fail = false, status = 500 } = {}) {
  return vi.fn(async (url, opts = {}) => {
    if (url === '/api/study/game-runs') {
      posts.push(opts.body)
      if (fail) { const e = new Error('boom'); e.status = status; throw e }
      return { xp_gained: opts.body.right * 2, progress: { xp: 1000 + opts.body.right * 2, level: 3, xp_gained: opts.body.right * 2 }, badges_new: [] }
    }
    throw new Error(`unexpected ${url}`)
  })
}

/** Start a run on the pinned seed (the component seeds from Date.now() once, at Start). */
function startRun(seed = SEED, button = 'payoff-start') {
  const spy = vi.spyOn(Date, 'now').mockReturnValue(seed)
  fireEvent.click(screen.getByTestId(button))
  spy.mockRestore()
}

const tile = (label) => [...screen.getByTestId('payoff-cards').querySelectorAll('button')].find((b) => b.textContent.includes(label))
const labelFor = (pos, mistake) => pos.choices.find((c) => c.mistake === mistake).label

/** Answer the current position with the tile for `mistake`, through the takeover, to the review. */
function answer(pos, mistake) {
  fireEvent.click(tile(labelFor(pos, mistake)))
  fireEvent.click(screen.getByTestId('payoff-check'))
  expect(screen.getByTestId('payoff-takeover')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('payoff-takeover-go'))
}

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

describe('OptionsPayoffGame', () => {
  it('registers itself from one place, on an existing icon and accent', () => {
    expect(GAME).toEqual({ kind: 'payoff', title: 'Options Payoff', sub: expect.any(String), icon: 'dollar', plate: 'Payoff', accent: 'gold' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/—|firm/i)
  })

  it('opens on the start arena: the stakes, the three steps, the best score', () => {
    render(<OptionsPayoffGame fetcher={fetcherWith([])} onClose={() => {}} />)
    const intro = screen.getByTestId('payoff-intro')
    expect(intro).toHaveTextContent('Options Payoff')
    expect(intro).toHaveTextContent('6positions')
    expect(intro).toHaveTextContent('3hearts')
    expect(intro).toHaveTextContent('x100a contract')
    const how = screen.getByTestId('payoff-howto')
    expect(within(how).getAllByRole('listitem')).toHaveLength(3)
    expect(how).toHaveTextContent('Read the position')
    expect(how).toHaveTextContent('Price it at expiry')
    expect(how).toHaveTextContent('Watch the payoff draw')
    expect(screen.getByTestId('payoff-best')).toHaveTextContent('0')
    expect(intro.textContent).not.toMatch(/—|firm/i)
  })

  it('a right answer, a wrong one with the working, three misses end the run, and the run posts its XP once', async () => {
    const posts = []
    render(<OptionsPayoffGame fetcher={fetcherWith(posts)} onClose={() => {}} />)
    startRun()

    // position 1: the position said plainly, the expiry price in the question, four tiles, the line not drawn yet
    let pos = RUN[0]
    expect(screen.getByTestId('payoff-step')).toHaveTextContent(`Position 1 of ${PAYOFF_TOTAL}`)
    expect(screen.getByTestId('payoff-position')).toHaveTextContent(pos.sentence)
    expect(screen.getByText(pos.question)).toBeInTheDocument()
    expect(screen.getByTestId('payoff-cards').querySelectorAll('button')).toHaveLength(4)
    expect(screen.getByTestId('payoff-hearts').getAttribute('data-left')).toBe('3')
    expect(screen.queryByTestId('payoff-line')).toBeNull()
    expect(screen.getByTestId('payoff-plot').getAttribute('data-drawn')).toBe('0')
    expect(screen.getByTestId('payoff-expiry').textContent).toBe(`Expiry ${price(pos.expiry)}`)   // no P/L before the answer
    expect(screen.getByTestId('payoff-check')).toBeDisabled()

    // the right answer: the takeover, then the payoff line draws with its breakeven and the P/L at the expiry price
    fireEvent.click(tile(pos.answer))
    fireEvent.click(screen.getByTestId('payoff-check'))
    const tk = screen.getByTestId('payoff-takeover')
    expect(tk.getAttribute('data-correct')).toBe('1')
    expect(tk).toHaveTextContent('Priced it.')
    expect(tk).toHaveTextContent(pos.answer)
    expect(screen.queryByTestId('payoff-line')).toBeNull()        // the line draws when the member opens the review
    fireEvent.click(screen.getByTestId('payoff-takeover-go'))
    expect(screen.queryByTestId('payoff-takeover')).toBeNull()
    expect(screen.getByTestId('payoff-line')).toBeInTheDocument()
    expect(screen.getByTestId('payoff-breakeven')).toHaveTextContent(`Breakeven ${price(pos.breakeven)}`)
    expect(screen.getByTestId('payoff-expiry').textContent).toBe(`Expiry ${price(pos.expiry)} · ${pos.answer}`)
    expect(screen.getByTestId('payoff-readout')).toHaveTextContent(`At ${price(pos.expiry)} on expiry day: ${pos.answer}`)
    expect(screen.getByText('Priced it.')).toBeInTheDocument()
    const working = screen.getByTestId('payoff-working')
    expect(working).toHaveTextContent('How it adds up')
    for (const w of pos.working) expect(working).toHaveTextContent(w)
    expect(working).toHaveTextContent(pos.rule)
    expect(working).toHaveTextContent(`From the course · ${pos.unit}`)
    expect(screen.queryByTestId('payoff-mistake')).toBeNull()
    // a finger along the line reads the P/L at that price, from the pure module
    const svg = screen.getByTestId('payoff-plot').querySelector('svg')
    const W = Number(svg.getAttribute('viewBox').split(' ')[2])      // the drawing's own width (measured, or its fallback)
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: W, height: 260, right: W, bottom: 260, x: 0, y: 0 })
    const L = 60, pw = W - 60 - 12
    fireEvent.pointerMove(svg, { clientX: L + pw / 2, clientY: 100 })
    const mid = priceAt(payoffChart(pos), 0.5)
    expect(screen.getByTestId('payoff-readout')).toHaveTextContent(`At ${price(mid)} on expiry day: ${fmtPL(plAt(pos, mid))}`)
    fireEvent.click(screen.getByTestId('payoff-next'))

    // position 2: forgot the x100. The takeover is the working; the review names the mistake; a heart goes
    pos = RUN[1]
    expect(screen.getByTestId('payoff-step')).toHaveTextContent(`Position 2 of ${PAYOFF_TOTAL}`)
    fireEvent.click(tile(labelFor(pos, 'x100')))
    fireEvent.click(screen.getByTestId('payoff-check'))
    const miss = screen.getByTestId('payoff-takeover')
    expect(miss.getAttribute('data-correct')).toBe('0')
    expect(miss).toHaveTextContent('Forgot the x100.')
    expect(miss).toHaveTextContent(`The answer${pos.answer}`)
    const tkWork = screen.getByTestId('payoff-takeover-working')
    expect(tkWork).toHaveTextContent(mistakeLine(pos, 'x100'))
    for (const w of pos.working) expect(tkWork).toHaveTextContent(w)
    fireEvent.click(screen.getByTestId('payoff-takeover-go'))
    expect(screen.getByTestId('payoff-mistake')).toHaveTextContent(mistakeLine(pos, 'x100'))
    expect(screen.getByTestId('payoff-working')).toHaveTextContent(`How to get ${pos.answer}`)
    expect(screen.getByText(`you said ${labelFor(pos, 'x100')}`, { exact: false })).toBeInTheDocument()
    expect(screen.getByTestId('payoff-hearts').getAttribute('data-left')).toBe('2')
    // the tile the verdict lights green is the right amount; the picked one is marked wrong
    expect(tile(pos.answer).getAttribute('data-state')).toBe('right')
    expect(tile(labelFor(pos, 'x100')).getAttribute('data-state')).toBe('wrong')
    fireEvent.click(screen.getByTestId('payoff-next'))

    // positions 3 and 4: left out the premium, then the sign flipped; the last heart goes and the run ends there
    answer(RUN[2], 'premium')
    expect(screen.getByTestId('payoff-mistake')).toHaveTextContent(mistakeLine(RUN[2], 'premium'))
    fireEvent.click(screen.getByTestId('payoff-next'))
    pos = RUN[3]
    fireEvent.click(tile(labelFor(pos, 'sign')))
    fireEvent.click(screen.getByTestId('payoff-check'))
    expect(screen.getByTestId('payoff-takeover')).toHaveTextContent('That was the last heart.')
    fireEvent.click(screen.getByTestId('payoff-takeover-go'))
    expect(screen.getByTestId('payoff-hearts').getAttribute('data-left')).toBe('0')
    expect(screen.getByTestId('payoff-next')).toHaveTextContent('See the run')
    expect(posts).toHaveLength(0)
    fireEvent.click(screen.getByTestId('payoff-next'))

    // the end screen: the run log, the right count, and the XP and level bar from the server's answer
    expect(screen.getByTestId('payoff-done')).toBeInTheDocument()
    expect(screen.getByText('Out of hearts')).toBeInTheDocument()
    expect(screen.getByTestId('payoff-right')).toHaveTextContent('1/4')
    const log = screen.getByTestId('run-log')
    expect(within(log).getAllByRole('listitem')).toHaveLength(4)
    expect(log).toHaveTextContent(RUN[0].title)
    expect(log).toHaveTextContent(`you said ${labelFor(RUN[1], 'x100')}, it was ${RUN[1].answer}`)
    await waitFor(() => expect(screen.getByTestId('payoff-level')).toBeInTheDocument())
    expect(posts).toEqual([{ kind: 'payoff', run_id: `payoff-${SEED}`, right: 1, total: 4 }])
    expect(screen.getByTestId('payoff-level')).toHaveTextContent('+2 XP this run')
    await waitFor(() => expect(screen.getByTestId('payoff-xp')).toHaveTextContent('+2'))
    expect(screen.queryByTestId('payoff-signed-out')).toBeNull()
  })

  it('a perfect run of six is Legendary, posts 6 of 6, and keeps the best score on the device', async () => {
    const posts = []
    render(<OptionsPayoffGame fetcher={fetcherWith(posts)} onClose={() => {}} />)
    startRun()
    for (let k = 0; k < PAYOFF_TOTAL; k++) {
      answer(RUN[k], 'right')
      expect(screen.getByTestId('payoff-hearts').getAttribute('data-left')).toBe('3')
      fireEvent.click(screen.getByTestId('payoff-next'))
    }
    expect(screen.getByText('Legendary')).toBeInTheDocument()
    expect(screen.getByTestId('legend-medal').getAttribute('data-lit')).toBe('1')
    expect(screen.getByTestId('payoff-right')).toHaveTextContent('6/6')
    await waitFor(() => expect(posts).toEqual([{ kind: 'payoff', run_id: `payoff-${SEED}`, right: 6, total: 6 }]))
    await waitFor(() => expect(screen.getByTestId('payoff-level')).toHaveTextContent('+12 XP this run'))
    expect(localStorage.getItem('study.payoff.best')).toBe('6')
  })

  it('a failed post never breaks the end screen: it shows without the level bar', async () => {
    const posts = []
    render(<OptionsPayoffGame fetcher={fetcherWith(posts, { fail: true })} onClose={() => {}} />)
    startRun()
    for (let k = 0; k < 3; k++) { answer(RUN[k], 'sign'); fireEvent.click(screen.getByTestId('payoff-next')) }
    expect(screen.getByTestId('payoff-done')).toBeInTheDocument()
    await waitFor(() => expect(posts).toHaveLength(1))
    // let the rejected post settle, then the screen is still the end screen with no bar
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByTestId('payoff-done')).toBeInTheDocument()
    expect(screen.queryByTestId('payoff-level')).toBeNull()
    expect(screen.getByTestId('payoff-right')).toHaveTextContent('0/3')
    expect(screen.queryByTestId('payoff-signed-out')).toBeNull()
  })

  it('a signed-out run says it earned no XP and offers the sign-in', async () => {
    render(<OptionsPayoffGame fetcher={fetcherWith([], { fail: true, status: 401 })} onClose={() => {}} signedOut={<button type="button">Sign in</button>} />)
    startRun()
    for (let k = 0; k < 3; k++) { answer(RUN[k], 'premium'); fireEvent.click(screen.getByTestId('payoff-next')) }
    expect(await screen.findByTestId('payoff-signed-out')).toHaveTextContent('You are signed out, so this run earned no XP.')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByTestId('payoff-level')).toBeNull()
  })

  it('plays from the keyboard: a number key picks, Enter checks, Enter opens the review', () => {
    render(<OptionsPayoffGame fetcher={fetcherWith([])} onClose={() => {}} />)
    startRun()
    const pos = RUN[0]
    const k = pos.labels.indexOf(pos.answer)
    fireEvent.keyDown(window, { key: String(k + 1) })
    expect(tile(pos.answer).getAttribute('data-state')).toBe('sel')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.getByTestId('payoff-takeover').getAttribute('data-correct')).toBe('1')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('payoff-takeover')).toBeNull()
    expect(screen.getByTestId('payoff-line')).toBeInTheDocument()
  })

  it('Run it again starts a fresh run at position 1 with three hearts', async () => {
    const posts = []
    render(<OptionsPayoffGame fetcher={fetcherWith(posts)} onClose={() => {}} />)
    startRun()
    for (let k = 0; k < 3; k++) { answer(RUN[k], 'x100'); fireEvent.click(screen.getByTestId('payoff-next')) }
    await waitFor(() => expect(screen.getByTestId('payoff-level')).toBeInTheDocument())
    startRun(SEED + 1, 'payoff-again')
    const next = buildRun(SEED + 1)
    expect(screen.getByTestId('payoff-step')).toHaveTextContent(`Position 1 of ${PAYOFF_TOTAL}`)
    expect(screen.getByTestId('payoff-hearts').getAttribute('data-left')).toBe('3')
    expect(screen.getByTestId('payoff-position')).toHaveTextContent(next[0].sentence)
  })

  it("a late XP answer for the last run never lands on the next run's end screen", async () => {
    let settle = null
    const posts = []
    const fetcher = vi.fn((url, opts = {}) => {
      posts.push(opts.body)
      // the first run's post waits for the test to answer it; the second's never answers
      return posts.length === 1 ? new Promise((res) => { settle = res }) : new Promise(() => {})
    })
    render(<OptionsPayoffGame fetcher={fetcher} onClose={() => {}} />)
    startRun()
    for (let k = 0; k < 3; k++) { answer(RUN[k], 'sign'); fireEvent.click(screen.getByTestId('payoff-next')) }
    await waitFor(() => expect(settle).not.toBeNull())
    startRun(SEED + 7, 'payoff-again')
    await act(async () => { settle({ xp_gained: 0, progress: { xp: 1000, level: 3 } }) })
    const next = buildRun(SEED + 7)
    for (let k = 0; k < 3; k++) { answer(next[k], 'sign'); fireEvent.click(screen.getByTestId('payoff-next')) }
    expect(screen.getByTestId('payoff-done')).toBeInTheDocument()
    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts[1]).toEqual({ kind: 'payoff', run_id: `payoff-${SEED + 7}`, right: 0, total: 3 })
    expect(screen.queryByTestId('payoff-level')).toBeNull()
  })
})

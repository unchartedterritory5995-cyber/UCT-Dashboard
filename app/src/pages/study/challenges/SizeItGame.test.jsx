/**
 * Size It rails (docs/study/GAMES.md §1 rule 6): the start screen with its stakes and three steps; a right answer scores
 * on the multiplier and deals the next card at once; a miss takes over the screen with the mistake named and the working
 * in three steps while the clock waits; the clock ends the run on the end screen with its log; the run reports itself
 * once to POST /api/study/game-runs and the level bar shows what the server granted; a refused report leaves the end
 * screen whole without the bar. Time is faked, so the seed (Date.now() at start) and every card are known.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'

vi.mock('../../../components/study/StudyMark', () => ({ default: () => <span data-testid="mark" /> }))

import SizeItGame, { GAME } from './SizeItGame'
import { UICON_NAMES } from '../../../components/ui/UIcon'
import { cardAt, dollars, missTitle, pointsFor, price, riskPctText, runIdOf, sharesText, whyLine, working } from './games/sizeIt'

const SEED = 1731100000000
const tileFor = (value) => within(screen.getByTestId('size-choices')).getByRole('button', { name: sharesText(value) })   // exact: "20" never matches "20,000"
const flush = async () => { await act(async () => { for (let k = 0; k < 6; k++) await Promise.resolve() }) }
const okFetcher = (posts) => vi.fn(async (url, opts = {}) => {
  posts.push({ url, body: opts.body })
  return { xp_gained: 2, duplicate: false, progress: { xp_gained: 2, xp: 1002, level: 3 } }
})

function expectCard(c) {
  expect(screen.getByTestId('size-account')).toHaveTextContent(dollars(c.account))
  expect(screen.getByTestId('size-risk')).toHaveTextContent(riskPctText(c.riskBps))
  expect(screen.getByTestId('size-entry')).toHaveTextContent(price(c.entryCents))
  expect(screen.getByTestId('size-stop')).toHaveTextContent(price(c.stopCents))
  const labels = within(screen.getByTestId('size-choices')).getAllByRole('button').map((b) => b.textContent)
  expect(labels).toHaveLength(4)
  c.choices.forEach((x, k) => expect(labels[k]).toContain(sharesText(x.value)))
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(SEED); localStorage.clear() })
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear() })

describe('SizeItGame', () => {
  it('registers itself with a real icon and one of the landing accents', () => {
    expect(GAME).toMatchObject({ kind: 'size', title: 'Size It', plate: 'Size' })
    expect(UICON_NAMES).toContain(GAME.icon)
    expect(['amber', 'red', 'gold', 'green']).toContain(GAME.accent)
    expect(GAME.sub).not.toMatch(/—/)
  })

  it('opens on the start arena: the stakes, the rule, the three steps and the best score', () => {
    localStorage.setItem('study.size.best', '140')
    render(<SizeItGame fetcher={okFetcher([])} />)
    const intro = screen.getByTestId('size-intro')
    expect(intro).toHaveTextContent('Size It')
    expect(intro).toHaveTextContent('60seconds')
    expect(intro).toHaveTextContent('2%max risk')
    expect(intro).toHaveTextContent('x5top multiplier')
    expect(intro).toHaveTextContent('Stop first, distance second, size last.')
    expect(screen.getByTestId('size-best')).toHaveTextContent('140')
    const how = screen.getByTestId('size-howto')
    expect(how.querySelectorAll('li')).toHaveLength(3)
    for (const t of ['Read the card', 'Size it', 'Build the multiplier']) expect(how).toHaveTextContent(t)
    expect(intro.textContent).not.toMatch(/—|the firm/i)
    expect(screen.getByTestId('size-start')).not.toBeDisabled()
  })

  it('plays a run: right scores on the multiplier, a miss takes over with the working, the clock waits, time ends it and reports once', async () => {
    const posts = []
    const onClose = vi.fn()
    render(<SizeItGame fetcher={okFetcher(posts)} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('size-start'))
    expect(screen.getByTestId('size-play')).toBeInTheDocument()
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('60s left')

    // card 1: the right size, tapped
    const c0 = cardAt(SEED, 0)
    expectCard(c0)
    expect(screen.getByTestId('size-card')).toHaveAttribute('data-level', 'easy')
    fireEvent.click(tileFor(c0.shares))
    expect(screen.getByTestId('blitz-score')).toHaveTextContent(String(pointsFor(1)))
    expect(screen.queryByTestId('size-takeover')).toBeNull()

    // card 2 comes at once; a named mistake, picked by its number key
    const c1 = cardAt(SEED, 1)
    expectCard(c1)
    const k = c1.choices.findIndex((x) => x.mistake)
    const wrong = c1.choices[k]
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('57s left')
    fireEvent.keyDown(window, { key: String(k + 1) })
    const tk = screen.getByTestId('size-takeover')
    expect(tk).toHaveAttribute('data-correct', '0')
    expect(tk).toHaveTextContent(missTitle(c1, wrong.value))
    expect(tk).toHaveTextContent(`${sharesText(c1.shares)} shares`)
    expect(screen.getByTestId('size-why')).toHaveTextContent(whyLine(c1, wrong.value))
    const work = screen.getByTestId('size-working')
    const steps = working(c1)
    expect(steps[0].text).toMatch(/^Risk \$[\d,.]+ = \$[\d,]+ × [\d.]+%\.$/)
    expect(steps[1].text).toMatch(/^Per share \$[\d,.]+ = \$[\d,.]+ − \$[\d,.]+\.$/)
    for (const st of steps) expect(work).toHaveTextContent(st.text)
    expect(tk).toHaveTextContent('Stop first, distance second, size last.')
    expect(screen.getByTestId('blitz-score')).toHaveTextContent(String(pointsFor(1)))   // a miss scores nothing

    // the clock waits while the working holds the screen
    act(() => { vi.advanceTimersByTime(10000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('57s left')
    // a number key does nothing under the takeover
    fireEvent.keyDown(window, { key: '1' })
    expect(screen.getByTestId('size-takeover')).toBeInTheDocument()

    // Enter (the takeover's button) deals card 3 and the clock runs again
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(screen.queryByTestId('size-takeover')).toBeNull()
    expectCard(cardAt(SEED, 2))
    act(() => { vi.advanceTimersByTime(56000) })
    expect(screen.getByTestId('blitz-clock')).toHaveTextContent('1s left')
    expect(posts).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(1000) })

    // the end screen, the run's log, the slip it made, and one report
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.getByTestId('size-right')).toHaveTextContent('1/2')
    const log = screen.getByTestId('run-log')
    const cards = within(log).getAllByRole('listitem')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent(`${sharesText(c0.shares)} shares`)
    expect(cards[1]).toHaveTextContent(`you said ${sharesText(wrong.value)}`)
    expect(screen.getByTestId('size-slip')).toHaveTextContent('Your most common slip:')
    expect(screen.getByTestId('size-best-line')).toHaveTextContent('A new best.')
    expect(localStorage.getItem('study.size.best')).toBe(String(pointsFor(1)))
    await flush()
    expect(posts).toEqual([{ url: '/api/study/game-runs', body: { kind: 'size', run_id: runIdOf(SEED, 1), right: 1, total: 2 } }])
    expect(screen.getByTestId('size-level')).toHaveTextContent('+2 XP this run')
    expect(screen.getByTestId('size-done').textContent).not.toMatch(/—|the firm|NaN|undefined/i)

    // Back to Study closes; Again returns to the arena
    fireEvent.click(screen.getByRole('button', { name: /Back to Study/ }))
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('size-again'))
    expect(screen.getByTestId('size-intro')).toBeInTheDocument()
    await flush()
    expect(posts).toHaveLength(1)
  })

  it('shows the end screen whole without the level bar when the report fails, and says so when signed out', async () => {
    const fail = vi.fn(async () => { const e = new Error('POST /api/study/game-runs answered 401'); e.status = 401; throw e })
    render(<SizeItGame fetcher={fail} signedOut={<a data-testid="sign-in" href="/login">Sign in</a>} />)
    fireEvent.click(screen.getByTestId('size-start'))
    fireEvent.click(tileFor(cardAt(SEED, 0).shares))
    act(() => { vi.advanceTimersByTime(60000) })
    await flush()
    expect(fail).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.getByTestId('size-right')).toHaveTextContent('1/1')
    expect(screen.queryByTestId('size-level')).toBeNull()
    expect(screen.getByTestId('size-not-saved')).toHaveTextContent('signed out')
    expect(screen.getByTestId('sign-in')).toBeInTheDocument()
  })

  it('a server error that is not a sign-out leaves the end screen as it is, and a run with no answers reports nothing', async () => {
    const boom = vi.fn(async () => { const e = new Error('500'); e.status = 500; throw e })
    render(<SizeItGame fetcher={boom} />)
    fireEvent.click(screen.getByTestId('size-start'))
    const c0 = cardAt(SEED, 0)
    fireEvent.click(tileFor(c0.choices.find((x) => x.mistake).value))
    fireEvent.click(screen.getByTestId('size-takeover-go'))
    act(() => { vi.advanceTimersByTime(60000) })
    await flush()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.queryByTestId('size-level')).toBeNull()
    expect(screen.queryByTestId('size-not-saved')).toBeNull()
    expect(screen.getByTestId('size-best-line')).toHaveTextContent('Your best stands at')
    cleanup()

    const quiet = vi.fn()
    render(<SizeItGame fetcher={quiet} />)
    fireEvent.click(screen.getByTestId('size-start'))
    act(() => { vi.advanceTimersByTime(60000) })
    await flush()
    expect(screen.getByTestId('size-done')).toBeInTheDocument()
    expect(screen.getByTestId('size-slip')).toHaveTextContent('Every card is one rule')
    expect(quiet).not.toHaveBeenCalled()
  })
})
